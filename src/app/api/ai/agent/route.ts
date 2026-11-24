import { NextRequest } from 'next/server'
import { withProvider } from '@/lib/ai/provider'
import { withLogging } from '@/lib/observability'
import {
  AGENT_PROTOCOL_VERSION,
  parseAgentTurn,
  sseLine,
  type AgentEvent,
  type AgentMode,
} from '@/lib/agent/protocol'
import { fontFamilies } from '@/lib/agent/tools'
import { serializeDesignContext, type AgentDesignCtx } from '@/lib/agent/context'
import { heuristicMode, parseMode, ROUTER_SYSTEM, modeAllowsWrites, MODE_TOOL_RISK } from '@/lib/agent/router'
import { runAgentLoop, toolsForMode } from '@/lib/agent/loop'
import { selectSkills } from '@/lib/agent/skills'
import { extractBrief } from '@/lib/agent/brief'

export const runtime = 'nodejs'
export const maxDuration = 800

// ─────────────────────────────────────────────────────────────
// POST /api/ai/agent — the design agent (v0.28).
//
// Streams SSE AgentEvents (src/lib/agent/protocol.ts, v2). The model
// plans; the CLIENT executes actions through applyDesignAction — the
// same validated, undoable, collab-synced path user edits ride. The
// server never writes the document during a run.
//
// v0.28 route responsibilities:
//  · classify the MODE (create/edit/review/improve/explain/plan/
//    discuss) — heuristic first, one cheap model call when unsure
//  · extract the Design Brief Contract from the message (Phase 5)
//  · pre-select skills for the run (Phase 2, progressive disclosure)
//  · explain/plan/discuss/review run a read-only loop; discuss runs
//    a single completion (no canvas context needed)
//  · the client bridge: while a run is in flight the client may POST
//    side-channel messages (acks + confirmations + brief validation
//    results) to the SAME connection's pending promises via the
//    `bridge` map below, keyed by run id.
// ─────────────────────────────────────────────────────────────

interface AgentBody {
  message?: string
  history?: { role: 'user' | 'assistant'; content: string }[]
  design?: AgentDesignCtx
  /** client-pinned mode (chips) */
  mode?: AgentMode
  /** tools the user pre-approved this run (from the confirm dialog) */
  confirmed?: string[]
}

interface RunBridge {
  /** destructive-tool confirmations: tool → resolve */
  confirms: Map<string, (ok: boolean) => void>
  /** apply acks, FIFO */
  acks: ((ack: { ok: boolean; message?: string; design?: AgentDesignCtx }) => void)[]
  /** brief validation result pushed by the client (Phase 5) */
  briefResult: ((r: { satisfied: boolean; unmet: string[] } | null) => void) | null
  /** briefResult that arrived before the loop asked (the panel answers
   *  immediately on seeing the action event) — consumed first */
  pendingBriefResult: { satisfied: boolean; unmet: string[] } | null
  /** the latest context the client pushed (after applying actions) */
  latestDesign: AgentDesignCtx
  /** client-abort flag (Stop button closes the stream; the route
   *  notices via req.signal too) */
  aborted: boolean
}

/** live runs keyed by run id — the side-channel POST targets these */
const bridges = new Map<string, RunBridge>()

/** tiny id for runs */
function newRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

async function __canvix_post(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as AgentBody & {
    confirm?: { tool: string; ok: boolean }
    ack?: { ok: boolean; message?: string; design?: AgentDesignCtx }
    briefResult?: { satisfied: boolean; unmet: string[] } | null
  }
  const message = (body.message ?? '').trim().slice(0, 2000)

  // side-channel: an in-flight run's ack / confirmation / brief
  // validation rides a ?bridge=<runId> POST with no `message`. The
  // body was parsed ONCE above — the bridge reads the same parsed
  // object. Bridge POSTs are handled BEFORE withProvider on purpose:
  // they are same-origin by construction and MUST NOT consume the
  // assistant feature's rate-limit budget.
  const bridgeId = req.nextUrl.searchParams.get('bridge')
  if (bridgeId && !message) {
    const bridge = bridges.get(bridgeId)
    if (!bridge) return new Response(JSON.stringify({ error: 'Unknown or finished run.' }), { status: 404 })
    if (body.confirm) {
      const pending = bridge.confirms.get(body.confirm.tool)
      if (pending) {
        pending(body.confirm.ok)
        bridge.confirms.delete(body.confirm.tool)
      }
    }
    if (body.ack) {
      if (body.ack.design) bridge.latestDesign = body.ack.design
      const resolve = bridge.acks.shift()
      resolve?.({ ok: body.ack.ok, message: body.ack.message, design: body.ack.design })
    }
    if (body.briefResult !== undefined) {
      const resolve = bridge.briefResult
      if (resolve) {
        bridge.briefResult = null
        resolve(body.briefResult)
      } else if (body.briefResult) {
        // early answer (loop not waiting yet) — queue it
        bridge.pendingBriefResult = body.briefResult
      }
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }

  if (!message) {
    return new Response(JSON.stringify({ error: 'A message is required.' }), { status: 400 })
  }

  // withProvider expects a NextResponse-returning callback — wrap the
  // SSE Response (a plain web Response) so the provider chain types line
  // up; the body streams through untouched.
  const wrapped = await withProvider('assistant', req, { limit: 20, windowSec: 60 }, async (ctx) => {
    const design: AgentDesignCtx = body.design ?? {}
    const history = (body.history ?? [])
      .slice(-12)
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, 800) }))

    const chat = async (msgs: { role: 'system' | 'user' | 'assistant'; content: string }[]) => {
      const completion = await ctx.zai.chat.completions.create({
        ...(ctx.model ? { model: ctx.model } : {}),
        messages: msgs,
        thinking: { type: 'disabled' },
      })
      return String(completion.choices[0]?.message?.content ?? '')
    }

    // ── 1. classify the mode (heuristic first, model when unsure) ──
    let mode: AgentMode
    if (body.mode && MODE_TOOL_RISK[body.mode]) {
      mode = body.mode // the client pinned a mode (chips)
    } else {
      const h = heuristicMode(message)
      mode = h.mode
      if (h.confidence === 'low') {
        try {
          const modelMode = parseMode(
            await chat([
              { role: 'system', content: ROUTER_SYSTEM },
              { role: 'user', content: message.slice(0, 500) },
            ]),
          )
          if (modelMode) mode = modelMode
        } catch {
          /* provider hiccup — the heuristic answer stands */
        }
      }
    }

    // ── 2. extract the brief contract + pre-select skills ─────
    const brief =
      mode === 'create' || mode === 'improve'
        ? extractBrief(message, design.width, design.height)
        : null
    const skills = selectSkills(
      message,
      mode,
      !!(design.brand && (design.brand.colors?.length || design.brand.headingFont)),
    )

    const runId = newRunId()
    const encoder = new TextEncoder()

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false
        const emit = (event: AgentEvent) => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(sseLine(event)))
          } catch {
            closed = true
          }
        }
        // client disconnect (Stop button / navigation)
        req.signal.addEventListener('abort', () => {
          const bridge = bridges.get(runId)
          if (bridge) bridge.aborted = true
        })

        try {
          emit({ v: AGENT_PROTOCOL_VERSION, type: 'start', intent: mode, runId })

          // ── 3a. discuss → one completion, no canvas loop ────
          // (product/engineering talk; the design is irrelevant)
          if (mode === 'discuss') {
            const answer = await chat([
              {
                role: 'system',
                content:
                  'You are the Canvix assistant in a product/engineering discussion. Answer concisely (max 200 words), plain text, practical. Do not output JSON. Do not modify anything.',
              },
              ...history,
              { role: 'user', content: message },
            ])
            emit({ v: AGENT_PROTOCOL_VERSION, type: 'done', summary: answer.slice(0, 1600), steps: 1, toolCalls: 0 })
            return
          }

          // ── 3b. explain → one grounded answer ───────────────
          if (mode === 'explain') {
            const answer = await chat([
              {
                role: 'system',
                content:
                  'You are the Canvix design assistant. Answer the question about the CURRENT design below concisely (max 150 words), plain text. Ground every claim in the state shown — never invent elements. Do not output JSON.\n\nCURRENT DESIGN:\n' +
                  serializeDesignContext(design),
              },
              ...history,
              { role: 'user', content: message },
            ])
            emit({ v: AGENT_PROTOCOL_VERSION, type: 'done', summary: answer.slice(0, 1600), steps: 1, toolCalls: 0 })
            return
          }

          // ── 3c. every other mode → the agent loop (review/
          //    plan run read-only tool surfaces inside the loop)
          const bridge: RunBridge = {
            confirms: new Map(),
            acks: [],
            briefResult: null,
            pendingBriefResult: null,
            latestDesign: design,
            aborted: false,
          }
          bridges.set(runId, bridge)
          // tell the client the run id so its side-channel POSTs can
          // find this bridge (protocol detail: rides an observation)
          emit({ v: AGENT_PROTOCOL_VERSION, type: 'observation', stepIndex: 0, message: `__runId:${runId}` })

          try {
            await runAgentLoop({
              chat,
              design,
              mode,
              brief,
              skills,
              emit,
              confirmed: new Set(body.confirmed ?? []),
              signal: {
                get aborted() {
                  return bridge.aborted || req.signal.aborted
                },
                reason: 'Stopped by user',
              },
              awaitConfirm: (tool) =>
                new Promise<boolean>((resolve) => {
                  bridge.confirms.set(tool, resolve)
                  // safety: never hang forever on a silent client
                  setTimeout(() => {
                    if (bridge.confirms.get(tool) === resolve) {
                      bridge.confirms.delete(tool)
                      resolve(false)
                    }
                  }, 120_000)
                }),
              awaitApply: () =>
                new Promise<{ ok: boolean; message?: string }>((resolve) => {
                  bridge.acks.push((ack) => resolve({ ok: ack.ok, message: ack.message }))
                  setTimeout(() => resolve({ ok: true, message: 'ack timeout — assumed applied' }), 60_000)
                }),
              refreshedContext: () => bridge.latestDesign,
              validateBriefOnClient: async () => {
                // consume an early answer first, then wait for a live one
                if (bridge.pendingBriefResult) {
                  const r = bridge.pendingBriefResult
                  bridge.pendingBriefResult = null
                  return r
                }
                return new Promise<{ satisfied: boolean; unmet: string[] } | null>((resolve) => {
                  bridge.briefResult = resolve
                  // the client answers on the bridge; give it a generous
                  // window, then fall back to null (no client validation
                  // available — the run continues without the gate)
                  setTimeout(() => {
                    if (bridge.briefResult === resolve) {
                      bridge.briefResult = null
                      resolve(null)
                    }
                  }, 30_000)
                })
              },
            })
          } finally {
            bridges.delete(runId)
          }
        } catch (err) {
          emit({
            v: AGENT_PROTOCOL_VERSION,
            type: 'error',
            message: `Agent run failed: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown error'}.`,
          })
        } finally {
          closed = true
          try {
            controller.close()
          } catch {
            /* already closed */
          }
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // same as the collab stream: disable nginx proxy buffering so
        // live agent steps arrive as they happen, not in one lump when
        // the run finishes
        'X-Accel-Buffering': 'no',
        'X-Agent-Run': runId,
      },
    }) as unknown as import('next/server').NextResponse
  })
  return wrapped
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests
export const POST = withLogging('POST /api/ai/agent', __canvix_post)
