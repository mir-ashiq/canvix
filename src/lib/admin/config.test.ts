// Unit tests for the instance config module (v0.16 A1): validators,
// masking, defaults merge and the cached read path against a mocked db.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const findMany = vi.hoisted(() => vi.fn())
const upsert = vi.hoisted(() => vi.fn())
const dbMock = vi.hoisted(() => ({ appConfig: { findMany, upsert } }))
vi.mock('@/lib/db', () => ({ db: dbMock }))

import {
  validateProvider,
  validateModels,
  validateFeatures,
  validateSettings,
  maskApiKey,
  getFeatures,
  getSettings,
  getProviderOverride,
  getModels,
  setFeatures,
  clearProvider,
  DEFAULT_FEATURES,
} from './config'

beforeEach(() => {
  vi.clearAllMocks()
  findMany.mockResolvedValue([])
  // each test starts from a cold cache
  return import('./config').then((m) => m.invalidateAdminConfig())
})

describe('validateProvider (v0.16 A1)', () => {
  it('accepts a clean http(s) URL + key and normalizes the URL', () => {
    const out = validateProvider({ baseUrl: 'https://api.example.com/v1/', apiKey: 'sk-123' })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.value.baseUrl).toBe('https://api.example.com/v1/')
  })

  it('rejects non-http(s) schemes', () => {
    expect(validateProvider({ baseUrl: 'ftp://x', apiKey: 'k' }).ok).toBe(false)
    expect(validateProvider({ baseUrl: 'javascript:alert(1)', apiKey: 'k' }).ok).toBe(false)
  })

  it('rejects credentials embedded in the URL', () => {
    expect(validateProvider({ baseUrl: 'https://user:pw@example.com', apiKey: 'k' }).ok).toBe(false)
  })

  it('rejects missing pieces and oversize values', () => {
    expect(validateProvider({ baseUrl: '', apiKey: 'k' }).ok).toBe(false)
    expect(validateProvider({ baseUrl: 'https://x.io', apiKey: '' }).ok).toBe(false)
    expect(validateProvider({ baseUrl: 'https://x.io', apiKey: 'k'.repeat(4097) }).ok).toBe(false)
    expect(validateProvider({ baseUrl: `https://x.io/${'a'.repeat(2100)}`, apiKey: 'k' }).ok).toBe(false)
    expect(validateProvider(null).ok).toBe(false)
  })
})

describe('validateModels (v0.16 A1)', () => {
  it('keeps well-formed ids and drops empty/cleared ones', () => {
    expect(validateModels({ text: 'glm-4.6', vision: '', image: undefined })).toEqual({
      ok: true,
      value: { text: 'glm-4.6' },
    })
  })

  it('rejects garbage model ids and unknown junk only warns by ignoring', () => {
    expect(validateModels({ text: 'bad model!' }).ok).toBe(false)
    expect(validateModels({ text: '../etc/passwd' }).ok).toBe(false)
    const out = validateModels({ evil: 'x', text: 'glm-4.6' })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.value).toEqual({ text: 'glm-4.6' })
    expect(validateModels('nope').ok).toBe(false)
  })
})

describe('validateFeatures (v0.16 A1)', () => {
  it('keeps booleans, ignores unknown keys', () => {
    const out = validateFeatures({ magicWrite: false, nope: true })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.value).toEqual({ magicWrite: false })
  })

  it('rejects non-boolean values', () => {
    expect(validateFeatures({ vision: 'off' }).ok).toBe(false)
    expect(validateFeatures({ vision: 0 }).ok).toBe(false)
  })
})

describe('validateSettings (v0.16 A1)', () => {
  it('keeps booleans, ignores unknown keys, rejects the rest', () => {
    expect(validateSettings({ signupsOpen: false })).toEqual({ ok: true, value: { signupsOpen: false } })
    expect(validateSettings({ anonymousEditing: 'no' }).ok).toBe(false)
    expect(validateSettings([]).ok).toBe(false)
  })
})

describe('maskApiKey (v0.16 A1)', () => {
  it('never reveals the middle of a key', () => {
    const masked = maskApiKey('sk-abcdef1234567890wxyz')
    expect(masked).toBe('sk-a…wxyz')
    expect(masked).not.toContain('1234567890')
  })

  it('fully masks short keys', () => {
    expect(maskApiKey('short')).toBe('••••••••')
  })
})

describe('cached reads (v0.16 A1)', () => {
  it('defaults when the table is empty', async () => {
    expect(await getFeatures()).toEqual(DEFAULT_FEATURES)
    expect(await getSettings()).toEqual({ signupsOpen: true, anonymousEditing: true })
    expect(await getProviderOverride()).toBeNull()
    expect(await getModels()).toEqual({})
  })

  it('merges stored partial sections over defaults', async () => {
    findMany.mockResolvedValue([
      { key: 'ai.features', value: { magicWrite: false } },
      { key: 'app.settings', value: { signupsOpen: false } },
    ])
    expect((await getFeatures()).magicWrite).toBe(false)
    expect((await getFeatures()).assistant).toBe(true)
    expect((await getSettings()).signupsOpen).toBe(false)
    expect((await getSettings()).anonymousEditing).toBe(true)
  })

  it('ignores a corrupt provider row (fails back to env behaviour)', async () => {
    findMany.mockResolvedValue([{ key: 'ai.provider', value: { baseUrl: 'not a url' } }])
    expect(await getProviderOverride()).toBeNull()
  })

  it('DB read failure falls back to defaults, never throws', async () => {
    findMany.mockRejectedValue(new Error('connection refused'))
    await expect(getFeatures()).resolves.toEqual(DEFAULT_FEATURES)
  })

  it('one findMany serves repeated reads inside the TTL', async () => {
    await getFeatures()
    await getSettings()
    await getModels()
    expect(findMany).toHaveBeenCalledTimes(1)
  })
})

describe('writers (v0.16 A1)', () => {
  it('setFeatures upserts the merged flags and invalidates the cache', async () => {
    findMany.mockResolvedValue([{ key: 'ai.features', value: { magicWrite: false } }])
    await getFeatures() // warm cache with magicWrite:false
    upsert.mockResolvedValue({})
    await setFeatures({ ...DEFAULT_FEATURES, magicWrite: false })
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'ai.features' } })
    )
    // cache was dropped → next read hits the db again
    await getFeatures()
    expect(findMany).toHaveBeenCalledTimes(2)
  })

  it('clearProvider writes the empty override', async () => {
    upsert.mockResolvedValue({})
    await clearProvider()
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'ai.provider' }, update: { value: {} } })
    )
  })
})
