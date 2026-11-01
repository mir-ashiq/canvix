import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { presenceKey } from '@/lib/collab/presence-diff'
import { acquireStreamSlot, clientIp, releaseStreamSlot } from '@/lib/rate-limit'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // Vercel-friendly bounded stream duration

// ── v0.10.1 lifecycle bounds (production incident 2026-10-29) ──
// A tick could wedge forever on a stale pooled connection (pooler idle
// drop with no FIN): the stream then hung silently until the platform
// killed the function at its duration limit, and every request sharing
// that instance's single connection queued behind it. Bounds now:
//   - PUMP_TIMEOUT_MS: one tick wedging past this ends the invocation
//     CLEANLY — the client reconnects within ~1.5 s and replays gap-free
//   - MAX_STREAM_AGE_MS: self-recycle well under maxDuration so the
//     platform never kills us mid-frame (fresh connection per cycle is
//     also the cheapest pool hygiene there is)
const PUMP_TIMEOUT_MS = 8_000
const MAX_STREAM_AGE_MS = Number(process.env.CANVIX_STREAM_TTL_MS ?? 240_000)

/**
 * GET /api/collab/[designId]/stream?since=<seq>&pid=<participantId>
 *
 * SSE downstream: emit new DesignEvents (id > since) + live presence
 * (lastSeen < 30 s). Postgres is the source of truth — a reconnect with
 * ?since=<lastSeq> replays gap-free. Also lazily GCs stale presence rows
 * and prunes the event log.
 *
 * v0.9.2 cost fix: this used to fire THREE Postgres queries every 800 ms
 * per connected client for the full stream lifetime — the single biggest
 * Fluid-CPU driver in the app. The pump is now adaptive:
 *   - events query every tick, but the tick backs off 800 ms → 3.2 s
 *     when nothing is happening and snaps back on the first event
 *   - presence query every 2nd tick (clients heartbeat every 15 s)
 *   - the MAX(id) aggregate only every 5th tick (gap detection)
 * Idle collaboration sessions now cost ~10× less; active editing latency
 * is unchanged (first event after activity still arrives in ≤ 800 ms).
 *
 * v0.11.5 (F4, research/V0114-QA-PASS.md): frames used to go out only when
 * design events existed or every 20th tick — so an IDLE client learned that
 * someone JOINED only via that keepalive: 20 ticks at the 3.2 s idle cadence
 * ≈ 64–90 s of invisible collaborator. Presence is now queried every tick
 * and diffed against the last snapshot actually SENT (presenceKey: id /
 * name / color / cursor — never lastSeen, never row order); any visible
 * change pushes a frame within one tick (≤ 3.2 s idle, ≤ 800 ms active) and
 * counts as activity for the backoff. Cost: the presence findMany doubles
 * (every 2nd → every tick: 0.31 q/s idle, 1.25 q/s active per client — a
 * tiny indexed take-30 query, still ~3× below the pre-v0.9.2 constant
 * 3.75 q/s), while idle FRAME traffic is unchanged: the diff only fires on
 * real changes, and heartbeats (15 s) reorder rows and bump lastSeen
 * without touching the key.
 */
async function __canvix_get(req: NextRequest, { params }: { params: Promise<{ designId: string }> }) {
  const { designId } = await params
  const pid = req.nextUrl.searchParams.get('pid')?.slice(0, 40) ?? ''
  let since = Number(req.nextUrl.searchParams.get('since'))
  if (!Number.isFinite(since) || since < 0) since = 0

  // verify the design exists (404 early, keeps the stream honest)
  try {
    const design = await db.design.findUnique({ where: { id: designId }, select: { id: true } })
    if (!design) return new Response('Design not found', { status: 404 })
  } catch {
    return new Response('Database unavailable', { status: 503 })
  }

  // v0.12.3 (H5): per-IP concurrent SSE cap (default 6 — a browser's
  // per-domain HTTP/1.1 limit; CANVIX_SSE_MAX_PER_IP to tune). Every
  // exit path funnels through close(), which releases the slot.
  const ip = clientIp(req)
  if (!acquireStreamSlot(ip)) {
    return new Response('Too many live collaboration streams from this address.', {
      status: 429,
      headers: { 'Retry-After': '10', 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  const encoder = new TextEncoder()
  let closed = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let pumpTimeout: ReturnType<typeof setTimeout> | null = null
  const born = Date.now()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastSeq = since
      let tick = 0
      let delay = 800
      // v0.11.5: last presence key actually sent to THIS client (null =
      // nothing sent yet — the first tick always counts as a change, which
      // also preserves the historical send-a-frame-immediately-on-connect)
      let lastPresenceKey: string | null = null

      const send = (frame: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
        } catch {
          closed = true
        }
      }
      const comment = (text: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`: ${text}\n\n`))
        } catch {
          closed = true
        }
      }

      const close = () => {
        if (closed) return
        closed = true
        releaseStreamSlot(ip)
        if (timer) clearTimeout(timer)
        if (pumpTimeout) clearTimeout(pumpTimeout)
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }

      const pump = async (): Promise<boolean> => {
        if (closed) return false
        try {
          const [events, presence, maxRow, gcRows] = await Promise.all([
            db.designEvent.findMany({
              where: { designId, id: { gt: lastSeq } },
              orderBy: { id: 'asc' },
              take: 200,
            }),
            // v0.11.5: presence EVERY tick — the diff gate needs a fresh
            // snapshot to detect a join within one tick (was every 2nd under
            // the old send-only-every-20th-tick regime; see header note)
            db.presence.findMany({
              where: { designId, lastSeen: { gt: new Date(Date.now() - 30_000) } },
              orderBy: { lastSeen: 'desc' },
              take: 30,
            }),
            // v0.9.2: the MAX(id) aggregate only matters for gap detection
            // after pruning — every 5th tick is plenty.
            tick % 5 === 0
              ? db.designEvent.aggregate({ where: { designId }, _max: { id: true } })
              : Promise.resolve(null),
            // heartbeat GC: drop presence rows older than 24 h (cheap, throttled by tick)
            tick % 90 === 0
              ? db.presence.deleteMany({ where: { designId, lastSeen: { lt: new Date(Date.now() - 86_400_000) } } })
              : Promise.resolve({ count: 0 }),
          ])
          void gcRows

          if (events.length) {
            lastSeq = Number(events[events.length - 1].id)
          }
          const serverSeq = maxRow ? Number(maxRow._max.id ?? lastSeq) : lastSeq

          // only send a frame when something actually changed (plus periodic keepalive)
          const filteredPresence = presence.filter((p) => p.id !== pid)
          // v0.11.5 (F4): diff the VISIBLE presence against what this client
          // was last told — a join/leave/cursor/name/color change pushes a
          // frame within one tick instead of waiting for the 20-tick
          // keepalive (~64 s at the idle cadence). Keyed without lastSeen
          // and row order (see presence-diff.ts) so heartbeats stay silent.
          const presenceSnapshot = filteredPresence.map((p) => ({
            id: p.id,
            name: p.name,
            color: p.color,
            cursor: p.cursor,
          }))
          const currentKey = presenceKey(presenceSnapshot)
          const presenceChanged = currentKey !== lastPresenceKey
          if (events.length || presenceChanged || tick % 20 === 0) {
            const frame = {
              events: events.map((e) => ({
                seq: Number(e.id),
                id: e.id.toString(),
                eventId: e.eventId ?? undefined, // v0.10.1: client dedupe key
                designId: e.designId,
                actorId: e.actorId,
                kind: e.kind,
                payload: e.payload,
                createdAt: e.createdAt.toISOString(),
              })),
              presence: filteredPresence.map((p) => ({
                id: p.id,
                name: p.name,
                color: p.color,
                cursor: p.cursor,
                lastSeen: p.lastSeen.toISOString(),
              })),
              seq: serverSeq,
            }
            send(frame)
            lastPresenceKey = currentKey
          } else {
            comment('keepalive')
          }

          // event-log pruning: keep the last 500 events per design
          if (events.length && serverSeq - lastSeq === 0 && serverSeq > 500 && tick % 30 === 0) {
            try {
              await db.designEvent.deleteMany({ where: { designId, id: { lt: serverSeq - 500 } } })
            } catch {
              /* pruning is best-effort */
            }
          }
          // presence changes are activity too: a collaborator joining or
          // moving a cursor keeps this pump hot (800 ms) exactly like edits
          // do — idle backoff resumes the moment the room goes quiet
          return events.length > 0 || presenceChanged
        } catch (err) {
          console.error('[collab/stream] tick failed', err)
          comment('retry')
          return false
        } finally {
          tick += 1
        }
      }

      // v0.9.2: adaptive self-scheduling pump — backs off to 3.2 s when the
      // design is quiet, returns to 800 ms the moment anything happens.
      const PUMP_WEDGED = Symbol('pump-wedged')
      const scheduleNext = async () => {
        if (closed) return
        // v0.10.1: self-recycle under the maxDuration ceiling — the client
        // reconnects (retry hint below) and replays gap-free via ?since
        if (Date.now() - born > MAX_STREAM_AGE_MS) {
          comment('recycle')
          close()
          return
        }
        const result = await Promise.race([
          pump(),
          new Promise<typeof PUMP_WEDGED>((resolve) => {
            pumpTimeout = setTimeout(() => resolve(PUMP_WEDGED), PUMP_TIMEOUT_MS)
          }),
        ])
        if (pumpTimeout) {
          clearTimeout(pumpTimeout)
          pumpTimeout = null
        }
        if (closed) return
        if (result === PUMP_WEDGED) {
          // v0.10.1: a tick wedged past PUMP_TIMEOUT_MS (stale pooled
          // connection / pooler hiccup) — end this invocation cleanly
          // instead of hanging to maxDuration; the client reconnects
          // within ~1.5 s and replays gap-free
          comment('db-timeout')
          close()
          return
        }
        delay = result ? 800 : Math.min(Math.round(delay * 1.5), 3200)
        if (closed) return
        timer = setTimeout(() => void scheduleNext(), delay)
      }

      req.signal.addEventListener('abort', close)

      // initial frame immediately (replay from `since`)
      comment(`open design=${designId} since=${since}`)
      // v0.10.1: reconnect hint — after our clean close (recycle /
      // db-timeout) the browser reconnects in 1.5 s instead of the ~3 s
      // default, keeping the gap invisible to the user
      try {
        controller.enqueue(encoder.encode('retry: 1500\n\n'))
      } catch {
        /* client already gone */
      }
      await scheduleNext()
    },
    cancel() {
      // consumer went away without an abort signal (platform teardown)
      close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const GET = withLogging('GET /api/collab/[designId]/stream', __canvix_get)
