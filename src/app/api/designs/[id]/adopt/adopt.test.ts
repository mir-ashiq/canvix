// Unit tests for per-design adoption (v0.9.1) — the deliberate,
// single-design claim path.
//
// Eligibility matrix:
//   owned by other        → 403 READ_ONLY_DESIGN (never claimable)
//   owned by self         → idempotent ok / adopted 0
//   ownerless + own hash  → claimed
//   ownerless + legacy    → claimed (explicit action, by design)
//   ownerless + foreign   → 403 NOT_ELIGIBLE (someone else's work)
//   race (count 0)        → 409

import { describe, it, expect, vi, beforeEach } from 'vitest'

const dbMock = vi.hoisted(() => ({
  design: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))

const getSessionUser = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/session', () => ({ getSessionUser }))

import { NextRequest } from 'next/server'
import { POST } from './route'
import { ANON_COOKIE, anonKeyHash } from '@/lib/auth/anon'

const USER = { id: 'user-1', username: 'ashiq', createdAt: new Date() }

function post(id: string, opts: { cookie?: string; origin?: string } = {}) {
  const headers: Record<string, string> = { host: 'canvix.test' }
  if (opts.cookie) headers.cookie = opts.cookie
  if (opts.origin) headers.origin = opts.origin
  const req = new NextRequest(`http://canvix.test/api/designs/${id}/adopt`, { method: 'POST', headers })
  return POST(req, { params: Promise.resolve({ id }) })
}

function designRow(overrides: Record<string, unknown> = {}) {
  return { id: 'd1', ownerId: null, anonKey: null, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  getSessionUser.mockResolvedValue(USER)
  dbMock.design.updateMany.mockResolvedValue({ count: 1 })
})

describe('POST /api/designs/[id]/adopt', () => {
  it('requires a signed-in account', async () => {
    getSessionUser.mockResolvedValue(null)
    const res = await post('d1', { cookie: `${ANON_COOKIE}=t` })
    expect(res.status).toBe(401)
    expect(dbMock.design.updateMany).not.toHaveBeenCalled()
  })

  it('rejects cross-site requests (CSRF)', async () => {
    const res = await post('d1', { origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    expect(dbMock.design.updateMany).not.toHaveBeenCalled()
  })

  it('404s for unknown designs', async () => {
    dbMock.design.findUnique.mockResolvedValue(null)
    expect((await post('missing')).status).toBe(404)
  })

  it('NEVER claims a design owned by another account', async () => {
    dbMock.design.findUnique.mockResolvedValue(designRow({ ownerId: 'user-2' }))
    const res = await post('d1')
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('READ_ONLY_DESIGN')
    expect(dbMock.design.updateMany).not.toHaveBeenCalled()
  })

  it('is idempotent for designs you already own', async () => {
    dbMock.design.findUnique.mockResolvedValue(designRow({ ownerId: USER.id }))
    const res = await post('d1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, adopted: 0 })
    expect(dbMock.design.updateMany).not.toHaveBeenCalled()
  })

  it('refuses a foreign browser’s anonymous design (NOT_ELIGIBLE)', async () => {
    dbMock.design.findUnique.mockResolvedValue(designRow({ anonKey: anonKeyHash('someone-elses-browser') }))
    const res = await post('d1', { cookie: `${ANON_COOKIE}=my-browser` })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('NOT_ELIGIBLE')
    expect(dbMock.design.updateMany).not.toHaveBeenCalled()
  })

  it('refuses a foreign design even when the caller has no attribution cookie', async () => {
    dbMock.design.findUnique.mockResolvedValue(designRow({ anonKey: anonKeyHash('someone-elses-browser') }))
    const res = await post('d1')
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('NOT_ELIGIBLE')
  })

  it('claims the caller’s own anonymous design', async () => {
    const token = 'my-browser'
    dbMock.design.findUnique.mockResolvedValue(designRow({ anonKey: anonKeyHash(token) }))
    const res = await post('d1', { cookie: `${ANON_COOKIE}=${token}` })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, adopted: 1 })
    expect(dbMock.design.updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', ownerId: null }, // the guard re-checks ownerlessness atomically
      data: { ownerId: USER.id },
    })
  })

  it('claims a LEGACY design (pre-attribution, anonKey null) — deliberate single-design action', async () => {
    dbMock.design.findUnique.mockResolvedValue(designRow({ anonKey: null }))
    const res = await post('d1', { cookie: `${ANON_COOKIE}=my-browser` })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, adopted: 1 })
  })

  it('reports 409 when a racing account wins the claim', async () => {
    dbMock.design.findUnique.mockResolvedValue(designRow({ anonKey: null }))
    dbMock.design.updateMany.mockResolvedValue({ count: 0 })
    const res = await post('d1')
    expect(res.status).toBe(409)
  })
})
