import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { dbErrorResponse } from '@/lib/db-errors'
import { getSessionUser } from '@/lib/auth/session'

// Normalise incoming pages payload (accepts object or legacy JSON string)
// into a value suitable for the Postgres jsonb column.
function toPages(value: unknown): Prisma.InputJsonValue {
  if (typeof value === 'string') {
    try { return JSON.parse(value) as Prisma.InputJsonValue } catch { return [] }
  }
  return (value ?? []) as Prisma.InputJsonValue
}

// GET /api/designs — list designs (metadata only, newest first)
// ?trash=1 → only soft-deleted designs; default → only live designs
//
// v0.9 scoping: signed-in users see their designs + ownerless (shared)
// designs; anonymous visitors see ownerless designs only. Owned designs
// are private to their account.
export async function GET(req: NextRequest) {
  try {
    const trash = req.nextUrl.searchParams.get('trash') === '1'
    const user = await getSessionUser(req)
    const where: Prisma.DesignWhereInput = {
      deletedAt: trash ? { not: null } : null,
      ...(user
        ? { OR: [{ ownerId: null }, { ownerId: user.id }] }
        : { ownerId: null }),
    }
    const designs = await db.design.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        width: true,
        height: true,
        thumbnail: true,
        source: true,
        ownerId: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    return NextResponse.json(designs)
  } catch (error) {
    return dbErrorResponse(error, 'GET /api/designs')
  }
}

// POST /api/designs — create a new design.
// v0.9: when signed in, the design is owned by the account (private).
// Anonymous users keep the link-accessible ownerless mode.
export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser(req)
    const body = await req.json()
    const design = await db.design.create({
      data: {
        name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Untitled design',
        width: Number.isFinite(body.width) ? Math.round(body.width) : 1080,
        height: Number.isFinite(body.height) ? Math.round(body.height) : 1080,
        pages: toPages(body.pages),
        source: typeof body.source === 'string' ? body.source.slice(0, 120) : 'blank',
        thumbnail: typeof body.thumbnail === 'string' ? body.thumbnail : null,
        ...(user ? { ownerId: user.id } : {}),
      },
    })
    return NextResponse.json(design, { status: 201 })
  } catch (error) {
    // v0.8: template-opening failures get a classified, actionable payload
    // (DB_NOT_MIGRATED after a host switch etc.) instead of a bare 500.
    return dbErrorResponse(error, 'POST /api/designs')
  }
}
