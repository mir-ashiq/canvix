// ─────────────────────────────────────────────────────────────
// Server-side session management (v0.9).
//
// Opaque token sessions: the cookie carries a 32-byte random token;
// the DB row id is sha256(token). A database leak therefore never
// contains usable session tokens, and sessions can be revoked
// server-side at any time (logout, expiry sweep).
//
// Cookie: `canvix_session`, HttpOnly + SameSite=Lax (+ Secure in
// production). 30-day absolute lifetime.
//
// CONTRACT: server-only module (node:crypto + Prisma).
// ─────────────────────────────────────────────────────────────

import { createHash, randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'

export const SESSION_COOKIE = 'canvix_session'
export const SESSION_TTL_DAYS = 30

export interface SessionUser {
  id: string
  username: string
  createdAt: Date
}

/** New random session token (base64url, 256-bit). */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

/** DB row id for a token = sha256 hex. */
export function sessionIdFor(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function cookieOptions() {
  const secure = process.env.NODE_ENV === 'production'
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  }
}

/**
 * Create a session for a user and attach the cookie to a response.
 * Opportunistically sweeps expired sessions (bounded, best-effort).
 */
export async function createSession(userId: string, res: NextResponse): Promise<void> {
  const token = newSessionToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)
  await db.session.create({ data: { id: sessionIdFor(token), userId, expiresAt } })
  res.cookies.set(SESSION_COOKIE, token, cookieOptions())
  // best-effort sweep: drop expired sessions (single bounded DELETE)
  void db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {})
}

/** Delete the current session (if any) and clear the cookie. */
export async function destroySession(req: NextRequest, res: NextResponse): Promise<void> {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (token) {
    await db.session.deleteMany({ where: { id: sessionIdFor(token) } }).catch(() => {})
  }
  res.cookies.set(SESSION_COOKIE, '', { ...cookieOptions(), maxAge: 0 })
}

/**
 * Resolve the signed-in user from the request cookie.
 * Returns null when absent, expired, or dangling (user deleted).
 */
export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (!token || token.length > 128) return null
  try {
    const row = await db.session.findUnique({
      where: { id: sessionIdFor(token) },
      include: { user: { select: { id: true, username: true, createdAt: true } } },
    })
    if (!row) return null
    if (row.expiresAt.getTime() < Date.now()) {
      void db.session.delete({ where: { id: row.id } }).catch(() => {})
      return null
    }
    return row.user
  } catch {
    // DB unavailable — treat as signed out, never crash a route over auth
    return null
  }
}
