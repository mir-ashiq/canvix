// ─────────────────────────────────────────────────────────────
// Anonymous attribution (v0.9.1) — who created an ownerless
// design, without accounts.
//
// The first time a browser creates a design anonymously it receives a
// `canvix_anon` cookie (32-byte random token, HttpOnly, 1 year). The
// design row stores sha256(token) in `anonKey` — the same shape as
// session ids, so a database leak never contains usable tokens.
//
// This is what makes claim eligibility enforceable:
//   • adopt-all  claims only rows whose anonKey matches the caller's
//     cookie — never another browser's work, never legacy rows.
//   • per-design adopt additionally allows legacy rows (anonKey null),
//     as a deliberate single-design action.
//
// CONTRACT: server-only module (node:crypto).
// ─────────────────────────────────────────────────────────────

import { createHash, randomBytes } from 'node:crypto'
import type { NextRequest, NextResponse } from 'next/server'

export const ANON_COOKIE = 'canvix_anon'
export const ANON_TTL_DAYS = 365

/** New anonymous browser token (base64url, 256-bit). */
export function newAnonToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Stored attribution for a token = sha256 hex (never the raw cookie). */
export function anonKeyHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * The caller's existing anon token, or null when absent/oversized.
 * Read-only — never mints.
 */
export function readAnonToken(req: NextRequest): string | null {
  const token = req.cookies.get(ANON_COOKIE)?.value
  if (!token || token.length > 128) return null
  return token
}

/** The caller's attribution hash, or null when the browser has none. */
export function anonHashFrom(req: NextRequest): string | null {
  const token = readAnonToken(req)
  return token ? anonKeyHash(token) : null
}

/** (Re)attach the anon cookie to a response. */
export function setAnonCookie(res: NextResponse, token: string): void {
  res.cookies.set(ANON_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ANON_TTL_DAYS * 24 * 60 * 60,
  })
}

/**
 * Resolve the caller's attribution, minting a token (and scheduling the
 * cookie on `res`) when the browser has none. Used by design creation.
 */
export function ensureAnonAttribution(
  req: NextRequest,
  res: NextResponse
): { token: string; hash: string } {
  const existing = readAnonToken(req)
  const token = existing ?? newAnonToken()
  setAnonCookie(res, token)
  return { token, hash: anonKeyHash(token) }
}
