import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { dbErrorResponse } from '@/lib/db-errors'
import { authenticateApiKey } from '@/lib/auth/api-key'
import { withLogging } from '@/lib/observability'
import { recordActive } from '@/lib/admin/traffic'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/v1/designs — the REST rail (v0.24, Wave 6 core).
//
// API-key surface (Authorization: Bearer cvx_…): lists the key owner's
// OWN designs only — unlike the session dashboard, ownerless shared
// designs are NOT included: a machine credential reading a shared
// workspace by default is a data-exfiltration footgun, and the v1
// surface stays deliberately narrower than the browser one.
// Keyset-paginated exactly like GET /api/designs (60 rows, cursor+id).
//
// Scopes: designs:read. 401 (bad/revoked/expired key) and 403 (key
// valid, scope missing) are deliberately distinct — automation should
// be able to tell "rotate the key" from "re-issue with more scopes".

const DESIGNS_PAGE_SIZE = 60

async function __canvix_get(req: NextRequest) {
  try {
    const auth = await authenticateApiKey(req, db)
    if (!auth) {
      return NextResponse.json(
        { error: 'unauthorized', message: 'This endpoint requires an API key (Authorization: Bearer cvx_…). Create one in Settings → API keys.' },
        { status: 401 }
      )
    }
    if (!auth.ok) {
      return NextResponse.json({ error: auth.code, message: auth.message }, { status: auth.status })
    }
    if (!auth.user.scopes.includes('designs:read')) {
      return NextResponse.json(
        { error: 'insufficient_scope', message: "This key lacks the 'designs:read' scope." },
        { status: 403 }
      )
    }

    // key-authenticated traffic counts as daily activity for the owner
    void recordActive(auth.user.id)

    const cursor = req.nextUrl.searchParams.get('cursor')
    const cursorId = req.nextUrl.searchParams.get('id')
    const filters: Prisma.DesignWhereInput[] = []
    if (cursor && !Number.isNaN(Date.parse(cursor))) {
      filters.push({
        OR: [
          { updatedAt: { lt: new Date(cursor) } },
          ...(cursorId ? [{ updatedAt: new Date(cursor), id: { lt: cursorId } }] : []),
        ],
      })
    }
    const designs = await db.design.findMany({
      where: { ownerId: auth.user.id, deletedAt: null, AND: filters },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: DESIGNS_PAGE_SIZE + 1,
      select: {
        id: true,
        name: true,
        width: true,
        height: true,
        source: true,
        folderId: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    const hasMore = designs.length > DESIGNS_PAGE_SIZE
    const page = hasMore ? designs.slice(0, DESIGNS_PAGE_SIZE) : designs
    const last = page[page.length - 1]

    // best-effort lastUsedAt (never blocks the response)
    void db.apiKey.update({ where: { id: auth.user.keyId }, data: { lastUsedAt: new Date() } }).catch(() => {})

    return NextResponse.json({
      designs: page,
      nextCursor: hasMore && last ? { cursor: last.updatedAt.toISOString(), id: last.id } : null,
    })
  } catch (error) {
    return dbErrorResponse(error, 'GET /api/v1/designs')
  }
}

export const GET = withLogging('GET /api/v1/designs', __canvix_get)
