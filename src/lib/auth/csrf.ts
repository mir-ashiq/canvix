// ─────────────────────────────────────────────────────────────
// CSRF protection (v0.9.1) — same-origin enforcement for every
// cookie-authenticated mutating API route.
//
// Layer 1 (v0.9): the session cookie is SameSite=Lax, so modern
// browsers already refuse to attach it to cross-site POST/PUT/DELETE.
// Layer 2 (this module): browsers ALWAYS send an Origin header (with
// Referer as a legacy fallback) on cross-site requests; when either is
// present it must match the request's own host, otherwise the mutation
// is rejected. Non-browser clients (curl, the MCP endpoint, health
// checks) send neither header and pass — they carry no ambient cookie
// authority to forge.
// ─────────────────────────────────────────────────────────────

import type { NextRequest } from 'next/server'

/**
 * True when the request is same-origin (or provably not from a browser
 * navigation/fetch — no Origin/Referer headers at all).
 */
export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin') ?? req.headers.get('referer')
  if (!origin) return true // curl / MCP / server-to-server: no CSRF surface
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false // malformed header — reject rather than guess
  }
  const hosts = [
    req.headers.get('host'),
    req.headers.get('x-forwarded-host')?.split(',')[0]?.trim(),
  ].filter((h): h is string => Boolean(h))
  if (!hosts.length) return false
  return hosts.includes(parsed.host)
}

/** Standard 403 body for a rejected cross-site mutation. */
export const CSRF_REJECTED = {
  error: 'Cross-site request rejected.',
  code: 'CSRF_REJECTED',
} as const
