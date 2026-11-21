import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbErrorResponse } from '@/lib/db-errors'
import { authenticateApiKey } from '@/lib/auth/api-key'
import { withLogging } from '@/lib/observability'
import { recordActive } from '@/lib/admin/traffic'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/v1/designs/[id] — full design (metadata + pages) for a key
// the OWNER issued (v0.24, Wave 6 core).
//
// Deliberately narrower than GET /api/designs/[id]: the session route
// resolves link/share access for anyone; the REST rail only serves
// designs the key owner owns. Foreign ids are a flat 404 (never a 403
// — existence of someone else's design is not API business).
//
// Scopes: designs:read.

async function __canvix_get(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const { id } = await params
    const design = await db.design.findFirst({
      where: { id, ownerId: auth.user.id, deletedAt: null },
      select: {
        id: true,
        name: true,
        width: true,
        height: true,
        pages: true,
        source: true,
        folderId: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    if (!design) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    void recordActive(auth.user.id)
    void db.apiKey.update({ where: { id: auth.user.keyId }, data: { lastUsedAt: new Date() } }).catch(() => {})

    return NextResponse.json({ ...design, pages: design.pages ?? [] })
  } catch (error) {
    return dbErrorResponse(error, 'GET /api/v1/designs/[id]')
  }
}

export const GET = withLogging('GET /api/v1/designs/[id]', __canvix_get)
