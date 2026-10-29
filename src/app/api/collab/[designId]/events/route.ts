import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  MAX_EVENTS_PER_FLUSH,
  OP_KINDS,
  validateOpPayload,
  type CollabOp,
  type OpEnvelope,
} from '@/lib/collab/protocol'
import { formatHlc } from '@/lib/collab/hlc'

export const runtime = 'nodejs'
export const maxDuration = 30

interface EventsBody {
  pid?: string
  name?: string
  color?: string
  events?: OpEnvelope[]
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

// ── v0.10 offline merge: server-side HLC stamping ─────────────
// Envelopes from v0.10 clients carry an `hlc`; legacy clients don't. Every
// persisted event gets a stamp so downstream last-write-wins gates are
// total-ordered. The server clock is walltime-based with an in-memory tick;
// per-serverless-instance state is fine — stamps only need to be newer than
// the *client* epochs they arbitrate, and walltime guarantees that for
// honestly-clocked clients (a skewed client clock is absorbed by its own
// HLC on the next observe).
const serverClock = { w: 0, c: 0 }
function serverHlc(): string {
  const wall = Date.now()
  if (wall > serverClock.w) {
    serverClock.w = wall
    serverClock.c = 0
  } else {
    serverClock.c += 1
  }
  return formatHlc(serverClock.w, serverClock.c, 'srv')
}

/**
 * POST /api/collab/[designId]/events — upstream op flush (batched).
 *
 * Every op is validated before persisting: known kind, finite numbers,
 * bounded payload size, bounded counts. Malformed events are dropped and
 * reported — never crash, never 500 on bad input.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ designId: string }> }) {
  const { designId } = await params
  try {
    const body = (await req.json().catch(() => ({}))) as EventsBody
    const pid = (body.pid ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)
    if (!pid) return NextResponse.json({ error: 'A participant id is required.' }, { status: 400 })

    const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS_PER_FLUSH) : []
    if (!events.length) return NextResponse.json({ ok: true, accepted: 0 })

    // verify design exists & is not trashed
    const design = await db.design.findUnique({
      where: { id: designId },
      select: { id: true, deletedAt: true },
    })
    if (!design || design.deletedAt) {
      return NextResponse.json({ error: 'Design not found.' }, { status: 404 })
    }

    const seenEventIds = new Set<string>()
    const accepted: string[] = []
    const rejected: string[] = []

    for (const env of events) {
      if (!env || typeof env !== 'object' || !env.op || typeof env.eventId !== 'string') {
        rejected.push('malformed')
        continue
      }
      if (env.eventId.length > 80 || seenEventIds.has(env.eventId)) {
        rejected.push(env.eventId || 'bad-id')
        continue
      }
      seenEventIds.add(env.eventId)

      const op = env.op as CollabOp
      if (!OP_KINDS.has(op.kind)) {
        rejected.push(env.eventId)
        continue
      }
      // structural checks per op family
      const pageIdOk = typeof (op as { pageId?: unknown }).pageId !== 'string' || ((op as { pageId: string }).pageId.length <= 40)
      if (!pageIdOk) {
        rejected.push(env.eventId)
        continue
      }
      if (!validateOpPayload(op)) {
        rejected.push(env.eventId)
        continue
      }

      // design:rename — clamp the name
      const payload: Record<string, unknown> =
        op.kind === 'design:rename'
          ? { name: String((op as { name?: unknown }).name ?? '').slice(0, 80) }
          : { ...(op as unknown as Record<string, unknown>) }
      // v0.10: embed the HLC stamp (client's if present, else the server's)
      payload._h = typeof env.hlc === 'string' && env.hlc.length <= 80 ? env.hlc : serverHlc()

      await db.designEvent.create({
        data: {
          designId,
          actorId: pid,
          kind: op.kind,
          payload: payload as object,
        },
      })
      accepted.push(env.eventId)
    }

    // touch presence so an active editor stays "online" even between heartbeats
    const name = (body.name ?? '').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40) || 'Guest'
    const color = HEX_COLOR.test(body.color ?? '') ? body.color! : '#7630D7'
    await db.presence.upsert({
      where: { designId_id: { designId, id: pid } },
      create: { designId, id: pid, name, color },
      update: { lastSeen: new Date(), name, color },
    }).catch(() => { /* presence is best-effort */ })

    return NextResponse.json({ ok: true, accepted: accepted.length, rejected })
  } catch (err) {
    console.error('[collab/events]', err)
    return NextResponse.json({ error: 'Could not persist collaboration events.' }, { status: 502 })
  }
}
