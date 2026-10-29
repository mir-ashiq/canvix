import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

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
    const body = (await req.json().catch(() => ({}))) as PresenceBody
    const pid = (body.pid ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)
    if (!pid) return NextResponse.json({ error: 'A participant id is required.' }, { status: 400 })

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
