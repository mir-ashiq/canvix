// Route-level proof that the H5 rate limits are actually wired:
// POST /api/designs must 429 (with Retry-After) once the
// designs:create budget is spent, and must not consume any other
// bucket's budget. The limiter itself has its own unit tests
// (src/lib/rate-limit.test.ts); this file proves the plumbing.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const dbMock = vi.hoisted(() => ({
  design: { create: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))

const getSessionUser = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/session', () => ({ getSessionUser }))

import { NextRequest } from 'next/server'
import { POST } from './route'
import { RATE_LIMITS, resetRateLimitState } from '@/lib/rate-limit'

function post() {
  getSessionUser.mockResolvedValue(null)
  dbMock.design.create.mockImplementation(({ data }: { data: { name: string } }) =>
    Promise.resolve({ id: 'd_probe_' + data.name, ...data }))
  return POST(
    new NextRequest('http://canvix.test/api/designs', {
      method: 'POST',
      headers: { host: 'canvix.test', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'probe', pages: [] }),
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  resetRateLimitState()
  RATE_LIMITS['designs:create'] = { windowMs: 60_000, max: 3 }
})

afterEach(() => {
  resetRateLimitState()
})

describe('POST /api/designs × rate limit (H5)', () => {
  it('429s with Retry-After once the create budget is spent', async () => {
    expect((await post()).status).toBe(201)
    expect((await post()).status).toBe(201)
    expect((await post()).status).toBe(201)

    const blocked = await post()
    expect(blocked.status).toBe(429)
    const retryAfter = Number(blocked.headers.get('retry-after'))
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    expect(retryAfter).toBeLessThanOrEqual(60)
    const body = await blocked.json()
    expect(body.code).toBe('RATE_LIMITED')

    // the DB was touched exactly budget times — rejected requests
    // never reach it
    expect(dbMock.design.create).toHaveBeenCalledTimes(3)
  })

  it('a different IP is not blocked by the first one (proxy header)', async () => {
    getSessionUser.mockResolvedValue(null)
    const makeReq = (ip: string) =>
      new NextRequest('http://canvix.test/api/designs', {
        method: 'POST',
        headers: { host: 'canvix.test', 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ name: 'probe', pages: [] }),
      })
    for (let i = 0; i < 3; i++) await POST(makeReq('203.0.113.1'))
    const blockedNeighbor = await POST(makeReq('203.0.113.2'))
    expect(blockedNeighbor.status).toBe(201)
    const blockedSelf = await POST(makeReq('203.0.113.1'))
    expect(blockedSelf.status).toBe(429)
  })
})
