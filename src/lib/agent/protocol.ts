// ─────────────────────────────────────────────────────────────
// Agent protocol (v0.28) — the wire contract between the agent
// route (SSE producer), the loop, and the client panel.
//
// v0.28 overhaul (docs/AI-CAPABILITY-MATRIX.md):
//  · ARBITRARY CAPS REMOVED (Phase 4): no more maxSteps/maxToolCalls/
//    maxWallMs product limits. Termination is task-driven — done,
//    user stop, user decline, unrecoverable error — plus RESOURCE
//    GUARDS that protect the machine, not the product: consecutive
//    failure strikes, cycle detection (identical tool+args hash),
//    and an idle clock (no PROGRESS for a long window). Guards end
//    the run with a forced wrap-up, never a silent kill.
//  · MODES (Phase 8): runs carry a mode (create/edit/review/improve/
//    explain/plan/discuss); read-only modes get a tool surface with
//    ZERO write tools — structurally incapable of editing.
//  · USAGE OBSERVABILITY: `usage` events stream turns/toolCalls/ms
//    so the panel can show cost; history compaction is reported
//    via the `compact` event.
//  · BRIEF CONTRACT (Phase 5): runs carry a structured brief
//    (mandatory text/colors/dimensions…); completion validation
//    runs against REAL refreshed state, not the model's word.
// ─────────────────────────────────────────────────────────────

export const AGENT_PROTOCOL_VERSION = 2

/**
 * Resource guards — machine protection, not product caps (Phase 4).
 * A run may continue as long as it keeps making PROGRESS (a new,
 * distinct, validated tool call). These are the only stop
 * conditions besides the task-driven ones (done / stop / decline /
 * fatal error):
 *
 *  · strikes       — 3 consecutive invalid calls (unknown tool,
 *                    sanitize reject, unparseable turn). A success
 *                    resets the streak. (flail protection, v0.27.3)
 *  · cycleRepeat   — the same tool+args hash N times in a row means
 *                    the model is looping. (tldraw repeat pattern.)
 *  · idleMs        — no PROGRESS for this long (a model that keeps
 *                    chatting but never successfully calls tools).
 *                    Generous default: 4 minutes.
 *  · compactAt / maxMessages — conversation-size ceiling: compaction
 *                    summarizes older steps instead of growing
 *                    without bound (memory + provider context).
 *  · turnWarnAt    — disclose approaching compaction to the model.
 *
 * These are deliberately NOT "maxSteps": a 40-step deck build with
 * steady progress runs to completion.
 */
export const AGENT_GUARDS = {
  strikes: 3,
  cycleRepeat: 3,
  idleMs: 240_000,
  compactAtMessages: 60,
  maxMessages: 120,
  turnWarnAt: 50,
  /** actions attached to a single-shot `act` reply */
  maxDirectActions: 6,
} as const

/** v0.28 modes (Phase 8). Read-only modes (review, explain, plan,
 *  discuss) run with a ZERO-write tool surface. */
export type AgentMode = 'create' | 'edit' | 'review' | 'improve' | 'explain' | 'plan' | 'discuss'

export const AGENT_MODES: readonly AgentMode[] = ['create', 'edit', 'review', 'improve', 'explain', 'plan', 'discuss']

/** Risk tier of a tool — drives the confirm gate (three-tier
 *  Anthropic pattern: reads free, in-scope writes auto, destructive
 *  confirmed per callId). */
export type ToolRisk = 'read' | 'write' | 'destructive'

/** One streamed progress event (SSE `data:` payload). v2. */
export type AgentEvent =
  | { v: number; type: 'start'; intent: AgentMode; plan?: string[]; runId?: string }
  | { v: number; type: 'mode'; mode: AgentMode; reason: string }
  | { v: number; type: 'skill'; id: string; name: string }
  | { v: number; type: 'brief'; brief: Record<string, unknown> }
  | { v: number; type: 'plan'; steps: string[] }
  | { v: number; type: 'step'; index: number; thought: string; tool: string }
  /** a validated action batch the client should apply NOW (auto mode) or
   *  hold for approval (destructive) */
  | {
      v: number
      type: 'action'
      stepIndex: number
      callId: string
      risk: ToolRisk
      tool: string
      actions: unknown[]
    }
  /** the client's application result — sent up as an ack, never streamed
   *  down; defined here so both sides share the shape */
  | { v: number; type: 'ack'; callId: string; ok: boolean; message?: string }
  | { v: number; type: 'observation'; stepIndex: number; message: string }
  /** periodic run telemetry — turns, tool calls, wall ms, model calls */
  | { v: number; type: 'usage'; turns: number; toolCalls: number; elapsedMs: number; modelCalls: number }
  /** v0.29.3: the loop asks the CLIENT to screenshot the live canvas
   *  (the export pipeline's captureStage) mid-run, BEFORE completion —
   *  the grounded vision critique runs on the real render, not the
   *  model's imagination. The panel answers on the bridge with
   *  {capture: {image}}; a timeout is answered with null and the run
   *  DISCLOSES that visual verification was unavailable (fail-closed). */
  | { v: number; type: 'capture'; purpose: string }
  /** the loop compacted older history — the panel may show "context trimmed" */
  | { v: number; type: 'compact'; fromMessages: number; toMessages: number }
  | { v: number; type: 'done'; summary: string; steps: number; toolCalls: number; verification?: string }
  | { v: number; type: 'error'; message: string; code?: string }
  | { v: number; type: 'aborted'; reason: string }

/** A parsed model turn inside the loop. */
export interface AgentTurn {
  thought?: string
  tool?: string
  args?: Record<string, unknown>
  done?: boolean
  summary?: string
  /** optional plan emitted by the planner step */
  plan?: string[]
  /** review/explain structured findings */
  findings?: { severity: 'P0' | 'P1' | 'P2' | 'P3'; issue: string; fix?: string }[]
}

/** Keys that mark a parsed object as an actual agent turn. */
const TURN_KEYS = new Set(['tool', 'done', 'thought', 'reply', 'intent', 'plan', 'findings'])

function looksLikeTurn(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).some((k) => TURN_KEYS.has(k))
}

/** Parse one model reply into an AgentTurn. Tolerates markdown fences,
 *  leading prose, trailing junk and MULTI-OBJECT replies (a model that
 *  emits `{"a":1}\n{"tool":…}` — a parsed object that looks like a
 *  turn wins over one that doesn't; among turn-shaped candidates the
 *  outermost/earliest wins). Returns null when no JSON object is found. */
export function parseAgentTurn(raw: string): AgentTurn | null {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  let fallback: Record<string, unknown> | null = null
  for (let start = cleaned.indexOf('{'); start !== -1; start = cleaned.indexOf('{', start + 1)) {
    let end = cleaned.lastIndexOf('}')
    while (end > start) {
      let obj: Record<string, unknown> | null = null
      try {
        obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
      } catch {
        obj = null
      }
      if (obj && typeof obj === 'object') {
        if (looksLikeTurn(obj)) return obj as AgentTurn
        if (!fallback) fallback = obj
        break
      }
      end = cleaned.lastIndexOf('}', end - 1)
    }
  }
  return fallback ? (fallback as AgentTurn) : null
}

/** Serialize an event as an SSE line. */
export function sseLine(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}
