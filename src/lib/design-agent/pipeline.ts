// ─────────────────────────────────────────────────────────────
// DesignAgent · the autonomous pipeline (Phase B, 24 Nov 2026).
//
// research/AUTONOMOUS-AGENT-RESEARCH.md P2/P4: CODE orchestration
// around the model seams, with the evaluator loop (Reflexion-style
// self-correction). The pipeline is deterministic TypeScript —
// stages, order, retries and termination are code; the model only
// plans and (optionally) critiques. The compile checks are the
// evaluator: their failures are fed back to the planner as a
// revision prompt, bounded and cycle-guarded, and a run that cannot
// pass ENDS HONESTLY (never a fake success, never a truncated
// required text).
//
// Guards (machine protection, not product caps — the repo's
// protocol.ts philosophy):
//   · maxRevisions (default 3) — bounded self-correction rounds
//   · cycle guard — a model that repeats its previous spec verbatim
//     is looping, not progressing: stop, disclose
//   · every stage recorded in the run report — the "why" is public
// ─────────────────────────────────────────────────────────────

import type { DesignBrief } from '@/lib/agent/brief'
import type { DesignSpec } from '@/lib/design-spec/types'
import type { CompileChecks } from '@/lib/design-engine/compile'
import type { PageData } from '@/lib/types'
import { parseSpecResponse } from '@/lib/design-spec/parse'
import { compileSpec } from '@/lib/design-engine/compile'
import type { DesignAgentModel, RevisionFeedback } from './model'
import { runDesignTool, toolboxPromptSection } from './tools'
import { PLANNER_SYSTEM, planUserPrompt, revisionUserPrompt } from './prompts'

export interface DesignAgentLimits {
  /** bounded self-correction rounds (guard, not a product cap) */
  maxRevisions: number
}

export const DEFAULT_LIMITS: DesignAgentLimits = { maxRevisions: 3 }

export type AgentOutcome = 'passed' | 'failed-honestly' | 'guard-cycled'

export interface AgentStageRecord {
  name: string
  ok: boolean
  /** what happened, for the run report */
  detail: string
  /** true when this stage consumed a model call */
  modelCall: boolean
}

export interface AgentRunReport {
  stages: AgentStageRecord[]
  modelCalls: number
  revisionRounds: number
  cycleGuard: boolean
  brief: DesignBrief
  spec?: DesignSpec
  limits: DesignAgentLimits
}

export interface DesignAgentRun {
  outcome: AgentOutcome
  /** the last compiled pages (present when a spec parsed at all —
   * even a failed run keeps its evidence) */
  pages?: PageData[]
  checks?: CompileChecks
  /** brief→spec conformance failures (the model dropped or altered
   * something the user required). Empty on a passing run. */
  briefConformance: string[]
  warnings: string[]
  report: AgentRunReport
}

/**
 * Brief→spec conformance: the evaluator the ENGINE cannot run (it
 * validates spec→page; only the agent layer knows what the brief
 * demanded of the spec). A model that paraphrases, drops or recases
 * a user-required text, forgets a required hex, or changes the
 * requested dimensions fails HERE — deterministically, with the
 * exact requirement quoted back for the revision round.
 */
export function briefConformance(brief: DesignBrief, spec: DesignSpec): string[] {
  const failures: string[] = []
  for (const t of brief.requiredTexts) {
    const carried = spec.blocks.some((b) =>
      b.content.some((s) => s.source === 'user-required' && s.text.normalize('NFC') === t.text.normalize('NFC')),
    )
    if (!carried) failures.push(`required text missing from the spec — add it as a user-required slot with this EXACT text: "${t.text}"`)
  }
  for (const c of brief.requiredColors) {
    const pinned = Object.values(spec.palette.pinned ?? {})
    const carried =
      spec.palette.seeds.some((s) => s.trim().toLowerCase() === c.hex.trim().toLowerCase()) ||
      pinned.some((s) => typeof s === 'string' && s.trim().toLowerCase() === c.hex.trim().toLowerCase())
    if (!carried) failures.push(`required color ${c.hex} missing from palette.seeds — add it verbatim`)
  }
  if (brief.dimensions) {
    const { width, height } = brief.dimensions
    if (spec.format.width !== width || spec.format.height !== height) {
      failures.push(`dimensions must be ${width}x${height} per the brief — spec says ${spec.format.width}x${spec.format.height}`)
    }
  }
  return failures
}

/** Extract one JSON object from a model reply (tolerant of fences
 * and prose; the same tolerance loop.ts's parseAgentTurn has). */
function extractJsonObject(raw: string): unknown | null {
  const cleaned = raw.replace(/```(?:json)?/gi, '')
  for (let start = cleaned.indexOf('{'); start !== -1; start = cleaned.indexOf('{', start + 1)) {
    const end = cleaned.lastIndexOf('}')
    if (end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1))
      } catch {
        // keep scanning
      }
    }
  }
  return null
}

/**
 * The autonomous design run:
 *   extract-brief → plan (model) → parse → compile+check →
 *   [failures → revise (model)] × ≤ maxRevisions → report.
 */
export async function runDesignAgent(opts: {
  prompt: string
  model: DesignAgentModel
  limits?: Partial<DesignAgentLimits>
}): Promise<DesignAgentRun> {
  const limits = { ...DEFAULT_LIMITS, ...opts.limits }
  const stages: AgentStageRecord[] = []
  let modelCalls = 0

  // ── stage 1: extract the brief (deterministic) ──
  const briefRun = runDesignTool('extract-brief', { prompt: opts.prompt })
  stages.push({ name: 'extract-brief', ok: briefRun.ok, detail: briefRun.ok ? `${(briefRun.value as DesignBrief).requiredTexts.length} required text(s), ${(briefRun.value as DesignBrief).requiredColors.length} required color(s)` : briefRun.notes.join('; '), modelCall: false })
  if (!briefRun.ok || !briefRun.value) {
    return {
      outcome: 'failed-honestly',
      briefConformance: [],
      warnings: briefRun.notes,
      report: { stages, modelCalls: 0, revisionRounds: 0, cycleGuard: false, brief: briefRun.value as DesignBrief, limits },
    }
  }
  const brief = briefRun.value as DesignBrief
  const toolbox = toolboxPromptSection()

  // ── the plan/compile/revise loop (evaluator loop, bounded) ──
  const seenSpecs: string[] = []
  let revisionRounds = 0
  let cycleGuard = false
  let lastSpec: DesignSpec | undefined
  let lastCompile: ReturnType<typeof compileSpec> | undefined
  let feedback: RevisionFeedback | undefined

  while (true) {
    // plan seam (model)
    const raw = await opts.model.plan({ brief, toolbox, feedback })
    modelCalls += 1

    // parse (deterministic, honest failure)
    const parsed = parseSpecResponse(raw)
    if (!parsed.ok) {
      stages.push({ name: `plan+parse (round ${revisionRounds + 1})`, ok: false, detail: `parse failed: ${parsed.error}`, modelCall: true })
      // a parse failure with no prior spec: nothing to revise against
      if (!lastSpec || revisionRounds >= limits.maxRevisions) {
        return {
          outcome: 'failed-honestly',
          briefConformance: [],
          warnings: [parsed.error],
          report: { stages, modelCalls, revisionRounds, cycleGuard: false, brief, spec: lastSpec, limits },
        }
      }
      revisionRounds += 1
      feedback = { round: revisionRounds, failures: [parsed.error], warnings: [], priorSpec: lastSpec }
      continue
    }
    const spec = parsed.spec

    // cycle guard: the model repeated itself verbatim — no progress
    const canonical = JSON.stringify(spec)
    if (seenSpecs.includes(canonical)) {
      cycleGuard = true
      stages.push({ name: `cycle-guard (round ${revisionRounds + 1})`, ok: false, detail: 'model repeated its previous spec verbatim — looping, not progressing; run stops honestly', modelCall: false })
      return {
        outcome: 'guard-cycled',
        pages: lastCompile?.pages,
        checks: lastCompile?.checks,
        briefConformance: lastSpec ? briefConformance(brief, lastSpec) : [],
        warnings: [...(lastCompile?.warnings ?? []), 'revision loop detected: the model repeated its spec verbatim'],
        report: { stages, modelCalls, revisionRounds, cycleGuard: true, brief, spec: lastSpec ?? spec, limits },
      }
    }
    seenSpecs.push(canonical)

    // compile + evaluate (deterministic) — engine checks spec→page,
    // brief conformance checks brief→spec: BOTH must be clean
    const compiled = compileSpec(spec)
    const briefFailures = briefConformance(brief, spec)
    const allFailures = [...briefFailures, ...compiled.checks.failures]
    lastSpec = spec
    lastCompile = compiled

    if (allFailures.length === 0 && compiled.checks.passed) {
      stages.push({ name: `brief-conformance (round ${revisionRounds + 1})`, ok: true, detail: 'spec carries every required text, color and dimension', modelCall: false })
      stages.push({ name: `compile+check (round ${revisionRounds + 1})`, ok: true, detail: 'all checks passed', modelCall: false })
      const balance = runDesignTool('balance-report', { pages: compiled.pages, width: spec.format.width, height: spec.format.height })
      stages.push({ name: 'balance-report', ok: true, detail: `vertical coverage ${(Number((balance.value as { coverage: number }).coverage ?? 0) * 100).toFixed(0)}%`, modelCall: false })
      return {
        outcome: 'passed',
        pages: compiled.pages,
        checks: compiled.checks,
        briefConformance: [],
        warnings: [...compiled.warnings, ...balance.notes],
        report: { stages, modelCalls, revisionRounds, cycleGuard: false, brief, spec, limits },
      }
    }

    // failed → feedback → revise (bounded)
    stages.push({ name: `brief-conformance (round ${revisionRounds + 1})`, ok: briefFailures.length === 0, detail: briefFailures.join('; ') || 'conformant', modelCall: false })
    stages.push({ name: `compile+check (round ${revisionRounds + 1})`, ok: compiled.checks.passed, detail: compiled.checks.failures.join('; ') || 'all checks passed', modelCall: false })
    if (revisionRounds >= limits.maxRevisions) {
      return {
        outcome: 'failed-honestly',
        pages: compiled.pages,
        checks: compiled.checks,
        briefConformance: briefFailures,
        warnings: [...compiled.warnings, `revision budget exhausted (${limits.maxRevisions}) — run ends honestly with the failures visible`],
        report: { stages, modelCalls, revisionRounds, cycleGuard: false, brief, spec, limits },
      }
    }
    revisionRounds += 1
    feedback = { round: revisionRounds, failures: allFailures, warnings: compiled.warnings, priorSpec: spec }
  }
}

/** Extract a spec-shaped object from a raw model reply WITHOUT the
 * strict parse (used by the acceptance harness when a scripted or
 * file-based planner needs tolerant extraction). */
export function tolerantParseSpec(raw: string): DesignSpec | null {
  const obj = extractJsonObject(raw)
  if (!obj || typeof obj !== 'object') return null
  const parsed = parseSpecResponse(JSON.stringify(obj))
  return parsed.ok ? parsed.spec : null
}

export { extractJsonObject }
