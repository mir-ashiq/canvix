import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveDesignAccess, NOT_YOUR_DESIGN } from '@/lib/auth/design-guard'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { getSessionUser } from '@/lib/auth/session'
import { anonKeyHash, readAnonToken } from '@/lib/auth/anon'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'

// ── v0.14 (D6): move a design into a folder (or back to the root) ──
//   POST /api/designs/[id]/move { folderId: string | null }
//
// Two authorizations, both required:
//   1. the caller must be able to EDIT the design (the standard
//      design guard — 404 absent, 403 foreign-owned);
//   2. the target folder must belong to the caller's attribution —
//      a foreign folder id is a flat 404 (no existence oracle), so
//      nobody can file designs into someone else's tree or probe it.
// folderId null = "All designs" (the root) — always allowed.
//
// Deliberately NOT part of PUT /api/designs/[id]: that route is the
// autosave path (name/pages/thumbnail, 300/min); filing is an explicit
// dashboard action and gets its own budget.

async function __canvix_post(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const limit = checkRateLimit(req, 'designs:update')
  if (!limit.ok) return rateLimitResponse(limit)
  try {
    const { id } = await params
    const access = await resolveDesignAccess(req, id)
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!access.canEdit) return NextResponse.json(NOT_YOUR_DESIGN, { status: 403 })

    const body = (await req.json().catch(() => ({}))) as { folderId?: unknown }

    if (body.folderId === null || body.folderId === undefined) {
      await db.design.update({ where: { id }, data: { folderId: null } })
      return NextResponse.json({ ok: true, folderId: null })
    }

    if (typeof body.folderId !== 'string' || !body.folderId) {
      return NextResponse.json({ error: 'folderId must be a folder id or null.' }, { status: 400 })
    }

    // the target folder must be the caller's own
    const user = await getSessionUser(req)
    const token = readAnonToken(req)
    const ownerId = user?.id ?? null
    const anonKey = user ? null : token ? anonKeyHash(token) : null
    if (!ownerId && !anonKey) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const owned = await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "Folder"
        WHERE id = $1 AND (
          ("ownerId" = $2 AND $2 IS NOT NULL) OR ("anonKey" = $3 AND $3 IS NOT NULL))`,
      body.folderId,
      ownerId,
      anonKey,
    )
    if (owned.length === 0) return NextResponse.json({ error: 'Folder not found' }, { status: 404 })

    await db.design.update({ where: { id }, data: { folderId: body.folderId } })
    return NextResponse.json({ ok: true, folderId: body.folderId })
  } catch (error) {
    console.error('POST /api/designs/[id]/move failed', error)
    return NextResponse.json({ error: 'Failed to move the design' }, { status: 500 })
  }
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const POST = withLogging('POST /api/designs/[id]/move', __canvix_post)
