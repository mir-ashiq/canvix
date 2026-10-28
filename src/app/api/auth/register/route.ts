import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth/passwords'
import { canonicalUsername, checkUsername, checkPassword } from '@/lib/auth/validate'
import { createSession } from '@/lib/auth/session'
import { rateLimit } from '@/lib/ai/provider'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'

// POST /api/auth/register — create an account (username + password).
// Free forever: no email, no verification, no external provider — a
// self-hosted account system with zero moving parts beyond the DB.
// v0.9.1: same-origin enforced (blocks cross-site forced sign-ups).
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const rl = rateLimit('auth:register', req, 5, 3600)
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many sign-up attempts — try again in ${rl.retryAfterSec}s.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    )
  }
  try {
    const body = await req.json().catch(() => ({}))
    const uname = checkUsername(body?.username)
    if (!uname.ok) return NextResponse.json({ error: uname.error }, { status: 400 })
    const pword = checkPassword(body?.password)
    if (!pword.ok) return NextResponse.json({ error: pword.error }, { status: 400 })

    const username = canonicalUsername(body.username)
    const existing = await db.user.findUnique({ where: { username }, select: { id: true } })
    if (existing) return NextResponse.json({ error: 'That username is already taken.' }, { status: 409 })

    const passwordHash = await hashPassword(String(body.password))
    const user = await db.user.create({ data: { username, passwordHash }, select: { id: true, username: true, createdAt: true } })

    const res = NextResponse.json({ user }, { status: 201 })
    await createSession(user.id, res)
    return res
  } catch (error) {
    console.error('POST /api/auth/register failed', error)
    return NextResponse.json({ error: 'Could not create the account. Please try again.' }, { status: 500 })
  }
}
