import { describe, expect, it } from 'vitest'
import {
  PLUGIN_DATA_MAX_ARRAY,
  PLUGIN_DATA_MAX_BYTES,
  PLUGIN_DATA_MAX_DEPTH,
  PLUGIN_DATA_MAX_KEYS,
  PLUGIN_DATA_MAX_STRING,
  checkCloneSafe,
} from './data-caps'

// The caps mirror validateOpPayload (collab) so plugin data rides
// autosave/collab/jsonb unchanged — these tests pin the parity
// limits and the hostile-payload rejections.

describe('checkCloneSafe', () => {
  it('accepts plain JSON data of reasonable size', () => {
    expect(checkCloneSafe(null)).toBeNull()
    expect(checkCloneSafe(42)).toBeNull()
    expect(checkCloneSafe({ words: ['a', 'b'], seed: 1, nested: { deep: [1, 2, 3] } })).toBeNull()
  })

  it('rejects non-JSON structured-clone types by design', () => {
    // top-level non-serializables fail at the JSON.stringify gate…
    expect(checkCloneSafe(() => 1)).toMatch(/not serializable/)
    expect(checkCloneSafe(Symbol('x'))).toMatch(/not serializable/)
    // …nested ones at the walk (BigInt throws at stringify, like a circle)
    expect(checkCloneSafe({ fn: () => 'hi' })).toMatch(/unsupported value type/)
    expect(checkCloneSafe({ sym: Symbol('x') })).toMatch(/unsupported value type/)
    expect(checkCloneSafe({ big: BigInt(10) })).toMatch(/not serializable/)
    expect(checkCloneSafe(new Date())).toMatch(/unsupported value type/)
    expect(checkCloneSafe(new Map())).toMatch(/unsupported value type/)
    expect(checkCloneSafe(new (class Widget {})())).toMatch(/unsupported value type/)
  })

  it('rejects circular references', () => {
    const a: Record<string, unknown> = {}
    a.self = a
    expect(checkCloneSafe(a)).toMatch(/not serializable/)
  })

  it('enforces the byte cap with a named violation', () => {
    const big = 'x'.repeat(PLUGIN_DATA_MAX_BYTES)
    expect(checkCloneSafe(big)).toMatch(/bytes — the cap is/)
    expect(checkCloneSafe('x'.repeat(PLUGIN_DATA_MAX_STRING - 1))).toBeNull()
  })

  it('enforces string, array, key and depth caps', () => {
    expect(checkCloneSafe('y'.repeat(PLUGIN_DATA_MAX_STRING + 1))).toMatch(/string longer than/)
    expect(checkCloneSafe(new Array(PLUGIN_DATA_MAX_ARRAY + 1).fill(0))).toMatch(/array longer than/)
    const wide: Record<string, number> = {}
    for (let i = 0; i <= PLUGIN_DATA_MAX_KEYS; i++) wide[`k${i}`] = i
    expect(checkCloneSafe(wide)).toMatch(/more than \d+ keys/)
    let deep: unknown = 0
    for (let i = 0; i < PLUGIN_DATA_MAX_DEPTH + 2; i++) deep = { d: deep }
    expect(checkCloneSafe(deep)).toMatch(/nested deeper than/)
  })

  it('rejects prototype-pollution key names (the JSON.parse attack)', () => {
    // object literals set a prototype; JSON.parse creates a genuine
    // own "__proto__" key — that is the shape a hostile payload has
    expect(checkCloneSafe(JSON.parse('{"__proto__": {"polluted": true}}'))).toMatch(/reserved key name/)
    expect(checkCloneSafe(JSON.parse('{"constructor": {"prototype": {"x": 1}}}'))).toMatch(/reserved key name/)
    expect(checkCloneSafe({ safe: { proto: 1 } })).toBeNull() // 'proto' alone is fine
  })
})
