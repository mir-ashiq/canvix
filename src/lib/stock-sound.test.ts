import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Sound wave tests for the Freesound connector. Same posture as
// stock-photo.test.ts: availability resolves console-first through
// the admin config — mock the db (empty AppConfig by default) so
// the env path is the default. CI has no keys, so recorded
// response shapes are the parsing oracle.

const findMany = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({ db: { appConfig: { findMany } } }))

import {
  resetStockSoundCache,
  searchStockSounds,
  stockSoundAvailable,
  stockSoundProviders,
  type StockSoundResult,
} from './stock-sound'
import { invalidateAdminConfig } from '@/lib/admin/config'

// ── recorded Freesound response shape (documented Search results) ──
const FREESOUND_RESPONSE = {
  count: 1234,
  previous: null,
  next: 'https://freesound.org/apiv2/search/text/?page=2',
  results: [
    {
      id: 123456,
      name: 'Soft rain on a window',
      tags: ['rain', 'ambient', 'water', 'window', 'loopable', 'field-recording', 'extra'],
      username: 'rainmaker',
      duration: 12.4,
      license: 'https://creativecommons.org/publicdomain/zero/1.0/',
      previews: {
        'preview-hq-mp3': 'https://cdn.freesound.org/previews/123/123456_1234-hq.mp3',
        'preview-lq-mp3': 'https://cdn.freesound.org/previews/123/123456_1234-lq.mp3',
        'preview-hq-ogg': 'https://cdn.freesound.org/previews/123/123456_1234-hq.ogg',
        'preview-lq-ogg': 'https://cdn.freesound.org/previews/123/123456_1234-lq.ogg',
      },
    },
    {
      // CC BY result — the label mapping
      id: 789,
      name: 'Thunder clap',
      tags: ['thunder'],
      username: 'stormy',
      duration: 3.1,
      license: 'http://creativecommons.org/licenses/by/4.0/',
      previews: {
        'preview-hq-mp3': 'https://cdn.freesound.org/previews/789/789_1-hq.mp3',
      },
    },
    {
      // hostile/malformed: no previews at all — dropped, not crashed
      id: 666,
      name: 'Evil',
      tags: 'not-an-array',
      username: 'nobody',
      duration: 'long',
      license: 'javascript:alert(1)',
      url: 'javascript:alert(1)',
    },
    {
      // missing id — dropped
      name: 'No id',
      username: 'x',
      duration: 1,
      license: 'https://creativecommons.org/publicdomain/zero/1.0/',
      previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/x.mp3' },
    },
  ],
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('FREESOUND_API_KEY', 'test-key')
  delete process.env.FREESOUND_API_BASE
  findMany.mockReset().mockResolvedValue([])
  invalidateAdminConfig()
  resetStockSoundCache()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('stock-sound availability', () => {
  it('no key → not available, no providers', async () => {
    vi.stubEnv('FREESOUND_API_KEY', '')
    expect(await stockSoundAvailable()).toBe(false)
    expect(await stockSoundProviders()).toEqual([])
  })

  it('env key → available as freesound', async () => {
    expect(await stockSoundAvailable()).toBe(true)
    expect(await stockSoundProviders()).toEqual(['freesound'])
  })
})

describe('searchStockSounds', () => {
  it('no key → NO_PROVIDER', async () => {
    vi.stubEnv('FREESOUND_API_KEY', '')
    await expect(searchStockSounds('rain', 10)).rejects.toThrow('NO_PROVIDER')
  })

  it('blank query → [] without any fetch', async () => {
    const fetchMock = vi.fn()
    expect(await searchStockSounds('   ', 10, { fetchImpl: fetchMock as unknown as typeof fetch })).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('parses the documented shape, drops hostile rows, maps licences', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(FREESOUND_RESPONSE), { status: 200 }),
    )
    const out = await searchStockSounds('rain', 24, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      noCache: true,
    })
    expect(out).toHaveLength(2)
    const first = out[0] as StockSoundResult
    expect(first.id).toBe('freesound-123456')
    expect(first.name).toBe('Soft rain on a window')
    expect(first.duration).toBe(12.4)
    expect(first.preview).toBe('https://cdn.freesound.org/previews/123/123456_1234-hq.mp3')
    expect(first.tags).toHaveLength(6) // capped
    expect(first.credit.license).toBe('CC0')
    expect(first.credit.author).toBe('rainmaker')
    expect(first.credit.provider).toBe('Freesound')
    expect(first.credit.url).toBe('https://freesound.org/s/123456/')
    // CC BY mapping on the second row
    expect(out[1]?.credit.license).toBe('CC BY')
    // the request is CC0-filtered by default and carries the token
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string
    expect(calledUrl).toContain(encodeURIComponent('license:"Creative Commons 0"'))
    expect(calledUrl).toContain('token=test-key')
  })

  it('includeOtherLicenses drops the CC0 filter', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(FREESOUND_RESPONSE), { status: 200 })),
    )
    await searchStockSounds('rain', 24, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      noCache: true,
      includeOtherLicenses: true,
    })
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string
    expect(calledUrl).not.toContain('filter=')
    expect(calledUrl).toContain('fields=')
  })

  it('provider error → sanitized status-only message, never the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"detail": "Invalid token test-key"}', { status: 401 }),
    )
    await expect(
      searchStockSounds('rain', 10, { fetchImpl: fetchMock as unknown as typeof fetch, noCache: true }),
    ).rejects.toThrow('Freesound search failed (401).')
  })

  it('results cache for 24 h per query+count+filter', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(FREESOUND_RESPONSE), { status: 200 })),
    )
    const opts = { fetchImpl: fetchMock as unknown as typeof fetch }
    await searchStockSounds('rain', 24, opts)
    await searchStockSounds('rain', 24, opts)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // different filter → different cache key
    await searchStockSounds('rain', 24, { ...opts, includeOtherLicenses: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
