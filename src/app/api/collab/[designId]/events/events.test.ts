// Unit tests for the collab events-rail access enforcement (v0.11.8).
//
// The rail used to check design existence only; it now enforces the same
// three-case rule as the document rail (design-guard):
//   ownerless design + anyone       → accepted (link = edit, by design)
//   owned design + owner            → accepted
//   owned design + other / anon     → 403 READ_ONLY_DESIGN, nothing persisted
//   cross-site POST                 → 403 CSRF
//   missing / trashed design        → 404

import { describe, it, expect, vi, beforeEach } from 'vitest'

const dbMock = vi.hoisted(() => ({
  design: { findUnique: vi.fn() },
  designEvent: { createMany: vi.fn() },
  presence: { upsert: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))

const getSessionUser = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/session', () => ({ getSessionUser }))

import { NextRequest } from 'next/server'
import { POST } from './route'

const OWNER = { id: 'owner-1', username: 'ashiq', createdAt: new Date() }
const OTHER = { id: 'other-2', username: 'mallory', createdAt: new Date() }

function post(
  designId: string,
  opts: { origin?: string; events?: unknown[] } = {}
) {
  const headers: Record<string, string> = { host: 'canvix.test' }
  if (opts.origin) headers.origin = opts.origin
  const req = new NextRequest(`http://canvix.test/api/collab/${designId}/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      pid: 'pid-1',
      name: 'Alice',
      color: '#7630D7',
      events:
        opts.events ??
        [{ eventId: 'e1', hlc: '1:2:a', op: { kind: 'design:rename', name: 'x' } }],
    }),
  })
  return POST(req, { params: Promise.resolve({ designId }) })
}

function designRow(overrides: Record<string, unknown> = {}) {
  return { id: 'd1', deletedAt: null, ownerId: null, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  getSessionUser.mockResolvedValue(null)
  dbMock.design.findUnique.mockResolvedValue(designRow())
  dbMock.designEvent.createMany.mockResolvedValue({ count: 1 })
  dbMock.presence.upsert.mockResolvedValue({})
})

describe('POST /api/collab/[designId]/events — access enforcement (v0.11.8)', () => {
  it('rejects cross-site requests (CSRF)', async () => {
    const res = await post('d1', { origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    expect(dbMock.design.findUnique).not.toHaveBeenCalled()
    expect(dbMock.designEvent.createMany).not.toHaveBeenCalled()
  })

  it('404s for a missing design', async () => {
    dbMock.design.findUnique.mockResolvedValue(null)
    const res = await post('d1')
    expect(res.status).toBe(404)
    expect(dbMock.designEvent.createMany).not.toHaveBeenCalled()
  })

  it('404s for a trashed design', async () => {
    dbMock.design.findUnique.mockResolvedValue(designRow({ deletedAt: new Date() }))
    const res = await post('d1')
    expect(res.status).toBe(404)
    expect(dbMock.designEvent.createMany).not.toHaveBeenCalled()
  })

  it('blocks a signed-out visitor from flushing ops to an owned design', async () => {
    dbMock.design.findUnique.mockResolvedValue(designRow({ ownerId: 'owner-1' }))
    getSessionUser.mockResolvedValue(null)
    const res = await post('d1')
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('READ_ONLY_DESIGN')
    expect(dbMock.designEvent.createMany).not.toHaveBeenCalled()
    expect(dbMock.presence.upsert).not.toHaveBeenCalled()
  })

  it('blocks a second account from flushing ops to an owned design', async () => {
    dbMock.design.findUnique.mockResolvedValue(designRow({ ownerId: 'owner-1' }))
    getSessionUser.mockResolvedValue(OTHER)
    const res = await post('d1')
    expect(res.status).toBe(403)
    expect(dbMock.designEvent.createMany).not.toHaveBeenCalled()
  })

  it('accepts an anonymous flush to an ownerless design (link = edit, by design)', async () => {
    dbMock.design.findUnique.mockResolvedValue(designRow({ ownerId: null }))
    getSessionUser.mockResolvedValue(null)
    const res = await post('d1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.accepted).toBe(1)
    expect(dbMock.designEvent.createMany).toHaveBeenCalledOnce()
  })

  it('accepts the owner flushing ops to their own design', async () => {
    dbMock.design.findUnique.mockResolvedValue(designRow({ ownerId: 'owner-1' }))
    getSessionUser.mockResolvedValue(OWNER)
    const res = await post('d1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.accepted).toBe(1)
    expect(dbMock.designEvent.createMany).toHaveBeenCalledOnce()
  })

  it('still drops malformed events without failing the flush', async () => {
    const res = await post('d1', {
      events: [{ eventId: 'bad', op: { kind: 'nonsense' } }],
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.accepted).toBe(0)
    expect(body.rejected).toEqual(['bad'])
    expect(dbMock.designEvent.createMany).not.toHaveBeenCalled()
  })

  it('passes Origin-less script clients through (curl / probe scripts)', async () => {
    // verify-offline-merge.ts & friends POST without an Origin header —
    // isSameOrigin's documented non-browser carve-out must keep working.
    const res = await post('d1')
    expect(res.status).toBe(200)
  })
})
