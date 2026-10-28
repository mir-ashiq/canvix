import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword } from '@/lib/auth/passwords'
import { canonicalUsername, checkUsername } from '@/lib/auth/validate'
import { createSession } from '@/lib/auth/session'
import { rateLimit } from '@/lib/ai/provider'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'

// POST /api/auth/login — exchange username + password for a session cookie.
// One deliberately generic error message: never reveal whether the
// username exists (account enumeration).
// v0.9.1: same-origin enforced (blocks login CSRF / session fixation).
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const rl = rateLimit('auth:login', req, 10, 600)
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many sign-in attempts — try again in ${rl.retryAfterSec}s.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    )
  }
  try {
    const body = await req.json().catch(() => ({}))
    const uname = checkUsername(body?.username)
    if (!uname.ok) return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 })
    if (typeof body?.password !== 'string' || !body.password) {
      return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 })
    }

    const username = canonicalUsername(body.username)
    const user = await db.user.findUnique({ where: { username } })
    const ok = user ? await verifyPassword(body.password, user.passwordHash) : false
    if (!user || !ok) {
      return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 })
    }

    const res = NextResponse.json({ user: { id: user.id, username: user.username, createdAt: user.createdAt } })
    await createSession(user.id, res)
    return res
  } catch (error) {
    console.error('POST /api/auth/login failed', error)
    return NextResponse.json({ error: 'Sign-in failed. Please try again.' }, { status: 500 })
  }
}
