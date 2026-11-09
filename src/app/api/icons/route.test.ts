// Unit tests for the Iconify proxy (v0.17 Wave 2) — validation and
// passthrough behaviour with a stubbed fetch, following the
// stock-photo/stock-video route test conventions.

import { NextRequest } from 'next/server'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

// rate limits off for deterministic tests
vi.mock('@/lib/rate-limit', async (orig) => {
  const actual = await orig<typeof import('@/lib/rate-limit')>()
  return { ...actual, checkRateLimit: () => ({ ok: true }) }
})

import { GET } from './route'

beforeEach(() => {
  // mockReset (not clearAllMocks) — once-implementations must not leak
  // between tests when a request 400s before reaching fetch
  fetchMock.mockReset()
})

const req = (url: string) => new NextRequest(`http://canvix.test${url}`)

describe('GET /api/icons (Iconify proxy, v0.17 Wave 2)', () => {
  it('rejects requests without ?q or ?svg', async () => {
    const res = await GET(req('/api/icons'))
    expect(res.status).toBe(400)
  })

  it('validates icon references strictly (injection-safe)', async () => {
    for (const bad of ['../etc/passwd', 'mdi:home extra', 'mdi:', ':home', 'MDI:home', 'a'.repeat(70) + ':x']) {
      const res = await GET(req(`/api/icons?svg=${encodeURIComponent(bad)}`))
      expect(res.status, `svg=${bad}`).toBe(400)
    }
  })

  it('validates search queries (shape + length)', async () => {
    for (const bad of ['', '   ', 'a;b', '${jndi}', 'x'.repeat(70)]) {
      const res = await GET(req(`/api/icons?q=${encodeURIComponent(bad)}`))
      expect(res.status, `q="${bad}"`).toBe(400)
    }
  })

  it('proxies a search and filters malformed icon ids', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ icons: ['mdi:rocket', 'not-an-id', 42, 'uil:space'] }), { status: 200 }),
    )
    const res = await GET(req('/api/icons?q=rocket'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.icons).toEqual(['mdi:rocket', 'uil:space'])
    expect(fetchMock.mock.calls[0][0]).toContain('api.iconify.design/search?query=rocket&limit=60')
  })

  it('serves svg passthrough with hard edge caching', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>', { status: 200 }))
    const res = await GET(req('/api/icons?svg=mdi:home&color=%23FF0000'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('image/svg+xml')
    expect(res.headers.get('cache-control')).toContain('s-maxage=604800')
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.iconify.design/mdi/home.svg?color=%23FF0000')
  })

  it('rejects invalid colours on svg fetches', async () => {
    const res = await GET(req('/api/icons?svg=mdi:home&color=javascript:alert(1)'))
    expect(res.status).toBe(400)
  })

  it('rejects non-svg payloads from upstream', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>not an icon</html>', { status: 200 }))
    const res = await GET(req('/api/icons?svg=mdi:home'))
    expect(res.status).toBe(502)
  })

  it('maps upstream misses to 404 and network failures to 504', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not found', { status: 404 }))
    expect((await GET(req('/api/icons?svg=mdi:nope'))).status).toBe(404)
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    expect((await GET(req('/api/icons?q=rocket'))).status).toBe(504)
  })
})
