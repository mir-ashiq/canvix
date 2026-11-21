import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbErrorResponse } from '@/lib/db-errors'
import { getSessionUser } from '@/lib/auth/session'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// DELETE /api/keys/[id] — revoke one of the caller's own keys.
//
// Revocation is a timestamp, not a row delete: the 401 reason can say
// "revoked" (vs "unknown"), and the profile list keeps the audit trail
// (when it was created, last used). The row only disappears with the
// account (cascade). Only the OWNER's keys are addressable — a foreign
// key id is a flat 404, never a 403 (existence is not API business).

async function __canvix_delete(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser(req)
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })

    const { id } = await params
    const key = await db.apiKey.findFirst({ where: { id, userId: user.id }, select: { id: true, revokedAt: true } })
    if (!key) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (key.revokedAt) return NextResponse.json({ ok: true, alreadyRevoked: true })

    await db.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return dbErrorResponse(error, 'DELETE /api/keys/[id]')
  }
}

export const DELETE = withLogging('DELETE /api/keys/[id]', __canvix_delete)
