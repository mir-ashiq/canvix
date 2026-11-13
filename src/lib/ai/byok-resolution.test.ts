// Unit tests for the v0.23 BYOK integration in the provider layer:
// resolveSlotForUser puts the user's saved providers ahead of every
// instance-wide layer, and anonymous callers resolve unchanged.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the BYOK db-backed resolver — resolveSlotForUser's user layer.
const resolveUserSlot = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ai/byok', () => ({ resolveUserSlot }))

// Mock the admin config module resolveSlot depends on (getProviders /
// getProviderOverride / getModels / aiFeatureEnabled) — same approach
// as slot-resolution.test.ts, but self-contained here because we only
// assert the BYOK layer and the fallback shape.
const { getProviders, getProviderOverride, getModels, aiFeatureEnabled } = vi.hoisted(() => ({
  getProviders: vi.fn(),
  getProviderOverride: vi.fn(),
  getModels: vi.fn(),
  aiFeatureEnabled: vi.fn(),
}))
vi.mock('@/lib/admin/config', () => ({
  getProviders,
  getProviderOverride,
  getModels,
  aiFeatureEnabled,
  maskApiKey: (k: string) => (k.length > 6 ? `${k.slice(0, 3)}…${k.slice(-4)}` : '***'),
  validateProvider: (i: { baseUrl?: string; apiKey?: string }) =>
    i.baseUrl && i.apiKey ? { ok: true, value: { baseUrl: i.baseUrl, apiKey: i.apiKey } } : { ok: false, error: 'nope' },
}))

import { resolveSlotForUser } from './provider'

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  // instance chain defaults: nothing configured anywhere
  getProviders.mockResolvedValue(null)
  getProviderOverride.mockResolvedValue(null)
  getModels.mockResolvedValue({})
  aiFeatureEnabled.mockResolvedValue(true)
  resolveUserSlot.mockResolvedValue(null)
})

describe('resolveSlotForUser (v0.23 BYOK precedence)', () => {
  it('returns the USER provider when one answers the slot', async () => {
    resolveUserSlot.mockResolvedValue({
      baseUrl: 'https://mine.example/v1',
      apiKey: 'sk-mine',
      model: 'glm-4.7',
      providerId: 'u1',
      label: 'My key',
      source: 'user',
    })
    const out = await resolveSlotForUser('text', 'user-1')
    expect(out?.source).toBe('user')
    expect(out?.baseUrl).toBe('https://mine.example/v1')
    expect(out?.model).toBe('glm-4.7')
    // the user layer was asked for THIS user
    expect(resolveUserSlot).toHaveBeenCalledWith('text', 'user-1')
  })

  it('falls back to the instance chain when the user has no provider for the slot', async () => {
    const envUrl = 'https://instance.example/v1'
    const envKey = 'sk-instance'
    vi.stubEnv('ZAI_BASE_URL', envUrl)
    vi.stubEnv('ZAI_API_KEY', envKey)
    resolveUserSlot.mockResolvedValue(null)
    const out = await resolveSlotForUser('text', 'user-1')
    expect(out?.source).toBe('env')
    expect(out?.baseUrl).toBe(envUrl)
  })

  it('anonymous callers never touch the BYOK layer', async () => {
    const envUrl = 'https://instance.example/v1'
    vi.stubEnv('ZAI_BASE_URL', envUrl)
    vi.stubEnv('ZAI_API_KEY', 'sk-instance')
    const out = await resolveSlotForUser('text', null)
    expect(out?.source).toBe('env')
    expect(resolveUserSlot).not.toHaveBeenCalled()
  })

  it('a BYOK failure degrades to the instance chain instead of erroring', async () => {
    resolveUserSlot.mockRejectedValue(new Error('db down'))
    const envUrl = 'https://instance.example/v1'
    vi.stubEnv('ZAI_BASE_URL', envUrl)
    vi.stubEnv('ZAI_API_KEY', 'sk-instance')
    const out = await resolveSlotForUser('text', 'user-1')
    expect(out?.source).toBe('env')
    expect(out?.baseUrl).toBe(envUrl)
  })

  it('with no user provider it equals the instance chain (resolveSlot passthrough)', async () => {
    // The machine may legitimately carry a .z-ai-config (the file layer
    // reads cwd → HOME → /etc, and /etc is not stub-able) or env vars.
    // What matters for BYOK: an empty user layer changes NOTHING —
    // resolveSlotForUser === resolveSlot, byte for byte.
    resolveUserSlot.mockResolvedValue(null)
    const [withUser, anonymous] = await Promise.all([resolveSlotForUser('video', 'user-1'), resolveSlotForUser('video', null)])
    expect(withUser).toEqual(anonymous)
    expect(resolveUserSlot).toHaveBeenCalledTimes(1) // only the user-1 call went through BYOK
  })
})
