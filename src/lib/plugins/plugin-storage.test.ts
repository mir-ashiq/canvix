import { describe, expect, it } from 'vitest'
import {
  PLUGIN_STORAGE_QUOTA_BYTES,
  PluginStorage,
  type StorageLike,
} from './plugin-storage'

// The storage tier (§4.8) is a security boundary, not a
// convenience: the prefix IS the isolation. A plugin must never
// see keys outside `canvix:plugin:<its own id>:*`, and the quota
// must hold even against a plugin that writes in a loop.

function memoryStorage(): StorageLike & { dump(): Map<string, string> } {
  const map = new Map<string, string>()
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size
    },
    dump: () => map,
  }
}

const BIG = 'x'.repeat(1024) // 1 KB string

describe('PluginStorage isolation', () => {
  it('scopes every key under the plugin prefix', () => {
    const store = memoryStorage()
    const a = new PluginStorage('com.canvix.wordcloud', store)
    a.set('palette', ['red', 'blue'])
    expect(a.get('palette')).toEqual({ ok: true, value: ['red', 'blue'] })
    for (const key of store.dump().keys()) {
      expect(key.startsWith('canvix:plugin:com.canvix.wordcloud:')).toBe(true)
    }
  })

  it('two plugins cannot read or enumerate each other', () => {
    const store = memoryStorage()
    const a = new PluginStorage('com.canvix.a', store)
    const b = new PluginStorage('com.canvix.b', store)
    a.set('secret', 'a-value')
    expect(b.get('secret')).toEqual({ ok: true, value: null })
    expect(b.keys()).toEqual([])
    expect(a.keys()).toEqual(['secret'])
    // and neither can reach host keys written outside the namespace
    store.setItem('canvix:brandkit:colors', 'host-data')
    expect(a.get('canvix:brandkit:colors' as never)).toMatchObject({ ok: false })
    expect(a.keys()).toEqual(['secret'])
  })

  it('keys() lists only this plugin, sorted, without the prefix', () => {
    const store = memoryStorage()
    const p = new PluginStorage('com.canvix.p', store)
    p.set('zeta', 1)
    p.set('alpha', 2)
    p.set('mid.key-3', 3)
    expect(p.keys()).toEqual(['alpha', 'mid.key-3', 'zeta'])
  })
})

describe('PluginStorage validation', () => {
  it('rejects malformed keys with E_KEY', () => {
    const p = new PluginStorage('com.canvix.p', memoryStorage())
    for (const bad of ['', ' lead', 'sp ace', 'a'.repeat(65), '../escape', 'a:b', 'a/b']) {
      expect(p.set(bad, 1)).toMatchObject({ ok: false, code: 'E_KEY' })
      expect(p.get(bad)).toMatchObject({ ok: false, code: 'E_KEY' })
      expect(p.remove(bad)).toMatchObject({ ok: false, code: 'E_KEY' })
    }
  })

  it('rejects values that cannot ride structured clone / JSON', () => {
    const p = new PluginStorage('com.canvix.p', memoryStorage())
    expect(p.set('fn', (() => 1) as unknown as number)).toMatchObject({ ok: false, code: 'E_VALUE' })
    expect(p.set('sym', Symbol('x') as unknown as number)).toMatchObject({ ok: false, code: 'E_VALUE' })
    expect(p.set('deep', { a: { b: { c: { d: { e: { f: { g: { h: { i: { j: { k: { l: { m: 1 } } } } } } } } } } } } })).toMatchObject({
      ok: false,
      code: 'E_VALUE',
    })
  })

  it('rejects invalid plugin ids at construction', () => {
    expect(() => new PluginStorage('NOT A VALID ID', memoryStorage())).toThrow()
    expect(() => new PluginStorage('', memoryStorage())).toThrow()
  })

  it('get on a corrupted entry surfaces E_STORAGE instead of throwing', () => {
    const store = memoryStorage()
    const p = new PluginStorage('com.canvix.p', store)
    store.setItem('canvix:plugin:com.canvix.p:bad', '{not json')
    expect(p.get('bad')).toMatchObject({ ok: false, code: 'E_STORAGE' })
  })

  it('missing keys read as null (KV semantics), remove is idempotent', () => {
    const p = new PluginStorage('com.canvix.p', memoryStorage())
    expect(p.get('nothing')).toEqual({ ok: true, value: null })
    expect(p.remove('nothing')).toEqual({ ok: true, value: undefined })
  })
})

describe('PluginStorage quota', () => {
  it('enforces the 256 KB per-plugin quota', () => {
    const p = new PluginStorage('com.canvix.p', memoryStorage())
    // write 1 KB entries until the quota refuses — must land near the cap
    let written = 0
    let firstRefusal = -1
    for (let i = 0; i < 1000; i++) {
      const res = p.set(`k${String(i).padStart(4, '0')}`, BIG)
      if (res.ok) written++
      else {
        firstRefusal = i
        break
      }
    }
    expect(firstRefusal).toBeGreaterThan(230) // ≈ 250 KB / 1.05 KB per entry
    expect(firstRefusal).toBeLessThan(260)
    expect(p.usageBytes()).toBeLessThanOrEqual(PLUGIN_STORAGE_QUOTA_BYTES)
    // …and stay refused until space is freed
    expect(p.set('overflow2', BIG)).toMatchObject({ ok: false, code: 'E_QUOTA' })
    expect(p.remove('k0000')).toEqual({ ok: true, value: undefined })
    expect(p.set('overflow', BIG)).toEqual({ ok: true, value: undefined })
  })

  it('a single value past the 64 KB per-value cap is rejected outright', () => {
    const p = new PluginStorage('com.canvix.p', memoryStorage())
    const huge = 'y'.repeat(PLUGIN_STORAGE_QUOTA_BYTES + 1)
    expect(p.set('huge', huge)).toMatchObject({ ok: false, code: 'E_VALUE' })
  })

  it('overwriting a key reuses its own bytes (no phantom usage)', () => {
    const p = new PluginStorage('com.canvix.p', memoryStorage())
    p.set('k', BIG)
    const before = p.usageBytes()
    for (let i = 0; i < 50; i++) {
      expect(p.set('k', BIG)).toEqual({ ok: true, value: undefined })
    }
    expect(p.usageBytes()).toBe(before)
  })

  it('usageBytes counts keys and values of this plugin only', () => {
    const store = memoryStorage()
    const a = new PluginStorage('com.canvix.a', store)
    const b = new PluginStorage('com.canvix.b', store)
    store.setItem('unrelated-host-key', 'x'.repeat(5000))
    a.set('one', 'x'.repeat(100))
    b.set('one', 'x'.repeat(100))
    expect(a.usageBytes()).toBe(b.usageBytes())
    expect(a.usageBytes()).toBeLessThan(300)
  })
})
