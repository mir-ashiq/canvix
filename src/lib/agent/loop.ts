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

/** The model client the loop needs — a thin callable so the loop is
 *  unit-testable without the SDK. */
export type ChatFn = (messages: { role: 'system' | 'user' | 'assistant'; content: string }[]) => Promise<string>

export interface LoopDeps {
  chat: ChatFn
  design: AgentDesignCtx
  mode: AgentMode
  /** the run's brief contract (extracted by the route) */
  brief?: DesignBrief | null
  /** v0.29: local quality audit of the latest design snapshot
   *  (contrast/overlap/overflow heuristics). The loop runs ONE
   *  auto-fix round on its findings before accepting done. */
  auditDesign?: () => string[] | Promise<string[]>
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
  /** wait for the client's apply ack */
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
    '6. When the goal is achieved, verify via get_page_state (once) and validate_brief (create/improve runs), then emit {"done":true,"summary":"…"}. Never claim work you did not do; never claim completion while validate_brief reports unmet items.',
    '7. Args must match each tool spec exactly. On an error observation, fix the args and retry — the error message tells you what to change.',
    '8. Tools edit the CURRENT page only. To work on another page: goto_page {page: N}, then get_page_state — ids change with the page. add_page appends the LAST page.',
    '9. In review/explain mode, ground every claim in the state you read. Report missing items as missing — never describe them as present.',
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
  /** done turns rejected by the brief gate — a model that keeps
   *  claiming completion without fixing the unmet items must not
   *  loop forever (LangChain's "declare it blocked" pattern). */
  let doneRejections = 0

  const toolCtx: ToolContext = {
    validIds: contextValidIds(design),
    width: design.width ?? 1080,
    height: design.height ?? 1080,
    fonts: new Set(fontFamilies()),
  }

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: loopSystemPrompt({ design, ctx: toolCtx, mode, brief, skills }) },
    {
      role: 'user',
      content: `User request mode: ${mode}. Begin.${
        mode === 'discuss' || mode === 'explain' ? ' Answer the question directly and emit done with your answer in the summary.' : ''
      }`,
    },
  ]

  emit({ v: AGENT_PROTOCOL_VERSION, type: 'mode', mode, reason: `classified as ${mode}` })
  for (const s of skills) emit({ v: AGENT_PROTOCOL_VERSION, type: 'skill', id: s.id, name: s.name })
  if (brief) emit({ v: AGENT_PROTOCOL_VERSION, type: 'brief', brief: brief as unknown as Record<string, unknown> })

  // a run "makes progress" on every applied tool call
  const markProgress = () => {
    strikes = 0
    lastProgressAt = Date.now()
  }

  while (true) {
    // ── task-driven stops ───────────────────────────────────
    if (signal?.aborted) {
      emit({ v: AGENT_PROTOCOL_VERSION, type: 'aborted', reason: signal.reason ?? 'Stopped by user' })
      return { summary: summary || 'Stopped by the user.', steps, toolCalls, verification }
    }

    // ── resource guards (machine protection, NOT product caps) ──
    if (strikes >= AGENT_GUARDS.strikes) {
      emit({
        v: AGENT_PROTOCOL_VERSION,
        type: 'error',
        message: `Stopped after ${AGENT_GUARDS.strikes} consecutive invalid tool calls — the error under each step explains what to fix; try rephrasing the request.`,
        code: 'STRIKES',
      })
      return { summary: summary || 'Stopped after repeated invalid calls.', steps, toolCalls, verification }
    }
    if (Date.now() - lastProgressAt > AGENT_GUARDS.idleMs) {
      emit({
        v: AGENT_PROTOCOL_VERSION,
        type: 'done',
        summary: 'The run stopped making progress and was wrapped up. Everything applied so far is kept — send a follow-up message to continue.',
        steps,
        toolCalls,
        verification,
      })
      return { summary, steps, toolCalls, verification }
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
      return { summary, steps, toolCalls, verification }
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
      // BRIEF GATE (Phase 5): create/improve runs must validate
      // against real client state before completion is accepted
      if ((mode === 'create' || mode === 'improve') && brief && deps.validateBriefOnClient && !briefValidated) {
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
      emit({ v: AGENT_PROTOCOL_VERSION, type: 'done', summary, steps, toolCalls, verification })
      return { summary, steps, toolCalls, findings: turn.findings, plan: turn.plan, verification }
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

    // validate_brief is a read-only pseudo-action: the client answers
    // on the bridge (briefResult), so there is NO apply/ack round
    // trip — awaiting one dropped the client's early answer (found by
    // the live NIM eval: 60s ack timeout + lost validation result)
    if (toolName === 'validate_brief' && deps.validateBriefOnClient) {
      emit({
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
          emit({
            v: AGENT_PROTOCOL_VERSION,
            type: 'done',
            summary: 'The run repeated the same operation without effect and was wrapped up. Applied work is kept — describe the next change to continue.',
            steps,
            toolCalls,
            verification,
          })
          return { summary, steps, toolCalls, verification }
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
