// ─────────────────────────────────────────────────────────────
// Admin guard (v0.16 A1) — who may open /admin and its API.
//
// Two paths to admin, both fail-closed:
//   1. DB role: User.role === 'admin' — granted by another admin from
//      the console (POST /api/admin/users/[id]/role).
//   2. Env bootstrap: CANVIX_ADMIN_USERS="alice,bob" — usernames that
//      are admin on EVERY request, no DB write needed. This is the
//      self-hoster's zero-friction first-admin path: set the env var,
//      log in, the console link appears.
//
// There is no third path — no config-table flag, no secret URL, and
// deliberately no "first registered user is admin" (on a public
// instance that would silently hand the keys to whoever happens to
// register first).
//
// CONTRACT: server-only (reads sessions + env).
// ─────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from 'next/server'
import { getSessionUser, type SessionUser } from '@/lib/auth/session'

/** Parse CANVIX_ADMIN_USERS into a lowercase username set. */
export function envAdminUsernames(): Set<string> {
  const raw = process.env.CANVIX_ADMIN_USERS ?? ''
  const out = new Set<string>()
  for (const part of raw.split(',')) {
    const name = part.trim().toLowerCase()
    if (name) out.add(name)
  }
  return out
}

/** Anything with a username shape we can compare against (lowercased). */
type NameLike = Pick<SessionUser, 'username' | 'role'>

/** True when this user is an admin by either path. */
export function isAdminUser(user: NameLike | null | undefined): boolean {
  if (!user) return false
  if (user.role === 'admin') return true
  return envAdminUsernames().has(user.username)
}

/** Where a user's admin status comes from — surfaced as a badge in the console. */
export function adminSource(user: NameLike | null | undefined): 'db' | 'env' | 'both' | null {
  if (!user) return null
  const db = user.role === 'admin'
  const env = envAdminUsernames().has(user.username)
  if (db && env) return 'both'
  if (db) return 'db'
  if (env) return 'env'
  return null
}

export const ADMIN_REQUIRED = {
  error: 'Administrator access is required.',
  code: 'ADMIN_REQUIRED',
} as const

/**
 * Resolve + authorize in one call — every /api/admin route starts with
 * this. Returns the session user when the request carries an admin
 * session, else a ready-to-return response:
 *   401 — not signed in at all
 *   403 — signed in but not an admin
 * (the console UI shows different copy for each case).
 */
export async function requireAdmin(
  req: NextRequest
): Promise<{ ok: true; user: SessionUser } | { ok: false; res: NextResponse }> {
  const user = await getSessionUser(req)
  if (!user) {
    return { ok: false, res: NextResponse.json({ ...ADMIN_REQUIRED, signedIn: false }, { status: 401 }) }
  }
  if (!isAdminUser(user)) {
    return { ok: false, res: NextResponse.json({ ...ADMIN_REQUIRED, signedIn: true }, { status: 403 }) }
  }
  return { ok: true, user }
}
