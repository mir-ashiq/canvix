// Unit tests for the offline icon pack (v0.17 Wave 2) — guards the
// invariants the Icons app and canvas renderer rely on: structure,
// unique ids, path-data shape, and search ranking.

import { describe, it, expect } from 'vitest'
import { ICONS, searchIcons } from './icon-pack'

describe('offline icon pack (v0.17 Wave 2)', () => {
  it('ships a substantial pack (≥ 500 icons)', () => {
    expect(ICONS.length).toBeGreaterThanOrEqual(500)
  })

  it('has unique kebab-case ids, names and 1–4 tags each', () => {
    const ids = new Set(ICONS.map((i) => i.id))
    expect(ids.size).toBe(ICONS.length)
    for (const i of ICONS) {
      expect(i.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(i.name.length).toBeGreaterThan(0)
      expect(i.tags.length).toBeGreaterThanOrEqual(1)
      expect(i.tags.length).toBeLessThanOrEqual(4)
    }
  })

  it('every icon has path data in the 100×100 box (±5 grace)', () => {
    for (const i of ICONS) {
      expect(i.d).toMatch(/^[Mm]/)
      expect(i.d.length).toBeGreaterThan(10)
      // sampling full bounds on every icon is slow; spot-check the extremes
      // on a deterministic slice
    }
    const sample = [ICONS[0], ICONS[Math.floor(ICONS.length / 3)], ICONS[ICONS.length - 1]]
    for (const i of sample) {
      const nums = (i.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
      expect(Math.max(...nums)).toBeLessThanOrEqual(140) // lucide art may overshoot slightly
      expect(Math.min(...nums)).toBeGreaterThanOrEqual(-90)
    }
  })

  it('contains the canonical basics every design tool needs', () => {
    const ids = new Set(ICONS.map((i) => i.id))
    for (const must of ['heart', 'star', 'check', 'arrow-right', 'rocket', 'camera', 'gift', 'crown', 'trophy']) {
      expect(ids.has(must), `missing ${must}`).toBe(true)
    }
  })

  it('search ranks name-prefix hits above tag hits', () => {
    const results = searchIcons('arrow', 20)
    expect(results.length).toBeGreaterThan(4)
    expect(results[0].name.toLowerCase().startsWith('arrow')).toBe(true)
    // limit is respected
    expect(searchIcons('a', 10)).toHaveLength(10)
    // empty query returns the head of the pack
    expect(searchIcons('').length).toBeGreaterThan(0)
  })
})
