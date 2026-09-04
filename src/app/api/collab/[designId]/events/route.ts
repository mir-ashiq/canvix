import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  MAX_EVENTS_PER_FLUSH,
  OP_KINDS,
  validateOpPayload,
  type CollabOp,
  type OpEnvelope,
} from '@/lib/collab/protocol'

export const runtime = 'nodejs'
export const maxDuration = 30

interface EventsBody {
  pid?: string
  name?: string
  color?: string
  events?: OpEnvelope[]
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

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
      const payload =
        op.kind === 'design:rename'
          ? { name: String((op as { name?: unknown }).name ?? '').slice(0, 80) }
          : (op as unknown)

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
