// Unit tests for GET /api/templates CDN caching (v0.9.2) — the ~0.7 MB
// public payload must be edge-cacheable so it stops counting against
// Fluid CPU + Fast Origin Transfer on every request.

import { NextRequest } from 'next/server'
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
    const res = await GET(new NextRequest('http://canvix.test/api/templates'))
    expect(res.status).toBe(200)
    const cc = res.headers.get('cache-control') ?? ''
    expect(cc).toContain('public')
    expect(cc).toContain('s-maxage=3600')
    expect(cc).toContain('stale-while-revalidate=86400')
    expect(cc).toContain('stale-while-revalidate')
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].pages).toEqual([{ id: 'p1', elements: [] }])
  })

  it('serves the bundled 366-template catalogue when the database is unavailable', async () => {
    dbMock.template.findMany.mockRejectedValue(new Error('connect ECONNREFUSED'))
    const res = await GET(new NextRequest('http://tea-g3.test/api/templates'))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-teag3-template-source')).toBe('built-in')
    const body = await res.json()
    expect(body).toHaveLength(366)
    expect(body[0]).toHaveProperty('slug')
    expect(body[0]).toHaveProperty('pages')
  })

  it('uses the bundled catalogue when the database table is empty', async () => {
    dbMock.template.findMany.mockResolvedValue([])
    const res = await GET(new NextRequest('http://tea-g3.test/api/templates'))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-teag3-template-source')).toBe('built-in')
    expect(await res.json()).toHaveLength(366)
  })
})
