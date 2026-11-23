// ─────────────────────────────────────────────────────────────
// Agent protocol (v0.27) — the wire contract between the agent
// route (SSE producer), the loop, and the client panel.
//
// Design notes (docs/AGENT-ARCHITECTURE.md):
//  · The z-ai SDK / BYOK endpoints expose no native function calling,
//    so the loop speaks a strict JSON protocol: each model turn is
//    {"thought","tool","args"} or {"done":true,"summary"}.
//  · Events are one JSON object per SSE `data:` line — small enough to
//    flush immediately, versioned with `v` so the client can ignore
//    unknown event kinds instead of breaking.
//  · Budgets are protocol-level constants so the route, the loop and
//    the tests agree on the exact numbers.
// ─────────────────────────────────────────────────────────────

export const AGENT_PROTOCOL_VERSION = 1

/** Hard budgets — the anti-over-ambition rails (Loomic's failure modes:
 * over-ambition and false completion). A run can never exceed these no
 * matter what the model tries. */
export const AGENT_BUDGETS = {
  /** model turns in the loop (thought+tool or done) */
  maxSteps: 8,
  /** total tool executions (sanitize-rejected calls do NOT count — the
   * model gets the error for free and can correct itself) */
  maxToolCalls: 12,
  /** wall-clock cap for the whole run, ms */
  maxWallMs: 90_000,
  /** actions attached to a single-shot `act` reply */
  maxDirectActions: 3,
  /** history messages replayed to the model (compacted client-side) */
  maxHistory: 10,
} as const

/** Risk tier of a tool — drives the confirm gate (jaaz's
 * tool_confirmation_manager pattern, three-tier Anthropic model). */
export type ToolRisk = 'read' | 'write' | 'destructive'

/** One streamed progress event (SSE `data:` payload). */
export type AgentEvent =
  | { v: number; type: 'start'; intent: 'act' | 'plan' | 'ask'; plan?: string[] }
  | { v: number; type: 'step'; index: number; thought: string; tool: string }
  | { v: number; type: 'plan'; steps: string[] }
  /** a validated action batch the client should apply NOW (auto mode) or
   *  hold for approval (manual mode / destructive) */
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
  | { v: number; type: 'done'; summary: string; steps: number; toolCalls: number }
  | { v: number; type: 'error'; message: string; code?: string }
  | { v: number; type: 'aborted'; reason: string }

/** A parsed model turn inside the loop. */
export interface AgentTurn {
  thought?: string
  tool?: string
  args?: Record<string, unknown>
  done?: boolean
  summary?: string
  /** v0.28 reserved: variation selector for parallel exploration */
  variant?: number
}

/** Keys that mark a parsed object as an actual agent turn (or an
 *  act-route reply). Used to prefer a real turn over preamble objects
 *  when a model emits several JSON objects in one reply. */
const TURN_KEYS = new Set(['tool', 'done', 'thought', 'reply', 'intent'])

function looksLikeTurn(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).some((k) => TURN_KEYS.has(k))
}

/** Parse one model reply into an AgentTurn. Tolerates markdown fences,
 *  leading prose, trailing junk and MULTI-OBJECT replies (a model that
 *  emits `{"a":1}\n{"tool":…}` — a parsed object that looks like a
 *  turn wins over one that doesn't; among turn-shaped candidates the
 *  outermost/earliest wins, which is the original single-object
 *  behavior). Returns null when no JSON object is found. */
export function parseAgentTurn(raw: string): AgentTurn | null {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  // window scan: starts forward (outermost first), ends backward
  // (largest window first) — nested braces in strings are skipped
  // naturally because only windows that PARSE count
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
        // remember the first parseable object as a fallback (a reply
        // with no turn keys at all — e.g. act-route {"reply":…} is
        // covered by TURN_KEYS, so this is genuinely unknown-shaped)
        if (!fallback) fallback = obj
        break // this start's largest window parsed; smaller windows
        // of the same start would be inner fragments — move on
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
