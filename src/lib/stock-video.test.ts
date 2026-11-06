import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chooseRenditions,
  resetStockVideoCache,
  searchStockVideos,
  stockVideoAvailable,
  stockVideoProviders,
  type StockVideoResult,
} from './stock-video'

// ── recorded provider response shapes ─────────────────────────
// The Pexels Video resource + the Pixabay video hit, exactly as
// documented (fields verified against each provider's API docs;
// CI has no keys, so these fixtures are the parsing oracle).

const PEXELS_RESPONSE = {
  url: 'https://api.pexels.com/videos/search?query=ocean',
  page: 1,
  per_page: 24,
  videos: [
    {
      id: 2499611,
      width: 3840,
      height: 2160,
      url: 'https://www.pexels.com/video/aerial-view-of-ocean-2499611/',
      image: 'https://images.pexels.com/videos/2499611/pictures/preview-0.jpg',
      duration: 15,
      user: { id: 47024, name: 'Jo Farne', url: 'https://www.pexels.com/@jo-farne-47024/' },
      video_files: [
        {
          id: 10663,
          quality: 'uhd',
          file_type: 'video/mp4',
          width: 3840,
          height: 2160,
          fps: 25,
          link: 'https://videos.pexels.com/video-files/2499611/2499611-uhd_3840_2160_25fps.mp4',
        },
        {
          id: 10664,
          quality: 'hd',
          file_type: 'video/mp4',
          width: 1920,
          height: 1080,
          fps: 25,
          link: 'https://videos.pexels.com/video-files/2499611/2499611-hd_1920_1080_25fps.mp4',
        },
        {
          id: 10665,
          quality: 'sd',
          file_type: 'video/mp4',
          width: 1280,
          height: 720,
          fps: 25,
          link: 'https://videos.pexels.com/video-files/2499611/2499611-sd_1280_720_25fps.mp4',
        },
        {
          id: 10666,
          quality: 'sd',
          file_type: 'video/mp4',
          width: 640,
          height: 360,
          fps: 25,
          link: 'https://videos.pexels.com/video-files/2499611/2499611-sd_640_360_25fps.mp4',
        },
        { id: 10667, quality: 'hls', file_type: 'video/mp4', link: 'https://videos.pexels.com/hls/2499611.m3u8' },
      ],
      video_pictures: [
        { id: 50394, nr: 0, picture: 'https://images.pexels.com/videos/2499611/pictures/preview-0.jpg' },
        { id: 50395, nr: 1, picture: 'https://images.pexels.com/videos/2499611/pictures/preview-1.jpg' },
      ],
    },
    {
      // hostile/malformed: no mp4 files at all — must be dropped, not crash
      id: 999,
      width: 100,
      height: 100,
      url: 'javascript:alert(1)',
      duration: 1,
      user: { name: 'Nobody' },
      video_files: [{ quality: 'hls', file_type: 'application/x-mpegURL', link: 'https://x.example/a.m3u8' }],
    },
  ],
}

const PIXABAY_RESPONSE = {
  total: 42,
  totalHits: 42,
  hits: [
    {
      id: 125,
      pageURL: 'https://pixabay.com/videos/id-125/',
      type: 'film',
      tags: 'flowers, yellow, blossom',
      duration: 12,
      videos: {
        large: { url: '', width: 3840, height: 2160, size: 0, thumbnail: '' },
        medium: {
          url: 'https://cdn.pixabay.com/video/2015/08/08/125-135736646_medium.mp4',
          width: 1280,
          height: 720,
          size: 3562083,
          thumbnail: 'https://cdn.pixabay.com/video/2015/08/08/125-135736646_medium.jpg',
        },
        small: {
          url: 'https://cdn.pixabay.com/video/2015/08/08/125-135736646_small.mp4',
          width: 960,
          height: 540,
          size: 2030736,
          thumbnail: 'https://cdn.pixabay.com/video/2015/08/08/125-135736646_small.jpg',
        },
        tiny: {
          url: 'https://cdn.pixabay.com/video/2015/08/08/125-135736646_tiny.mp4',
          width: 640,
          height: 360,
          size: 426799,
          thumbnail: 'https://cdn.pixabay.com/video/2015/08/08/125-135736646_tiny.jpg',
        },
      },
      views: 4462,
      downloads: 1464,
      likes: 18,
      comments: 0,
      user_id: 1281706,
      user: 'Coverr-Free-Footage',
    },
    'garbage-entry',
  ],
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  resetStockVideoCache()
  vi.stubEnv('PEXELS_API_KEY', 'test-pexels-key')
  vi.stubEnv('PIXABAY_API_KEY', 'test-pixabay-key')
  delete process.env.PEXELS_API_BASE
  delete process.env.PIXABAY_API_BASE
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('availability — self-hoster keys gate the feature', () => {
  it('no keys → no providers, not available', () => {
    vi.stubEnv('PEXELS_API_KEY', '')
    vi.stubEnv('PIXABAY_API_KEY', ' ')
    expect(stockVideoProviders()).toEqual([])
    expect(stockVideoAvailable()).toBe(false)
  })

  it('either key enables its provider only', () => {
    vi.stubEnv('PEXELS_API_KEY', '')
    expect(stockVideoProviders()).toEqual(['pixabay'])
    vi.stubEnv('PEXELS_API_KEY', 'k')
    vi.stubEnv('PIXABAY_API_KEY', '')
    expect(stockVideoProviders()).toEqual(['pexels'])
  })
})

describe('chooseRenditions — the fallback ladder', () => {
  it('picks the largest ≤1920px file, smaller ones as alternates, smallest as preview', () => {
    const ladder = chooseRenditions([
      { url: 'https://x/a-3840.mp4', width: 3840 },
      { url: 'https://x/a-1920.mp4', width: 1920 },
      { url: 'https://x/a-1280.mp4', width: 1280 },
      { url: 'https://x/a-640.mp4', width: 640 },
    ])
    expect(ladder).toEqual({
      primary: 'https://x/a-1920.mp4',
      alternates: ['https://x/a-1280.mp4', 'https://x/a-640.mp4'],
      previewVideo: 'https://x/a-640.mp4',
    })
  })

  it('all-4K set → the smallest becomes the primary (best chance under the cap)', () => {
    const ladder = chooseRenditions([
      { url: 'https://x/u-3840.mp4', width: 3840 },
      { url: 'https://x/u-2560.mp4', width: 2560 },
    ])
    expect(ladder?.primary).toBe('https://x/u-2560.mp4')
    expect(ladder?.alternates).toEqual([])
  })

  it('dedupes by URL and rejects non-http(s)', () => {
    const ladder = chooseRenditions([
      { url: 'https://x/dup.mp4', width: 1000 },
      { url: 'https://x/dup.mp4', width: 2000 },
      { url: 'javascript:alert(1)', width: 3000 },
    ])
    expect(ladder?.primary).toBe('https://x/dup.mp4')
  })

  it('empty → null', () => {
    expect(chooseRenditions([])).toBeNull()
  })
})

describe('searchStockVideos — pexels', () => {
  it('normalizes the documented response shape', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(PEXELS_RESPONSE))
    const results = await searchStockVideos('ocean', 24, { fetchImpl: fetchImpl as unknown as typeof fetch, noCache: true })

    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('https://api.pexels.com/videos/search?query=ocean&per_page=24')
    expect(url).toContain('orientation=landscape')
    expect((init.headers as Record<string, string>).Authorization).toBe('test-pexels-key')

    expect(results).toHaveLength(1) // the malformed entry is dropped
    const r: StockVideoResult = results[0]
    expect(r.id).toBe('pexels-2499611')
    expect(r.provider).toBe('pexels')
    expect(r.duration).toBe(15)
    // 4K skipped as primary, hd 1920 chosen, sd tiers ladder below
    expect(r.mp4).toBe('https://videos.pexels.com/video-files/2499611/2499611-hd_1920_1080_25fps.mp4')
    expect(r.alternates).toEqual([
      'https://videos.pexels.com/video-files/2499611/2499611-sd_1280_720_25fps.mp4',
      'https://videos.pexels.com/video-files/2499611/2499611-sd_640_360_25fps.mp4',
    ])
    expect(r.previewVideo).toBe('https://videos.pexels.com/video-files/2499611/2499611-sd_640_360_25fps.mp4')
    expect(r.preview).toBe('https://images.pexels.com/videos/2499611/pictures/preview-0.jpg')
    expect(r.credit).toEqual({
      provider: 'Pexels',
      author: 'Jo Farne',
      license: 'Pexels License',
      url: 'https://www.pexels.com/video/aerial-view-of-ocean-2499611/',
    })
  })

  it('accepts url in place of link (schema drift tolerance)', async () => {
    const drift = {
      videos: [
        {
          id: 7,
          width: 1280,
          height: 720,
          duration: 3,
          url: 'https://www.pexels.com/video/drift-7/',
          user: { name: 'A' },
          video_files: [{ file_type: 'video/mp4', width: 1280, url: 'https://videos.pexels.com/drift-7.mp4' }],
        },
      ],
    }
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(drift))
    const results = await searchStockVideos('x', 5, { fetchImpl: fetchImpl as unknown as typeof fetch, noCache: true })
    expect(results[0]?.mp4).toBe('https://videos.pexels.com/drift-7.mp4')
  })

  it('garbage bodies fail closed to empty lists', async () => {
    for (const body of [{}, { videos: null }, { videos: 'nope' }, { videos: [null, 42, {}] }]) {
      const fetchImpl = vi.fn().mockResolvedValue(jsonRes(body))
      const results = await searchStockVideos('x', 5, { fetchImpl: fetchImpl as unknown as typeof fetch, noCache: true })
      expect(results).toEqual([])
    }
  })
})

describe('searchStockVideos — pixabay', () => {
  it('normalizes the documented response shape (empty large url skipped)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(PIXABAY_RESPONSE))
    const results = await searchStockVideos('flowers', 24, { provider: 'pixabay', fetchImpl: fetchImpl as unknown as typeof fetch, noCache: true })

    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url.startsWith('https://pixabay.com/api/videos/?key=test-pixabay-key&')).toBe(true)
    expect(url).toContain('q=flowers')
    expect(url).toContain('safesearch=true')

    expect(results).toHaveLength(1) // the garbage entry is dropped
    const r = results[0]
    expect(r.id).toBe('pixabay-125')
    expect(r.provider).toBe('pixabay')
    expect(r.duration).toBe(12)
    expect(r.mp4).toBe('https://cdn.pixabay.com/video/2015/08/08/125-135736646_medium.mp4')
    expect(r.alternates).toEqual([
      'https://cdn.pixabay.com/video/2015/08/08/125-135736646_small.mp4',
      'https://cdn.pixabay.com/video/2015/08/08/125-135736646_tiny.mp4',
    ])
    expect(r.width).toBe(1280)
    expect(r.height).toBe(720)
    expect(r.preview).toBe('https://cdn.pixabay.com/video/2015/08/08/125-135736646_medium.jpg')
    expect(r.credit).toEqual({
      provider: 'Pixabay',
      author: 'Coverr-Free-Footage',
      license: 'Pixabay Content License',
      url: 'https://pixabay.com/videos/id-125/',
    })
  })

  it('honours the API base override (proxies / tests)', async () => {
    vi.stubEnv('PIXABAY_API_BASE', 'http://127.0.0.1:3210/api')
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(PIXABAY_RESPONSE))
    await searchStockVideos('flowers', 24, { provider: 'pixabay', fetchImpl: fetchImpl as unknown as typeof fetch, noCache: true })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url.startsWith('http://127.0.0.1:3210/api/videos/?key=')).toBe(true)
  })
})

describe('gating + failure modes', () => {
  it('no configured provider → NO_PROVIDER', async () => {
    vi.stubEnv('PEXELS_API_KEY', '')
    vi.stubEnv('PIXABAY_API_KEY', '')
    await expect(searchStockVideos('x', 5, { noCache: true })).rejects.toThrow('NO_PROVIDER')
  })

  it('provider error → sanitized message, never the request URL or body', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('API rate limit exceeded — key=test-pexels-key', { status: 429 }))
    await expect(
      searchStockVideos('x', 5, { fetchImpl: fetchImpl as unknown as typeof fetch, noCache: true }),
    ).rejects.toThrow('Pexels search failed (429).')
    expect(spy).toHaveBeenCalledWith('[stock-video] pexels search failed: 429')
  })

  it('credit fields are hard-capped and control chars stripped', async () => {
    const evil = {
      videos: [
        {
          id: 1,
          width: 640,
          height: 360,
          duration: 2,
          url: 'https://www.pexels.com/video/evil-1/',
          user: { name: 'A\u0000B\n  C' + 'x'.repeat(200) },
          video_files: [{ file_type: 'video/mp4', width: 640, link: 'https://videos.pexels.com/evil.mp4' }],
        },
      ],
    }
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(evil))
    const results = await searchStockVideos('x', 5, { fetchImpl: fetchImpl as unknown as typeof fetch, noCache: true })
    expect(results[0]?.credit.author).toBe('A B C' + 'x'.repeat(75)) // 80-char cap
    expect(results[0]?.credit.author).not.toMatch(/[\u0000-\u001f]/)
  })

  it('javascript: source URLs never become credit links', async () => {
    const evil = {
      videos: [
        {
          id: 2,
          width: 640,
          height: 360,
          duration: 2,
          url: 'javascript:alert(1)',
          user: { name: 'A' },
          video_files: [{ file_type: 'video/mp4', width: 640, link: 'https://videos.pexels.com/ok.mp4' }],
        },
      ],
    }
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(evil))
    const results = await searchStockVideos('x', 5, { fetchImpl: fetchImpl as unknown as typeof fetch, noCache: true })
    expect(results[0]?.credit.url).toBe('')
  })
})

describe('the 24 h response cache', () => {
  it('a repeat query is served from memory — the provider is hit once', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(PEXELS_RESPONSE))
    const a = await searchStockVideos('ocean', 24, { fetchImpl: fetchImpl as unknown as typeof fetch })
    const b = await searchStockVideos('ocean', 24, { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(b).toEqual(a)
  })

  it('different query or provider → different cache slot', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonRes(PEXELS_RESPONSE))
      .mockResolvedValueOnce(jsonRes(PIXABAY_RESPONSE))
      .mockResolvedValueOnce(jsonRes(PEXELS_RESPONSE))
    await searchStockVideos('ocean', 24, { fetchImpl: fetchImpl as unknown as typeof fetch })
    await searchStockVideos('ocean', 24, { provider: 'pixabay', fetchImpl: fetchImpl as unknown as typeof fetch })
    await searchStockVideos('wave', 24, { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})
