import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// DELETE /api/versions/[id] — remove one saved version snapshot
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await db.designVersion.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE /api/versions/[id] failed', error)
    return NextResponse.json({ error: 'Failed to delete version' }, { status: 500 })
  }
}
