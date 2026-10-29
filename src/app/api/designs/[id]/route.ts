import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { resolveDesignAccess, NOT_YOUR_DESIGN } from '@/lib/auth/design-guard'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'

// Normalise incoming pages payload (accepts object or legacy JSON string)
// into a value suitable for the Postgres jsonb column.
function toPages(value: unknown): Prisma.InputJsonValue {
  if (typeof value === 'string') {
    try { return JSON.parse(value) as Prisma.InputJsonValue } catch { return [] }
  }
  return (value ?? []) as Prisma.InputJsonValue
}

// GET /api/designs/[id] — full design incl. pages.
// v0.9: open to anyone with the link (share/view), but carries a
// `readOnly` flag when the design belongs to another account so the
// editor can switch to view-only mode.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const access = await resolveDesignAccess(req, id)
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const design = access.design
    return NextResponse.json({ ...design, pages: design.pages ?? [], readOnly: !access.canEdit })
  } catch (error) {
    console.error('GET /api/designs/[id] failed', error)
    return NextResponse.json({ error: 'Failed to get design' }, { status: 500 })
  }
}

// PUT /api/designs/[id] — save design (name / pages / thumbnail)
// v0.9: ownerless designs stay link-editable; owned designs only save
// for their owner (403 otherwise). v0.9.1: same-origin enforced (CSRF).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  try {
    const { id } = await params
    const access = await resolveDesignAccess(req, id)
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!access.canEdit) return NextResponse.json(NOT_YOUR_DESIGN, { status: 403 })

    const body = await req.json()
    const data: Record<string, unknown> = {}
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 120)
    if (body.pages !== undefined) data.pages = toPages(body.pages)
    if (body.thumbnail !== undefined) data.thumbnail = typeof body.thumbnail === 'string' ? body.thumbnail : null
    const design = await db.design.update({ where: { id }, data })
    return NextResponse.json({
      id: design.id,
      name: design.name,
      updatedAt: design.updatedAt,
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
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
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
