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
  validateProviderList,
  validateSlots,
  maskApiKey,
  getFeatures,
  getSettings,
  getProviderOverride,
  getProviders,
  getModels,
  setFeatures,
  setProviders,
  clearProviders,
  clearProvider,
  importLegacyProvider,
  invalidateAdminConfig,
  DEFAULT_FEATURES,
  type StoredProviderEntry,
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
    expect(validateModels({ text: 'model;rm -rf /' }).ok).toBe(false) // ; and spaces are never legal
    // "/" IS legal since v0.16.2 — NVIDIA NIM / HuggingFace namespaces
    expect(validateModels({ text: 'meta/llama-3.1-70b-instruct' }).ok).toBe(true)
    expect(validateModels({ text: 'openrouter/auto' }).ok).toBe(true)
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

describe('validateProviderList (v0.16.2 A2)', () => {
  const existing = new Map<string, StoredProviderEntry>([
    ['pkeep', { id: 'pkeep', label: 'Old label', baseUrl: 'https://old.example/v1', apiKey: 'sk-stored' }],
  ])

  it('validates a clean list and normalizes base URLs', () => {
    const out = validateProviderList([{ id: 'pa', label: 'A', baseUrl: 'https://a.example/v1', apiKey: 'k-a' }])
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.value[0]).toEqual({ id: 'pa', label: 'A', baseUrl: 'https://a.example/v1', apiKey: 'k-a' })
  })

  it('keeps the stored key when apiKey is omitted (write-only credential)', () => {
    const out = validateProviderList([{ id: 'pkeep', label: 'Renamed', baseUrl: 'https://old.example/v1' }], { existing })
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.value[0].apiKey).toBe('sk-stored')
      expect(out.value[0].label).toBe('Renamed')
    }
  })

  it('demands a key for a NEW provider (unknown id, no key)', () => {
    const out = validateProviderList([{ label: 'New', baseUrl: 'https://n.example/v1' }], { existing })
    expect(out.ok).toBe(false)
  })

  it('generates ids for new entries (injectable makeId) and enforces uniqueness', () => {
    let n = 0
    const out = validateProviderList(
      [
        { label: 'A', baseUrl: 'https://a.example/v1', apiKey: 'k' },
        { label: 'B', baseUrl: 'https://b.example/v1', apiKey: 'k' },
      ],
      { makeId: () => 'p' + n++ }
    )
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.value.map((p) => p.id)).toEqual(['p0', 'p1'])
      expect(out.value[0].id).toMatch(/^p[a-z0-9]+$/)
    }
    const dup = validateProviderList(
      [
        { id: 'psame', label: 'A', baseUrl: 'https://a.example/v1', apiKey: 'k' },
        { id: 'psame', label: 'B', baseUrl: 'https://b.example/v1', apiKey: 'k' },
      ],
      { makeId: () => 'px' }
    )
    expect(dup.ok).toBe(false)
  })

  it('rejects malformed entries: label, URL, scheme, embedded credentials, cap', () => {
    expect(validateProviderList('nope').ok).toBe(false)
    expect(validateProviderList([{ label: '', baseUrl: 'https://x.io', apiKey: 'k' }]).ok).toBe(false)
    expect(validateProviderList([{ label: 'A', baseUrl: 'not a url', apiKey: 'k' }]).ok).toBe(false)
    expect(validateProviderList([{ label: 'A', baseUrl: 'ftp://x', apiKey: 'k' }]).ok).toBe(false)
    expect(validateProviderList([{ label: 'A', baseUrl: 'https://u:p@x.io', apiKey: 'k' }]).ok).toBe(false)
    expect(
      validateProviderList(
        Array.from({ length: 9 }, (_, i) => ({ label: `P${i}`, baseUrl: `https://p${i}.io`, apiKey: 'k' }))
      ).ok
    ).toBe(false)
  })

  it('an empty list is valid (clears the table)', () => {
    expect(validateProviderList([])).toEqual({ ok: true, value: [] })
  })
})

describe('validateSlots (v0.16.2 A2)', () => {
  const ids = new Set(['pa', 'pb'])

  it('keeps valid slots, drops unknown keys, omits empty models', () => {
    const out = validateSlots(
      { text: { providerId: 'pa', model: 'glm-4.6' }, vision: { providerId: 'pb', model: '' }, junk: { providerId: 'pa' } },
      ids
    )
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.value).toEqual({ text: { providerId: 'pa', model: 'glm-4.6' }, vision: { providerId: 'pb' } })
    }
  })

  it('null clears a slot; unknown providerId and bad models are rejected', () => {
    expect(validateSlots({ text: null }, ids)).toEqual({ ok: true, value: {} })
    expect(validateSlots({ text: { providerId: 'pgone' } }, ids).ok).toBe(false)
    expect(validateSlots({ text: { providerId: 'pa', model: 'bad model!' } }, ids).ok).toBe(false)
    expect(validateSlots([], ids).ok).toBe(false)
  })
})

describe('multi-provider table read/write (v0.16.2 A2)', () => {
  it('getProviders parses a stored table; absent/corrupt rows read as null', async () => {
    findMany.mockResolvedValue([
      {
        key: 'ai.providers',
        value: {
          providers: [{ id: 'pa', label: 'A', baseUrl: 'https://a.example/v1', apiKey: 'k' }],
          slots: { text: { providerId: 'pa', model: 'glm-4.6' } },
        },
      },
    ])
    const table = await getProviders()
    expect(table?.providers).toHaveLength(1)
    expect(table?.slots.text).toEqual({ providerId: 'pa', model: 'glm-4.6' })

    invalidateAdminConfig()
    findMany.mockResolvedValue([{ key: 'ai.providers', value: { providers: [{ label: 'no id' }] } }])
    expect(await getProviders()).toBeNull()

    invalidateAdminConfig()
    findMany.mockResolvedValue([])
    expect(await getProviders()).toBeNull()
  })

  it('setProviders upserts the table; clearProviders empties it', async () => {
    upsert.mockResolvedValue({})
    await setProviders({ providers: [{ id: 'pa', label: 'A', baseUrl: 'https://a.io', apiKey: 'k' }], slots: { text: { providerId: 'pa' } } })
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'ai.providers' } })
    )
    await clearProviders()
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'ai.providers' }, update: { value: {} } })
    )
  })
})

describe('importLegacyProvider (v0.16.2 A2)', () => {
  it('imports the legacy override, wires empty slots to it, clears the legacy row', async () => {
    findMany.mockResolvedValue([
      { key: 'ai.provider', value: { baseUrl: 'https://legacy.example/v1', apiKey: 'sk-leg' } },
    ])
    upsert.mockResolvedValue({})
    const out = await importLegacyProvider()
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.value.added).toBe(true)
      expect(out.value.list).toHaveLength(1)
      expect(out.value.list[0].baseUrl).toBe('https://legacy.example/v1')
      expect(out.value.list[0].apiKey).toBe('sk-leg')
      expect(Object.keys(out.value.slots)).toHaveLength(5) // all slots wired
    }
    const calls = upsert.mock.calls.map((c) => c[0].where.key)
    expect(calls).toContain('ai.providers')
    expect(calls).toContain('ai.provider') // cleared
  })

  it('does not duplicate a provider that is already in the table', async () => {
    findMany.mockResolvedValue([
      { key: 'ai.provider', value: { baseUrl: 'https://same.example/v1', apiKey: 'sk-leg' } },
      {
        key: 'ai.providers',
        value: {
          providers: [{ id: 'pa', label: 'Same', baseUrl: 'https://same.example/v1', apiKey: 'sk-x' }],
          slots: { text: { providerId: 'pa' } },
        },
      },
    ])
    upsert.mockResolvedValue({})
    const out = await importLegacyProvider()
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.value.added).toBe(false)
      expect(out.value.list).toHaveLength(1)
      expect(out.value.slots).toEqual({ text: { providerId: 'pa' } }) // existing slots kept
    }
  })

  it('fails cleanly when nothing is stored', async () => {
    findMany.mockResolvedValue([])
    const out = await importLegacyProvider()
    expect(out.ok).toBe(false)
  })
})
