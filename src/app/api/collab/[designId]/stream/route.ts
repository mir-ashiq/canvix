import { NextRequest } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // Vercel-friendly bounded stream duration

/**
 * GET /api/collab/[designId]/stream?since=<seq>&pid=<participantId>
 *
 * SSE downstream: every ~800 ms tick, emit new DesignEvents (id > since) +
 * live presence (lastSeen < 30 s). Postgres is the source of truth — a
 * reconnect with ?since=<lastSeq> replays gap-free. Also lazily GCs stale
 * presence rows and prunes the event log.
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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastSeq = since
      let tick = 0

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
        clearInterval(timer)
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }

      const pump = async () => {
        if (closed) return
        try {
          const [events, presence, maxRow, gcRows] = await Promise.all([
            db.designEvent.findMany({
              where: { designId, id: { gt: lastSeq } },
              orderBy: { id: 'asc' },
              take: 200,
            }),
            db.presence.findMany({
              where: { designId, lastSeen: { gt: new Date(Date.now() - 30_000) } },
              orderBy: { lastSeen: 'desc' },
              take: 30,
            }),
            db.designEvent.aggregate({ where: { designId }, _max: { id: true } }),
            // heartbeat GC: drop presence rows older than 24 h (cheap, throttled by tick)
            tick % 90 === 0
              ? db.presence.deleteMany({ where: { designId, lastSeen: { lt: new Date(Date.now() - 86_400_000) } } })
              : Promise.resolve({ count: 0 }),
          ])
          void gcRows

          if (events.length) {
            lastSeq = Number(events[events.length - 1].id)
          }
          const serverSeq = Number(maxRow._max.id ?? lastSeq)

          // only send a frame when something actually changed (plus periodic keepalive)
          const filteredPresence = presence.filter((p) => p.id !== pid)
          const frame = {
            events: events.map((e) => ({
              seq: Number(e.id),
              id: e.id.toString(),
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
          if (events.length || tick % 20 === 0) send(frame)
          else comment('keepalive')

          // event-log pruning: keep the last 500 events per design
          if (events.length && serverSeq - lastSeq === 0 && serverSeq > 500 && tick % 30 === 0) {
            try {
              await db.designEvent.deleteMany({ where: { designId, id: { lt: serverSeq - 500 } } })
            } catch {
              /* pruning is best-effort */
            }
          }
        } catch (err) {
          console.error('[collab/stream] tick failed', err)
          comment('retry')
        }
      }

      const timer = setInterval(() => {
        tick += 1
        void pump()
      }, 800)
      req.signal.addEventListener('abort', close)

      // initial frame immediately (replay from `since`)
      comment(`open design=${designId} since=${since}`)
      await pump()
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
