// Unit tests for the collab presence rail (v0.11.8 hardening).
//
// Presence is deliberately open to signed-out visitors and read-only
// viewers — they are legitimate room members and a presence row carries
// no document authority (element ops go through /events, which enforces
// ownership). What v0.11.8 adds: same-origin enforcement and a design
// existence/trash check so arbitrary ids can no longer mint junk rows.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const dbMock = vi.hoisted(() => ({
  design: { findUnique: vi.fn() },
  presence: { upsert: vi.fn(), update: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))

// the route dynamic-imports this for Prisma.JsonNull — stub it
vi.mock('@/generated/prisma/client', () => ({
  Prisma: { JsonNull: { __prismaJsonNull: true } },
}))

import { NextRequest } from 'next/server'
import { POST } from './route'

function post(designId: string, opts: { origin?: string } = {}) {
  const headers: Record<string, string> = { host: 'canvix.test' }
  if (opts.origin) headers.origin = opts.origin
  const req = new NextRequest(`http://canvix.test/api/collab/${designId}/presence`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      pid: 'pid-1',
      name: 'Alice',
      color: '#7630D7',
      cursor: { page: 0, x: 0.5, y: 0.5 },
    }),
  })
  return POST(req, { params: Promise.resolve({ designId }) })
}

function designRow(overrides: Record<string, unknown> = {}) {
  return { id: 'd1', deletedAt: null, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.design.findUnique.mockResolvedValue(designRow())
  dbMock.presence.upsert.mockResolvedValue({})
})

describe('POST /api/collab/[designId]/presence (v0.11.8)', () => {
  it('rejects cross-site requests (CSRF)', async () => {
    const res = await post('d1', { origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    expect(dbMock.design.findUnique).not.toHaveBeenCalled()
    expect(dbMock.presence.upsert).not.toHaveBeenCalled()
  })

  it('404s for a missing design instead of minting a junk presence row', async () => {
    dbMock.design.findUnique.mockResolvedValue(null)
    const res = await post('nope')
    expect(res.status).toBe(404)
    expect(dbMock.presence.upsert).not.toHaveBeenCalled()
  })

  it('404s for a trashed design', async () => {
    dbMock.design.findUnique.mockResolvedValue(designRow({ deletedAt: new Date() }))
    const res = await post('d1')
    expect(res.status).toBe(404)
    expect(dbMock.presence.upsert).not.toHaveBeenCalled()
  })

  it('accepts an anonymous heartbeat on an ownerless design (unchanged)', async () => {
    const res = await post('d1')
    expect(res.status).toBe(200)
    expect(dbMock.presence.upsert).toHaveBeenCalledOnce()
  })

  it('accepts a read-only viewer heartbeat on an owned design (deliberate)', async () => {
    // viewers watch live and appear in the room; the events rail is what
    // blocks their mutations — presence itself carries no authority
    dbMock.design.findUnique.mockResolvedValue(designRow({ ownerId: 'owner-1' }))
    const res = await post('d1')
    expect(res.status).toBe(200)
    expect(dbMock.presence.upsert).toHaveBeenCalledOnce()
  })
})
