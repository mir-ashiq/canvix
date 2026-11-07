import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { resolveDesignAccess, NOT_YOUR_DESIGN } from '@/lib/auth/design-guard'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { mergePages } from '@/lib/collab/merge'
import type { PageData } from '@/lib/types'
import { withLogging } from '@/lib/observability'
import { getSessionUser } from '@/lib/auth/session'
import { anonHashFrom } from '@/lib/auth/anon'
import { recordActive } from '@/lib/admin/traffic'
import { getSettings } from '@/lib/admin/config'

// Normalise incoming pages payload (accepts object or legacy JSON string)
// into a value suitable for the Postgres jsonb column.
function toPages(value: unknown): Prisma.InputJsonValue {
  if (typeof value === 'string') {
    try { return JSON.parse(value) as Prisma.InputJsonValue } catch { return [] }
  }
  return (value ?? []) as Prisma.InputJsonValue
}

function asPages(value: unknown): PageData[] {
  return Array.isArray(value) ? (value as PageData[]) : []
}

// GET /api/designs/[id] — full design incl. pages.
// v0.9: open to anyone with the link (share/view), but carries a
// `readOnly` flag when the design belongs to another account so the
// editor can switch to view-only mode.
// v0.10: also returns `seq` (the design's current event-log cursor) so a
// freshly loaded editor does not replay pre-load events over a document
// that already contains them.
async function __canvix_get(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const access = await resolveDesignAccess(req, id)
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const design = access.design
    // v0.16 (A1): opening the editor counts as daily activity
    void recordActive((await getSessionUser(req))?.id ?? anonHashFrom(req))
    const maxEvent = await db.designEvent
      .aggregate({ where: { designId: id }, _max: { id: true } })
      .catch(() => null)
    return NextResponse.json({
      ...design,
      pages: design.pages ?? [],
      readOnly: !access.canEdit,
      seq: maxEvent ? Number(maxEvent._max.id ?? 0) : 0,
    })
  } catch (error) {
    console.error('GET /api/designs/[id] failed', error)
    return NextResponse.json({ error: 'Failed to get design' }, { status: 500 })
  }
}

// PUT /api/designs/[id] — save design (name / pages / thumbnail)
// v0.9: ownerless designs stay link-editable; owned designs only save
// for their owner (403 otherwise). v0.9.1: same-origin enforced (CSRF).
// v0.10 offline merge: the body may carry `baseUpdatedAt` — the server
// `updatedAt` the client's pages are based on. When it matches the stored
// row, this is a fast-path save (plain overwrite). When it does not (the
// tab was offline while others saved), the server MERGES element-wise by
// HLC stamps (`_m`) + tombstones instead of clobbering — the same pure
// rule every client applies, so all replicas converge.
async function __canvix_put(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  // v0.12.3 (H5): generous cap — autosave fires ≤ ~37/min after its
  // 1.6 s debounce; 300/min leaves multi-tab headroom, stops runaway loops
  const limit = checkRateLimit(req, 'designs:update')
  if (!limit.ok) return rateLimitResponse(limit)
  try {
    const { id } = await params
    const access = await resolveDesignAccess(req, id)
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!access.canEdit) return NextResponse.json(NOT_YOUR_DESIGN, { status: 403 })

    // v0.16 (A1): anonymous saves are refused when the console disables
    // anonymous editing (the ownerless commons included). The session is
    // only resolved on the disabled path — the default path costs one
    // cached config read and nothing else.
    if (!(await getSettings()).anonymousEditing && !(await getSessionUser(req))) {
      return NextResponse.json(
        { error: 'Anonymous editing is disabled on this instance. Sign in to save changes.', code: 'ANON_DISABLED' },
        { status: 403 }
      )
    }

    const body = await req.json()
    const data: Record<string, unknown> = {}
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 120)
    if (body.pages !== undefined) data.pages = toPages(body.pages)
    if (body.thumbnail !== undefined) data.thumbnail = typeof body.thumbnail === 'string' ? body.thumbnail : null

    // ── v0.10 divergence check ──────────────────────────────────
    const baseUpdatedAt =
      typeof body.baseUpdatedAt === 'string' && body.baseUpdatedAt ? body.baseUpdatedAt : null
    let mergedPages: PageData[] | null = null
    if (baseUpdatedAt && data.pages !== undefined) {
      const current = await db.design.findUnique({
        where: { id },
        select: { updatedAt: true, pages: true },
      })
      // normalize both timestamps to ms-precision ISO for comparison —
      // Prisma returns Date; the client received it via JSON (ISO string)
      const serverIso = current ? new Date(current.updatedAt).toISOString() : null
      let baseIso: string | null = null
      try {
        baseIso = new Date(baseUpdatedAt).toISOString()
      } catch {
        baseIso = null
      }
      if (serverIso && baseIso && serverIso !== baseIso) {
        // divergent — merge their pages into ours by stamp
        const ours = asPages(current?.pages)
        const theirs = asPages(data.pages)
        mergedPages = mergePages(ours, theirs)
        data.pages = mergedPages as unknown as Prisma.InputJsonValue
      }
    }

    const design = await db.design.update({ where: { id }, data })
    return NextResponse.json({
      id: design.id,
      name: design.name,
      updatedAt: design.updatedAt,
      ...(mergedPages ? { merged: true, pages: mergedPages } : {}),
    })
  } catch (error) {
    console.error('PUT /api/designs/[id] failed', error)
    return NextResponse.json({ error: 'Failed to save design' }, { status: 500 })
  }
}

// DELETE /api/designs/[id] — move to Trash (soft delete).
// ?permanent=1 → delete permanently (also removes version snapshots).
// v0.9: ownerless designs stay link-editable; owned designs only delete
// for their owner (403 otherwise). v0.9.1: same-origin enforced (CSRF).
async function __canvix_delete(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const limit = checkRateLimit(req, 'designs:delete')
  if (!limit.ok) return rateLimitResponse(limit)
  try {
    const { id } = await params
    const access = await resolveDesignAccess(req, id)
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!access.canEdit) return NextResponse.json(NOT_YOUR_DESIGN, { status: 403 })

    if (req.nextUrl.searchParams.get('permanent') === '1') {
      await db.design.delete({ where: { id } })
      return NextResponse.json({ ok: true, permanent: true })
    }
    await db.design.update({ where: { id }, data: { deletedAt: new Date() } })
    return NextResponse.json({ ok: true, trashed: true })
  } catch (error) {
    console.error('DELETE /api/designs/[id] failed', error)
    return NextResponse.json({ error: 'Failed to delete design' }, { status: 500 })
  }
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const GET = withLogging('GET /api/designs/[id]', __canvix_get)
export const PUT = withLogging('PUT /api/designs/[id]', __canvix_put)
export const DELETE = withLogging('DELETE /api/designs/[id]', __canvix_delete)
