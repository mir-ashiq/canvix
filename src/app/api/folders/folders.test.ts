// Unit tests for the v0.14 (D6) folder routes.
//
// Invariants under test:
//   1. GET lists ONLY the caller's attribution (ownerId or anonKey),
//      never another account's rows — the scoping lives in the SQL
//   2. POST validates/caps names, enforces the per-attribution folder
//      ceiling (409), and stamps attribution (user → ownerId,
//      anonymous → anonKey + cookie)
//   3. PATCH/DELETE are attribution-scoped: a foreign id is a flat 404
//      (no cross-account existence oracle)
//   4. DELETE removes the folder row only — the unfile-on-delete FK
//      lives in the database (migration 0008), verified by the e2e

import { describe, it, expect, vi, beforeEach } from 'vitest'

const queryRaw = vi.hoisted(() => vi.fn())
const executeRaw = vi.hoisted(() => vi.fn())
const folderCount = vi.hoisted(() => vi.fn())
const folderCreate = vi.hoisted(() => vi.fn())
const dbMock = vi.hoisted(() => ({
  $queryRawUnsafe: queryRaw,
  $executeRawUnsafe: executeRaw,
  folder: { count: folderCount, create: folderCreate },
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))

const getSessionUser = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/session', () => ({ getSessionUser }))

const readAnonToken = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/anon', () => ({
  readAnonToken,
  newAnonToken: () => 'fresh-token',
  anonKeyHash: (t: string) => `hash(${t})`,
  setAnonCookie: vi.fn(),
}))

vi.mock('@/lib/observability', () => ({
  withLogging: (_name: string, fn: unknown) => fn,
}))

import { NextRequest } from 'next/server'
import { GET, POST } from './route'
import { PATCH, DELETE } from './[id]/route'

const USER_A = { id: 'user-a', username: 'alpha', createdAt: new Date() }

function getReq(opts: { user?: unknown; anon?: string | null } = {}) {
  getSessionUser.mockResolvedValue(opts.user ?? null)
  readAnonToken.mockReturnValue(opts.anon === undefined ? null : opts.anon)
  return new NextRequest('http://localhost/api/folders')
}

function idReq(
  id: string,
  opts: { user?: unknown; anon?: string | null; body?: unknown; method?: string; origin?: string } = {}
) {
  getSessionUser.mockResolvedValue(opts.user ?? null)
  readAnonToken.mockReturnValue(opts.anon === undefined ? null : opts.anon)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.origin) headers.origin = opts.origin
  return new NextRequest(`http://localhost/api/folders/${id}`, {
    method: opts.method ?? 'PATCH',
    headers,
    body: JSON.stringify(opts.body ?? {}),
  })
}

function postReq(opts: { user?: unknown; anon?: string | null; body?: unknown; origin?: string } = {}) {
  getSessionUser.mockResolvedValue(opts.user ?? null)
  readAnonToken.mockReturnValue(opts.anon === undefined ? null : opts.anon)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.origin) headers.origin = opts.origin
  return new NextRequest('http://localhost/api/folders', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/folders', () => {
  it('returns the caller scoping query with counts', async () => {
    queryRaw.mockResolvedValueOnce([
      { id: 'f1', name: 'Client work', createdAt: new Date('2026-11-01T00:00:00Z'), designCount: 2 },
    ])
    const res = await GET(getReq({ user: USER_A }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.folders).toEqual([
      { id: 'f1', name: 'Client work', createdAt: '2026-11-01T00:00:00.000Z', designCount: 2 },
    ])
    // the SQL must scope by the ownerId, never the anonKey
    const sql = queryRaw.mock.calls[0][0] as string
    expect(sql).toContain('FROM "Folder" f')
    expect(sql).toContain('"ownerId" = $1')
    expect(queryRaw.mock.calls[0][1]).toBe('user-a')
    expect(queryRaw.mock.calls[0][2]).toBeNull()
    // the design-count join only counts LIVE designs
    expect(sql).toContain('d."deletedAt" IS NULL')
  })

  it('scopes anonymous callers by their anonKey', async () => {
    queryRaw.mockResolvedValueOnce([])
    const res = await GET(getReq({ anon: 'tok-1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ folders: [] })
    expect(queryRaw.mock.calls[0][1]).toBeNull()
    expect(queryRaw.mock.calls[0][2]).toBe('hash(tok-1)')
  })

  it('attribution-less caller gets an honest empty tree, no SQL', async () => {
    const res = await GET(getReq())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ folders: [] })
    expect(queryRaw).not.toHaveBeenCalled()
  })
})

describe('POST /api/folders', () => {
  it('creates the folder for a signed-in caller', async () => {
    folderCount.mockResolvedValueOnce(0)
    folderCreate.mockResolvedValueOnce({ id: 'f2', name: 'Posters', createdAt: new Date('2026-11-02T00:00:00Z') })
    const res = await POST(postReq({ user: USER_A, body: { name: 'Posters' } }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.folder).toMatchObject({ id: 'f2', name: 'Posters', designCount: 0 })
    expect(folderCreate).toHaveBeenCalledWith({
      data: { name: 'Posters', ownerId: 'user-a' },
      select: { id: true, name: true, createdAt: true },
    })
  })

  it('creates the folder for an anonymous caller with attribution', async () => {
    folderCount.mockResolvedValueOnce(0)
    folderCreate.mockResolvedValueOnce({ id: 'f3', name: 'Scratch', createdAt: new Date('2026-11-02T00:00:00Z') })
    const res = await POST(postReq({ anon: 'tok-9', body: { name: 'Scratch' } }))
    expect(res.status).toBe(201)
    expect(folderCreate).toHaveBeenCalledWith({
      data: { name: 'Scratch', anonKey: 'hash(tok-9)' },
      select: { id: true, name: true, createdAt: true },
    })
  })

  it('sanitizes the name: path fragments and traversal stripped, capped', async () => {
    folderCount.mockResolvedValueOnce(0)
    folderCreate.mockResolvedValueOnce({ id: 'f4', name: 'a.b', createdAt: new Date() })
    const res = await POST(postReq({ user: USER_A, body: { name: '  ../a/b\\c  ' } }))
    expect(res.status).toBe(201)
    expect(folderCreate.mock.calls[0][0].data.name).toBe('abc')
  })

  it('empty name is a 400', async () => {
    const res = await POST(postReq({ user: USER_A, body: { name: '   ' } }))
    expect(res.status).toBe(400)
    expect(folderCreate).not.toHaveBeenCalled()
  })

  it('enforces the per-attribution folder ceiling (409)', async () => {
    folderCount.mockResolvedValueOnce(50)
    const res = await POST(postReq({ user: USER_A, body: { name: 'One too many' } }))
    expect(res.status).toBe(409)
    expect(folderCreate).not.toHaveBeenCalled()
  })

  it('cross-origin POST is rejected by the CSRF guard', async () => {
    const res = await POST(postReq({ user: USER_A, body: { name: 'X' }, origin: 'https://evil.example' }))
    expect(res.status).toBe(403)
    expect(folderCreate).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/folders/[id] (rename)', () => {
  it('renames within the attribution', async () => {
    executeRaw.mockResolvedValueOnce(1)
    const res = await PATCH(idReq('f1', { user: USER_A, body: { name: 'Renamed' } }), { params: Promise.resolve({ id: 'f1' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, name: 'Renamed' })
    const sql = executeRaw.mock.calls[0][0] as string
    expect(sql).toContain('UPDATE "Folder"')
    expect(sql).toContain('"ownerId" = $2')
  })

  it('foreign id is a flat 404', async () => {
    executeRaw.mockResolvedValueOnce(0)
    const res = await PATCH(idReq('f-foreign', { user: USER_A, body: { name: 'Nope' } }), { params: Promise.resolve({ id: 'f-foreign' }) })
    expect(res.status).toBe(404)
  })

  it('attribution-less caller is a flat 404', async () => {
    const res = await PATCH(idReq('f1', { body: { name: 'Nope' } }), { params: Promise.resolve({ id: 'f1' }) })
    expect(res.status).toBe(404)
    expect(executeRaw).not.toHaveBeenCalled()
  })

  it('cross-origin PATCH is rejected by the CSRF guard', async () => {
    const res = await PATCH(idReq('f1', { user: USER_A, body: { name: 'X' }, origin: 'https://evil.example' }), { params: Promise.resolve({ id: 'f1' }) })
    expect(res.status).toBe(403)
  })
})

describe('DELETE /api/folders/[id]', () => {
  it('deletes the folder row (designs unfile via the FK, not here)', async () => {
    executeRaw.mockResolvedValueOnce(1)
    const res = await DELETE(idReq('f1', { user: USER_A, method: 'DELETE' }), { params: Promise.resolve({ id: 'f1' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const sql = executeRaw.mock.calls[0][0] as string
    expect(sql).toContain('DELETE FROM "Folder"')
  })

  it('foreign id is a flat 404', async () => {
    executeRaw.mockResolvedValueOnce(0)
    const res = await DELETE(idReq('f-foreign', { user: USER_A, method: 'DELETE' }), { params: Promise.resolve({ id: 'f-foreign' }) })
    expect(res.status).toBe(404)
  })

  it('anonymous caller scopes by anonKey', async () => {
    executeRaw.mockResolvedValueOnce(1)
    const res = await DELETE(idReq('f1', { anon: 'tok-1', method: 'DELETE' }), { params: Promise.resolve({ id: 'f1' }) })
    expect(res.status).toBe(200)
    expect(executeRaw.mock.calls[0][3]).toBe('hash(tok-1)')
  })
})
