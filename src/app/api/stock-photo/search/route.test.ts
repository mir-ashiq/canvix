import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Route tests for the v0.16.4 A4 stock-photo API. No network, no
// Postgres. Invariants:
//   1. no provider key → 503 NO_PROVIDER (the F2b gate)
//   2. available is secret-free and never leaks the keys
//   3. CSRF on the search POST
//   4. unknown/unconfigured provider → 400
//   5. the happy path proxies the normalized result set

import { NextRequest } from 'next/server'
import { GET as getAvailable } from '../available/route'
import { POST as searchPhotos } from './route'
import { resetStockPhotoCache } from '@/lib/stock-photo'
import { resetRateLimitState } from '@/lib/rate-limit'

function req(url: string, init?: Omit<RequestInit, 'signal' | 'headers'> & { headers?: Record<string, string> }) {
  return new NextRequest(url, {
    ...init,
    headers: { host: 'canvix.test', ...(init?.headers ?? {}) },
  })
}

const PEXELS_FIXTURE = {
  photos: [
    {
      id: 42,
      width: 4000,
      height: 2667,
      url: 'https://www.pexels.com/photo/route-test-42/',
      photographer: 'Route Tester',
      src: {
        original: 'https://images.pexels.com/route-42-original.jpeg',
        large2x: 'https://images.pexels.com/route-42-large2x.jpeg',
        large: 'https://images.pexels.com/route-42-large.jpeg',
        medium: 'https://images.pexels.com/route-42-medium.jpeg',
      },
    },
  ],
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('PEXELS_API_KEY', 'route-test-key')
  delete process.env.PEXELS_API_BASE
  delete process.env.PIXABAY_API_KEY
  resetStockPhotoCache()
  resetRateLimitState()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  resetRateLimitState()
})

describe('GET /api/stock-photo/available', () => {
  it('no keys → available=false, empty providers, no secrets', async () => {
    vi.stubEnv('PEXELS_API_KEY', '')
    const res = await getAvailable(req('http://canvix.test/api/stock-photo/available'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { available: boolean; providers: string[] }
    expect(body).toEqual({ available: false, providers: [] })
  })

  it('a key flips availability and names only the provider', async () => {
    const res = await getAvailable(req('http://canvix.test/api/stock-photo/available'))
    const body = (await res.json()) as { available: boolean; providers: string[] }
    expect(body).toEqual({ available: true, providers: ['pexels'] })
    expect(JSON.stringify(body)).not.toContain('route-test-key')
  })
})

describe('POST /api/stock-photo/search', () => {
  it('no provider key → 503 NO_PROVIDER with the operator hint', async () => {
    vi.stubEnv('PEXELS_API_KEY', '')
    const res = await searchPhotos(
      req('http://canvix.test/api/stock-photo/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'ocean' }),
      }),
    )
    expect(res.status).toBe(503)
    const body = (await res.json()) as { code?: string; hint?: string }
    expect(body.code).toBe('NO_PROVIDER')
    expect(body.hint).toContain('PEXELS_API_KEY')
  })

  it('cross-site Origin → 403 CSRF_REJECTED', async () => {
    const res = await searchPhotos(
      req('http://canvix.test/api/stock-photo/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: JSON.stringify({ query: 'ocean' }),
      }),
    )
    expect(res.status).toBe(403)
    const body = (await res.json()) as { code?: string }
    expect(body.code).toBe('CSRF_REJECTED')
  })

  it('missing/blank query → 400', async () => {
    for (const query of ['', '   ', undefined]) {
      const res = await searchPhotos(
        req('http://canvix.test/api/stock-photo/search', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query }),
        }),
      )
      expect(res.status).toBe(400)
    }
  })

  it('unconfigured provider → 400 naming the configured set', async () => {
    const res = await searchPhotos(
      req('http://canvix.test/api/stock-photo/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'ocean', provider: 'pixabay' }),
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toContain('pexels')
  })

  it('happy path → 200 with the normalized results, key never in the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(PEXELS_FIXTURE), { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await searchPhotos(
      req('http://canvix.test/api/stock-photo/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'ocean', count: 12 }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      query: string
      count: number
      results: { id: string; download: string; credit: { author: string } }[]
    }
    expect(body.query).toBe('ocean')
    expect(body.count).toBe(1)
    expect(body.results[0].id).toBe('pexels-42')
    expect(body.results[0].download).toBe('https://images.pexels.com/route-42-large2x.jpeg')
    expect(body.results[0].credit.author).toBe('Route Tester')
    expect(JSON.stringify(body)).not.toContain('route-test-key')
    // the outbound provider call carried the key in the header
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('per_page=12')
    expect((init.headers as Record<string, string>).Authorization).toBe('route-test-key')
  })

  it('provider outage → 502 with the sanitized status-only message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom key=secret', { status: 500 })))

    const res = await searchPhotos(
      req('http://canvix.test/api/stock-photo/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'ocean' }),
      }),
    )
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toBe('Pexels search failed (500).')
    expect(body.error).not.toContain('secret')
    expect(spy).toHaveBeenCalled()
  })
})
