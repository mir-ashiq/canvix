import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const maxDuration = 20

interface PresenceBody {
  pid?: string
  name?: string
  color?: string
  cursor?: { page?: number; x?: number; y?: number; selection?: string[] } | null
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/**
 * POST /api/collab/[designId]/presence — heartbeat + cursor broadcast.
 * Called every ~5 s (heartbeat) and throttled on cursor moves.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ designId: string }> }) {
  const { designId } = await params
  try {
    // v0.11.8: same-origin enforcement, matching every other mutating route.
    if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
    // v0.12.3 (H5): heartbeats are 15 s/client — 120/min/IP is a floor
    // so high it never bites a real room, and a ceiling for floods.
    const limit = checkRateLimit(req, 'collab:presence')
    if (!limit.ok) return rateLimitResponse(limit)

    const body = (await req.json().catch(() => ({}))) as PresenceBody
    const pid = (body.pid ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)
    if (!pid) return NextResponse.json({ error: 'A participant id is required.' }, { status: 400 })

    // v0.11.8: verify the design exists (and is not trashed) before
    // writing presence — this used to upsert blindly, leaving junk rows
    // for arbitrary design ids. Presence stays open to signed-out visitors
    // and read-only viewers ON PURPOSE: they are legitimate room members,
    // and a presence row carries no document authority (element ops go
    // through /events, which enforces ownership since v0.11.8).
    const design = await db.design.findUnique({
      where: { id: designId },
      select: { id: true, deletedAt: true },
    })
    if (!design || design.deletedAt) {
      return NextResponse.json({ error: 'Design not found.' }, { status: 404 })
    }

    const name = (body.name ?? '').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40) || 'Guest'
    const color = HEX_COLOR.test(body.color ?? '') ? body.color! : '#7630D7'

    // cursor: finite page/x/y, selection ids bounded
    let cursor: Record<string, unknown> | null = null
    if (body.cursor && typeof body.cursor === 'object') {
      const page = Number(body.cursor.page)
      const x = Number(body.cursor.x)
      const y = Number(body.cursor.y)
      const selection = Array.isArray(body.cursor.selection)
        ? body.cursor.selection.filter((s) => typeof s === 'string').slice(0, 50).map((s) => s.slice(0, 40))
        : undefined
      if (Number.isFinite(page) && Number.isFinite(x) && Number.isFinite(y)) {
        cursor = { page: Math.max(0, Math.round(page)), x, y, ...(selection ? { selection } : {}) }
      }
    }

    const { Prisma } = await import('@/generated/prisma/client')
    // v0.10.1 (incident 2026-10-29): this upsert used to 502 with P2002
    // every heartbeat when one browser had presence in a second design
    // (participant identity is per-browser; the PK used to be id alone —
    // fixed by migration 0004). Belt-and-braces: a concurrent create race
    // can still P2002 on the composite key — fall back to a plain update
    // so the heartbeat lands and the route never 502s on a benign race.
    try {
      await db.presence.upsert({
        where: { designId_id: { designId, id: pid } },
        create: { designId, id: pid, name, color, cursor: (cursor ?? undefined) as object },
        update: { name, color, cursor: (cursor ?? Prisma.JsonNull) as object, lastSeen: new Date() },
      })
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        await db.presence
          .update({
            where: { designId_id: { designId, id: pid } },
            data: { name, color, cursor: (cursor ?? Prisma.JsonNull) as object, lastSeen: new Date() },
          })
          .catch(() => { /* row vanished (24 h GC) — next heartbeat recreates */ })
      } else {
        throw err // unexpected (pool timeout, DB down) — honest 502 below
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[collab/presence]', err)
    return NextResponse.json({ error: 'Could not update presence.' }, { status: 502 })
  }
}
