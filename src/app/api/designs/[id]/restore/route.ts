import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveDesignAccess, NOT_YOUR_DESIGN } from '@/lib/auth/design-guard'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { withLogging } from '@/lib/observability'

// POST /api/designs/[id]/restore — restore a design from the Trash.
// v0.9: owner-only for owned designs (403 otherwise); ownerless unchanged.
// v0.9.1: same-origin enforced (CSRF).
async function __canvix_post(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  try {
    const { id } = await params
    const access = await resolveDesignAccess(req, id)
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!access.canEdit) return NextResponse.json(NOT_YOUR_DESIGN, { status: 403 })
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

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const POST = withLogging('POST /api/designs/[id]/restore', __canvix_post)
