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

// GET /api/designs — list designs (metadata only, newest first)
// ?trash=1 → only soft-deleted designs; default → only live designs
export async function GET(req: NextRequest) {
  try {
    const trash = req.nextUrl.searchParams.get('trash') === '1'
    const designs = await db.design.findMany({
      where: { deletedAt: trash ? { not: null } : null },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        width: true,
        height: true,
        thumbnail: true,
        source: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    return NextResponse.json(designs)
  } catch (error) {
    console.error('GET /api/designs failed', error)
    return NextResponse.json({ error: 'Failed to list designs' }, { status: 500 })
  }
}

// POST /api/designs — create a new design
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const design = await db.design.create({
      data: {
        name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Untitled design',
        width: Number.isFinite(body.width) ? Math.round(body.width) : 1080,
        height: Number.isFinite(body.height) ? Math.round(body.height) : 1080,
        pages: toPages(body.pages),
        source: typeof body.source === 'string' ? body.source.slice(0, 120) : 'blank',
        thumbnail: typeof body.thumbnail === 'string' ? body.thumbnail : null,
      },
    })
    return NextResponse.json(design, { status: 201 })
  } catch (error) {
    console.error('POST /api/designs failed', error)
    return NextResponse.json({ error: 'Failed to create design' }, { status: 500 })
  }
}
