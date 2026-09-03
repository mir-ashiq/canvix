import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/designs — list all designs (metadata only, newest first)
export async function GET() {
  try {
    const designs = await db.design.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        width: true,
        height: true,
        thumbnail: true,
        source: true,
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
        pages: typeof body.pages === 'string' ? body.pages : JSON.stringify(body.pages ?? []),
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
