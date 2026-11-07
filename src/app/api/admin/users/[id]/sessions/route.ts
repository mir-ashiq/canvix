import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin/guard'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/admin/users/[id]/sessions — revoke every session of one
// user ("sign out everywhere"). Sessions are opaque server-side rows,
// so this is a single bounded DELETE; the user's designs and uploads
// are untouched. Works on the admin's own rows too (an explicit sign-
// out of the console session itself, nothing more dramatic).

async function __canvix_post(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.res

  try {
    const { id } = await params
    const target = await db.user.findUnique({ where: { id }, select: { id: true } })
    if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 })
    const { count } = await db.session.deleteMany({ where: { userId: id } })
    return NextResponse.json({ revoked: count })
  } catch (error) {
    console.error('POST /api/admin/users/[id]/sessions failed', error)
    return NextResponse.json({ error: 'Could not revoke sessions. Please try again.' }, { status: 500 })
  }
}

export const POST = withLogging('POST /api/admin/users/[id]/sessions', __canvix_post)
