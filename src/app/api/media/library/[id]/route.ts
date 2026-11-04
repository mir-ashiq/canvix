import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { getSessionUser } from '@/lib/auth/session'
import { anonKeyHash, readAnonToken } from '@/lib/auth/anon'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'

// ── v0.14 (D1): uploads library item management ──────────────
//   PATCH  /api/media/library/[id] { name }  — rename
//   DELETE /api/media/library/[id]           — remove from the library
//
// Ownership: the row's attribution (ownerId / anonKey) must match the
// caller's; anything else is a flat 404 (no existence oracle across
// accounts). DELETE only clears keepInLibrary — the bytes survive while
// any design still references them (the orphan GC's referenced-check
// protects them); unreferenced rows are reclaimed by the GC after its
// grace period, exactly like a deleted design's media always was.

function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.replace(/[\\/]|\.\./g, '').trim().slice(0, 200)
  return trimmed || null
}

async function __canvix_patch(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const { id } = await params
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: unknown }
    const name = sanitizeName(body.name)
    if (!name) return NextResponse.json({ error: 'A name is required.' }, { status: 400 })

    const user = await getSessionUser(req)
    const token = readAnonToken(req)
    const ownerId = user?.id ?? null
    const anonKey = user ? null : token ? anonKeyHash(token) : null
    if (!ownerId && !anonKey) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    const updated = await db.$executeRawUnsafe(
      `UPDATE "Media" SET name = $3 WHERE id = $1 AND "keepInLibrary" = true AND (
        ("ownerId" = $2 AND $2 IS NOT NULL) OR ("anonKey" = $4 AND $4 IS NOT NULL))`,
      id,
      ownerId,
      name,
      anonKey,
    )
    if (updated === 0) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    return NextResponse.json({ ok: true, name })
  } catch (error) {
    console.error('[media/library rename] failed', error)
    return NextResponse.json({ error: 'Could not rename.' }, { status: 500 })
  }
}

async function __canvix_delete(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const { id } = await params
  try {
    const user = await getSessionUser(req)
    const token = readAnonToken(req)
    const ownerId = user?.id ?? null
    const anonKey = user ? null : token ? anonKeyHash(token) : null
    if (!ownerId && !anonKey) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    const updated = await db.$executeRawUnsafe(
      `UPDATE "Media" SET "keepInLibrary" = false WHERE id = $1 AND "keepInLibrary" = true AND (
        ("ownerId" = $2 AND $2 IS NOT NULL) OR ("anonKey" = $3 AND $3 IS NOT NULL))`,
      id,
      ownerId,
      anonKey,
    )
    if (updated === 0) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[media/library delete] failed', error)
    return NextResponse.json({ error: 'Could not remove.' }, { status: 500 })
  }
}

export const PATCH = withLogging('PATCH /api/media/library/[id]', __canvix_patch)
export const DELETE = withLogging('DELETE /api/media/library/[id]', __canvix_delete)
