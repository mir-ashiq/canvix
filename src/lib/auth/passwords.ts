// ─────────────────────────────────────────────────────────────
// Password hashing for Canvix accounts (v0.9).
//
// scrypt from node:crypto — deliberately zero external dependencies
// (no bcrypt/argon2 native builds) so self-hosting stays trivially
// free and portable. Parameters are Node's defaults (N=16384, r=8,
// p=1) with a 64-byte key and per-hash random salt.
//
// Format:  scrypt:<N>:<r>:<p>:<saltB64>:<hashB64>
// The stored parameters make future cost upgrades verifiable
// against old hashes without invalidating them.
// ─────────────────────────────────────────────────────────────

import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(_scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number }
) => Promise<Buffer>

const N = 16384
const R = 8
const P = 1
const KEYLEN = 64

/** Hash a password → storable string (random 16-byte salt). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 })
  return `scrypt:${N}:${R}:${P}:${salt.toString('base64')}:${key.toString('base64')}`
}

/**
 * Verify a password against a stored hash. Constant-time on the derived
 * key comparison; malformed stored hashes simply fail (never throw).
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split(':')
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false
    const [, nStr, rStr, pStr, saltB64, hashB64] = parts
    const n = parseInt(nStr, 10)
    const r = parseInt(rStr, 10)
    const p = parseInt(pStr, 10)
    // sanity bounds — refuse absurd parameters from a tampered row
    if (!(n >= 1 && n <= 1 << 22) || !(r >= 1 && r <= 1024) || !(p >= 1 && p <= 1024)) return false
    const salt = Buffer.from(saltB64, 'base64')
    const expected = Buffer.from(hashB64, 'base64')
    if (salt.length < 8 || expected.length < 32) return false
    const actual = await scrypt(password, salt, expected.length, { N: n, r, p, maxmem: 64 * 1024 * 1024 })
    if (actual.length !== expected.length) return false
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}
