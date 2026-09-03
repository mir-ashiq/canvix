import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/templates — built-in template library (from DB, falls back empty)
export async function GET() {
  try {
    const templates = await db.template.findMany({
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json(
      templates.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        category: t.category,
        width: t.width,
        height: t.height,
        accent: t.accent,
        pages: t.pages ?? [],
      }))
    )
  } catch (error) {
    console.error('GET /api/templates failed', error)
    return NextResponse.json({ error: 'Failed to list templates' }, { status: 500 })
  }
}
