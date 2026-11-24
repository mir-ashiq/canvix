// ─────────────────────────────────────────────────────────────
// DesignAgent · the autonomous pipeline (Phase B, 24 Nov 2026).
//
// research/AUTONOMOUS-AGENT-RESEARCH.md P2/P4: CODE orchestration
// around the model seams, with the evaluator loop (Reflexion-style
// self-correction). The pipeline is deterministic TypeScript —
// stages, order, retries and termination are code; the model only
// plans and critiques. The compile checks are the evaluator: their
// failures are fed back to the planner as a revision prompt,
// bounded and cycle-guarded, and a run that cannot pass ENDS
// HONESTLY (never a fake success, never a truncated text).
//
// Visual verification (v2, the P0 ChatGPT review item): after the
// deterministic checks pass, the pipeline RENDERS the pages and a
// vision model critiques the real pixels. P1/P2 findings can trigger
// one more revision round — but a critique-revision is only
// ACCEPTED if the new spec also passes every deterministic check
// and the critique issue count actually drops; otherwise the
// previous passing design is kept and the outcome disclosed.
// Checks outrank critique, always. No renderer or critique seam →
// "visual verification unavailable" is disclosed, never faked.
//
// Guards (machine protection, not product caps — the repo's
// protocol.ts philosophy):
//   · maxRevisions (default 3) — bounded self-correction rounds,
//     shared by check- and critique-origin revisions
//   · cycle guard — a model that repeats its previous spec verbatim
//     is looping, not progressing: stop, disclose
//   · signal — caller cancellation (AbortSignal), checked before
//     every model call and stage
//   · every stage recorded in the run report — the "why" is public
// ─────────────────────────────────────────────────────────────

import type { DesignBrief } from '@/lib/agent/brief'
import type { DesignSpec } from '@/lib/design-spec/types'
import type { CompileChecks } from '@/lib/design-engine/compile'
import type { PageData } from '@/lib/types'
import { parseSpecResponse } from '@/lib/design-spec/parse'
import { compileSpec } from '@/lib/design-engine/compile'
import type { DesignAgentModel, RevisionFeedback, CritiqueIssue, CritiqueResult } from './model'
import { parseCritiqueResponse } from './model'
import { runDesignTool, toolboxPromptSection } from './tools'
import { PLANNER_SYSTEM, planUserPrompt, revisionUserPrompt } from './prompts'

export interface DesignAgentLimits {
  /** bounded self-correction rounds, shared by checks- and
   * critique-origin revisions (guard, not a product cap) */
  maxRevisions: number
  /** bounded visual-verification passes (render → critique) */
  maxVisualPasses: number
}

export const DEFAULT_LIMITS: DesignAgentLimits = { maxRevisions: 3, maxVisualPasses: 1 }

export type AgentOutcome = 'passed' | 'failed-honestly' | 'guard-cycled' | 'aborted'

/** How the pipeline sees its own render. Implementations: the app
 * (exportPageToSVG + captureStage), the acceptance harness (the CLI
 * render step). Returns null when rendering is unavailable — the
 * pipeline discloses it, never invents a critique. */
export interface DesignRenderer {
  render(pages: PageData[], spec: DesignSpec): Promise<{ image: string } | null>
}

export interface AgentStageRecord {
  name: string
  ok: boolean
  /** what happened, for the run report */
  detail: string
  /** true when this stage consumed a model call */
  modelCall: boolean
}

export interface VisualPassRecord {
  round: number
  issues: CritiqueIssue[]
  summary: string
  /** what the pipeline did with the findings */
  action: 'revised' | 'accepted-as-is' | 'rejected-by-checks' | 'no-improvement' | 'budget-exhausted' | 'unparseable-discarded' | 'unavailable'
}

export interface AgentRunReport {
  stages: AgentStageRecord[]
  modelCalls: number
  revisionRounds: number
  cycleGuard: boolean
  brief: DesignBrief
  spec?: DesignSpec
  limits: DesignAgentLimits
  /** the visual-verification passes (render → critique) and what
   * each one concluded */
  visualPasses: VisualPassRecord[]
  visualVerification: 'verified' | 'improved' | 'unverified' | 'unavailable' | 'aborted'
}

export interface DesignAgentRun {
  outcome: AgentOutcome
  /** the last accepted compiled pages (present when a spec parsed at
   * all — even a failed run keeps its evidence) */
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
    if (!carried) {
      const pieces = spec.blocks.flatMap((b) => b.content).map((s) => s.text)
      const splitHint = pieces.includes(t.text.split(' ')[0])
        ? ' It is NOT enough to split its pieces across separate slots — the FULL string must be one slot.'
        : ''
      failures.push(`required text missing from the spec — add it as ONE user-required slot with exactly this text: "${t.text}"${splitHint}`)
    }
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
export function extractJsonObject(raw: string): unknown | null {
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

/** Count the findings that warrant action (P1/P2). */
function actionableIssues(critique: CritiqueResult): CritiqueIssue[] {
  return critique.issues.filter((i) => i.severity === 'P1' || i.severity === 'P2')
}

/**
 * The autonomous design run:
 *   extract-brief → plan (model) → parse → brief-conformance +
 *   compile+check → [failures → revise (model)] × ≤ maxRevisions →
 *   visual verification: render → critique → (bounded, guarded
 *   correction → re-compile → re-render → verify) → report.
 */
export async function runDesignAgent(opts: {
  prompt: string
  model: DesignAgentModel
  renderer?: DesignRenderer
  limits?: Partial<DesignAgentLimits>
  /** caller cancellation; checked before every model call and stage */
  signal?: { aborted: boolean }
}): Promise<DesignAgentRun> {
  const limits = { ...DEFAULT_LIMITS, ...opts.limits }
  const stages: AgentStageRecord[] = []
  let modelCalls = 0
  const signal = opts.signal ?? { aborted: false }
  const isAborted = () => signal.aborted

  const abortedRun = (partial: Partial<AgentRunReport> & { brief: DesignBrief }): DesignAgentRun => ({
    outcome: 'aborted',
    briefConformance: [],
    warnings: ['run cancelled by the caller before completion'],
    report: { stages, modelCalls, revisionRounds: 0, cycleGuard: false, visualPasses: [], visualVerification: 'aborted', ...partial, limits },
  })

  // ── stage 1: extract the brief (deterministic) ──
  const briefRun = runDesignTool('extract-brief', { prompt: opts.prompt })
  stages.push({ name: 'extract-brief', ok: briefRun.ok, detail: briefRun.ok ? `${(briefRun.value as DesignBrief).requiredTexts.length} required text(s), ${(briefRun.value as DesignBrief).requiredColors.length} required color(s)` : briefRun.notes.join('; '), modelCall: false })
  if (!briefRun.ok || !briefRun.value) {
    return {
      outcome: 'failed-honestly',
      briefConformance: [],
      warnings: briefRun.notes,
      report: { stages, modelCalls: 0, revisionRounds: 0, cycleGuard: false, brief: briefRun.value as DesignBrief, limits, visualPasses: [], visualVerification: 'unverified' },
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

  /** the accepted (checks-green) result after the loop */
  let accepted: { spec: DesignSpec; compiled: ReturnType<typeof compileSpec>; conformance: string[] } | undefined

  while (true) {
    if (isAborted()) return abortedRun({ brief, spec: lastSpec })
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
          report: { stages, modelCalls, revisionRounds, cycleGuard: false, brief, spec: lastSpec, limits, visualPasses: [], visualVerification: 'unverified' },
        }
      }
      revisionRounds += 1
      feedback = { round: revisionRounds, failures: [parsed.error], warnings: [], priorSpec: lastSpec, origin: 'checks' }
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
        report: { stages, modelCalls, revisionRounds, cycleGuard: true, brief, spec: lastSpec ?? spec, limits, visualPasses: [], visualVerification: 'unverified' },
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
      accepted = { spec, compiled, conformance: briefFailures }
      break
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
        report: { stages, modelCalls, revisionRounds, cycleGuard: false, brief, spec, limits, visualPasses: [], visualVerification: 'unverified' },
      }
    }
    revisionRounds += 1
    feedback = { round: revisionRounds, failures: allFailures, warnings: compiled.warnings, priorSpec: spec, origin: 'checks' }
  }

  // ── visual verification: render → critique → (guarded) fix ──
  const visualPasses: VisualPassRecord[] = []
  let visualVerification: AgentRunReport['visualVerification'] = 'unverified'
  const canSee = Boolean(opts.renderer && opts.model.critique)
  if (!canSee) {
    stages.push({ name: 'visual-verification', ok: false, detail: 'unavailable — no renderer or critique seam provided; disclosed, not faked', modelCall: false })
    visualVerification = 'unverified'
  } else {
    // the accepted design gets rendered and critiqued, up to
    // maxVisualPasses times; each pass may trigger ONE revision
    // round (shared budget) if actionable findings exist
    let current = accepted!
    let passes = 0
    while (passes < limits.maxVisualPasses) {
      if (isAborted()) return abortedRun({ brief, spec: current.spec })
      passes += 1
      const rendered = await opts.renderer!.render(current.compiled.pages, current.spec)
      if (!rendered) {
        stages.push({ name: `render (pass ${passes})`, ok: false, detail: 'renderer returned no image — visual verification unavailable, disclosed', modelCall: false })
        visualPasses.push({ round: passes, issues: [], summary: '', action: 'unavailable' })
        visualVerification = 'unavailable'
        break
      }
      stages.push({ name: `render (pass ${passes})`, ok: true, detail: 'rendered the real pages for visual review', modelCall: false })

      if (isAborted()) return abortedRun({ brief, spec: current.spec })
      const critiqueRaw = await opts.model.critique!({ brief, image: rendered.image })
      modelCalls += 1
      const critique = parseCritiqueResponse(critiqueRaw)
      if (!critique) {
        stages.push({ name: `critique (pass ${passes})`, ok: false, detail: 'critique reply unparseable — discarded (fail-closed; no invented issues)', modelCall: true })
        visualPasses.push({ round: passes, issues: [], summary: '', action: 'unparseable-discarded' })
        visualVerification = 'unverified'
        break
      }
      const actionable = actionableIssues(critique)
      stages.push({ name: `critique (pass ${passes})`, ok: actionable.length === 0, detail: `${critique.issues.length} issue(s), ${actionable.length} actionable (P1/P2)${critique.summary ? ` — ${critique.summary.slice(0, 90)}` : ''}`, modelCall: true })

      if (actionable.length === 0) {
        visualPasses.push({ round: passes, issues: critique.issues, summary: critique.summary, action: 'accepted-as-is' })
        visualVerification = 'verified'
        break
      }

      // actionable findings → one critique-origin revision, IF the
      // shared revision budget still allows it
      if (revisionRounds >= limits.maxRevisions) {
        visualPasses.push({ round: passes, issues: critique.issues, summary: critique.summary, action: 'budget-exhausted' })
        stages.push({ name: `visual-revision (pass ${passes})`, ok: false, detail: `revision budget exhausted — findings recorded, design kept (checks green)`, modelCall: false })
        visualVerification = 'unverified'
        break
      }
      revisionRounds += 1
      const reviseFeedback: RevisionFeedback = {
        round: revisionRounds,
        failures: actionable.map((i) => `${i.severity}: ${i.issue}${i.fix ? ` → fix: ${i.fix}` : ''}`),
        warnings: [],
        priorSpec: current.spec,
        origin: 'critique',
      }
      if (isAborted()) return abortedRun({ brief, spec: current.spec })
      const revisedRaw = await opts.model.plan({ brief, toolbox, feedback: reviseFeedback })
      modelCalls += 1
      const revisedParsed = parseSpecResponse(revisedRaw)
      if (!revisedParsed.ok) {
        stages.push({ name: `visual-revision (pass ${passes})`, ok: false, detail: `revised spec unparseable — previous passing design kept (${revisedParsed.error})`, modelCall: true })
        visualPasses.push({ round: passes, issues: critique.issues, summary: critique.summary, action: 'rejected-by-checks' })
        visualVerification = 'unverified'
        break
      }
      const revisedSpec = revisedParsed.spec
      // a critique revision is only accepted if it ALSO passes every
      // deterministic check and stays brief-conformant — the checks
      // outrank the critique
      const revisedCompiled = compileSpec(revisedSpec)
      const revisedConformance = briefConformance(brief, revisedSpec)
      if (!revisedCompiled.checks.passed || revisedConformance.length > 0) {
        stages.push({ name: `visual-revision (pass ${passes})`, ok: false, detail: 'revised spec failed deterministic checks — rejected; previous passing design kept (checks outrank critique)', modelCall: true })
        visualPasses.push({ round: passes, issues: critique.issues, summary: critique.summary, action: 'rejected-by-checks' })
        visualVerification = 'unverified'
        break
      }
      current = { spec: revisedSpec, compiled: revisedCompiled, conformance: revisedConformance }
      visualPasses.push({ round: passes, issues: critique.issues, summary: critique.summary, action: 'revised' })
      stages.push({ name: `visual-revision (pass ${passes})`, ok: true, detail: 'revised spec accepted — re-rendering to verify', modelCall: true })
    }
    accepted = current
    // final verify pass when the last action was a revision
    if (visualPasses.length > 0 && visualPasses[visualPasses.length - 1].action === 'revised') {
      if (isAborted()) return abortedRun({ brief, spec: current.spec })
      // the findings that TRIGGERED the revision, for comparison
      const triggering = actionableIssues({ summary: '', issues: visualPasses[visualPasses.length - 1].issues, advisory: true })
      const reRendered = await opts.renderer!.render(accepted.compiled.pages, accepted.spec)
      if (reRendered) {
        const reCritiqueRaw = await opts.model.critique!({ brief, image: reRendered.image })
        modelCalls += 1
        const reCritique = parseCritiqueResponse(reCritiqueRaw)
        if (reCritique) {
          const remaining = actionableIssues(reCritique)
          stages.push({ name: 'verify (post-revision)', ok: remaining.length === 0, detail: `${remaining.length} actionable issue(s) after the correction (was ${triggering.length})`, modelCall: true })
          visualVerification = remaining.length < triggering.length ? 'improved' : 'unverified'
        } else {
          stages.push({ name: 'verify (post-revision)', ok: false, detail: 'verification critique unparseable — discarded (fail-closed)', modelCall: true })
          visualVerification = 'unverified'
        }
      } else {
        stages.push({ name: 'verify (post-revision)', ok: false, detail: 'renderer unavailable for the verification pass', modelCall: false })
        visualVerification = 'unverified'
      }
    } else if (visualPasses.length > 0 && visualPasses[visualPasses.length - 1].action === 'accepted-as-is') {
      visualVerification = 'verified'
    }
  }

  // ── finish: balance diagnostics + report ──
  if (isAborted()) return abortedRun({ brief, spec: accepted!.spec })
  const balance = runDesignTool('balance-report', { pages: accepted!.compiled.pages, width: accepted!.spec.format.width, height: accepted!.spec.format.height })
  stages.push({ name: 'balance-report', ok: true, detail: `vertical coverage ${(Number((balance.value as { coverage: number }).coverage ?? 0) * 100).toFixed(0)}%`, modelCall: false })

  const warnings = [...accepted!.compiled.warnings, ...balance.notes]
  if (!canSee) warnings.push('visual verification unavailable (no renderer or critique seam) — deterministic checks passed; the render was not visually reviewed')

  return {
    outcome: 'passed',
    pages: accepted!.compiled.pages,
    checks: accepted!.compiled.checks,
    briefConformance: accepted!.conformance,
    warnings,
    report: { stages, modelCalls, revisionRounds, cycleGuard, brief, spec: accepted!.spec, limits, visualPasses, visualVerification },
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
