// Unit tests for the BYOK module (v0.23): validators, slot picking,
// masked listing — all against a mocked db, same pattern as
// admin/config.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const findMany = vi.hoisted(() => vi.fn())
const count = vi.hoisted(() => vi.fn())
const create = vi.hoisted(() => vi.fn())
const findFirst = vi.hoisted(() => vi.fn())
const update = vi.hoisted(() => vi.fn())
const del = vi.hoisted(() => vi.fn())
const dbMock = vi.hoisted(() => ({
  userAIProvider: { findMany, count, create, findFirst, update, delete: del },
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))

import { parseSlots, validateUserProvider, pickUserSlot } from './byok'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('parseSlots', () => {
  it('parses a comma list and drops unknowns', () => {
    expect(parseSlots('text,vision')).toEqual(['text', 'vision'])
    expect(parseSlots('text, bogus ,video')).toEqual(['text', 'video'])
  })
  it('tolerates empty/absent input', () => {
    expect(parseSlots(undefined)).toEqual([])
    expect(parseSlots('')).toEqual([])
    expect(parseSlots(null)).toEqual([])
  })
})

describe('validateUserProvider (v0.23)', () => {
  it('accepts a clean provider', () => {
    const out = validateUserProvider({ label: 'My key', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-123', slots: ['text'] })
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.value.label).toBe('My key')
      expect(out.value.slots).toEqual(['text'])
    }
  })
  it('normalizes the URL like the admin table', () => {
    const out = validateUserProvider({ label: 'My key', baseUrl: 'https://api.example.com/v1/', apiKey: 'sk-123', slots: 'text' })
    expect(out.ok).toBe(true)
  })
  it('rejects short/long labels', () => {
    expect(validateUserProvider({ label: 'ab', baseUrl: 'https://x.example/v1', apiKey: 'sk-1', slots: ['text'] }).ok).toBe(false)
    expect(
      validateUserProvider({ label: 'x'.repeat(61), baseUrl: 'https://x.example/v1', apiKey: 'sk-1', slots: ['text'] }).ok
    ).toBe(false)
  })
  it('rejects non-http(s) and credential-embedding URLs (admin rules reuse)', () => {
    expect(validateUserProvider({ label: 'My key', baseUrl: 'ftp://x/v1', apiKey: 'sk-1', slots: ['text'] }).ok).toBe(false)
    expect(validateUserProvider({ label: 'My key', baseUrl: 'https://user:pass@x/v1', apiKey: 'sk-1', slots: ['text'] }).ok).toBe(false)
  })
  it('requires at least one known slot', () => {
    const out = validateUserProvider({ label: 'My key', baseUrl: 'https://x.example/v1', apiKey: 'sk-1', slots: [] })
    expect(out.ok).toBe(false)
  })
  it('validates per-slot model ids, drops unknown keys', () => {
    const out = validateUserProvider({
      label: 'My key',
      baseUrl: 'https://x.example/v1',
      apiKey: 'sk-1',
      slots: ['text', 'vision'],
      models: { text: 'glm-4.7', vision: 'bad model!', bogus: 'x' },
    })
    expect(out.ok).toBe(false) // 'bad model!' fails MODEL_RE (space + !)
    const out2 = validateUserProvider({
      label: 'My key',
      baseUrl: 'https://x.example/v1',
      apiKey: 'sk-1',
      slots: ['text', 'vision'],
      models: { text: 'glm-4.7', bogus: 'dropped' },
    })
    expect(out2.ok).toBe(true)
    if (out2.ok) expect(out2.value.models).toEqual({ text: 'glm-4.7' })
  })
})

describe('pickUserSlot (BYOK precedence per slot)', () => {
  const row = (over: Partial<Parameters<typeof pickUserSlot>[1][number]> = {}) => ({
    id: 'p1',
    label: 'First',
    baseUrl: 'https://one.example/v1',
    apiKey: 'sk-one',
    slots: 'text,vision',
    models: { text: 'glm-4.7' },
    ...over,
  })

  it('answers the first provider covering the slot, in insertion order', () => {
    const rows = [row(), row({ id: 'p2', label: 'Second', slots: 'text' })]
    const picked = pickUserSlot('text', rows)
    expect(picked?.providerId).toBe('p1')
    expect(picked?.source).toBe('user')
    expect(picked?.model).toBe('glm-4.7')
  })
  it('skips providers that do not cover the slot', () => {
    const rows = [row({ slots: 'vision' }), row({ id: 'p2', label: 'Second', baseUrl: 'https://two.example/v1', apiKey: 'sk-two', slots: 'text' })]
    const picked = pickUserSlot('text', rows)
    expect(picked?.providerId).toBe('p2')
    expect(picked?.apiKey).toBe('sk-two')
  })
  it('returns null when nothing covers the slot (fallback to instance chain)', () => {
    expect(pickUserSlot('video', [row()])).toBeNull()
    expect(pickUserSlot('text', [])).toBeNull()
  })
  it('carries no model when the slot has none configured', () => {
    const picked = pickUserSlot('vision', [row()])
    expect(picked?.model).toBeUndefined()
  })
})
