// Unit tests for the font catalog (v0.17 Wave 2) — structure invariants
// the font dropdown, brand kit and on-demand loader depend on.

import { describe, it, expect } from 'vitest'
import { FONTS, PRELOADED_FONTS } from './catalog'

describe('font catalog (v0.17 Wave 2)', () => {
  it('ships 250+ families', () => {
    expect(FONTS.length).toBeGreaterThanOrEqual(250)
  })

  it('has unique families (one category per family)', () => {
    const families = FONTS.map((f) => f.family)
    expect(new Set(families).size).toBe(families.length)
  })

  it('every entry is well-formed', () => {
    for (const f of FONTS) {
      expect(f.family).toMatch(/^[A-Za-z0-9]+( [A-Za-z0-9]+)*$/)
      expect(f.label.length).toBeGreaterThan(0)
      expect(f.category).toMatch(/^(sans|serif|display|handwriting|mono)$/)
      // weights: comma-separated 3-digit numbers 100–900
      expect(f.weights).toMatch(/^(?:[1-9]00)(?:,[1-9]00)*$/)
    }
  })

  it('covers every category substantially', () => {
    const by: Record<string, number> = {}
    for (const f of FONTS) by[f.category] = (by[f.category] ?? 0) + 1
    expect(by.sans).toBeGreaterThanOrEqual(60)
    expect(by.serif).toBeGreaterThanOrEqual(40)
    expect(by.display).toBeGreaterThanOrEqual(80)
    expect(by.handwriting).toBeGreaterThanOrEqual(40)
    expect(by.mono).toBeGreaterThanOrEqual(15)
  })

  it('tracks the preloaded set accurately (every name is a catalog family)', () => {
    expect(PRELOADED_FONTS.size).toBeGreaterThanOrEqual(60)
    const families = new Set(FONTS.map((f) => f.family))
    for (const fam of PRELOADED_FONTS) {
      expect(families.has(fam), `${fam} in preload set but missing from catalog`).toBe(true)
    }
    for (const must of [
      'Inter', 'Poppins', 'Montserrat', 'Playfair Display', 'Abril Fatface',
      'Bebas Neue', 'Anton', 'Pacifico', 'Caveat', 'DM Mono', 'JetBrains Mono',
    ]) {
      expect(PRELOADED_FONTS.has(must), `${must} missing from preload set`).toBe(true)
    }
  })

  it('defaults used by docs & templates resolve to real catalog entries', () => {
    const families = new Set(FONTS.map((f) => f.family))
    for (const must of ['Inter', 'Poppins', 'Montserrat', 'Space Grotesk', 'Oswald', 'Playfair Display', 'Roboto Slab', 'Caveat', 'Abril Fatface', 'Anton']) {
      expect(families.has(must), `${must} missing`).toBe(true)
    }
  })
})
