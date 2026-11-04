// Unit tests for POST /api/designs/[id]/move (v0.14, D6).
//
// Invariants under test:
//   1. the caller must be able to EDIT the design (the design-guard
//      three-case rule: ownerless → anyone, owned → owner only)
//   2. the target folder must belong to the caller's attribution —
//      foreign ids are a flat 404, so nobody can file designs into
//      someone else's tree or probe which folders exist
//   3. folderId null = the root ("All designs"), always allowed
//   4. same-origin enforced (CSRF); bad payloads are a 400

import { describe, it, expect, vi, beforeEach } from 'vitest'

const designFindUnique = vi.hoisted(() => vi.fn())
const designUpdate = vi.hoisted(() => vi.fn())
const queryRaw = vi.hoisted(() => vi.fn())
const dbMock = vi.hoisted(() => ({
  design: { findUnique: designFindUnique, update: designUpdate },
  $queryRawUnsafe: queryRaw,
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
import { POST } from './route'

const USER_A = { id: 'user-a', username: 'alpha', createdAt: new Date() }

function moveReq(
  id: string,
  opts: { user?: unknown; anon?: string | null; body?: unknown; origin?: string } = {}
) {
  getSessionUser.mockResolvedValue(opts.user ?? null)
  readAnonToken.mockReturnValue(opts.anon === undefined ? null : opts.anon)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.origin) headers.origin = opts.origin
  return new NextRequest(`http://localhost/api/designs/${id}/move`, {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? {}),
  })
}

function designRow(ownerId: string | null) {
  return { id: 'd1', ownerId, anonKey: null, name: 'D', deletedAt: null }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/designs/[id]/move', () => {
  it('files an ownerless design into the caller own folder', async () => {
    designFindUnique.mockResolvedValueOnce(designRow(null))
    queryRaw.mockResolvedValueOnce([{ id: 'f1' }])
    designUpdate.mockResolvedValueOnce({ id: 'd1' })
    const res = await POST(moveReq('d1', { user: USER_A, body: { folderId: 'f1' } }), { params: Promise.resolve({ id: 'd1' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, folderId: 'f1' })
    // the folder ownership check scoped by the caller's attribution
    expect(queryRaw.mock.calls[0][0]).toContain('FROM "Folder"')
    expect(queryRaw.mock.calls[0][2]).toBe('user-a')
    expect(designUpdate).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { folderId: 'f1' } })
  })

  it('scopes the folder check for anonymous callers by anonKey', async () => {
    designFindUnique.mockResolvedValueOnce(designRow(null))
    queryRaw.mockResolvedValueOnce([{ id: 'f1' }])
    designUpdate.mockResolvedValueOnce({ id: 'd1' })
    const res = await POST(moveReq('d1', { anon: 'tok-1', body: { folderId: 'f1' } }), { params: Promise.resolve({ id: 'd1' }) })
    expect(res.status).toBe(200)
    expect(queryRaw.mock.calls[0][2]).toBeNull()
    expect(queryRaw.mock.calls[0][3]).toBe('hash(tok-1)')
  })

  it('folderId null moves the design back to the root (no folder query)', async () => {
    designFindUnique.mockResolvedValueOnce(designRow(null))
    designUpdate.mockResolvedValueOnce({ id: 'd1' })
    const res = await POST(moveReq('d1', { user: USER_A, body: { folderId: null } }), { params: Promise.resolve({ id: 'd1' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, folderId: null })
    expect(queryRaw).not.toHaveBeenCalled()
    expect(designUpdate).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { folderId: null } })
  })

  it('a foreign folder id is a flat 404 — no probe, no move', async () => {
    designFindUnique.mockResolvedValueOnce(designRow(null))
    queryRaw.mockResolvedValueOnce([]) // not the caller's folder
    const res = await POST(moveReq('d1', { user: USER_A, body: { folderId: 'f-foreign' } }), { params: Promise.resolve({ id: 'd1' }) })
    expect(res.status).toBe(404)
    expect(designUpdate).not.toHaveBeenCalled()
  })

  it("someone else's owned design is a 403 (read-only)", async () => {
    designFindUnique.mockResolvedValueOnce(designRow('user-b'))
    const res = await POST(moveReq('d1', { user: USER_A, body: { folderId: null } }), { params: Promise.resolve({ id: 'd1' }) })
    expect(res.status).toBe(403)
    expect(designUpdate).not.toHaveBeenCalled()
  })

  it('absent design is a 404', async () => {
    designFindUnique.mockResolvedValueOnce(null)
    const res = await POST(moveReq('missing', { user: USER_A, body: { folderId: null } }), { params: Promise.resolve({ id: 'missing' }) })
    expect(res.status).toBe(404)
  })

  it('a non-string folderId is a 400', async () => {
    designFindUnique.mockResolvedValueOnce(designRow(null))
    const res = await POST(moveReq('d1', { user: USER_A, body: { folderId: 42 } }), { params: Promise.resolve({ id: 'd1' }) })
    expect(res.status).toBe(400)
  })

  it('cross-origin move is rejected by the CSRF guard', async () => {
    const res = await POST(moveReq('d1', { user: USER_A, body: { folderId: null }, origin: 'https://evil.example' }), { params: Promise.resolve({ id: 'd1' }) })
    expect(res.status).toBe(403)
    expect(designFindUnique).not.toHaveBeenCalled()
  })
})
