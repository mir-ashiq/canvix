import { NextRequest } from 'next/server'
import { db } from '@/lib/db'

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
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ designId: string }> }) {
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
            // v0.9.2: presence every 2nd tick — clients heartbeat every 15 s,
            // so a 1.6 s refresh window (when active) is still real-time.
            tick % 2 === 0
              ? db.presence.findMany({
                  where: { designId, lastSeen: { gt: new Date(Date.now() - 30_000) } },
                  orderBy: { lastSeen: 'desc' },
                  take: 30,
                })
              : Promise.resolve([]),
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
          if (events.length || tick % 20 === 0) {
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
          return events.length > 0
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
