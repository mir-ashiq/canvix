// ─────────────────────────────────────────────────────────────
// Agent loop (v0.27) — the multi-step engine.
//
// Protocol (docs/AGENT-ARCHITECTURE.md): the model speaks strict JSON
// turns; tools are sanitized at the boundary; validated actions are
// streamed to the CLIENT which applies them through applyDesignAction
// (editor parity + undo + collab for free). The server never writes
// the document during a run.
//
// Failure discipline (Loomic's lessons):
//  · over-ambition  → step/tool-call/wall-clock budgets
//  · false completion → the final observation always carries fresh
//    spatial analysis so "done" is grounded in the real page state
//  · parse errors → one repair retry with the error shown, then stop
// ─────────────────────────────────────────────────────────────

import { AGENT_BUDGETS, parseAgentTurn, type AgentEvent, type AgentTurn } from './protocol'
import { AGENT_TOOL_MAP, toolsPromptSection, fontFamilies, type ToolContext, type SanitizeResult } from './tools'
import { serializeDesignContext, contextValidIds, type AgentDesignCtx } from './context'

/** The model client the loop needs — a thin callable so the loop is
 *  unit-testable without the SDK. */
export type ChatFn = (messages: { role: 'system' | 'user' | 'assistant'; content: string }[]) => Promise<string>

export interface LoopDeps {
  chat: ChatFn
  design: AgentDesignCtx
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
}

/** The full system prompt for loop steps. */
export function loopSystemPrompt(design: AgentDesignCtx, ctx: ToolContext): string {
  return [
    'You are the Canvix design agent — an autonomous design assistant working inside a graphic editor.',
    'You see the CURRENT design state below. You act ONLY through tools, one per turn.',
    '',
    'Reply with ONE JSON object per turn, nothing else:',
    '{"thought": "one short sentence of reasoning", "tool": "tool_name", "args": { ... }}',
    'or when finished:',
    '{"done": true, "summary": "what you did, 1-2 sentences"}',
    '',
    'TOOLS (risk: read | write | destructive):',
    toolsPromptSection(),
    '',
    `Fonts available (use EXACT names): ${fontFamilies().slice(0, 40).join(', ')}…`,
    '',
    'RULES:',
    '1. Use only element ids from the context. After structural edits (add/delete), call get_page_state to refresh ids.',
    '2. One tool per turn. Plan multi-step work: usually 2-5 tools are enough. Do NOT loop more than needed.',
    '3. Destructive tools (delete_elements, clear_page) need user confirmation — the system pauses and asks; do not repeat the call in the same turn.',
    '4. Keep 6% margins from page edges. Estimate text width ≈ 0.6 × fontSize × characters. Avoid overlaps — the context lists current ones; fix_overlaps resolves them.',
    '5. Prefer the BRAND KIT colors/fonts when one is given.',
    '6. When the goal is achieved, verify visually via get_page_state (once), then emit {"done":true,"summary":"…"}. Never claim work you did not do.',
    '7. Args must match each tool spec exactly. On an error observation, fix the args and retry — the error message tells you what to change.',
    '8. Tools edit the CURRENT page only. To work on another page: goto_page {page: N}, then get_page_state — ids change with the page. add_page appends the LAST page.',
    '',
    'CURRENT DESIGN:',
    serializeDesignContext(design),
  ].join('\n')
}

/** Compact observation for a tool result (sent back as the next
 *  user-role message). Kept tiny — observations are the loop's
 *  context economy. */
function observationFor(tool: string, result: SanitizeResult, applied: boolean): string {
  if (!result.ok) return `ERROR from ${tool}: ${result.error}`
  return `${tool} ${applied ? 'OK' : 'QUEUED for confirmation'} — ${result.observation}`
}

/**
 * Run the agent loop. Streams events through deps.emit; returns the
 * final summary. Never throws for model/parse problems — those become
 * error/aborted events + a returned message.
 */
export async function runAgentLoop(deps: LoopDeps): Promise<{ summary: string; steps: number; toolCalls: number }> {
  const { chat, design, emit, confirmed = new Set<string>(), signal } = deps
  const toolCtx: ToolContext = {
    validIds: contextValidIds(design),
    width: design.width ?? 1080,
    height: design.height ?? 1080,
    fonts: new Set(fontFamilies()),
  }

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: loopSystemPrompt(design, toolCtx) },
  ]

  const started = Date.now()
  let steps = 0
  /** PROGRESS steps — model turns that led somewhere (a valid tool
   *  call or a done). Rejections and repair retries do NOT count:
   *  the budget guards against over-ambition, and a run that wasted
   *  its 8 steps on two bad calls + a JSON repair never got to be
   *  ambitious in the first place (v0.27.3 audit fix). */
  let progressSteps = 0
  /** free-correction strikes — sanitize rejections and unknown tools
   *  are budget-free so the model can self-correct, but a model that
   *  NEVER produces a valid call would loop forever on wall-clock
   *  alone, growing the message list until the process dies (found
   *  by the harness OOM). Three strikes and the run ends. */
  let strikes = 0
  let toolCalls = 0
  let summary = ''

  while (true) {
    // ── budgets & abort ──────────────────────────────────────
    if (signal?.aborted) {
      emit({ v: 1, type: 'aborted', reason: signal.reason ?? 'Stopped by user' })
      return { summary: summary || 'Stopped by the user.', steps, toolCalls }
    }
    if (progressSteps >= AGENT_BUDGETS.maxSteps || toolCalls >= AGENT_BUDGETS.maxToolCalls) {
      emit({
        v: 1,
        type: 'done',
        summary: summary || 'Reached the step budget — everything applied so far is kept. Refine with another message.',
        steps,
        toolCalls,
      })
      return { summary, steps, toolCalls }
    }
    if (strikes >= 3) {
      emit({
        v: 1,
        type: 'error',
        message: 'Stopped after 3 invalid tool calls in a row — the error messages under each step explain what to fix; try rephrasing the request.',
      })
      return { summary, steps, toolCalls }
    }
    if (Date.now() - started > AGENT_BUDGETS.maxWallMs) {
      emit({ v: 1, type: 'done', summary: 'Time budget reached — applied work is kept.', steps, toolCalls })
      return { summary, steps, toolCalls }
    }

    // ── one model turn ───────────────────────────────────────
    let raw = ''
    try {
      raw = await chat(messages)
    } catch (err) {
      emit({
        v: 1,
        type: 'error',
        message: `The AI provider failed: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown error'}.`,
      })
      return { summary, steps, toolCalls }
    }
    const turn = parseAgentTurn(raw)
    if (!turn) {
      // one repair attempt: show the model its own garbage
      if (steps === 0 && messages[messages.length - 1].role !== 'assistant') {
        messages.push({ role: 'assistant', content: raw.slice(0, 500) })
        messages.push({
          role: 'user',
          content: 'That was not valid JSON. Reply with exactly one JSON object: {"thought","tool","args"} or {"done":true,"summary"}.',
        })
        steps += 1
        continue
      }
      emit({ v: 1, type: 'error', message: 'The model reply was not parseable JSON after a retry.' })
      return { summary, steps, toolCalls }
    }
    steps += 1
    messages.push({ role: 'assistant', content: raw.slice(0, 2000) })

    // ── done? ────────────────────────────────────────────────
    if (turn.done) {
      summary = String(turn.summary ?? '').slice(0, 500) || 'Done.'
      emit({ v: 1, type: 'done', summary, steps, toolCalls })
      return { summary, steps, toolCalls }
    }

    // ── a tool call ──────────────────────────────────────────
    const toolName = typeof turn.tool === 'string' ? turn.tool : ''
    const tool = AGENT_TOOL_MAP.get(toolName)
    const thought = String(turn.thought ?? '').slice(0, 300)
    if (!tool) {
      const known = [...AGENT_TOOL_MAP.keys()].slice(0, 6).join(', ')
      strikes += 1
      messages.push({
        role: 'user',
        content: `ERROR: unknown tool "${toolName}". Valid tools: ${known}… (full list in the system prompt). Retry with a valid tool.`,
      })
      continue
    }
    emit({ v: 1, type: 'step', index: steps, thought, tool: toolName })

    const args = (turn.args && typeof turn.args === 'object' && !Array.isArray(turn.args) ? turn.args : {}) as Record<string, unknown>
    const result = tool.sanitize(args, toolCtx)

    if (!result.ok) {
      // free correction: rejected calls don't consume the tool budget
      // (but they cost a strike — 3 in a row end the run)
      strikes += 1
      messages.push({ role: 'user', content: observationFor(toolName, result, false) })
      continue
    }
    strikes = 0
    // a SANITIZED call is progress — it will reach the client as an
    // action (or a confirmation prompt). Rejections above stay free.
    progressSteps += 1

    // ── destructive gate ─────────────────────────────────────
    if (tool.risk === 'destructive' && !confirmed.has(toolName)) {
      emit({
        v: 1,
        type: 'action',
        stepIndex: steps,
        callId: `call-${steps}-${Math.random().toString(36).slice(2, 8)}`,
        risk: 'destructive',
        tool: toolName,
        actions: result.actions,
      })
      // the client pauses for confirmation; the loop waits for the ack
      // through the pendingConfirm channel provided by the route
      const approved = await deps.awaitConfirm?.(toolName) ?? false
      if (!approved) {
        messages.push({
          role: 'user',
          content: `The user DECLINED the ${toolName} call. Do not retry it. Continue with non-destructive tools or finish.`,
        })
        continue
      }
      // v0.27.3: an approved destructive call still needs the client's
      // apply ack — the failure path (apply throws on the client) must
      // feed the error back to the model instead of counting as done
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
        v: 1,
        type: 'action',
        stepIndex: steps,
        callId: `call-${steps}-${Math.random().toString(36).slice(2, 8)}`,
        risk: tool.risk,
        tool: toolName,
        actions: result.actions,
      })
      // the client applies + acks; the route resumes us
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
    emit({ v: 1, type: 'observation', stepIndex: steps, message: result.observation })

    // get_page_state: the route injects the refreshed context the client
    // sent with its ack — otherwise a generic observation
    if (toolName === 'get_page_state' && deps.refreshedContext) {
      const refreshed = deps.refreshedContext()
      messages.push({
        role: 'user',
        content: `UPDATED PAGE STATE:\n${serializeDesignContext(refreshed)}`,
      })
      // future tools validate against the refreshed ids
      toolCtx.validIds = contextValidIds(refreshed)
      if (refreshed.width) toolCtx.width = refreshed.width
      if (refreshed.height) toolCtx.height = refreshed.height
    } else {
      messages.push({ role: 'user', content: observationFor(toolName, result, true) })
    }
  }
}
