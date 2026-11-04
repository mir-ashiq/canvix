// Unit tests for GET /api/designs list pagination (v0.9.2) — the cost fix
// that caps the unbounded thumbnail-heavy list response.
//
// Invariants under test:
//   1. pagination envelope { designs, nextCursor } with 60-row pages
//   2. ownership scoping survives cursor pagination — a signed-in user
//      must NEVER receive another account's private designs, even when
//      a keyset cursor is present (the AND-composition regression)
//   3. the keyset cursor pages forward without re-serving rows
//   4. anonymous visitors still see ownerless designs only

import { describe, it, expect, vi, beforeEach } from 'vitest'

const dbMock = vi.hoisted(() => ({
  design: { findMany: vi.fn(), create: vi.fn() },
  $queryRawUnsafe: vi.fn(),
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
  anonHashFrom: () => null,
}))

import { NextRequest } from 'next/server'
import { GET, POST } from './route'

const USER_A = { id: 'user-a', username: 'alpha', createdAt: new Date() }

function designRow(opts: {
  id: string
  ownerId: string | null
  updatedAt?: Date
  anonKey?: string | null
  name?: string
}) {
  return {
    id: opts.id,
    name: opts.name ?? opts.id,
    width: 1080,
    height: 1080,
    thumbnail: null,
    source: 'blank',
    ownerId: opts.ownerId,
    anonKey: opts.anonKey ?? null,
    deletedAt: null,
    createdAt: opts.updatedAt ?? new Date('2026-10-01T00:00:00Z'),
    updatedAt: opts.updatedAt ?? new Date('2026-10-01T00:00:00Z'),
  }
}

function get(opts: { user?: unknown; url?: string } = {}) {
  getSessionUser.mockResolvedValue(opts.user ?? null)
  return GET(new NextRequest(opts.url ?? 'http://canvix.test/api/designs', {
    headers: { host: 'canvix.test' },
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/designs (v0.9.2 pagination)', () => {
  it('returns the { designs, nextCursor } envelope with ≤60 rows', async () => {
    const rows = Array.from({ length: 61 }, (_, i) =>
      designRow({ id: `d${i}`, ownerId: null, updatedAt: new Date(2026, 9, 1, 0, i) }),
    )
    dbMock.design.findMany.mockResolvedValue(rows)
    const res = await get()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.designs)).toBe(true)
    expect(body.designs).toHaveLength(60)
    expect(body.nextCursor).toEqual({ cursor: rows[59].updatedAt.toISOString(), id: 'd59' })
    // requests 61 rows to detect hasMore
    expect(dbMock.design.findMany.mock.calls[0][0].take).toBe(61)
  })

  it('returns nextCursor null when the page is not full', async () => {
    dbMock.design.findMany.mockResolvedValue([
      designRow({ id: 'only', ownerId: null }),
    ])
    const res = await get()
    const body = await res.json()
    expect(body.designs).toHaveLength(1)
    expect(body.nextCursor).toBeNull()
  })

  it('keeps ownership isolation when a cursor is present (regression)', async () => {
    // user A paginating must still be scoped to (ownerless OR own) —
    // the cursor filter must not replace the ownership filter.
    dbMock.design.findMany.mockResolvedValue([])
    await get({
      user: USER_A,
      url: 'http://canvix.test/api/designs?cursor=2026-10-01T00:00:00.000Z&id=d59',
    })
    const where = dbMock.design.findMany.mock.calls[0][0].where
    expect(where.AND).toHaveLength(2)
    const scope = where.AND[0]
    expect(scope.OR).toEqual([{ ownerId: null }, { ownerId: 'user-a' }])
    const keyset = where.AND[1]
    expect(keyset.OR[0]).toEqual({ updatedAt: { lt: new Date('2026-10-01T00:00:00.000Z') } })
  })

  it('scopes anonymous visitors to ownerless designs (with and without cursor)', async () => {
    dbMock.design.findMany.mockResolvedValue([])
    await get()
    expect(dbMock.design.findMany.mock.calls[0][0].where.AND).toEqual([{ ownerId: null }])

    await get({ url: 'http://canvix.test/api/designs?cursor=2026-10-01T00:00:00.000Z' })
    const withCursor = dbMock.design.findMany.mock.calls[1][0].where
    expect(withCursor.AND[0]).toEqual({ ownerId: null })
    expect(withCursor.AND[1].OR[0]).toEqual({ updatedAt: { lt: new Date('2026-10-01T00:00:00.000Z') } })
  })

  it('ignores a malformed cursor instead of erroring', async () => {
    dbMock.design.findMany.mockResolvedValue([])
    const res = await get({ url: 'http://canvix.test/api/designs?cursor=not-a-date' })
    expect(res.status).toBe(200)
    // no keyset filter was added
    expect(dbMock.design.findMany.mock.calls[0][0].where.AND).toEqual([{ ownerId: null }])
  })

  it('orders by (updatedAt desc, id desc) for stable keyset paging', async () => {
    dbMock.design.findMany.mockResolvedValue([])
    await get()
    expect(dbMock.design.findMany.mock.calls[0][0].orderBy).toEqual([
      { updatedAt: 'desc' },
      { id: 'desc' },
    ])
  })
})


// ── v0.14 (D6): folder scoping on the list + create ────────────────
//
// ?folder=<id> must filter to one of the CALLER'S OWN folders; a
// foreign id is a flat 404 (folders are private organization, and
// probing must not reveal which exist). POST accepts folderId under
// the same rule — a design can be born filed.

function postReq(opts: { user?: unknown; body?: unknown; origin?: string } = {}) {
  getSessionUser.mockResolvedValue(opts.user ?? null)
  readAnonToken.mockReturnValue(null)
  const headers: Record<string, string> = { 'Content-Type': 'application/json', host: 'canvix.test' }
  if (opts.origin) headers.origin = opts.origin
  return new NextRequest('http://canvix.test/api/designs', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? {}),
  })
}

describe('GET /api/designs ?folder= (v0.14 D6)', () => {
  it("filters the list to the caller's own folder", async () => {
    dbMock.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'f1' }])
    dbMock.design.findMany.mockResolvedValue([])
    const res = await get({
      user: USER_A,
      url: 'http://canvix.test/api/designs?folder=f1',
    })
    expect(res.status).toBe(200)
    // the ownership check scoped by the caller's attribution
    expect(dbMock.$queryRawUnsafe.mock.calls[0][0]).toContain('FROM "Folder"')
    expect(dbMock.$queryRawUnsafe.mock.calls[0][2]).toBe('user-a')
    // the list where carries the folder filter
    expect(dbMock.design.findMany.mock.calls[0][0].where.folderId).toBe('f1')
  })

  it('a foreign folder id is a flat 404 — the list never runs', async () => {
    dbMock.$queryRawUnsafe.mockResolvedValueOnce([]) // not the caller's
    const res = await get({
      user: USER_A,
      url: 'http://canvix.test/api/designs?folder=f-foreign',
    })
    expect(res.status).toBe(404)
    expect(dbMock.design.findMany).not.toHaveBeenCalled()
  })

  it('an empty folder param is a 400, not an empty list', async () => {
    const res = await get({ url: 'http://canvix.test/api/designs?folder=' })
    expect(res.status).toBe(400)
    expect(dbMock.design.findMany).not.toHaveBeenCalled()
  })

  it('no folder param = All designs, no folder query at all', async () => {
    dbMock.design.findMany.mockResolvedValue([])
    await get()
    expect(dbMock.$queryRawUnsafe).not.toHaveBeenCalled()
    expect(dbMock.design.findMany.mock.calls[0][0].where.folderId).toBeUndefined()
  })

  it("scopes the folder check for anonymous callers by anonKey", async () => {
    readAnonToken.mockReturnValue('tok-1')
    dbMock.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'f1' }])
    dbMock.design.findMany.mockResolvedValue([])
    const res = await get({ url: 'http://canvix.test/api/designs?folder=f1' })
    expect(res.status).toBe(200)
    expect(dbMock.$queryRawUnsafe.mock.calls[0][2]).toBeNull()
    expect(dbMock.$queryRawUnsafe.mock.calls[0][3]).toBe('hash(tok-1)')
  })
})

describe('POST /api/designs folderId (v0.14 D6)', () => {
  it('creates the design filed into the caller own folder', async () => {
    dbMock.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'f1' }])
    dbMock.design.create.mockResolvedValueOnce({ id: 'd-new' })
    const res = await POST(postReq({
      user: USER_A,
      body: { name: 'Filed', width: 800, height: 600, folderId: 'f1' },
    }))
    expect(res.status).toBe(201)
    expect(dbMock.design.create.mock.calls[0][0].data.folderId).toBe('f1')
  })

  it('a foreign folderId is a flat 404 — nothing is created', async () => {
    dbMock.$queryRawUnsafe.mockResolvedValueOnce([])
    const res = await POST(postReq({
      user: USER_A,
      body: { name: 'Nope', folderId: 'f-foreign' },
    }))
    expect(res.status).toBe(404)
    expect(dbMock.design.create).not.toHaveBeenCalled()
  })

  it('no folderId creates at the root (unchanged pre-v0.14 behaviour)', async () => {
    dbMock.design.create.mockResolvedValueOnce({ id: 'd-root' })
    const res = await POST(postReq({ user: USER_A, body: { name: 'Root' } }))
    expect(res.status).toBe(201)
    expect(dbMock.$queryRawUnsafe).not.toHaveBeenCalled()
    expect(dbMock.design.create.mock.calls[0][0].data.folderId).toBeNull()
  })
})
