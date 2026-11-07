import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, isAdminUser, adminSource } from '@/lib/admin/guard'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/admin/users/[id]/role — grant or revoke console access.
// body: { role: "admin" | "user" }
//
// Guards:
//   • self-change is refused — an admin must never be able to lock
//     themselves out of the only page that can undo the change. (An
//     env-bootstrap admin can always recover a pure-DB lockout; this
//     guard removes the footgun entirely.)
//   • changing a username that CANVIX_ADMIN_USERS blesses is allowed
//     but pointless — the env wins by design. The UI shows an "env"
//     badge so nobody is surprised.

async function __canvix_post(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.res

  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const role = (body as { role?: unknown })?.role
    if (role !== 'admin' && role !== 'user') {
      return NextResponse.json({ error: 'role must be "admin" or "user".' }, { status: 400 })
    }
    if (id === guard.user.id) {
      return NextResponse.json(
        { error: 'You cannot change your own role — ask another administrator.', code: 'SELF_ROLE_CHANGE' },
        { status: 400 }
      )
    }
    const target = await db.user.findUnique({
      where: { id },
      select: { id: true, username: true, role: true },
    })
    if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 })

    const updated = await db.user.update({
      where: { id },
      data: { role },
      select: { id: true, username: true, role: true, createdAt: true },
    })
    return NextResponse.json({
      user: { ...updated, admin: isAdminUser(updated), adminSource: adminSource(updated) },
    })
  } catch (error) {
    console.error('POST /api/admin/users/[id]/role failed', error)
    return NextResponse.json({ error: 'Could not update the role. Please try again.' }, { status: 500 })
  }
}

export const POST = withLogging('POST /api/admin/users/[id]/role', __canvix_post)
