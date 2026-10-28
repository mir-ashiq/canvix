import { NextRequest, NextResponse } from 'next/server'
import { destroySession } from '@/lib/auth/session'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'

// POST /api/auth/logout — revoke the current session + clear the cookie.
// v0.9.1: same-origin enforced (a cross-site page must not be able to
// log the visitor out — logout CSRF).
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const res = NextResponse.json({ ok: true })
  await destroySession(req, res)
  return res
}
