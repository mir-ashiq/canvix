import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import {
  MAX_EVENTS_PER_FLUSH,
  OP_KINDS,
  validateOpPayload,
  type CollabOp,
  type OpEnvelope,
} from '@/lib/collab/protocol'
import { formatHlc } from '@/lib/collab/hlc'
import { canEditDesign, NOT_YOUR_DESIGN } from '@/lib/auth/design-guard'
import { getSessionUser } from '@/lib/auth/session'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { withLogging } from '@/lib/observability'

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
async function __canvix_post(req: NextRequest, { params }: { params: Promise<{ designId: string }> }) {
  const { designId } = await params
  try {
    // v0.11.8: same-origin enforcement — every other mutating route already
    // checks this; without it a cross-site page could drive an authenticated
    // owner's session cookie at this endpoint.
    if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
    // v0.12.3 (H5): active clients flush every 400 ms (150/min each) —
    // 600/min/IP covers a few tabs in one room, stops event floods.
    const limit = checkRateLimit(req, 'collab:events')
    if (!limit.ok) return rateLimitResponse(limit)

    const body = (await req.json().catch(() => ({}))) as EventsBody
    const pid = (body.pid ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)
    if (!pid) return NextResponse.json({ error: 'A participant id is required.' }, { status: 400 })

    const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS_PER_FLUSH) : []
    if (!events.length) return NextResponse.json({ ok: true, accepted: 0 })

    // v0.11.8: verify the design exists & is not trashed, and resolve the
    // caller's edit rights. This route used to check existence only — the
    // ownership rule the document rail (PUT /api/designs/[id]) enforces was
    // missing here, so anyone holding an owned design's link could append
    // ops (up to and including pages:replace) that reached the owner's live
    // session and rode the owner's next autosave. Same three cases as
    // design-guard now, resolved with a lean column set — this route is hot
    // (a flush every 400 ms per client), so the full design row is
    // deliberately not fetched.
    const [design, user] = await Promise.all([
      db.design.findUnique({
        where: { id: designId },
        select: { id: true, deletedAt: true, ownerId: true },
      }),
      getSessionUser(req),
    ])
    if (!design || design.deletedAt) {
      return NextResponse.json({ error: 'Design not found.' }, { status: 404 })
    }
    if (!canEditDesign(design, user)) {
      return NextResponse.json(NOT_YOUR_DESIGN, { status: 403 })
    }

    const seenEventIds = new Set<string>()
    const rejected: string[] = []
    const rows: Prisma.DesignEventCreateManyInput[] = []

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

      rows.push({
        designId,
        actorId: pid,
        kind: op.kind,
        payload: payload as Prisma.InputJsonValue,
        eventId: env.eventId,
      })
    }

    // v0.10.1: one round-trip for the whole batch (was N sequential creates —
    // up to 20 pooler round-trips per flush) and IDEMPOTENT: (designId,
    // eventId) is unique, so a retried flush (network drop, or the function
    // killed at its duration limit mid-batch — exactly the 30 s-timeout
    // incident) re-inserts nothing instead of duplicating ops. The v0.10
    // client RETAINS failed batches, so this is what makes retries safe.
    let accepted = 0
    if (rows.length) {
      const r = await db.designEvent.createMany({ data: rows, skipDuplicates: true })
      accepted = r.count
    }

    // touch presence so an active editor stays "online" even between heartbeats.
    // v0.10.1: bounded (3 s) — presence is best-effort and must never hold the
    // flush hostage — and P2002-safe (a concurrent create raced us → the row
    // exists by now → a plain update lands the touch anyway).
    const name = (body.name ?? '').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40) || 'Guest'
    const color = HEX_COLOR.test(body.color ?? '') ? body.color! : '#7630D7'
    await Promise.race([
      db.presence
        .upsert({
          where: { designId_id: { designId, id: pid } },
          create: { designId, id: pid, name, color },
          update: { lastSeen: new Date(), name, color },
        })
        .catch(async (err) => {
          if ((err as { code?: string }).code === 'P2002') {
            await db.presence
              .update({
                where: { designId_id: { designId, id: pid } },
                data: { lastSeen: new Date(), name, color },
              })
              .catch(() => { /* row vanished (GC) — next heartbeat recreates */ })
          }
          /* other errors: presence is best-effort */
        }),
      new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
    ])

    return NextResponse.json({ ok: true, accepted, rejected })
  } catch (err) {
    console.error('[collab/events]', err)
    return NextResponse.json({ error: 'Could not persist collaboration events.' }, { status: 502 })
  }
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const POST = withLogging('POST /api/collab/[designId]/events', __canvix_post)
