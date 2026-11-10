import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Route tests for the Sound wave stock-sound API. No network, no
// Postgres. Invariants (the A4 stock-photo twin):
//   1. no provider key → 503 NO_PROVIDER (the F2b gate)
//   2. available is secret-free and never leaks the key
//   3. CSRF on the search POST
//   4. the happy path proxies the normalized result set

import { NextRequest } from 'next/server'
import { GET as getAvailable } from '../available/route'
import { POST as searchSounds } from './route'
import { resetStockSoundCache } from '@/lib/stock-sound'
import { resetRateLimitState } from '@/lib/rate-limit'

function req(url: string, init?: Omit<RequestInit, 'signal' | 'headers'> & { headers?: Record<string, string> }) {
  return new NextRequest(url, {
    ...init,
    headers: { host: 'canvix.test', ...(init?.headers ?? {}) },
  })
}

const FREESOUND_FIXTURE = {
  count: 1,
  results: [
    {
      id: 42,
      name: 'Click',
      tags: ['ui', 'click'],
      username: 'routeTester',
      duration: 0.2,
      license: 'https://creativecommons.org/publicdomain/zero/1.0/',
      previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/42/42_1-hq.mp3' },
    },
  ],
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('FREESOUND_API_KEY', 'route-test-key')
  delete process.env.FREESOUND_API_BASE
  resetStockSoundCache()
  resetRateLimitState()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  resetRateLimitState()
})

describe('GET /api/stock-sound/available', () => {
  it('no key → available=false, empty providers, no secrets', async () => {
    vi.stubEnv('FREESOUND_API_KEY', '')
    const res = await getAvailable(req('http://canvix.test/api/stock-sound/available'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { available: boolean; providers: string[] }
    expect(body).toEqual({ available: false, providers: [] })
  })

  it('a key flips availability and names only the provider', async () => {
    const res = await getAvailable(req('http://canvix.test/api/stock-sound/available'))
    const body = (await res.json()) as { available: boolean; providers: string[] }
    expect(body).toEqual({ available: true, providers: ['freesound'] })
    expect(JSON.stringify(body)).not.toContain('route-test-key')
  })
})

describe('POST /api/stock-sound/search', () => {
  it('no provider key → 503 NO_PROVIDER with the operator hint', async () => {
    vi.stubEnv('FREESOUND_API_KEY', '')
    const res = await searchSounds(
      req('http://canvix.test/api/stock-sound/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'rain' }),
      }),
    )
    expect(res.status).toBe(503)
    const body = (await res.json()) as { code?: string; hint?: string }
    expect(body.code).toBe('NO_PROVIDER')
    expect(body.hint).toContain('FREESOUND_API_KEY')
    expect(body.hint).toContain('Creative Commons 0')
  })

  it('cross-site Origin → 403 CSRF_REJECTED', async () => {
    const res = await searchSounds(
      req('http://canvix.test/api/stock-sound/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: JSON.stringify({ query: 'rain' }),
      }),
    )
    expect(res.status).toBe(403)
    const body = (await res.json()) as { code?: string }
    expect(body.code).toBe('CSRF_REJECTED')
  })

  it('missing/blank query → 400', async () => {
    for (const query of ['', '   ']) {
      const res = await searchSounds(
        req('http://canvix.test/api/stock-sound/search', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query }),
        }),
      )
      expect(res.status).toBe(400)
    }
  })

  it('happy path → 200 with the normalized results, key never in the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(FREESOUND_FIXTURE), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const res = await searchSounds(
      req('http://canvix.test/api/stock-sound/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'click' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      results?: { id: string; name: string; credit: { license: string } }[]
    }
    expect(body.results).toHaveLength(1)
    expect(body.results?.[0]?.id).toBe('freesound-42')
    expect(body.results?.[0]?.credit.license).toBe('CC0')
    expect(JSON.stringify(body)).not.toContain('route-test-key')
    // default request is CC0-filtered
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string
    expect(calledUrl).toContain(encodeURIComponent('license:"Creative Commons 0"'))
  })
})
