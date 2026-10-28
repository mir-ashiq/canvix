// Unit tests for the v0.9 account primitives — password hashing,
// input validation and session token derivation. All pure (or
// node:crypto-only): no DB, no network, fully hermetic.

import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from './passwords'
import { checkUsername, checkPassword, canonicalUsername } from './validate'
import { newSessionToken, sessionIdFor } from './session'

describe('hashPassword / verifyPassword', () => {
  it('round-trips a password', async () => {
    const stored = await hashPassword('correct horse battery staple')
    expect(stored.startsWith('scrypt:')).toBe(true)
    await expect(verifyPassword('correct horse battery staple', stored)).resolves.toBe(true)
  })

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple')
    await expect(verifyPassword('wrong password entirely!', stored)).resolves.toBe(false)
  })

  it('salts: the same password hashes differently every time', async () => {
    const a = await hashPassword('same password')
    const b = await hashPassword('same password')
    expect(a).not.toBe(b)
    await expect(verifyPassword('same password', a)).resolves.toBe(true)
    await expect(verifyPassword('same password', b)).resolves.toBe(true)
  })

  it('never throws on malformed stored hashes — just fails', async () => {
    for (const bad of ['', 'plaintext', 'bcrypt:$x:y:z', 'scrypt:1:2', 'scrypt:abc:def:ghi:jkl:mno', 'scrypt:999999999:1:1:AAAA:BBBB']) {
      await expect(verifyPassword('whatever', bad)).resolves.toBe(false)
    }
  })
})

describe('checkUsername / canonicalUsername', () => {
  it('accepts valid usernames and canonicalizes case/space', () => {
    expect(checkUsername('ashiq')).toEqual({ ok: true })
    expect(checkUsername('  Ashiq_Designs-01  ').ok).toBe(true)
    expect(canonicalUsername('  Ashiq_Designs-01  ')).toBe('ashiq_designs-01')
  })

  it('rejects short, long, empty and non-string input', () => {
    expect(checkUsername('ab').ok).toBe(false)
    expect(checkUsername('').ok).toBe(false)
    expect(checkUsername(null).ok).toBe(false)
    expect(checkUsername('a'.repeat(33)).ok).toBe(false)
  })

  it('rejects characters outside [a-z0-9_-] and leading -/_', () => {
    expect(checkUsername('has space').ok).toBe(false)
    expect(checkUsername('ünicode').ok).toBe(false)
    expect(checkUsername('dot.name').ok).toBe(false)
    expect(checkUsername('../etc/passwd').ok).toBe(false)
    expect(checkUsername('-leading').ok).toBe(false)
    expect(checkUsername('_leading').ok).toBe(false)
  })
})

describe('checkPassword', () => {
  it('accepts long-enough passwords, rejects short/long/guessable', () => {
    expect(checkPassword('12345678').ok).toBe(false) // in top-passwords list
    expect(checkPassword('tr0ub4dor&3days').ok).toBe(true)
    expect(checkPassword('short').ok).toBe(false)
    expect(checkPassword('a'.repeat(201)).ok).toBe(false)
    expect(checkPassword(12345678).ok).toBe(false)
  })
})

describe('session tokens', () => {
  it('mints 256-bit base64url tokens with no padding', () => {
    const t = newSessionToken()
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('derives a stable sha256 row id, different from the token', () => {
    const t = newSessionToken()
    const id = sessionIdFor(t)
    expect(id).toMatch(/^[0-9a-f]{64}$/)
    expect(sessionIdFor(t)).toBe(id)
    expect(sessionIdFor(newSessionToken())).not.toBe(id)
  })
})
