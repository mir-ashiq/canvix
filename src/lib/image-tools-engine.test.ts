import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { getImageToolsEngine, setImageToolsEngine, IMAGE_TOOL_ENGINES } from './image-tools-engine'

/** Minimal localStorage stand-in — the module only uses getItem/setItem. */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    key: () => null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage
}

describe('image-tools-engine', () => {
  let backing: Storage | undefined
  const previous = (globalThis as { localStorage?: Storage }).localStorage

  beforeEach(() => {
    backing = memoryStorage()
    ;(globalThis as { localStorage?: Storage }).localStorage = backing
  })

  afterEach(() => {
    // restore whatever the environment had before the test (usually nothing
    // — the vitest environment is node)
    if (previous) (globalThis as { localStorage?: Storage }).localStorage = previous
    else delete (globalThis as { localStorage?: Storage }).localStorage
  })

  it('defaults to provider — the user-requested default', () => {
    expect(getImageToolsEngine()).toBe('provider')
  })

  it('defaults to provider when storage is unavailable (SSR / private mode)', () => {
    delete (globalThis as { localStorage?: Storage }).localStorage
    expect(getImageToolsEngine()).toBe('provider')
    // set is a no-op, not a throw
    expect(() => setImageToolsEngine('device')).not.toThrow()
  })

  it('round-trips an explicit device choice', () => {
    setImageToolsEngine('device')
    expect(getImageToolsEngine()).toBe('device')
    // and back
    setImageToolsEngine('provider')
    expect(getImageToolsEngine()).toBe('provider')
  })

  it('ignores garbage values instead of throwing or switching', () => {
    backing?.setItem('canvix.image-tools.engine', 'quantum')
    expect(getImageToolsEngine()).toBe('provider')
    backing?.setItem('canvix.image-tools.engine', '')
    expect(getImageToolsEngine()).toBe('provider')
  })

  it('exposes exactly the two engines, provider first (UI order = default)', () => {
    expect(IMAGE_TOOL_ENGINES.map((e) => e.id)).toEqual(['provider', 'device'])
    expect(IMAGE_TOOL_ENGINES.every((e) => e.label.length > 0 && e.hint.length > 0)).toBe(true)
  })
})
