// Unit tests for GET /api/templates CDN caching (v0.9.2) — the ~0.7 MB
// public payload must be edge-cacheable so it stops counting against
// Fluid CPU + Fast Origin Transfer on every request.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const dbMock = vi.hoisted(() => ({
  template: { findMany: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.template.findMany.mockResolvedValue([
    {
      id: 't1',
      slug: 'instagram-post',
      name: 'Instagram post',
      category: 'social',
      width: 1080,
      height: 1080,
      accent: '#00C4CC',
      pages: [{ id: 'p1', elements: [] }],
      createdAt: new Date('2026-10-01T00:00:00Z'),
    },
  ])
})

describe('GET /api/templates (v0.9.2 CDN caching)', () => {
  it('serves the full template list with edge-cache headers', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const cc = res.headers.get('cache-control') ?? ''
    expect(cc).toContain('public')
    expect(cc).toContain('s-maxage=86400')
    expect(cc).toContain('stale-while-revalidate')
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].pages).toEqual([{ id: 'p1', elements: [] }])
  })

  it('still surfaces classified DB errors (never a bare 500)', async () => {
    dbMock.template.findMany.mockRejectedValue(new Error('connect ECONNREFUSED'))
    const res = await GET()
    expect(res.status).toBeGreaterThanOrEqual(500)
    const body = await res.json()
    expect(typeof body.error).toBe('string')
  })
})
