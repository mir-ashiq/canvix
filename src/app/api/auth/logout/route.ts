import { NextRequest, NextResponse } from 'next/server'
import { destroySession } from '@/lib/auth/session'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { withLogging } from '@/lib/observability'

// POST /api/auth/logout — revoke the current session + clear the cookie.
// v0.9.1: same-origin enforced (a cross-site page must not be able to
// log the visitor out — logout CSRF).
async function __canvix_post(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const res = NextResponse.json({ ok: true })
  await destroySession(req, res)
  return res
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const POST = withLogging('POST /api/auth/logout', __canvix_post)
