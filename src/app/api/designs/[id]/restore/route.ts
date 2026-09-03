import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/designs/[id]/restore — restore a design from the Trash
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const design = await db.design.update({
      where: { id },
      data: { deletedAt: null },
    })
    return NextResponse.json({ ok: true, id: design.id })
  } catch (error) {
    console.error('POST /api/designs/[id]/restore failed', error)
    return NextResponse.json({ error: 'Failed to restore design' }, { status: 500 })
  }
}
