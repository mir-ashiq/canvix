// v0.24 (Wave 6 core): scoped API keys — the user-facing REST rail.
//
// The MCP endpoint already proves the model (one bearer token → one
// JSON-RPC surface); this is the same idea for people: a user creates
// a key in their profile, picks scopes, and scripts against the REST
// API. Storage mirrors the Session pattern: the DB row id is
// sha256(token), so a database leak never yields usable keys, and the
// raw token is shown exactly once at creation.
//
// Scope model: a key is a comma-joined subset of the known scopes
// (SCOPES below). 'designs:read' is the v1 scope; 'all' is sugar for
// every current scope (explicit > implicit: the UI checks the real
// scopes, and a key scoped 'all' keeps working as future scopes ship
// — matching how operators expect long-lived automation keys to age).
//
// Rate limits: key-authenticated requests count against the caller's
// own bucket ('api-key:<id-hash-prefix>'), separate from browser
// sessions, so a runaway script cannot lock the owner's browser out.

import { createHash, randomBytes } from 'node:crypto'
import type { NextRequest, NextResponse } from 'next/server'

export const API_KEY_PREFIX = 'cvx_'
// v0.25: 'mcp' unlocks the MCP endpoint (/api/mcp) for the key owner —
// BYO-MCP. The scope rides the same key machinery (one token, many
// rails): a key with 'mcp' authorizes JSON-RPC calls scoped to the
// owner's own designs, exactly like the REST rail is scoped.
export const API_KEY_SCOPES = ['designs:read', 'designs:write', 'mcp'] as const
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]

/** New raw key token: cvx_ + 256-bit base64url. */
export function newApiKeyValue(): string {
  return API_KEY_PREFIX + randomBytes(32).toString('base64url')
}

/** DB row id for a raw key = sha256 hex (same shape as Session). */
export function apiKeyIdFor(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Parse + validate a scopes CSV → normalized subset, or null. */
export function parseScopes(raw: string | null | undefined): ApiKeyScope[] | null {
  if (!raw) return null
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const out = new Set<ApiKeyScope>()
  for (const p of parts) {
    if (p === 'all') {
      for (const s of API_KEY_SCOPES) out.add(s)
      continue
    }
    if (!(API_KEY_SCOPES as readonly string[]).includes(p)) return null
    out.add(p as ApiKeyScope)
  }
  return out.size ? [...out] : null
}

/** Does the key's scope list include the given scope? */
export function hasScope(scopes: string, scope: ApiKeyScope): boolean {
  return parseScopes(scopes)?.includes(scope) ?? false
}

export interface ApiKeyUser {
  id: string
  username: string
  keyId: string
  scopes: ApiKeyScope[]
}

export interface ApiKeyAuthResult {
  ok: true
  user: ApiKeyUser
}

export interface ApiKeyAuthError {
  ok: false
  status: 401 | 500
  code: string
  message: string
}

/** Resolve the Authorization: Bearer key on a request → user + scopes.
 *  Returns null when the request carries no key (the caller decides
 *  whether to fall back to session auth). */
export async function authenticateApiKey(
  req: NextRequest,
  db: { apiKey: { findUnique: (a: { where: { id: string }; include: { user: boolean } }) => Promise<null | { id: string; user: { id: string; username: string } | null; scopes: string; expiresAt: Date | null; revokedAt: Date | null }> } }
): Promise<ApiKeyAuthResult | ApiKeyAuthError | null> {
  const header = req.headers.get('authorization') ?? ''
  if (!header.startsWith('Bearer ')) return null
  const token = header.slice(7).trim()
  if (!token.startsWith(API_KEY_PREFIX)) {
    return { ok: false, status: 401, code: 'invalid_key', message: 'Malformed API key (expected cvx_… bearer token)' }
  }
  const row = await db.apiKey.findUnique({
    where: { id: apiKeyIdFor(token) },
    include: { user: true }, // relations are NOT returned by default
  })
  if (!row) return { ok: false, status: 401, code: 'invalid_key', message: 'Unknown or deleted API key' }
  if (row.revokedAt) return { ok: false, status: 401, code: 'revoked_key', message: 'This API key was revoked' }
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return { ok: false, status: 401, code: 'expired_key', message: 'This API key has expired' }
  }
  if (!row.user) return { ok: false, status: 401, code: 'invalid_key', message: 'API key owner no longer exists' }
  const scopes = parseScopes(row.scopes)
  if (!scopes) return { ok: false, status: 500, code: 'key_scope_error', message: 'API key has unrecognised scopes' }
  return { ok: true, user: { id: row.user.id, username: row.user.username, keyId: row.id, scopes } }
}
