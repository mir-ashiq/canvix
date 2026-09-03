import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

// Normalise incoming pages payload (accepts object or legacy JSON string)
// into a value suitable for the Postgres jsonb column.
function toPages(value: unknown): Prisma.InputJsonValue {
  if (typeof value === 'string') {
    try { return JSON.parse(value) as Prisma.InputJsonValue } catch { return [] }
  }
  return (value ?? []) as Prisma.InputJsonValue
}

// GET /api/designs/[id] — full design incl. pages
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const design = await db.design.findUnique({ where: { id } })
    if (!design) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ...design, pages: design.pages ?? [] })
  } catch (error) {
    console.error('GET /api/designs/[id] failed', error)
    return NextResponse.json({ error: 'Failed to get design' }, { status: 500 })
  }
}

// PUT /api/designs/[id] — save design (name / pages / thumbnail)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
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
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
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
