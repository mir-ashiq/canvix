// Unit tests for the v0.9.2 AI-route abuse guard (strict same-origin)
// and rate-limit tightening — see src/lib/ai/provider.ts.
//
// Invariants:
//   1. POSTs without Origin/Referer (direct API bots) → 403, zero provider work
//   2. POSTs with a foreign Origin → 403
//   3. Same-origin POSTs (browser fetch from the app) → pass the guard
//      (then reach the provider path; unconfigured providers answer 503)

import { describe, it, expect, vi, beforeEach } from 'vitest'

// This sandbox (and dev machines) can carry a real /etc/.z-ai-config, which
// would make getZAI() hit the live gateway from unit tests. Mock the SDK
// module itself so the route's full happy path runs hermetically.
const generationsCreate = vi.fn(async () => ({ data: [{ base64: 'aGVsbG8=' }] }))
vi.mock('z-ai-web-dev-sdk', () => ({
  default: {
    create: vi.fn(async () => ({
      images: { generations: { create: generationsCreate } },
    })),
  },
}))

// recordUsage is fire-and-forget against the DB — mock it so tests never
// open a real connection (which would hang the vitest worker).
const dbMock = vi.hoisted(() => ({
  aIUsage: { create: vi.fn().mockResolvedValue({}) },
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))

import { NextRequest } from 'next/server'
import { POST } from './route'

function post(opts: { origin?: string; referer?: string } = {}) {
  const headers: Record<string, string> = {
    host: 'canvix.test',
    'content-type': 'application/json',
  }
  if (opts.origin) headers.origin = opts.origin
  if (opts.referer) headers.referer = opts.referer
  return POST(
    new NextRequest('http://canvix.test/api/ai/image', {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: 'a poster' }),
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.aIUsage.create.mockResolvedValue({})
  generationsCreate.mockResolvedValue({ data: [{ base64: 'aGVsbG8=' }] })
})

describe('POST /api/ai/image — v0.9.2 abuse guard', () => {
  it('rejects Origin-less POSTs (direct API bots) before any provider work', async () => {
    const res = await post()
    expect(res.status).toBe(403)
    // guard fired before the rate limit even ran → no usage accounting
    expect(dbMock.aIUsage.create).not.toHaveBeenCalled()
  })

  it('rejects foreign origins', async () => {
    const res = await post({ origin: 'https://evil.example' })
    expect(res.status).toBe(403)
  })

  it('lets same-origin POSTs through the guard (full happy path)', async () => {
    const res = await post({ origin: 'http://canvix.test' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dataUrl).toBe('data:image/png;base64,aGVsbG8=')
    expect(generationsCreate).toHaveBeenCalledTimes(1)
  })

  it('accepts a same-origin Referer fallback', async () => {
    const res = await post({ referer: 'http://canvix.test/editor' })
    expect(res.status).not.toBe(403)
  })

  it('rejects when the Referer matches neither host nor x-forwarded-host', async () => {
    const res = await POST(
      new NextRequest('http://canvix.test/api/ai/image', {
        method: 'POST',
        headers: {
          host: 'canvix.test',
          'x-forwarded-host': 'canvix.real',
          referer: 'http://evil.example/editor',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ prompt: 'x' }),
      }),
    )
    expect(res.status).toBe(403)
  })
})
