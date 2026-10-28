// Unit tests for v0.9 session semantics — expiration, revocation and
// cookie hardening — against a mocked Prisma client (no DB needed).
//
// Establishes the properties the Phase-3 report was missing:
//   • expired sessions are rejected AND swept server-side
//   • a logged-out (deleted) session token is dead on replay
//   • the cookie is HttpOnly + SameSite=Lax (+ Secure in production)
//   • the DB stores sha256(token), never the usable token itself

import { describe, it, expect, vi, beforeEach } from 'vitest'

const dbMock = vi.hoisted(() => ({
  session: {
    create: vi.fn(),
    findUnique: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))

import { NextRequest, NextResponse } from 'next/server'
import { createSession, destroySession, getSessionUser, SESSION_COOKIE, sessionIdFor } from './session'

const USER = { id: 'user-1', username: 'ashiq', createdAt: new Date('2026-01-01T00:00:00Z') }

function reqWithCookie(token?: string): NextRequest {
  return new NextRequest('http://canvix.test/api/x', {
    headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  // promise-returning defaults (the real client never returns undefined)
  dbMock.session.create.mockResolvedValue({})
  dbMock.session.delete.mockResolvedValue({})
  dbMock.session.deleteMany.mockResolvedValue({ count: 0 })
  dbMock.session.findUnique.mockResolvedValue(null)
})

describe('getSessionUser', () => {
  it('returns null without a cookie (anonymous visitor)', async () => {
    expect(await getSessionUser(reqWithCookie())).toBeNull()
    expect(dbMock.session.findUnique).not.toHaveBeenCalled()
  })

  it('returns null for oversized tokens without touching the DB', async () => {
    expect(await getSessionUser(reqWithCookie('x'.repeat(200)))).toBeNull()
    expect(dbMock.session.findUnique).not.toHaveBeenCalled()
  })

  it('resolves the user for a valid, unexpired session', async () => {
    dbMock.session.findUnique.mockResolvedValue({
      id: 'row-1',
      userId: USER.id,
      expiresAt: new Date(Date.now() + 86_400_000),
      user: USER,
    })
    expect(await getSessionUser(reqWithCookie('valid-token'))).toEqual(USER)
    // looked up by sha256(token), never by the raw token
    expect(dbMock.session.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: sessionIdFor('valid-token') } })
    )
  })

  it('EXPIRED session: rejected and swept from the DB', async () => {
    dbMock.session.findUnique.mockResolvedValue({
      id: 'row-expired',
      userId: USER.id,
      expiresAt: new Date(Date.now() - 1000),
      user: USER,
    })
    expect(await getSessionUser(reqWithCookie('expired-token'))).toBeNull()
    expect(dbMock.session.delete).toHaveBeenCalledWith({ where: { id: 'row-expired' } })
  })

  it('REVOKED session (logged out elsewhere / row deleted): replay is dead', async () => {
    dbMock.session.findUnique.mockResolvedValue(null)
    expect(await getSessionUser(reqWithCookie('logged-out-token'))).toBeNull()
  })

  it('DB failure degrades to signed-out instead of crashing the route', async () => {
    dbMock.session.findUnique.mockRejectedValue(new Error('connection refused'))
    expect(await getSessionUser(reqWithCookie('any-token'))).toBeNull()
  })
})

describe('createSession', () => {
  it('stores sha256(token) and sets a hardened cookie', async () => {
    const res = NextResponse.json({})
    await createSession(USER.id, res)

    const create = dbMock.session.create.mock.calls[0][0]
    const storedId = create.data.id as string
    expect(storedId).toMatch(/^[0-9a-f]{64}$/) // hash, not the raw token

    const cookies = res.headers.getSetCookie()
    const session = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    expect(session).toBeDefined()
    const flat = session!.toLowerCase()
    expect(flat).toContain('httponly')
    expect(flat).toContain('samesite=lax')
    expect(flat).toContain('max-age=2592000') // 30 days
    expect(flat).toContain('path=/')
    // the cookie value must NOT be the stored row id (it must be the raw
    // token whose sha256 is the row id)
    expect(session).not.toContain(storedId)
    const token = session!.split(';')[0].split('=')[1]
    expect(sessionIdFor(token)).toBe(storedId)
  })

  it('sweeps expired sessions opportunistically', async () => {
    const res = NextResponse.json({})
    await createSession(USER.id, res)
    expect(dbMock.session.deleteMany).toHaveBeenCalled()
  })
})

describe('destroySession (logout = server-side revocation)', () => {
  it('deletes the row by sha256(token) and clears the cookie', async () => {
    const res = NextResponse.json({})
    await destroySession(reqWithCookie('bye-token'), res)
    expect(dbMock.session.deleteMany).toHaveBeenCalledWith({
      where: { id: sessionIdFor('bye-token') },
    })
    const cookies = res.headers.getSetCookie()
    const cleared = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    expect(cleared).toContain('Max-Age=0')
  })

  it('is a no-op when there is no cookie', async () => {
    const res = NextResponse.json({})
    await destroySession(reqWithCookie(), res)
    expect(dbMock.session.deleteMany).not.toHaveBeenCalled()
  })
})
