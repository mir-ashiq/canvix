// Unit tests for adopt-all eligibility (v0.9.1) — the "never claim
// another person's work" guarantee.
//
// The invariant: the bulk claim's WHERE clause is constrained to the
// caller's OWN attribution hash (and ownerId IS NULL). A browser that
// never made anonymous designs claims nothing; foreign work and legacy
// rows are structurally outside the update.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const dbMock = vi.hoisted(() => ({
  design: { updateMany: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))

const getSessionUser = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/session', () => ({ getSessionUser }))

import { NextRequest } from 'next/server'
import { POST } from './route'
import { ANON_COOKIE, anonKeyHash } from '@/lib/auth/anon'

const USER = { id: 'user-1', username: 'ashiq', createdAt: new Date() }

function post(opts: { cookie?: string; origin?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { host: 'canvix.test' }
  if (opts.cookie) headers.cookie = opts.cookie
  if (opts.origin) headers.origin = opts.origin
  const req = new NextRequest('http://canvix.test/api/designs/adopt-all', {
    method: 'POST',
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  })
  return POST(req)
}

beforeEach(() => {
  vi.clearAllMocks()
  getSessionUser.mockResolvedValue(USER)
})

describe('POST /api/designs/adopt-all', () => {
  it('requires a signed-in account', async () => {
    getSessionUser.mockResolvedValue(null)
    const res = await post({ cookie: `${ANON_COOKIE}=whatever` })
    expect(res.status).toBe(401)
    expect(dbMock.design.updateMany).not.toHaveBeenCalled()
  })

  it('rejects cross-site requests (CSRF)', async () => {
    const res = await post({ origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    expect(dbMock.design.updateMany).not.toHaveBeenCalled()
  })

  it('claims NOTHING when the browser has no attribution cookie', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, adopted: 0 })
    expect(dbMock.design.updateMany).not.toHaveBeenCalled()
  })

  it('scopes the bulk claim to THIS browser’s attribution hash only', async () => {
    const token = 'browser-a-token'
    dbMock.design.updateMany.mockResolvedValue({ count: 3 })
    const res = await post({ cookie: `${ANON_COOKIE}=${token}` })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, adopted: 3 })
    // THE invariant: ownerId null AND anonKey = sha256(caller's cookie).
    // Foreign anonymous designs (other hashes) and legacy rows (null)
    // are outside this UPDATE by construction.
    expect(dbMock.design.updateMany).toHaveBeenCalledWith({
      where: { ownerId: null, OR: [{ anonKey: anonKeyHash(token) }] },
      data: { ownerId: USER.id },
    })
  })

  it('includeLegacy opt-in adds ONLY legacy rows — foreign attributions still excluded', async () => {
    const token = 'browser-a-token'
    dbMock.design.updateMany.mockResolvedValue({ count: 10 })
    const res = await post({ cookie: `${ANON_COOKIE}=${token}`, body: { includeLegacy: true } })
    expect(res.status).toBe(200)
    expect(dbMock.design.updateMany).toHaveBeenCalledWith({
      where: { ownerId: null, OR: [{ anonKey: anonKeyHash(token) }, { anonKey: null }] },
      data: { ownerId: USER.id },
    })
  })

  it('includeLegacy with NO attribution cookie claims only legacy rows', async () => {
    dbMock.design.updateMany.mockResolvedValue({ count: 7 })
    const res = await post({ body: { includeLegacy: true } })
    expect(res.status).toBe(200)
    expect(dbMock.design.updateMany).toHaveBeenCalledWith({
      where: { ownerId: null, OR: [{ anonKey: null }] },
      data: { ownerId: USER.id },
    })
  })

  it('non-boolean includeLegacy is ignored (strict opt-in)', async () => {
    const res = await post({ cookie: `${ANON_COOKIE}=t`, body: { includeLegacy: 'yes' } })
    expect(res.status).toBe(200)
    expect(dbMock.design.updateMany).toHaveBeenCalledWith({
      where: { ownerId: null, OR: [{ anonKey: anonKeyHash('t') }] },
      data: { ownerId: USER.id },
    })
  })
})
