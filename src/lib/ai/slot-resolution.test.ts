// Unit tests for per-slot provider resolution (v0.16.2 A2) — the pure
// pickSlot() layer-picker behind every AI feature. Precedence under
// test: multi-provider table → legacy single override → env vars →
// .z-ai-config file → null, with the legacy ai.models ids still
// steering the text/vision/image slots on the fallback chain.

import { describe, it, expect } from 'vitest'
import { pickSlot } from './provider'
import type { StoredProviders, StoredProvider } from '@/lib/admin/config'

const P1 = { id: 'pnvidia', label: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: 'nvapi-1' }
const P2 = { id: 'pzai', label: 'Z.ai', baseUrl: 'https://api.z.ai/v1', apiKey: 'sk-2' }

function table(slots: StoredProviders['slots']): StoredProviders {
  return { providers: [P1, P2], slots }
}

describe('pickSlot (v0.16.2 A2)', () => {
  it('a slot pinned in the multi table resolves to that provider + model', () => {
    const out = pickSlot(
      'text',
      table({ text: { providerId: 'pnvidia', model: 'meta/llama-3.1-70b-instruct' } }),
      null,
      {},
      {},
      null
    )
    expect(out).toEqual({
      baseUrl: P1.baseUrl,
      apiKey: P1.apiKey,
      model: 'meta/llama-3.1-70b-instruct',
      providerId: 'pnvidia',
      label: 'NVIDIA NIM',
      source: 'multi',
    })
  })

  it('different slots can point at different providers', () => {
    const t = table({
      text: { providerId: 'pnvidia', model: 'meta/llama-3.1-70b-instruct' },
      image: { providerId: 'pzai' },
    })
    const text = pickSlot('text', t, null, {}, {}, null)
    const image = pickSlot('image', t, null, {}, {}, null)
    expect(text?.baseUrl).toBe(P1.baseUrl)
    expect(text?.model).toBe('meta/llama-3.1-70b-instruct')
    expect(image?.baseUrl).toBe(P2.baseUrl)
    expect(image?.model).toBeUndefined() // no model = provider default
  })

  it('a slot whose providerId no longer exists falls back to the legacy chain', () => {
    const legacy: StoredProvider = { baseUrl: 'https://legacy.example/v1', apiKey: 'k' }
    const out = pickSlot('text', table({ text: { providerId: 'pgone' } }), legacy, { text: 'glm-4.6' }, {}, null)
    expect(out?.source).toBe('db')
    expect(out?.baseUrl).toBe('https://legacy.example/v1')
    expect(out?.model).toBe('glm-4.6')
  })

  it('unpinned slots fall back: legacy override wins over env and file', () => {
    const legacy: StoredProvider = { baseUrl: 'https://db.example/v1', apiKey: 'k' }
    const out = pickSlot('vision', table({ text: { providerId: 'pzai' } }), legacy, {}, { baseUrl: 'https://env.example', apiKey: 'e' }, { baseUrl: 'https://file.example', apiKey: 'f' })
    expect(out?.source).toBe('db')
    expect(out?.baseUrl).toBe('https://db.example/v1')
  })

  it('fallback chain: env beats file; file used when env incomplete', () => {
    const env = pickSlot('image', null, null, {}, { baseUrl: 'https://env.example', apiKey: 'e' }, { baseUrl: 'https://file.example', apiKey: 'f' })
    expect(env?.source).toBe('env')
    const file = pickSlot('image', null, null, {}, { baseUrl: 'https://env.example' }, { baseUrl: 'https://file.example', apiKey: 'f' })
    expect(file?.source).toBe('file')
    expect(file?.baseUrl).toBe('https://file.example')
  })

  it('legacy ai.models map onto matching slots of the fallback chain', () => {
    const models = { text: 'gpt-x', vision: 'glm-4.5v', image: 'cogview-3' }
    expect(pickSlot('text', null, { baseUrl: 'https://x', apiKey: 'k' }, models, {}, null)?.model).toBe('gpt-x')
    expect(pickSlot('vision', null, { baseUrl: 'https://x', apiKey: 'k' }, models, {}, null)?.model).toBe('glm-4.5v')
    expect(pickSlot('image', null, { baseUrl: 'https://x', apiKey: 'k' }, models, {}, null)?.model).toBe('cogview-3')
    // imageEdit never had a legacy model id — provider default
    // (v0.16.4 A4: imageSearch is retired — photo search runs on the
    // stock-provider keys, not on an AI slot)
    expect(pickSlot('imageEdit', null, { baseUrl: 'https://x', apiKey: 'k' }, models, {}, null)?.model).toBeUndefined()
  })

  it('nothing configured anywhere → null (feature reports unavailable)', () => {
    expect(pickSlot('text', null, null, {}, {}, null)).toBeNull()
    expect(pickSlot('imageEdit', table({}), null, {}, {}, null)).toBeNull()
  })

  it('the multi table does NOT rescue other slots — only pinned ones', () => {
    // text pinned, image not: with no legacy/env/file, image stays null
    const t = table({ text: { providerId: 'pzai' } })
    expect(pickSlot('text', t, null, {}, {}, null)).not.toBeNull()
    expect(pickSlot('image', t, null, {}, {}, null)).toBeNull()
  })
})
