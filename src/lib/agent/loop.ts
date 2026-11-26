// ─────────────────────────────────────────────────────────────
// Agent loop (v0.28) — the task-driven engine.
//
// Protocol (docs/AGENT-ARCHITECTURE.md): the model speaks strict JSON
// turns; tools are sanitized at the boundary; validated actions are
// streamed to the CLIENT which applies them through applyDesignAction
// (editor parity + undo + collab for free). The server never writes
// the document during a run.
//
// v0.28 LIFECYCLE (Phase 4 — caps removed, guards kept):
//   Termination is TASK-DRIVEN: done / user stop / user decline /
//   fatal error. There is NO step or wall-clock product cap — a
//   40-step deck build with steady progress runs to completion.
//   Machine-protection guards (AGENT_GUARDS) end a run only when it
//   stops making progress: 3 consecutive strikes, an identical
//   tool+args cycle, or the idle clock. Guards force a WRAP-UP
//   ("state what's done and what remains"), never a silent kill.
//
//   MODES (Phase 8): the tool surface is built per mode — review/
//   explain/plan/discuss physically cannot write.
//
//   BRIEF (Phase 5): a done turn in a create/improve run must pass
//   brief validation (computed on the client against real state)
//   or the model is told the unmet items and continues.
//
//   COMPACTION: past AGENT_GUARDS.compactAtMessages the older
//   step/observation turns are folded into one summary message so
//   long runs stay inside provider context limits.
// ─────────────────────────────────────────────────────────────

import { AGENT_GUARDS, AGENT_PROTOCOL_VERSION, parseAgentTurn, type AgentEvent, type AgentMode, type AgentTurn } from './protocol'
import { AGENT_TOOLS, AGENT_TOOL_MAP, fontFamilies, type ToolContext, type SanitizeResult, type AgentTool } from './tools'
import { serializeDesignContext, contextValidIds, type AgentDesignCtx } from './context'
import { MODE_PROMPTS, MODE_TOOL_RISK } from './router'
import { skillsPromptSection, selectSkills, type DesignSkill } from './skills'
import { briefPromptSection, type DesignBrief } from './brief'
import type { VisionCritiqueResult } from './vision'

/** The model client the loop needs — a thin callable so the loop is
 *  unit-testable without the SDK. */
export type ChatFn = (messages: { role: 'system' | 'user' | 'assistant'; content: string }[]) => Promise<string>

export interface LoopDeps {
  chat: ChatFn
  design: AgentDesignCtx
  mode: AgentMode
  /** v0.32.2 (defect B, production report): the user's ORIGINAL
   *  request, verbatim. It becomes the first user message of the
   *  model conversation and survives compaction — the model must
   *  always be able to see what it was asked for, not a synthetic
   *  "User request mode: edit. Begin." placeholder (which starved
   *  the model of the actual creative brief: it kept inspecting the
   *  canvas, claimed no brief was given and created nothing). */
  request: string
  /** the run's brief contract (extracted by the route) */
  brief?: DesignBrief | null
  /** v0.29: local quality audit of the latest design snapshot
   *  (contrast/overlap/overflow heuristics). The loop runs ONE
   *  auto-fix round on its findings before accepting done. */
  auditDesign?: () => string[] | Promise<string[]>
  /** v0.29.3: ask the CLIENT to screenshot the live canvas (the real
   *  render) — resolved with a dataURL, or null on timeout/absence
   *  (fail-closed: visual verification is then DISCLOSED as
   *  unavailable, never silently skipped). */
  captureCanvas?: () => Promise<string | null>
  /** v0.29.3: grounded vision critique of a captured screenshot.
   *  Null when no vision model is configured — the run says so. */
  critique?: (image: string) => Promise<VisionCritiqueResult | null>
  /** skills pre-selected by the route (or auto-selected here) */
  skills?: DesignSkill[]
  /** emitted (by the route) as SSE lines */
  emit: (event: AgentEvent) => void
  /** the confirm map from the client: tool name → approved this run */
  confirmed?: ReadonlySet<string>
  /** abort signal (Stop button) — checked between steps */
  signal?: { aborted: boolean; reason?: string }
  /** resolve a destructive tool's confirmation (route bridges the SSE pause) */
  awaitConfirm?: (tool: string) => Promise<boolean>
  /** wait for the client's apply ack. v0.29.3: the route's
   *  implementation FAILS CLOSED — a timed-out ack resolves
   *  {ok:false} so the model is told the action was NOT applied
   *  instead of being told it succeeded. (The undefined default
   *  exists for the unit-test harness, which has no bridge.) */
  awaitApply?: () => Promise<{ ok: boolean; message?: string }>
  /** latest refreshed design context pushed by the client after applying */
  refreshedContext?: () => AgentDesignCtx
  /** client-side brief validation result (validated against real state) */
  validateBriefOnClient?: () => Promise<{ satisfied: boolean; unmet: string[] } | null>
}

export interface LoopResult {
  summary: string
  steps: number
  toolCalls: number
  findings?: { severity: 'P0' | 'P1' | 'P2' | 'P3'; issue: string; fix?: string }[]
  plan?: string[]
  verification?: string
}

/** Tools visible in this mode, filtered by risk tier. */
export function toolsForMode(mode: AgentMode): AgentTool[] {
  const allowed = MODE_TOOL_RISK[mode]
  return AGENT_TOOLS.filter((t) => allowed.includes(t.risk))
}

function toolsPromptSectionFor(mode: AgentMode): string {
  return toolsForMode(mode)
    .map((t) => `- ${t.name} (${t.risk}) — ${t.description} args: ${t.argsSpec}`)
    .join('\n')
}

/** The full system prompt for loop steps. */
export function loopSystemPrompt(deps: {
  design: AgentDesignCtx
  ctx: ToolContext
  mode: AgentMode
  brief?: DesignBrief | null
  skills?: DesignSkill[]
}): string {
  const { design, ctx, mode, brief, skills } = deps
  const lines: string[] = [
    'You are the Canvix design agent — an autonomous design assistant working inside a graphic editor.',
    'You see the CURRENT design state below. You act ONLY through tools, one per turn.',
    '',
    MODE_PROMPTS[mode],
    '',
    'Reply with ONE JSON object per turn, nothing else:',
    '{"thought": "one short sentence of reasoning", "tool": "tool_name", "args": { ... }}',
    'or when finished:',
    '{"done": true, "summary": "what you did, 1-2 sentences", "plan": ["…"], "findings": [{"severity":"P0|P1|P2|P3","issue":"…","fix":"…"}]}',
    '(plan for plan mode; findings for review mode)',
    '',
    'TOOLS (risk: read | write | destructive):',
    toolsPromptSectionFor(mode),
    '',
    `Fonts available (use EXACT names): ${fontFamilies().slice(0, 40).join(', ')}…`,
    '',
  ]

  if (brief) {
    const section = briefPromptSection(brief)
    if (section) lines.push(section, '')
  }

  if (mode === 'create' || mode === 'improve') {
    lines.push(
      'LAYOUT PLANNING (required first step):',
      '· Call plan_layout FIRST with your composition: page background, sections with y-ranges, what each contains (headline band, tagline, feature cards row, mockup, CTA, footer).',
      '· Reserve a vertical band per section with ≥40px gaps so nothing stacks or crowds; the brief texts each get their section.',
      '· Set the page background EARLY with set_background (a required background color belongs there, not in strips).',
      '· Build section by section after the plan. NEVER add bare decorative bars/strips just to include a required color — use colors as the page background, text fills, or real panel/card fills.',
      '· A realistic editor mockup = a large native panel (rounded rect, glass fill, border) CONTAINING inner native elements (toolbar bar, sidebar, canvas area, buttons) — not one empty rectangle.',
      '· Feature cards = one semi-transparent rect + its text per card. Glassmorphism = rgba fills with visible borders.',
      '',
    )
  }

  const skillSection = skillsPromptSection(skills ?? [])
  if (skillSection) lines.push(skillSection, '')

  lines.push(
    serializeDesignContext(design),
    '',
    'RULES:',
    '1. Use only element ids from the context. After structural edits (add/delete), call get_page_state to refresh ids.',
    '2. One tool per turn. Plan multi-step work up front; work steadily until the task is genuinely complete — there is no step limit, only a stop when you finish or stop making progress.',
    '3. Destructive tools (delete_elements, clear_page, delete_page on non-empty pages) need user confirmation — the system pauses and asks; do not repeat the call in the same turn.',
    '4. Keep 6% margins from page edges. Use measure_text for real text widths before finalizing headings — never rely on the 0.6×fontSize estimate for tight fits. Avoid overlaps; fix_overlaps resolves accidental ones.',
    '5. Prefer the BRAND KIT colors/fonts when one is given; the BRIEF always outranks it.',
    '6. When the goal is achieved, verify via get_page_state (once) and validate_brief (create/improve runs, and edit runs whose design carries a stored brief), then emit {"done":true,"summary":"…"}. Never claim work you did not do; never claim completion while validate_brief reports unmet items.',
    '7. Args must match each tool spec exactly. On an error observation, fix the args and retry — the error message tells you what to change.',
    '8. Tools edit the CURRENT page only. To work on another page: goto_page {page: N}, then get_page_state — ids change with the page. add_page appends the LAST page.',
    '9. In review/explain mode, ground every claim in the state you read. Report missing items as missing — never describe them as present.',
    '10. The document name in the context (e.g. "Music Festival") is just the FILE this request happens to run in — your summary describes what YOU BUILT FOR THIS REQUEST, never the document name. Distinguish "element exists" from "text is readable": only verified readable text counts as done.',
    '11. GROUND IN THE LIVE DESIGN: the element list above IS the current canvas (bottom-to-top z-order; the page background line is real). Build on THAT state — never assume an empty canvas, never re-create what already exists, and never invent imagery or a topic the user did not ask for. If the state looks stale, call get_page_state before acting.',
    '12. Verify-then-stop: before done, see what you actually built — get_page_state for structure, validate_brief for the contract, and (when the run critiques the captured canvas) the vision findings for what is REALLY visible. Fix what the checks report; only then finish. If a check cannot run, say so in the summary instead of claiming it passed.',
  )
  return lines.join('\n')
}

function observationFor(tool: string, result: SanitizeResult, ok: boolean): string {
  if (ok) return `Tool ${tool}: ${result.ok ? result.observation : ''}`
  return `ERROR in ${tool}: ${result.ok ? 'unknown error' : result.error}`
}

/** Hash a tool call for cycle detection. */
function callHash(tool: string, args: unknown): string {
  try {
    return `${tool}:${JSON.stringify(args ?? {})}`
  } catch {
    return `${tool}:?`
  }
}

/** Compact the message list: keep system + the first user message +
 *  the last turns, summarize the middle into one assistant note. */
function compactMessages(messages: { role: 'system' | 'user' | 'assistant'; content: string }[]): { compacted: typeof messages; from: number } {
  if (messages.length <= 12) return { compacted: messages, from: messages.length }
  const system = messages.slice(0, 1)
  const firstUser = messages.slice(1, 2)
  const tail = messages.slice(-8)
  const middle = Math.max(0, messages.length - 1 - 1 - 8)
  const summary = `[context compacted — ${middle} earlier turns summarized] Earlier in this run you completed several steps. Key outcomes persist in the CURRENT DESIGN STATE inside the system context; element ids from before a get_page_state refresh may be stale — call get_page_state if unsure. Continue the task; do not redo completed work.`
  return {
    compacted: [...system, ...firstUser, { role: 'assistant', content: summary }, ...tail],
    from: messages.length,
  }
}

export async function runAgentLoop(deps: LoopDeps): Promise<LoopResult> {
  const { chat, design, mode, emit, signal } = deps
  const brief = deps.brief ?? null
  const skills =
    deps.skills ??
    selectSkills(
      `${design.templateType ?? ''} ${design.name ?? ''} ${brief?.designType ?? ''}`,
      mode,
      !!(design.brand && (design.brand.colors?.length || design.brand.headingFont)),
    )

  const started = Date.now()
  let steps = 0
  let toolCalls = 0
  let modelCalls = 0
  let summary = ''
  let verification: string | undefined
  let strikes = 0
  let lastCallHash = ''
  let cycleCount = 0
  let lastProgressAt = started
  let lastUsageAt = started
  let briefValidated = false
  /** v0.29: quality-audit fix rounds already used (max 1 per run) */
  let auditRounds = 0
  /** v0.29.3: grounded vision passes already run (max 2 — initial
   *  critique + verification after the correction round) */
  let visionCritiques = 0
  /** v0.29.3: vision-driven correction rounds used (max 1 per run) */
  let visionCorrections = 0
  /** findings from the LAST vision critique (surface in the result) */
  let visionFindings: { severity: 'P0' | 'P1' | 'P2' | 'P3'; issue: string; fix?: string }[] | undefined
  /** true when the final vision pass still saw P0 defects */
  let visionBlocked = false
  /** done turns rejected by the brief gate — a model that keeps
   *  claiming completion without fixing the unmet items must not
   *  loop forever (LangChain's "declare it blocked" pattern). */
  let doneRejections = 0
  /** v0.32.2 (progress requirement): how many WRITE/DESTRUCTIVE tool
   *  calls were actually applied in this run. A create/improve run
   *  that changed NOTHING must not be reported as successfully
   *  created — the reproduction (empty canvas, model looped on
   *  get_page_state, claimed "no design brief provided") ended with
   *  a normal done summary over an untouched document. */
  let designChanges = 0
  /** done turns rejected because the run changed nothing yet */
  let emptyDoneRejections = 0

  const toolCtx: ToolContext = {
    validIds: contextValidIds(design),
    width: design.width ?? 1080,
    height: design.height ?? 1080,
    fonts: new Set(fontFamilies()),
  }

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: loopSystemPrompt({ design, ctx: toolCtx, mode, brief, skills }) },
    // v0.32.2 (defect B): the ORIGINAL user request is the actual
    // first user message. compactMessages always keeps messages[1],
    // so it survives compaction; tool observations and gate
    // feedback append AFTER it, never replace it. The mode guidance
    // lives in the system prompt (MODE_PROMPTS), not here.
    { role: 'user', content: deps.request },
  ]

  emit({ v: AGENT_PROTOCOL_VERSION, type: 'mode', mode, reason: `classified as ${mode}` })
  for (const s of skills) emit({ v: AGENT_PROTOCOL_VERSION, type: 'skill', id: s.id, name: s.name })
  if (brief) emit({ v: AGENT_PROTOCOL_VERSION, type: 'brief', brief: brief as unknown as Record<string, unknown> })

  // a run "makes progress" on every applied tool call
  const markProgress = () => {
    strikes = 0
    lastProgressAt = Date.now()
  }

  /** v0.32.2 (progress requirement): guard exits must be HONEST about
   *  what actually happened — a create/improve run that changed
   *  nothing is INCOMPLETE, never a wrapped-up success. */
  const guardExit = (base: string): { summary: string; verification: string | undefined } =>
    (mode === 'create' || mode === 'improve') && designChanges === 0
      ? {
          summary: `INCOMPLETE — no design changes were made. ${base}`,
          verification: 'NOT completed — the run ended without applying any design change; nothing was created.',
        }
      : { summary: base, verification }

  while (true) {
    // ── task-driven stops ───────────────────────────────────
    if (signal?.aborted) {
      emit({ v: AGENT_PROTOCOL_VERSION, type: 'aborted', reason: signal.reason ?? 'Stopped by user' })
      return { summary: summary || 'Stopped by the user.', steps, toolCalls, verification }
    }

    // ── resource guards (machine protection, NOT product caps) ──
    if (strikes >= AGENT_GUARDS.strikes) {
      // v0.29.2 (found on the PRODUCTION eval): striking out during the
      // quality-audit fix round must not kill an otherwise-complete
      // design. The canvas already passed the brief; the un-applied
      // polish is disclosed instead of failing the whole run.
      if (auditRounds > 0) {
        const disclosed = `${summary || 'Done.'} Note: quality-audit polish could not be applied (${AGENT_GUARDS.strikes} invalid patch attempts) — the validated design is kept as-is.`.slice(0, 800)
        emit({ v: AGENT_PROTOCOL_VERSION, type: 'done', summary: disclosed, steps, toolCalls, verification })
        return { summary: disclosed, steps, toolCalls, verification }
      }
      emit({
        v: AGENT_PROTOCOL_VERSION,
        type: 'error',
        message: `Stopped after ${AGENT_GUARDS.strikes} consecutive invalid tool calls — the error under each step explains what to fix; try rephrasing the request.`,
        code: 'STRIKES',
      })
      const exit = guardExit(summary || 'Stopped after repeated invalid calls.')
      return { summary: exit.summary, steps, toolCalls, verification: exit.verification }
    }
    if (Date.now() - lastProgressAt > AGENT_GUARDS.idleMs) {
      const exit = guardExit('The run stopped making progress and was wrapped up. Everything applied so far is kept — send a follow-up message to continue.')
      emit({
        v: AGENT_PROTOCOL_VERSION,
        type: 'done',
        summary: exit.summary,
        steps,
        toolCalls,
        verification: exit.verification,
      })
      return { summary: exit.summary, steps, toolCalls, verification: exit.verification }
    }

    // ── compaction (memory + provider context protection) ───
    if (messages.length > AGENT_GUARDS.maxMessages) {
      const { compacted, from } = compactMessages(messages)
      const to = compacted.length
      messages.length = 0
      messages.push(...compacted)
      emit({ v: AGENT_PROTOCOL_VERSION, type: 'compact', fromMessages: from, toMessages: to })
    }

    // ── one model turn ──────────────────────────────────────
    let raw = ''
    try {
      modelCalls += 1
      raw = await chat(messages)
    } catch (err) {
      emit({
        v: AGENT_PROTOCOL_VERSION,
        type: 'error',
        message: `The AI provider failed: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown error'}. Applied work is kept — retry to continue.`,
        code: 'PROVIDER',
      })
      const exit = guardExit(summary)
      return { summary: exit.summary, steps, toolCalls, verification: exit.verification }
    }

    const turn = parseAgentTurn(raw)
    if (!turn) {
      strikes += 1
      if (strikes < AGENT_GUARDS.strikes) {
        messages.push({ role: 'assistant', content: raw.slice(0, 500) })
        messages.push({
          role: 'user',
          content: 'That was not valid JSON. Reply with exactly one JSON object: {"thought","tool","args"} or {"done":true,"summary"}.',
        })
        continue
      }
      continue // the strike guard above ends the run next iteration
    }
    messages.push({ role: 'assistant', content: raw.slice(0, 2000) })

    // ── done? ────────────────────────────────────────────────
    if (turn.done) {
      summary = String(turn.summary ?? '').slice(0, 800) || 'Done.'
      // v0.32.2 (progress requirement): a create/improve run that has
      // not changed the document yet cannot claim completion. The
      // first such done is bounced with build guidance; the second
      // ends the run HONESTLY (never reported as a created design).
      if ((mode === 'create' || mode === 'improve') && designChanges === 0) {
        emptyDoneRejections += 1
        if (emptyDoneRejections >= 2) {
          const honest = `INCOMPLETE — no design changes were made. ${summary}`
          const noChangeVerification =
            'NOT completed — the run ended without applying any design change; nothing was created.'
          emit({ v: AGENT_PROTOCOL_VERSION, type: 'done', summary: honest, steps, toolCalls, verification: noChangeVerification })
          return { summary: honest, steps, toolCalls, verification: noChangeVerification }
        }
        messages.push({
          role: 'user',
          content:
            'NOT DONE — this is a create run and the canvas has not been changed yet. Build the requested design NOW with your tools: set_background first, then add_text for every headline/subline/CTA and add_rect/add_shape for structure (the user\u2019s original request is the first message of this conversation). Emit done only after the design exists on the canvas. If you believe you cannot proceed, explain exactly what is missing in your summary.',
        })
        continue
      }
      // BRIEF GATE (Phase 5): create/improve runs must validate
      // against real client state before completion is accepted.
      // v0.32 (Unified Canvix AI): an EDIT run that carries a brief
      // (the design's stored provenance merged with this message) is
      // gated too — a refinement may not finish while a requirement
      // the design was verified against has gone missing.
      if ((mode === 'create' || mode === 'improve' || (mode === 'edit' && brief)) && brief && deps.validateBriefOnClient && !briefValidated) {
        const v = await deps.validateBriefOnClient()
        if (v && !v.satisfied) {
          doneRejections += 1
          if (doneRejections >= 3) {
            // the model cannot or will not satisfy the brief — end
            // HONESTLY with the unmet list instead of looping
            const unmetList = v.unmet.map((u) => `· ${u}`).join('\n')
            const blockedSummary = `Stopped: the brief still has unmet requirements after ${doneRejections} completion attempts. Applied work is kept.\nUnmet:\n${unmetList}`
            emit({ v: AGENT_PROTOCOL_VERSION, type: 'done', summary: blockedSummary, steps, toolCalls })
            return { summary: blockedSummary, steps, toolCalls }
          }
          messages.push({
            role: 'user',
            content: `NOT DONE (attempt ${doneRejections} of 3) — brief validation against the real canvas found unmet requirements:\n${v.unmet.map((u) => `· ${u}`).join('\n')}\nFix these now with concrete tool calls (the exact values are in the DESIGN BRIEF CONTRACT), then emit done again. If a requirement is impossible, say so in your summary.`,
          })
          continue
        }
        if (v?.satisfied) {
          briefValidated = true
          verification = 'Brief contract validated against the live canvas — all mandatory items present.'
        }
      }
      // QUALITY AUDIT (v0.29): self-critique before the run is
      // accepted — local heuristics only, no extra model calls.
      // Exactly ONE fix round: done is then accepted with the residue
      // DISCLOSED (audit → fix → re-audit → honest outcome), never looped.
      if ((mode === 'create' || mode === 'improve') && deps.auditDesign) {
        let issues: string[] = []
        try {
          issues = (await deps.auditDesign()) ?? []
        } catch {
          /* audit is best-effort — never block completion on it */
        }
        if (issues.length && auditRounds === 0) {
          auditRounds += 1
          const list = issues.map((i) => `· ${i}`).join('\n')
          emit({
            v: AGENT_PROTOCOL_VERSION,
            type: 'observation',
            stepIndex: steps,
            message: `QUALITY AUDIT — ${issues.length} fixable issue(s) found:\n${list}`,
          })
          messages.push({
            role: 'user',
            content: `QUALITY AUDIT before completion — the canvas has these fixable problems:\n${list}\nFix them now with concrete tool calls (contrast: change the text fill; overflow: reduce fontSize, shorten text or widen the box; overlap/off-canvas: move or resize), then emit done again with an updated summary.`,
          })
          continue
        }
        if (!issues.length) {
          verification = verification
            ? `${verification} Quality audit passed: contrast, spacing and bounds clean.`
            : 'Quality audit passed: contrast, spacing and bounds clean.'
        } else if (auditRounds > 0) {
          verification = verification
            ? `${verification} Quality audit still reports ${issues.length} issue(s) after the fix round — disclosed, not blocking.`
            : `Quality audit still reports ${issues.length} issue(s) after the fix round — disclosed, not blocking.`
        }
      }

      // ── VISION ROUND (v0.29.3): grounded critique of the REAL
      // rendered canvas BEFORE completion is accepted. The failed
      // production runs critiqued AFTER claiming success — P0
      // findings ("CANVIX missing", clipped text, duplicates) could
      // never influence the design. Bounded: one critique now, one
      // correction round, one verification re-capture. A run whose
      // final capture still shows P0 defects does NOT claim success.
      if ((mode === 'create' || mode === 'improve') && deps.critique && visionCritiques < 2) {
        const shot = deps.captureCanvas ? await deps.captureCanvas() : null
        if (!shot) {
          // fail-closed: no capture → visual quality is NOT verified,
          // and the summary says so instead of implying it
          verification = verification
            ? `${verification} Visual critique UNAVAILABLE (canvas capture timed out or no client) — geometry checks only; visual quality NOT verified.`
            : 'Visual critique UNAVAILABLE (canvas capture timed out or no client) — geometry checks only; visual quality NOT verified.'
          visionCritiques = 2 // don't retry the capture path this run
        } else {
          visionCritiques += 1
          const critique = await deps.critique(shot)
          if (!critique) {
            verification = verification
              ? `${verification} Visual critique unavailable (no vision model configured or provider error) — geometry checks only; visual quality NOT verified.`
              : 'Visual critique unavailable (no vision model configured or provider error) — geometry checks only; visual quality NOT verified.'
            visionCritiques = 2
          } else {
            visionFindings = critique.findings
            const critical = critique.findings.filter((f) => f.severity === 'P0' || f.severity === 'P1')
            const emitList = critique.findings.map((f) => `${f.severity} ${f.issue}`).join('\n')
            if (critical.length && visionCorrections === 0) {
              // one bounded correction pass: feed the grounded P0/P1
              // findings to the model, let it fix, then the NEXT done
              // attempt re-captures and verifies (visionCritiques is
              // already 1, so one more pass is allowed)
              visionCorrections += 1
              emit({
                v: AGENT_PROTOCOL_VERSION,
                type: 'observation',
                stepIndex: steps,
                message: `VISION CRITIQUE (grounded in the rendered canvas):\n${emitList}\nA correction pass for the P0/P1 findings follows; P2/P3 are advisory.`,
              })
              messages.push({
                role: 'user',
                content: `VISION CRITIQUE of the RENDERED canvas (a real screenshot — these are grounded findings, not guesses):\n${emitList}\nFix the P0 and P1 findings now with concrete tool calls (missing text → add it verbatim; clipped/hidden text → resize, move or reorder; duplicates → delete the extras; contrast → change fills). Do not restate your plan — act, then emit done again.`,
              })
              continue
            }
            // verification state after the final pass
            const remainingP0 = critique.findings.filter((f) => f.severity === 'P0')
            if (remainingP0.length) {
              visionBlocked = true
              verification = `NOT visually verified — ${remainingP0.length} P0 visual defect(s) remain on the rendered canvas:\n${remainingP0.map((f) => `· ${f.issue}`).join('\n')}\nThe design is NOT confirmed correct; the issues above need a follow-up.`
              summary = `INCOMPLETE — P0 visual defects remain after the correction pass. ${summary}`
            } else if (critical.length) {
              verification = verification
                ? `${verification} Visual critique: P1/P2/P3 findings remain (disclosed) — no P0 defects on the rendered canvas.`
                : `Visual critique: P1/P2/P3 findings remain (disclosed) — no P0 defects on the rendered canvas.`
            } else {
              verification = verification
                ? `${verification} Visual verification PASSED against the rendered canvas — all required content visibly readable.`
                : 'Visual verification PASSED against the rendered canvas — all required content visibly readable.'
            }
          }
        }
      }

      emit({ v: AGENT_PROTOCOL_VERSION, type: 'done', summary, steps, toolCalls, verification })
      return {
        summary,
        steps,
        toolCalls,
        findings: [...(turn.findings ?? []), ...(visionFindings ?? [])],
        plan: turn.plan,
        verification,
      }
    }

    // ── a tool call ──────────────────────────────────────────
    const toolName = typeof turn.tool === 'string' ? turn.tool : ''
    const allowed = toolsForMode(mode)
    const tool = AGENT_TOOL_MAP.get(toolName)
    const thought = String(turn.thought ?? '').slice(0, 300)
    if (!tool) {
      const known = allowed.slice(0, 8).map((t) => t.name).join(', ')
      strikes += 1
      messages.push({
        role: 'user',
        content: `ERROR: unknown tool "${toolName}". Valid tools in ${mode} mode: ${known}${allowed.length > 8 ? '…' : ''}. Retry with a valid tool.`,
      })
      continue
    }
    if (!allowed.includes(tool)) {
      // the tool exists but is outside this mode's surface
      strikes += 1
      messages.push({
        role: 'user',
        content: `ERROR: "${toolName}" is not available in ${mode} mode (it modifies the design). This mode is read-only. Analyze with get_page_state and report findings instead.`,
      })
      continue
    }
    emit({ v: AGENT_PROTOCOL_VERSION, type: 'step', index: steps, thought, tool: toolName })

    const args = (turn.args && typeof turn.args === 'object' && !Array.isArray(turn.args) ? turn.args : {}) as Record<string, unknown>
    const result = tool.sanitize(args, toolCtx)

    // plan_layout (v0.29.3): read-only planning pseudo-tool — the
    // plan is streamed to the user (the 'plan' event) and echoed as
    // an observation. No apply/ack round trip: a plan changes nothing.
    if (toolName === 'plan_layout' && result.ok) {
      const planLines = (result.actions as { type: string; lines?: string[] }[])
        .flatMap((a) => (a && a.type === '__planLayout' && Array.isArray(a.lines) ? a.lines : []))
      const lines = planLines.length ? planLines : ['(model emitted an empty plan)']
      emit({ v: AGENT_PROTOCOL_VERSION, type: 'plan', steps: lines })
      emit({ v: AGENT_PROTOCOL_VERSION, type: 'observation', stepIndex: steps, message: result.observation })
      steps += 1
      markProgress()
      messages.push({
        role: 'user',
        content: `${result.observation}\nNow execute the plan: set_background first, then build section by section. Adjust the plan as reality demands — the plan is a reservation of space, not a cage.`,
      })
      continue
    }

    // validate_brief is a read-only pseudo-action: the client answers
    // on the bridge (briefResult), so there is NO apply/ack round
    // trip — awaiting one dropped the client's early answer (found by
    // the live NIM eval: 60s ack timeout + lost validation result)
    if (toolName === 'validate_brief' && deps.validateBriefOnClient) {      emit({
        v: AGENT_PROTOCOL_VERSION,
        type: 'action',
        stepIndex: steps,
        callId: `call-${steps}-${Math.random().toString(36).slice(2, 8)}`,
        risk: 'read',
        tool: toolName,
        actions: result.ok ? result.actions : [],
      })
      const v = await deps.validateBriefOnClient()
      steps += 1
      markProgress()
      if (v) {
        const msg = v.satisfied
          ? 'BRIEF VALIDATION PASSED — every mandatory text, color and dimension is present on the canvas. You may emit done.'
          : `BRIEF VALIDATION FAILED — unmet requirements:\n${v.unmet.map((u) => `· ${u}`).join('\n')}\nFix these now, then re-validate.`
        emit({ v: AGENT_PROTOCOL_VERSION, type: 'observation', stepIndex: steps - 1, message: msg })
        messages.push({ role: 'user', content: msg })
        if (v.satisfied) {
          briefValidated = true
          verification = 'Brief contract validated against the live canvas.'
        }
      } else {
        emit({ v: AGENT_PROTOCOL_VERSION, type: 'observation', stepIndex: steps - 1, message: 'Brief validation unavailable on this client.' })
        messages.push({ role: 'user', content: 'Brief validation was unavailable (no client response). Verify the required items yourself with get_page_state before finishing.' })
      }
      continue
    }

    // cycle detection: the identical call twice in a row is tolerated
    // (a legitimate retry), the THIRD consecutive identical attempt
    // wraps the run up BEFORE applying it — repeating the same
    // operation a third time cannot add anything
    const hash = callHash(toolName, args)
    if (result.ok) {
      if (hash === lastCallHash) {
        cycleCount += 1
        if (cycleCount >= AGENT_GUARDS.cycleRepeat - 1) {
          const exit = guardExit('The run repeated the same operation without effect and was wrapped up. Applied work is kept — describe the next change to continue.')
          emit({
            v: AGENT_PROTOCOL_VERSION,
            type: 'done',
            summary: exit.summary,
            steps,
            toolCalls,
            verification: exit.verification,
          })
          return { summary: exit.summary, steps, toolCalls, verification: exit.verification }
        }
      } else {
        cycleCount = 0
      }
      lastCallHash = hash
    }

    if (!result.ok) {
      // free correction: rejected calls cost only a strike
      strikes += 1
      messages.push({ role: 'user', content: observationFor(toolName, result, false) })
      continue
    }

    // ── destructive gate ────────────────────────────────────
    if (tool.risk === 'destructive' && !deps.confirmed?.has(toolName)) {
      emit({
        v: AGENT_PROTOCOL_VERSION,
        type: 'action',
        stepIndex: steps,
        callId: `call-${steps}-${Math.random().toString(36).slice(2, 8)}`,
        risk: 'destructive',
        tool: toolName,
        actions: result.actions,
      })
      const approved = await deps.awaitConfirm?.(toolName) ?? false
      if (!approved) {
        messages.push({
          role: 'user',
          content: `The user DECLINED the ${toolName} call. Do not retry it. Continue with non-destructive tools or finish.`,
        })
        continue
      }
      const ack = (await deps.awaitApply?.()) ?? { ok: true }
      if (!ack.ok) {
        messages.push({
          role: 'user',
          content: `ERROR applying ${toolName}: ${ack.message ?? 'client rejected the action'}. The document was NOT changed. Adjust and retry or finish.`,
        })
        continue
      }
    } else {
      emit({
        v: AGENT_PROTOCOL_VERSION,
        type: 'action',
        stepIndex: steps,
        callId: `call-${steps}-${Math.random().toString(36).slice(2, 8)}`,
        risk: tool.risk,
        tool: toolName,
        actions: result.actions,
      })
      const ack = (await deps.awaitApply?.()) ?? { ok: true }
      if (!ack.ok) {
        messages.push({
          role: 'user',
          content: `ERROR applying ${toolName}: ${ack.message ?? 'client rejected the action'}. The document was NOT changed. Adjust and retry or finish.`,
        })
        continue
      }
    }

    toolCalls += 1
    steps += 1
    markProgress()
    // v0.32.2: only real writes count as design changes (reads —
    // get_page_state/measure/plan/validate — never do)
    if (tool.risk === 'write' || tool.risk === 'destructive') designChanges += 1
    emit({ v: AGENT_PROTOCOL_VERSION, type: 'observation', stepIndex: steps - 1, message: result.observation })

    // usage telemetry: immediately on the first apply, then at most
    // every 2s (the panel shows live counts without waiting)
    const now = Date.now()
    if (toolCalls === 1 || now - lastUsageAt > 2000) {
      lastUsageAt = now
      emit({ v: AGENT_PROTOCOL_VERSION, type: 'usage', turns: steps, toolCalls, elapsedMs: now - started, modelCalls })
    }

    // get_page_state: inject the refreshed context the client sent
    if (toolName === 'get_page_state' && deps.refreshedContext) {
      const refreshed = deps.refreshedContext()
      messages.push({
        role: 'user',
        content: `UPDATED PAGE STATE (fresh from the client after your edits):\n${serializeDesignContext(refreshed)}`,
      })
      // refresh the local tool context too — new ids are valid now
      toolCtx.validIds = contextValidIds(refreshed)
      continue
    }


    messages.push({ role: 'user', content: observationFor(toolName, result, true) })

    // disclose approaching compaction so the model wraps up cleanly
    if (messages.length === AGENT_GUARDS.turnWarnAt) {
      messages.push({
        role: 'user',
        content: `NOTE: this conversation is getting long (${messages.length} messages). Wrap up the remaining work efficiently; older turns will be summarized soon.`,
      })
    }
  }
}

export { selectSkills }
