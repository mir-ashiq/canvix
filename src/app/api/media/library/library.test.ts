// Unit tests for the v0.14 (D1) uploads-library routes.
//
// Invariants under test:
//   1. GET lists ONLY the caller's attribution (ownerId or anonKey) —
//      never another account's rows, never the bytes
//   2. PATCH rename is attribution-scoped: a foreign id is a flat 404
//      (no cross-account existence oracle)
//   3. DELETE clears keepInLibrary (the row survives for referenced
//      designs) and is equally 404-scoped
//   4. an attribution-less caller gets an honest empty library

import { describe, it, expect, vi, beforeEach } from 'vitest'

const queryRaw = vi.hoisted(() => vi.fn())
const executeRaw = vi.hoisted(() => vi.fn())
const dbMock = vi.hoisted(() => ({
  $queryRawUnsafe: queryRaw,
  $executeRawUnsafe: executeRaw,
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))

const getSessionUser = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/session', () => ({ getSessionUser }))

const readAnonToken = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/anon', () => ({
  readAnonToken,
  anonKeyHash: (t: string) => `hash(${t})`,
}))

vi.mock('@/lib/observability', () => ({
  withLogging: (_name: string, fn: unknown) => fn,
}))

import { NextRequest } from 'next/server'
import { GET } from './route'
import { PATCH, DELETE } from './[id]/route'

const USER_A = { id: 'user-a', username: 'alpha', createdAt: new Date() }
const USER_B = { id: 'user-b', username: 'beta', createdAt: new Date() }

function getReq(opts: { user?: unknown; anon?: string | null } = {}) {
  getSessionUser.mockResolvedValue(opts.user ?? null)
  readAnonToken.mockReturnValue(opts.anon === undefined ? null : opts.anon)
  return new NextRequest('http://localhost/api/media/library')
}

function idReq(id: string, opts: { user?: unknown; anon?: string | null; body?: unknown; method?: string } = {}) {
  getSessionUser.mockResolvedValue(opts.user ?? null)
  readAnonToken.mockReturnValue(opts.anon === undefined ? null : opts.anon)
  // no Origin header: a non-browser client per the CSRF guard's curl
  // rule — the cross-origin REJECTION is covered by its own test below
  return new NextRequest(`http://localhost/api/media/library/${id}`, {
    method: opts.method ?? 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts.body ?? {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/media/library', () => {
  it('returns the owner scoping query results with quota', async () => {
    queryRaw
      .mockResolvedValueOnce([
        { id: 'm1', mime: 'image/png', name: 'logo.png', size: 1000, createdAt: new Date('2026-11-01T00:00:00Z') },
      ])
      .mockResolvedValueOnce([{ used: 1000 }])
    const res = await GET(getReq({ user: USER_A }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toEqual([
      { id: 'm1', mime: 'image/png', name: 'logo.png', size: 1000, createdAt: '2026-11-01T00:00:00.000Z' },
    ])
    expect(body.usedBytes).toBe(1000)
    expect(body.quotaBytes).toBe(256 * 1024 * 1024)
    // the SQL must carry the ownerId scoping, not the anonKey
    const listSql = queryRaw.mock.calls[0][0] as string
    expect(listSql).toContain('"ownerId" = $1')
    expect(listSql).toContain('"keepInLibrary" = true')
  })

  it('scopes anonymous callers by their anonKey', async () => {
    queryRaw.mockResolvedValue([]).mockResolvedValue([{ used: 0 }])
    const res = await GET(getReq({ anon: 'tok-123' }))
    expect(res.status).toBe(200)
    const listSql = queryRaw.mock.calls[0][0] as string
    expect(listSql).toContain('"anonKey" = $2')
  })

  it('attribution-less caller gets an honest empty library, no SQL', async () => {
    const res = await GET(getReq({}))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toEqual([])
    expect(body.usedBytes).toBe(0)
    expect(queryRaw).not.toHaveBeenCalled()
  })

  it('never selects the bytes column', async () => {
    queryRaw.mockResolvedValue([]).mockResolvedValue([{ used: 0 }])
    await GET(getReq({ user: USER_A }))
    const listSql = queryRaw.mock.calls[0][0] as string
    expect(listSql).not.toContain('bytes')
  })
})

describe('PATCH /api/media/library/[id] (rename)', () => {
  it('renames within the attribution', async () => {
    executeRaw.mockResolvedValueOnce(1)
    const res = await PATCH(idReq('m1', { user: USER_A, body: { name: 'hero.png' } }), {
      params: Promise.resolve({ id: 'm1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('hero.png')
    expect(executeRaw.mock.calls[0][0]).toContain('SET name = $3')
  })

  it('foreign id is a flat 404', async () => {
    executeRaw.mockResolvedValueOnce(0) // USER_A does not own m-foreign
    const res = await PATCH(idReq('m-foreign', { user: USER_A, body: { name: 'x' } }), {
      params: Promise.resolve({ id: 'm-foreign' }),
    })
    expect(res.status).toBe(404)
  })

  it('sanitizes the name: path fragments and traversal stripped', async () => {
    executeRaw.mockResolvedValueOnce(1)
    const res = await PATCH(
      idReq('m1', { user: USER_A, body: { name: '../../etc/passwd' } }),
      { params: Promise.resolve({ id: 'm1' }) },
    )
    expect(res.status).toBe(200)
    expect((await res.json()).name).toBe('etcpasswd')
  })

  it('empty name is a 400', async () => {
    const res = await PATCH(idReq('m1', { user: USER_A, body: { name: '   ' } }), {
      params: Promise.resolve({ id: 'm1' }),
    })
    expect(res.status).toBe(400)
  })

  it('cross-origin PATCH is rejected by the CSRF guard', async () => {
    getSessionUser.mockResolvedValue(USER_A)
    readAnonToken.mockReturnValue(null)
    const req = new NextRequest('http://localhost/api/media/library/m1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
      body: JSON.stringify({ name: 'x' }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'm1' }) })
    expect(res.status).toBe(403)
  })
})

describe('DELETE /api/media/library/[id]', () => {
  it('clears keepInLibrary (row survives for referenced designs)', async () => {
    executeRaw.mockResolvedValueOnce(1)
    const res = await DELETE(idReq('m1', { user: USER_A, method: 'DELETE' }), {
      params: Promise.resolve({ id: 'm1' }),
    })
    expect(res.status).toBe(200)
    const sql = executeRaw.mock.calls[0][0] as string
    expect(sql).toContain('SET "keepInLibrary" = false')
    expect(sql).not.toContain('DELETE FROM')
  })

  it('foreign id is a flat 404', async () => {
    executeRaw.mockResolvedValueOnce(0)
    const res = await DELETE(idReq('m-foreign', { user: USER_B, method: 'DELETE' }), {
      params: Promise.resolve({ id: 'm-foreign' }),
    })
    expect(res.status).toBe(404)
  })
})
