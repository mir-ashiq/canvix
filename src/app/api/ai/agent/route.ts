import { NextRequest } from 'next/server'
import { withProvider } from '@/lib/ai/provider'
import { withLogging } from '@/lib/observability'
import {
  AGENT_BUDGETS,
  AGENT_PROTOCOL_VERSION,
  parseAgentTurn,
  sseLine,
  type AgentEvent,
} from '@/lib/agent/protocol'
import { AGENT_TOOL_MAP, fontFamilies } from '@/lib/agent/tools'
import { serializeDesignContext, contextValidIds, type AgentDesignCtx } from '@/lib/agent/context'
import { heuristicIntent, parseIntent, ROUTER_SYSTEM, type AgentIntent } from '@/lib/agent/router'
import { runAgentLoop } from '@/lib/agent/loop'

export const runtime = 'nodejs'
export const maxDuration = 120

// ─────────────────────────────────────────────────────────────
// POST /api/ai/agent — the design agent (v0.27).
//
// Streams SSE AgentEvents (src/lib/agent/protocol.ts). The model plans;
// the CLIENT executes actions through applyDesignAction — the same
// validated, undoable, collab-synced path user edits ride. The server
// never writes the document during a run.
//
// The client bridge: while a run is in flight the client may POST
// side-channel messages (acks + confirmations) to the SAME connection's
// pending promises via the `bridge` map below, keyed by run id. Simpler
// than WebSockets, works on every deploy target (same SSE-only posture
// as the collab rail).
// ─────────────────────────────────────────────────────────────

interface AgentBody {
  message?: string
  history?: { role: 'user' | 'assistant'; content: string }[]
  design?: AgentDesignCtx
  /** 'act' | 'ask' | 'plan' — client may pass a pinned intent (chips) */
  intent?: AgentIntent
  /** tools the user pre-approved this run (from the confirm dialog) */
  confirmed?: string[]
}

interface RunBridge {
  /** destructive-tool confirmations: tool → resolve */
  confirms: Map<string, (ok: boolean) => void>
  /** apply acks, FIFO */
  acks: ((ack: { ok: boolean; message?: string; design?: AgentDesignCtx }) => void)[]
  /** the latest context the client pushed (after applying actions) */
  latestDesign: AgentDesignCtx
  /** client-abort flag (Stop button closes the stream; the route notices
   *  via req.signal too) */
  aborted: boolean
}

/** live runs keyed by run id — the side-channel POST targets these */
const bridges = new Map<string, RunBridge>()

/** tiny id for runs */
function newRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

async function __canvix_post(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as AgentBody
  const message = (body.message ?? '').trim().slice(0, 2000)

  // side-channel: an in-flight run's ack / confirmation / refreshed
  // context rides a ?bridge=<runId> POST with no `message`
  const bridgeId = req.nextUrl.searchParams.get('bridge')
  if (bridgeId && !message) {
    const bridge = bridges.get(bridgeId)
    if (!bridge) return new Response(JSON.stringify({ error: 'Unknown or finished run.' }), { status: 404 })
    const ackBody = (await req.json().catch(() => ({}))) as {
      confirm?: { tool: string; ok: boolean }
      ack?: { ok: boolean; message?: string; design?: AgentDesignCtx }
    }
    if (ackBody.confirm) {
      const pending = bridge.confirms.get(ackBody.confirm.tool)
      if (pending) {
        pending(ackBody.confirm.ok)
        bridge.confirms.delete(ackBody.confirm.tool)
      }
    }
    if (ackBody.ack) {
      if (ackBody.ack.design) bridge.latestDesign = ackBody.ack.design
      const resolve = bridge.acks.shift()
      resolve?.({ ok: ackBody.ack.ok, message: ackBody.ack.message, design: ackBody.ack.design })
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }

  if (!message) {
    return new Response(JSON.stringify({ error: 'A message is required.' }), { status: 400 })
  }

  // withProvider expects a NextResponse-returning callback — wrap the
  // SSE Response (a plain web Response) so the provider chain types line
  // up; the body streams through untouched.
  const wrapped = await withProvider('assistant', req, { limit: 12, windowSec: 60 }, async (ctx) => {
    const design: AgentDesignCtx = body.design ?? {}
    const history = (body.history ?? [])
      .slice(-AGENT_BUDGETS.maxHistory)
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

    // ── 1. route the intent (heuristic first, model fallback) ──
    let intent: AgentIntent
    if (body.intent && ['act', 'ask', 'plan'].includes(body.intent)) {
      intent = body.intent
    } else {
      intent = heuristicIntent(message) ?? 'plan'
      if (intent === 'plan') {
        // the heuristic's `plan` is a guess — one cheap model call to be
        // sure we don't pay loop latency for a simple edit
        try {
          intent = parseIntent(
            await chat([
              { role: 'system', content: ROUTER_SYSTEM },
              { role: 'user', content: message.slice(0, 500) },
            ]),
          )
        } catch {
          /* provider hiccup — the heuristic answer stands */
        }
      }
    }

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
          emit({ v: AGENT_PROTOCOL_VERSION, type: 'start', intent })

          // ── 2a. ask → answer only ───────────────────────────
          if (intent === 'ask') {
            const answer = await chat([
              {
                role: 'system',
                content:
                  'You are the Canvix design assistant. Answer the question about the CURRENT design concisely (max 120 words), plain text, practical. Do not output JSON.\n\nCURRENT DESIGN:\n' +
                  serializeDesignContext(design),
              },
              ...history,
              { role: 'user', content: message },
            ])
            emit({ v: 1, type: 'done', summary: answer.slice(0, 1200), steps: 1, toolCalls: 0 })
            return
          }

          // ── 2b. act → one completion, ≤3 actions ────────────
          if (intent === 'act') {
            const system =
              'You are the Canvix design assistant. Reply ONLY with JSON: {"reply": string, "actions": array} — actions are DesignAction objects (same schema as the assistant app). Max ' +
              `${AGENT_BUDGETS.maxDirectActions} actions, only when clearly asked. Empty array otherwise. Never invent element ids.\n\n` +
              'Action types: addText{text,fontSize,bold,color,align,y}, updateElements{ids,patch}, deleteElements{ids}, moveElements{ids,dx,dy,to}, ' +
              'setHeadingsColor{color}, setTextColor{color}, setFont{fontFamily,targets}, setBackground{kind,from,to,angle}, alignElements{ids,mode}, ' +
              'distributeElements{ids,axis}, fixOverlaps, balanceLayout, addPage, duplicatePage, suggestPalette{colors}, translate{language}, magicAnimate, generateImage{prompt}.\n\n' +
              `Fonts (exact names): ${fontFamilies().slice(0, 30).join(', ')}…\n\nCURRENT DESIGN:\n${serializeDesignContext(design)}`
            const raw = await chat([{ role: 'system', content: system }, ...history, { role: 'user', content: message }])
            // reuse the assistant route's robust parse shape
            const parsed = parseAgentTurn(raw)
            if (parsed && typeof (parsed as unknown as { reply?: string }).reply !== 'undefined') {
              const p = parsed as unknown as { reply?: string; actions?: unknown[] }
              const actions = Array.isArray(p.actions) ? p.actions.slice(0, AGENT_BUDGETS.maxDirectActions) : []
              if (actions.length > 0) {
                emit({
                  v: 1,
                  type: 'action',
                  stepIndex: 1,
                  callId: `direct-${runId}`,
                  risk: 'write',
                  tool: 'direct-actions',
                  actions,
                })
              }
              emit({ v: 1, type: 'done', summary: String(p.reply ?? '').slice(0, 1200), steps: 1, toolCalls: actions.length })
            } else {
              // plain-text fallback — treat as an answer
              emit({ v: 1, type: 'done', summary: raw.slice(0, 1200) || 'I could not answer that — try rephrasing.', steps: 1, toolCalls: 0 })
            }
            return
          }

          // ── 2c. plan → the agent loop ──────────────────────
          const bridge: RunBridge = {
            confirms: new Map(),
            acks: [],
            latestDesign: design,
            aborted: false,
          }
          bridges.set(runId, bridge)
          // the FIRST SSE line after start tells the client the run id so
          // its side-channel POSTs can find this bridge
          emit({ v: 1, type: 'plan', steps: [] })
          emit({ v: 1, type: 'observation', stepIndex: 0, message: `__runId:${runId}` })

          try {
            await runAgentLoop({
              chat,
              design,
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
                  // auto-approve if the user already approved this tool
                  bridge.confirms.set(tool, resolve)
                  // safety: never hang forever on a silent client
                  setTimeout(() => {
                    if (bridge.confirms.get(tool) === resolve) {
                      bridge.confirms.delete(tool)
                      resolve(false)
                    }
                  }, 45_000)
                }),
              awaitApply: () =>
                new Promise<{ ok: boolean; message?: string }>((resolve) => {
                  bridge.acks.push((ack) => resolve({ ok: ack.ok, message: ack.message }))
                  setTimeout(() => resolve({ ok: true, message: 'ack timeout — assumed applied' }), 30_000)
                }),
              refreshedContext: () => bridge.latestDesign,
            })
          } finally {
            bridges.delete(runId)
          }
        } catch (err) {
          emit({
            v: 1,
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
        'X-Agent-Run': runId,
      },
    }) as unknown as import('next/server').NextResponse
  })
  return wrapped
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests
export const POST = withLogging('POST /api/ai/agent', __canvix_post)
