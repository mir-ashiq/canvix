import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A5: availability resolves console-first through the admin config —
// mock the db (empty AppConfig by default) so the env path is the
// default and stock.providers rows can be injected per test.
const findMany = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({ db: { appConfig: { findMany } } }))

import {
  choosePhotoRenditions,
  resetStockPhotoCache,
  searchStockPhotos,
  stockPhotoAvailable,
  stockPhotoProviders,
  type StockPhotoResult,
} from './stock-photo'
import { invalidateAdminConfig } from '@/lib/admin/config'

// ── recorded provider response shapes ─────────────────────────
// The Pexels Photo resource + the Pixabay photo hit, exactly as
// documented (fields verified against each provider's API docs;
// CI has no keys, so these fixtures are the parsing oracle).

const PEXELS_PHOTO = {
  id: 417173,
      width: 5472,
      height: 3648,
      url: 'https://www.pexels.com/photo/photo-of-coffee-shop-417173/',
      photographer: 'Nathan Dumlao',
      photographer_url: 'https://www.pexels.com/@nathan-dumlao-268298',
      photographer_id: 268298,
      avg_color: '#8C7B6B',
      alt: 'coffee shop interior',
      src: {
        original: 'https://images.pexels.com/photos/417173/pexels-photo-417173.jpeg?auto=compress&cs=tinysrgb&w=5472',
        large2x: 'https://images.pexels.com/photos/417173/pexels-photo-417173.jpeg?auto=compress&cs=tinysrgb&w=1880',
        large: 'https://images.pexels.com/photos/417173/pexels-photo-417173.jpeg?auto=compress&cs=tinysrgb&w=940',
        medium: 'https://images.pexels.com/photos/417173/pexels-photo-417173.jpeg?auto=compress&cs=tinysrgb&w=400',
        small: 'https://images.pexels.com/photos/417173/pexels-photo-417173.jpeg?auto=compress&cs=tinysrgb&w=200',
        portrait: 'https://images.pexels.com/photos/417173/pexels-photo-417173.jpeg?auto=compress&cs=tinysrgb&w=200&h=300',
        landscape: 'https://images.pexels.com/photos/417173/pexels-photo-417173.jpeg?auto=compress&cs=tinysrgb&w=200',
        tiny: 'https://images.pexels.com/photos/417173/pexels-photo-417173.jpeg?auto=compress&cs=tinysrgb&w=65',
      },
  liked: false,
}

const PEXELS_RESPONSE = {
  total_results: 1000,
  page: 1,
  per_page: 24,
  photos: [
    PEXELS_PHOTO,
    {
      // hostile/malformed: no src object at all — must be dropped, not crash
      id: 999,
      width: 100,
      height: 100,
      url: 'javascript:alert(1)',
      photographer: 'Nobody',
    },
  ],
}

const PIXABAY_HIT = {
  id: 1547301,
      pageURL: 'https://pixabay.com/photos/id-1547301/',
      type: 'photo',
      tags: 'mountain, alps, snow',
      previewURL: 'https://cdn.pixabay.com/photo/2016/08/01/22/34/alps-1562210_150.jpg',
      previewWidth: 150,
      previewHeight: 99,
      webformatURL: 'https://cdn.pixabay.com/photo/2016/08/01/22/34/alps-1562210_640.jpg',
      webformatWidth: 640,
      webformatHeight: 425,
      largeImageURL: 'https://cdn.pixabay.com/photo/2016/08/01/22/34/alps-1562210_1280.jpg',
      fullHDURL: 'https://cdn.pixabay.com/photo/2016/08/01/22/34/alps-1562210_1920.jpg',
      imageWidth: 4896,
      imageHeight: 3264,
      imageSize: 3240110,
      views: 4462,
      downloads: 1464,
      likes: 18,
      comments: 0,
  user_id: 1281706,
  user: 'alps-photographer',
}

const PIXABAY_RESPONSE = {
  total: 42,
  totalHits: 42,
  hits: [PIXABAY_HIT, 'garbage-entry'],
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  resetStockPhotoCache()
  findMany.mockResolvedValue([])
  invalidateAdminConfig()
  vi.stubEnv('PEXELS_API_KEY', 'test-pexels-key')
  vi.stubEnv('PIXABAY_API_KEY', 'test-pixabay-key')
  delete process.env.PEXELS_API_BASE
  delete process.env.PIXABAY_API_BASE
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  // a test may warm the config cache with injected rows — never leak it
  invalidateAdminConfig()
})

describe('availability — self-hoster keys gate the feature', () => {
  it('no keys → no providers, not available', async () => {
    vi.stubEnv('PEXELS_API_KEY', '')
    vi.stubEnv('PIXABAY_API_KEY', '')
    await expect(stockPhotoProviders()).resolves.toEqual([])
    await expect(stockPhotoAvailable()).resolves.toBe(false)
  })

  it('either key enables its provider only', async () => {
    vi.stubEnv('PIXABAY_API_KEY', '')
    await expect(stockPhotoProviders()).resolves.toEqual(['pexels'])
    vi.stubEnv('PEXELS_API_KEY', '')
    vi.stubEnv('PIXABAY_API_KEY', 'k2')
    await expect(stockPhotoProviders()).resolves.toEqual(['pixabay'])
    await expect(stockPhotoAvailable()).resolves.toBe(true)
  })

  it('A5: a console-stored key activates the rail with no env var', async () => {
    vi.stubEnv('PEXELS_API_KEY', '')
    vi.stubEnv('PIXABAY_API_KEY', '')
    findMany.mockResolvedValue([{ key: 'stock.providers', value: { pixabay: 'db-key' } }])
    await expect(stockPhotoProviders()).resolves.toEqual(['pixabay'])
    await expect(stockPhotoAvailable()).resolves.toBe(true)
  })

  it('A5: a corrupt stock row is ignored, never fatal', async () => {
    vi.stubEnv('PEXELS_API_KEY', '')
    vi.stubEnv('PIXABAY_API_KEY', '')
    findMany.mockResolvedValue([{ key: 'stock.providers', value: { pexels: 42, junk: 'x' } }])
    await expect(stockPhotoProviders()).resolves.toEqual([])
    await expect(stockPhotoAvailable()).resolves.toBe(false)
  })
})

describe('choosePhotoRenditions — the fallback ladder', () => {
  it('picks the largest ≤1920px URL, smaller ones as alternates', () => {
    const out = choosePhotoRenditions([
      { url: 'https://x/a.jpg', width: 4000 },
      { url: 'https://x/b.jpg', width: 1880 },
      { url: 'https://x/c.jpg', width: 940 },
      { url: 'https://x/d.jpg', width: 400 },
    ])
    expect(out).toEqual({ primary: 'https://x/b.jpg', alternates: ['https://x/c.jpg', 'https://x/d.jpg'] })
  })

  it('no ≤1920 candidate → the last resort becomes the primary', () => {
    const out = choosePhotoRenditions([{ url: 'https://x/a.jpg', width: 4000 }])
    expect(out).toEqual({ primary: 'https://x/a.jpg', alternates: [] })
  })

  it('dedupes by URL and rejects non-http(s)', () => {
    const out = choosePhotoRenditions([
      { url: 'javascript:alert(1)', width: 100 },
      { url: 'https://x/b.jpg', width: 940 },
      { url: 'https://x/b.jpg', width: 940 },
    ])
    expect(out).toEqual({ primary: 'https://x/b.jpg', alternates: [] })
  })

  it('empty → null', () => {
    expect(choosePhotoRenditions([])).toBeNull()
    expect(choosePhotoRenditions([{ url: 'javascript:alert(1)', width: 100 }])).toBeNull()
  })
})

describe('searchStockPhotos — pexels', () => {
  it('normalizes the documented response shape', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(PEXELS_RESPONSE))
    const results = await searchStockPhotos('coffee shop', 24, { fetchImpl, noCache: true })
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('https://api.pexels.com/v1/search?')
    expect(url).toContain('query=')
    expect(url).toContain('per_page=24')
    expect(url).toContain('orientation=landscape')
    expect((init.headers as Record<string, string>).Authorization).toBe('test-pexels-key')

    expect(results).toHaveLength(1) // the malformed second entry is dropped
    const r: StockPhotoResult = results[0]
    expect(r.id).toBe('pexels-417173')
    expect(r.provider).toBe('pexels')
    expect(r.width).toBe(5472)
    expect(r.height).toBe(3648)
    // large2x is the design-tool sweet spot, original (5472px) is NOT the
    // primary; the fallback ladder is the SAME image at smaller sizes —
    // portrait/landscape (crops) and tiny (65px) are excluded by design
    expect(r.download).toBe(PEXELS_PHOTO.src.large2x)
    expect(r.alternates).toEqual([PEXELS_PHOTO.src.large, PEXELS_PHOTO.src.medium, PEXELS_PHOTO.src.small])
    expect(r.preview).toBe(PEXELS_PHOTO.src.medium)
    expect(r.credit).toEqual({
      provider: 'Pexels',
      author: 'Nathan Dumlao',
      license: 'Pexels License',
      url: 'https://www.pexels.com/photo/photo-of-coffee-shop-417173/',
    })
  })

  it('missing large2x falls back down the src ladder', async () => {
    const body = {
      photos: [
        {
          id: 7,
          width: 1200,
          height: 800,
          url: 'https://www.pexels.com/photo/x-7/',
          photographer: 'P',
          src: { large: 'https://x/large.jpg', small: 'https://x/small.jpg' },
        },
      ],
    }
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(body))
    const results = await searchStockPhotos('x', 10, { fetchImpl, noCache: true })
    expect(results[0].download).toBe('https://x/large.jpg')
    expect(results[0].alternates).toEqual(['https://x/small.jpg'])
    expect(results[0].preview).toBe('https://x/small.jpg') // smallest tile-suitable variant
  })

  it('garbage bodies fail closed to empty lists', async () => {
    for (const body of [null, 'string', {}, { photos: 'not-array' }, { photos: [null, 5, 'x'] }]) {
      const fetchImpl = vi.fn().mockResolvedValue(jsonRes(body))
      const results = await searchStockPhotos('x', 10, { fetchImpl, noCache: true })
      expect(results).toEqual([])
    }
  })
})

describe('searchStockPhotos — pixabay', () => {
  it('normalizes the documented response shape (fullHD preferred, preview tile)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(PIXABAY_RESPONSE))
    const results = await searchStockPhotos('alps', 24, { provider: 'pixabay', fetchImpl, noCache: true })
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('https://pixabay.com/api/?')
    expect(url).toContain('key=test-pixabay-key')
    expect(url).toContain('image_type=photo')
    expect(url).toContain('safesearch=true')

    expect(results).toHaveLength(1) // the garbage string entry is dropped
    const r: StockPhotoResult = results[0]
    expect(r.id).toBe('pixabay-1547301')
    expect(r.provider).toBe('pixabay')
    expect(r.width).toBe(4896)
    expect(r.height).toBe(3264)
    expect(r.download).toBe(PIXABAY_HIT.fullHDURL)
    expect(r.alternates).toEqual([PIXABAY_HIT.largeImageURL, PIXABAY_HIT.webformatURL])
    expect(r.preview).toBe(PIXABAY_HIT.previewURL)
    expect(r.credit).toEqual({
      provider: 'Pixabay',
      author: 'alps-photographer',
      license: 'Pixabay Content License',
      url: 'https://pixabay.com/photos/id-1547301/',
    })
  })

  it('no fullHDURL → largeImageURL, then webformatURL', async () => {
    const body = {
      hits: [
        {
          id: 8,
          pageURL: 'https://pixabay.com/photos/id-8/',
          user: 'U',
          previewURL: 'https://x/p.jpg',
          webformatURL: 'https://x/web.jpg',
          webformatWidth: 640,
          largeImageURL: 'https://x/large.jpg',
          imageWidth: 1000,
          imageHeight: 700,
        },
      ],
    }
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(body))
    const results = await searchStockPhotos('x', 10, { provider: 'pixabay', fetchImpl, noCache: true })
    expect(results[0].download).toBe('https://x/large.jpg')
    expect(results[0].alternates).toEqual(['https://x/web.jpg'])
  })

  it('honours the API base override (proxies / tests)', async () => {
    vi.stubEnv('PIXABAY_API_BASE', 'http://127.0.0.1:3210')
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes({ hits: [] }))
    await searchStockPhotos('x', 5, { provider: 'pixabay', fetchImpl, noCache: true })
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url.startsWith('http://127.0.0.1:3210/?')).toBe(true)
  })
})

describe('gating + failure modes', () => {
  it('no configured provider → NO_PROVIDER', async () => {
    vi.stubEnv('PEXELS_API_KEY', '')
    vi.stubEnv('PIXABAY_API_KEY', '')
    await expect(searchStockPhotos('x', 10, { noCache: true })).rejects.toThrow('NO_PROVIDER')
  })

  it('A5: a stored console key wins over the env var (the request carries it)', async () => {
    findMany.mockResolvedValue([{ key: 'stock.providers', value: { pexels: 'db-pexels-key' } }])
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes({ photos: [] }))
    await searchStockPhotos('x', 5, { fetchImpl, noCache: true })
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url.startsWith('https://api.pexels.com/v1/search')).toBe(true)
    expect((init.headers as Record<string, string>).Authorization).toBe('db-pexels-key')
  })

  it('provider error → sanitized message, never the request URL or body', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('{"error":"bad key sk-test-pexels-key"}', { status: 401 }))
    await expect(searchStockPhotos('x', 10, { fetchImpl, noCache: true })).rejects.toThrow('Pexels search failed (401).')
    const thrown = await searchStockPhotos('x', 10, { fetchImpl, noCache: true }).catch((e: Error) => e.message)
    expect(thrown).not.toContain('test-pexels-key')
  })

  it('credit fields are hard-capped and control chars stripped', async () => {
    const body = {
      photos: [
        {
          id: 5,
          width: 100,
          height: 50,
          url: 'https://www.pexels.com/photo/x-5/',
          photographer: 'A\u0000B \n'.repeat(40), // control chars + over cap
          src: { large: 'https://x/l.jpg' },
        },
      ],
    }
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(body))
    const results = await searchStockPhotos('x', 10, { fetchImpl, noCache: true })
    expect(results[0].credit.author.length).toBeLessThanOrEqual(80)
    expect(results[0].credit.author).not.toMatch(/[\u0000-\u001f]/)
  })

  it('javascript: source URLs never become credit links', async () => {
    const body = {
      photos: [{ id: 5, width: 1, height: 1, url: 'javascript:alert(1)', photographer: 'P', src: { large: 'https://x/l.jpg' } }],
    }
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(body))
    const results = await searchStockPhotos('x', 10, { fetchImpl, noCache: true })
    expect(results[0].credit.url).toBe('')
  })
})

describe('the 24 h response cache', () => {
  it('a repeat query is served from memory — the provider is hit once', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(PEXELS_RESPONSE))
    await searchStockPhotos('coffee', 24, { fetchImpl })
    await searchStockPhotos('coffee', 24, { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('different query or provider → different cache slot', async () => {
    // one Response per call — a body can only be read once
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonRes(PEXELS_RESPONSE))
      .mockResolvedValueOnce(jsonRes(PIXABAY_RESPONSE))
      .mockResolvedValueOnce(jsonRes(PEXELS_RESPONSE))
    await searchStockPhotos('coffee', 24, { fetchImpl })
    await searchStockPhotos('tea', 24, { fetchImpl })
    await searchStockPhotos('tea', 24, { fetchImpl, provider: 'pixabay' })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})
