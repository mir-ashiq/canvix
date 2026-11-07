import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { isAdminUser } from '@/lib/admin/guard'
import { withLogging } from '@/lib/observability'

// GET /api/auth/me — the signed-in user (or null). Public endpoint the
// dashboard/editor use to decide between account mode and anonymous mode.
async function __canvix_get(req: NextRequest) {
  const user = await getSessionUser(req)
  return NextResponse.json({
    user: user
      ? {
          id: user.id,
          username: user.username,
          createdAt: user.createdAt,
          // v0.16 (A1): drives the dashboard's Admin link. Env-bootstrap
          // admins (CANVIX_ADMIN_USERS) resolve true here too.
          admin: isAdminUser(user),
        }
      : null,
  })
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const GET = withLogging('GET /api/auth/me', __canvix_get)
