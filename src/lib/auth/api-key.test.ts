// ─────────────────────────────────────────────────────────────
// v0.24 (Wave 6): scoped API keys — lib invariants.
//
// What is locked in here:
//   1. token shape: cvx_ prefix, 256-bit base64url entropy, and the
//      row id is sha256(token) — a DB leak never yields usable keys
//   2. scope parsing: known scopes only, 'all' expands, dedupes,
//      unknown/malformed input is rejected (null), never silently
//      widened
//   3. authenticateApiKey: the full decision matrix — no header,
//      wrong scheme, non-cvx token, unknown key, revoked key,
//      expired key, dangling owner, valid key
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  newApiKeyValue,
  apiKeyIdFor,
  parseScopes,
  hasScope,
  authenticateApiKey,
  API_KEY_PREFIX,
} from '@/lib/auth/api-key'

describe('api key token shape', () => {
  it('tokens carry the cvx_ prefix and generous entropy', () => {
    for (let i = 0; i < 20; i++) {
      const t = newApiKeyValue()
      expect(t.startsWith(API_KEY_PREFIX)).toBe(true)
      // 32 bytes → 43 base64url chars after the prefix
      expect(t.length).toBe(API_KEY_PREFIX.length + 43)
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('tokens are unique', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newApiKeyValue()))
    expect(seen.size).toBe(200)
  })

  it('the DB id is sha256(token) hex — never the token itself', () => {
    const t = newApiKeyValue()
    expect(apiKeyIdFor(t)).toBe(createHash('sha256').update(t).digest('hex'))
    expect(apiKeyIdFor(t)).not.toContain(t.slice(4))
    expect(apiKeyIdFor(t)).toHaveLength(64)
  })
})

describe('scope parsing', () => {
  it('accepts each known scope and dedupes', () => {
    expect(parseScopes('designs:read')).toEqual(['designs:read'])
    expect(parseScopes('designs:read,designs:write')).toEqual(['designs:read', 'designs:write'])
    expect(parseScopes('designs:read, designs:read')).toEqual(['designs:read'])
  })

  it("'all' expands to every current scope", () => {
    expect(parseScopes('all')).toEqual(['designs:read', 'designs:write'])
  })

  it('rejects unknown scopes, malformed input and empty lists', () => {
    expect(parseScopes('admin')).toBeNull()
    expect(parseScopes('designs:read,admin')).toBeNull() // no partial accept
    expect(parseScopes('*')).toBeNull()
    expect(parseScopes('')).toBeNull()
    expect(parseScopes(',,,')).toBeNull()
    expect(parseScopes(null)).toBeNull()
  })

  it('hasScope answers from the stored CSV', () => {
    expect(hasScope('designs:read', 'designs:read')).toBe(true)
    expect(hasScope('designs:read', 'designs:write')).toBe(false)
    expect(hasScope('all', 'designs:write')).toBe(true)
    expect(hasScope('bogus', 'designs:read')).toBe(false)
  })
})

// a fake db.apiKey.findUnique driven by a map — no Prisma needed
function fakeDb(rows: Record<string, unknown>) {
  return {
    apiKey: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        (rows[where.id] as ReturnType<typeof row> | undefined) ?? null,
    },
  }
}
type Row = {
  id: string
  user: { id: string; username: string } | null
  scopes: string
  expiresAt: Date | null
  revokedAt: Date | null
}
function row(over: Partial<Row>): Row {
  return { id: 'k1', user: { id: 'u1', username: 'alice' }, scopes: 'designs:read', expiresAt: null, revokedAt: null, ...over }
}

function reqWith(header: string | null): { headers: { get: (k: string) => string | null } } {
  return { headers: { get: (k: string) => (k === 'authorization' ? header : null) } }
}

describe('authenticateApiKey', () => {
  it('returns null when no bearer header is present (fall back to session)', async () => {
    expect(await authenticateApiKey(reqWith(null) as never, fakeDb({}))).toBeNull()
    expect(await authenticateApiKey(reqWith('Basic abc') as never, fakeDb({}))).toBeNull()
  })

  it('rejects non-cvx bearer tokens with 401 invalid_key', async () => {
    const r = await authenticateApiKey(reqWith('Bearer sk-whatever') as never, fakeDb({}))
    expect(r).toMatchObject({ ok: false, status: 401, code: 'invalid_key' })
  })

  it('rejects unknown keys (wrong sha256 row)', async () => {
    const r = await authenticateApiKey(reqWith('Bearer cvx_unknown') as never, fakeDb({}))
    expect(r).toMatchObject({ ok: false, status: 401, code: 'invalid_key' })
  })

  it('distinguishes revoked keys (revoked_key)', async () => {
    const t = newApiKeyValue()
    const db = fakeDb({ [apiKeyIdFor(t)]: row({ revokedAt: new Date() }) })
    const r = await authenticateApiKey(reqWith(`Bearer ${t}`) as never, db)
    expect(r).toMatchObject({ ok: false, status: 401, code: 'revoked_key' })
  })

  it('distinguishes expired keys (expired_key)', async () => {
    const t = newApiKeyValue()
    const db = fakeDb({ [apiKeyIdFor(t)]: row({ expiresAt: new Date(Date.now() - 1000) }) })
    const r = await authenticateApiKey(reqWith(`Bearer ${t}`) as never, db)
    expect(r).toMatchObject({ ok: false, status: 401, code: 'expired_key' })
  })

  it('unexpired future expiry still authenticates', async () => {
    const t = newApiKeyValue()
    const db = fakeDb({ [apiKeyIdFor(t)]: row({ expiresAt: new Date(Date.now() + 60_000) }) })
    const r = await authenticateApiKey(reqWith(`Bearer ${t}`) as never, db)
    expect(r && r.ok).toBe(true)
  })

  it('rejects dangling owners (deleted user)', async () => {
    const t = newApiKeyValue()
    const db = fakeDb({ [apiKeyIdFor(t)]: row({ user: null }) })
    const r = await authenticateApiKey(reqWith(`Bearer ${t}`) as never, db)
    expect(r).toMatchObject({ ok: false, status: 401, code: 'invalid_key' })
  })

  it('a valid key resolves to user + parsed scopes', async () => {
    const t = newApiKeyValue()
    const db = fakeDb({ [apiKeyIdFor(t)]: row({ scopes: 'all' }) })
    const r = await authenticateApiKey(reqWith(`Bearer ${t}`) as never, db)
    expect(r).toMatchObject({
      ok: true,
      user: { id: 'u1', username: 'alice', keyId: 'k1', scopes: ['designs:read', 'designs:write'] },
    })
  })

  it('a key with unrecognised stored scopes is a 500 (operator fixable), not a silent pass', async () => {
    const t = newApiKeyValue()
    const db = fakeDb({ [apiKeyIdFor(t)]: row({ scopes: 'galactic:admin' }) })
    const r = await authenticateApiKey(reqWith(`Bearer ${t}`) as never, db)
    expect(r).toMatchObject({ ok: false, status: 500, code: 'key_scope_error' })
  })
})
