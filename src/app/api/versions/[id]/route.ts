import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withLogging } from '@/lib/observability'

// DELETE /api/versions/[id] — remove one saved version snapshot
async function __canvix_delete(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await db.designVersion.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE /api/versions/[id] failed', error)
    return NextResponse.json({ error: 'Failed to delete version' }, { status: 500 })
  }
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const DELETE = withLogging('DELETE /api/versions/[id]', __canvix_delete)
