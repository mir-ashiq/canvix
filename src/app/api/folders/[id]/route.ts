import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { getSessionUser } from '@/lib/auth/session'
import { anonKeyHash, readAnonToken } from '@/lib/auth/anon'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'

// ── v0.14 (D6): folder item management ───────────────────────
//   PATCH  /api/folders/[id] { name } — rename
//   DELETE /api/folders/[id]           — delete the folder
//
// Ownership: the row's attribution (ownerId / anonKey) must match the
// caller's; anything else is a flat 404 (no cross-account existence
// oracle — the same rule as the uploads library). DELETE never touches
// designs: the FK's ON DELETE SET NULL unfiles them (live AND trashed)
// back into "All designs" — a folder delete can never destroy work.

const MAX_NAME = 60

function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.replace(/[\\/]|\.\./g, '').trim().slice(0, MAX_NAME)
  return trimmed || null
}

async function __canvix_patch(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const limit = checkRateLimit(req, 'folders:update')
  if (!limit.ok) return rateLimitResponse(limit)
  const { id } = await params
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: unknown }
    const name = sanitizeName(body.name)
    if (!name) return NextResponse.json({ error: 'A folder name is required.' }, { status: 400 })

    const user = await getSessionUser(req)
    const token = readAnonToken(req)
    const ownerId = user?.id ?? null
    const anonKey = user ? null : token ? anonKeyHash(token) : null
    if (!ownerId && !anonKey) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    const updated = await db.$executeRawUnsafe(
      `UPDATE "Folder" SET name = $3, "updatedAt" = now()
        WHERE id = $1 AND (
          ("ownerId" = $2 AND $2 IS NOT NULL) OR ("anonKey" = $4 AND $4 IS NOT NULL))`,
      id,
      ownerId,
      name,
      anonKey,
    )
    if (updated === 0) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    return NextResponse.json({ ok: true, name })
  } catch (error) {
    console.error('[api/folders] rename failed', error)
    return NextResponse.json({ error: 'Could not rename.' }, { status: 500 })
  }
}

async function __canvix_delete(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const limit = checkRateLimit(req, 'folders:update')
  if (!limit.ok) return rateLimitResponse(limit)
  const { id } = await params
  try {
    const user = await getSessionUser(req)
    const token = readAnonToken(req)
    const ownerId = user?.id ?? null
    const anonKey = user ? null : token ? anonKeyHash(token) : null
    if (!ownerId && !anonKey) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    // The designs' folderId goes NULL via the FK's ON DELETE SET NULL
    const deleted = await db.$executeRawUnsafe(
      `DELETE FROM "Folder" WHERE id = $1 AND (
        ("ownerId" = $2 AND $2 IS NOT NULL) OR ("anonKey" = $3 AND $3 IS NOT NULL))`,
      id,
      ownerId,
      anonKey,
    )
    if (deleted === 0) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[api/folders] delete failed', error)
    return NextResponse.json({ error: 'Could not delete the folder.' }, { status: 500 })
  }
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const PATCH = withLogging('PATCH /api/folders/[id]', __canvix_patch)
export const DELETE = withLogging('DELETE /api/folders/[id]', __canvix_delete)
