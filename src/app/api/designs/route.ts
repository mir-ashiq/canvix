import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { dbErrorResponse } from '@/lib/db-errors'
import { getSessionUser } from '@/lib/auth/session'
import { readAnonToken, newAnonToken, anonKeyHash, setAnonCookie, anonHashFrom } from '@/lib/auth/anon'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'

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
//
// v0.9.1: each ownerless row carries two flags (the anonKey hash itself is
// never returned):
//   claimable — eligible for the per-design "Save to my account" action
//               (this browser's attribution OR a legacy pre-accounts row)
//   mine      — attributed to THIS browser; the only rows the bulk
//               "Save my designs" action will claim
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
        anonKey: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    const myHash = anonHashFrom(req)
    const out = designs.map(({ anonKey, ...d }) => ({
      ...d,
      claimable: d.ownerId === null && (anonKey === null || anonKey === myHash),
      mine: d.ownerId === null && anonKey !== null && anonKey === myHash,
    }))
    return NextResponse.json(out)
  } catch (error) {
    return dbErrorResponse(error, 'GET /api/designs')
  }
}

// POST /api/designs — create a new design.
// v0.9: when signed in, the design is owned by the account (private).
// Anonymous users keep the link-accessible ownerless mode.
// v0.9.1: anonymous creations are attributed to the creating browser
// (anonKey = sha256 of the canvix_anon cookie, minted on first use) so
// adopt-all can never claim someone else's work.
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  try {
    const user = await getSessionUser(req)
    const body = await req.json()

    if (user) {
      const design = await db.design.create({
        data: {
          name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Untitled design',
          width: Number.isFinite(body.width) ? Math.round(body.width) : 1080,
          height: Number.isFinite(body.height) ? Math.round(body.height) : 1080,
          pages: toPages(body.pages),
          source: typeof body.source === 'string' ? body.source.slice(0, 120) : 'blank',
          thumbnail: typeof body.thumbnail === 'string' ? body.thumbnail : null,
          ownerId: user.id,
        },
      })
      return NextResponse.json(design, { status: 201 })
    }

    // Anonymous: mint/refresh this browser's attribution, stamp the row.
    const token = readAnonToken(req) ?? newAnonToken()
    const design = await db.design.create({
      data: {
        name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Untitled design',
        width: Number.isFinite(body.width) ? Math.round(body.width) : 1080,
        height: Number.isFinite(body.height) ? Math.round(body.height) : 1080,
        pages: toPages(body.pages),
        source: typeof body.source === 'string' ? body.source.slice(0, 120) : 'blank',
        thumbnail: typeof body.thumbnail === 'string' ? body.thumbnail : null,
        anonKey: anonKeyHash(token),
      },
    })
    const res = NextResponse.json(design, { status: 201 })
    setAnonCookie(res, token)
    return res
  } catch (error) {
    // v0.8: template-opening failures get a classified, actionable payload
    // (DB_NOT_MIGRATED after a host switch etc.) instead of a bare 500.
    return dbErrorResponse(error, 'POST /api/designs')
  }
}
