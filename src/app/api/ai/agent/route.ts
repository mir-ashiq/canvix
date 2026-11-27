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
import { auditDesign as runDesignAudit } from '@/lib/agent/audit'
import { selectSkills } from '@/lib/agent/skills'
import { extractBrief, mergeBriefs, normalizeStoredBrief, type DesignBrief } from '@/lib/agent/brief'
import { critiqueWithVision } from '@/lib/agent/vision'
import { getClientForSlotForUser } from '@/lib/ai/provider'
import { getSessionUser } from '@/lib/auth/session'
import { getDesignProvenance } from '@/lib/design-provenance'
import { db } from '@/lib/db'

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
  /** v0.29.3: canvas capture pushed by the client (the loop's
   *  in-run vision critique) — resolves with the image dataURL or
   *  null (timeout) */
  capture: ((r: { image: string } | null) => void) | null
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

/** v0.32.1 (review P1): the stored brief, read AUTHORITATIVELY. When
 *  the design context carries a design id, the persisted DB contract
 *  (server-normalized, server-verified provenance) wins — a client
 *  post cannot tamper with what the run is gated on. The posted
 *  aiBrief is only the fallback (designs whose provenance is not yet
 *  persisted, or a DB hiccup). */
async function authoritativeStoredBrief(design: AgentDesignCtx): Promise<DesignBrief | null> {
  if (design.designId) {
    try {
      const row = await getDesignProvenance(design.designId)
      if (row) return row.brief
    } catch {
      /* fall through to the posted brief */
    }
  }
  const posted = normalizeStoredBrief(design.aiBrief)
  return posted ? posted.brief : null
}

/** v0.29.3: one grounded vision critique of a REAL captured
 *  screenshot — shared by the loop's pre-completion round. Resolves
 *  null when the vision slot is unconfigured or the call fails (the
 *  caller then discloses, never pretends).
 *  v0.32 (Unified Canvix AI): the vision slot resolves USER-FIRST
 *  (BYOK) — the same chain the text slot and the design-agent route
 *  use. A signed-in user with their own vision provider critiques
 *  with THEIR keys; anonymous requests resolve the instance chain
 *  exactly as before. */
async function critiqueRoute(
  image: string,
  brief: DesignBrief | null,
  design: AgentDesignCtx,
  userId: string | null,
): Promise<{ findings: { severity: 'P0' | 'P1' | 'P2' | 'P3'; issue: string; fix?: string }[]; note: string } | null> {
  if (!image.startsWith('data:image/')) return null
  const vision = await getClientForSlotForUser('vision', userId)
  if (!vision) return null
  // same structural cast the route's chat fn uses — the SDK's typed
  // create() accepts our body shape at runtime
  const client = vision.zai as unknown as Parameters<typeof critiqueWithVision>[0]
  return critiqueWithVision(client, image, {
    brief: brief
      ? { requiredTexts: brief.requiredTexts, requiredColors: brief.requiredColors }
      : undefined,
    stateSummary: serializeDesignContext(design),
    model: vision.model,
  })
}

async function __canvix_post(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as AgentBody & {
    confirm?: { tool: string; ok: boolean }
    ack?: { ok: boolean; message?: string; design?: AgentDesignCtx }
    briefResult?: { satisfied: boolean; unmet: string[] } | null
    capture?: { image: string } | null
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
    // v0.29.3: the panel's mid-run canvas capture (dataURL screenshot
    // taken with the export pipeline) for the loop's vision critique
    if (body.capture !== undefined) {
      const resolve = bridge.capture
      if (resolve) {
        bridge.capture = null
        resolve(body.capture)
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
    // v0.32: the session user for the user-first vision resolution
    // (the text slot already resolves BYOK-first inside withProvider —
    // the vision seam now matches it, see critiqueRoute)
    let userId: string | null = null
    try {
      userId = (await getSessionUser(req))?.id ?? null
    } catch {
      /* session hiccup — the instance chain answers */
    }
    const history = (body.history ?? [])
      .slice(-12)
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, 800) }))

    // v0.29: guaranteed-JSON turns. response_format {type:'json_object'}
    // passes through the SDK to any OpenAI-compatible gateway (verified
    // live on NVIDIA NIM: zero malformed turns). ZAI_JSON_MODE=auto (the
    // default) drops the param for the rest of the run if the gateway
    // rejects it, so every OpenAI-ish endpoint keeps working; 'on' fails
    // loudly instead of silently degrading.
    const jsonModePref = (process.env.ZAI_JSON_MODE ?? 'auto').trim().toLowerCase()
    let jsonModeLive = jsonModePref !== 'off'
    const rawCreate = ctx.zai.chat.completions.create as unknown as (
      body: Record<string, unknown>,
    ) => Promise<{ choices: { message?: { content?: unknown } }[] }>
    const chat = async (msgs: { role: 'system' | 'user' | 'assistant'; content: string }[]) => {
      const base: Record<string, unknown> = {
        ...(ctx.model ? { model: ctx.model } : {}),
        messages: msgs,
        thinking: { type: 'disabled' },
      }
      const callJson = (withJson: boolean) =>
        rawCreate(withJson ? { ...base, response_format: { type: 'json_object' } } : base)
      // v0.33 · transient-provider retry. Upstream 429s and network
      // blips killed live runs mid-build ("Applied work is kept —
      // retry to continue") and the user received degraded, half-
      // built posters. A bounded retry with backoff (×2: 1.5s, 3s)
      // rides out bursts before a transient error surfaces.
      const callWithRetry = async (): Promise<string> => {
        for (let tries = 0; ; tries++) {
          try {
            const completion = await callJson(jsonModeLive)
            return String(completion.choices[0]?.message?.content ?? '')
          } catch (e) {
            const msg = String((e as Error | undefined)?.message ?? e)
            // json-mode fallback (unchanged v0.32 behaviour): a gateway
            // that rejects response_format degrades once and the
            // choice is remembered for the whole run
            if (
              jsonModeLive &&
              jsonModePref === 'auto' &&
              /(?:\b(?:400|404|422)\b|response_format|json_object|unknown field|not supported|unsupported)/i.test(msg)
            ) {
              jsonModeLive = false // remember for the whole run
              continue
            }
            const transient =
              /\b(?:429|500|502|503|504)\b|rate.?limit|too many requests|fetch failed|network|econnreset|etimedout|socket hang up|aborted/i.test(
                msg,
              )
            if (!transient || tries >= 2) throw e
            await new Promise((r) => setTimeout(r, 1500 * (tries + 1)))
          }
        }
      }
      return callWithRetry()
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
    // v0.32 (Unified Canvix AI — continuation): a design with stored
    // AI provenance (an applied autonomous generation) contributes its
    // brief to EVERY run on that design. The stored contract merges
    // with the freshly extracted one (union — requirements survive),
    // and an edit-mode refinement on such a design is gated on the
    // merged brief too: a refinement may not finish while a verified
    // requirement has gone missing.
    // v0.32.1 (review P1): when the context carries the design id, the
    // persisted DB contract is AUTHORITATIVE — server-normalized,
    // server-verified — so a client post cannot tamper with what the
    // run is gated on. The client-posted aiBrief stays as the fallback
    // for designs whose provenance is not (yet) persisted.
    const storedBrief = await authoritativeStoredBrief(design)
    const extracted =
      mode === 'create' || mode === 'improve'
        ? extractBrief(message, design.width, design.height)
        : null
    const brief =
      storedBrief && extracted
        ? mergeBriefs(storedBrief, extracted)
        : (storedBrief ?? extracted)
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
            capture: null,
            latestDesign: design,
            aborted: false,
          }
          bridges.set(runId, bridge)
          // tell the client the run id so its side-channel POSTs can
          // find this bridge (protocol detail: rides an observation)
          emit({ v: AGENT_PROTOCOL_VERSION, type: 'observation', stepIndex: 0, message: `__runId:${runId}` })

          // v0.32.4: per-design run ledger — the last few runs in
          // THIS design (mode, request, actions, outcome) enter the
          // system prompt. Best-effort: a ledger failure must never
          // break the run itself.
          let ledgerLines: string[] = []
          if (design.designId) {
            try {
              const rows = await db.designAgentRun.findMany({
                where: { designId: design.designId },
                orderBy: { createdAt: 'desc' },
                take: 3,
              })
              ledgerLines = rows.map(
                (r) =>
                  `${r.mode} "${r.request.slice(0, 80)}" → ${r.toolCalls} action(s): ${r.summary.slice(0, 160)}${r.findings ? ` [residue to fix: ${r.findings.slice(0, 140)}]` : ''}`,
              )
            } catch {
              /* best-effort — run without the ledger */
            }
          }

          let loopResult: Awaited<ReturnType<typeof runAgentLoop>> | null = null
          try {
            loopResult = await runAgentLoop({
              chat,
              design,
              mode,
              // v0.32.2 (defect B): the ORIGINAL user request rides the
              // loop as the actual first user message — the model sees
              // what it was asked for, verbatim, all run long
              request: message,
              // v0.32.3: the conversation this request arrives in —
              // the loop's model sees the prior turns verbatim
              history,
              // v0.32.4: what the agent's recent runs did to THIS
              // design — grounded execution memory
              ledger: ledgerLines,
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
                  // v0.29.3 — FAIL CLOSED: a timed-out apply ack now
                  // resolves ok:false. The old "ack timeout — assumed
                  // applied" let the model believe edits landed when
                  // the client never confirmed them, so it built on a
                  // fiction and the completion summary described work
                  // that was never applied. The model is told the
                  // action was NOT applied; it can retry or finish
                  // honestly.
                  setTimeout(
                    () => resolve({ ok: false, message: 'ack timeout — the client did NOT confirm the apply; the document was not verified as changed. Retry once, or verify with get_page_state.' }),
                    60_000,
                  )
                }),
              // v0.29.3: the loop's mid-run capture — the panel answers
              // on the bridge with {capture: {image: dataUrl}}. A
              // silent client resolves null and the run DISCLOSES that
              // visual verification was unavailable (never pretends).
              captureCanvas: () =>
                new Promise<string | null>((resolve) => {
                  bridge.capture = (r) => resolve(r?.image ?? null)
                  setTimeout(() => {
                    if (bridge.capture) {
                      bridge.capture = null
                      resolve(null)
                    }
                  }, 45_000)
                }),
              // v0.29.3: the grounded vision critique, BEFORE completion.
              // Unconfigured vision slot → null → the loop discloses.
              // v0.32: user-first BYOK resolution (see critiqueRoute).
              critique: (image) =>
                critiqueRoute(image, brief, bridge.latestDesign ?? design, userId).then((r) => r ?? null),
              refreshedContext: () => bridge.latestDesign,
              // v0.29: audit the freshest design snapshot the panel acked
              // (v0.29.3: the brief rides along for strip detection)
              // v0.29: audit the freshest design snapshot the panel acked
              // (v0.29.3: the brief rides along for strip detection;
              // v0.32.4: so do the run's validated plan bands — the
              // audit checks duplicate elements, margins and that no
              // planned section was left empty)
              auditDesign: (bands) => runDesignAudit(bridge.latestDesign ?? design, brief, bands),
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
            // v0.32.4: persist the run ledger row — what THIS run did,
            // so the next run in this design starts with grounded
            // execution memory. Best-effort: the run's outcome is
            // already streamed; a ledger write failure never
            // surfaces as an agent error.
            if (design.designId) {
              try {
                await db.designAgentRun.create({
                  data: {
                    designId: design.designId,
                    mode,
                    request: message.slice(0, 240),
                    summary: String(loopResult?.summary ?? '').slice(0, 600),
                    toolCalls: loopResult?.toolCalls ?? 0,
                    findings:
                      (loopResult?.findings ?? [])
                        .map((f) => `${f.severity} ${f.issue}`)
                        .join(' | ')
                        .slice(0, 1200) || null,
                  },
                })
              } catch {
                /* best-effort ledger */
              }
            }
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
