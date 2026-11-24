// design-engine/typography.ts — pairing selection + modular scale.
import { describe, expect, it } from 'vitest'
import { assignTypeScale, PAIRINGS, selectPairing } from './typography'
import { FONTS } from '@/lib/editor-utils'

describe('selectPairing', () => {
  it('honors pinned families that exist in the catalog', () => {
    const { pairing } = selectPairing({ heading: 'Oswald', body: 'Lato' }, 'warm')
    expect(pairing.heading).toBe('Oswald')
    expect(pairing.body).toBe('Lato')
  })
  it('falls back when a pinned family is not in the catalog', () => {
    const { pairing } = selectPairing({ heading: 'Not A Font', body: 'Inter' }, 'cool')
    expect(PAIRINGS.some((p) => p.id === pairing.id)).toBe(true)
  })
  it('maps mood to a pairing; every catalog mood resolves', () => {
    const cool = selectPairing({}, 'cool')
    expect(cool.pairing.moods).toContain('cool')
    const neutral = selectPairing({}, 'neutral')
    expect(neutral.pairing).toBeTruthy()
  })
  it('every pairing family exists in the live catalog', () => {
    for (const p of PAIRINGS) {
      expect(FONTS.some((f) => f.family === p.heading), p.heading).toBe(true)
      expect(FONTS.some((f) => f.family === p.body), p.body).toBe(true)
    }
  })
})

describe('assignTypeScale', () => {
  it('sizes follow the hierarchy: headline > subline > cta > label', () => {
    const t = assignTypeScale({ scale: 1.333 }, 'neutral', 1080)
    expect(t.sizes.headline).toBeGreaterThan(t.sizes.subline)
    expect(t.sizes.subline).toBeGreaterThan(t.sizes.cta)
    expect(t.sizes.cta).toBeGreaterThan(t.sizes.label)
    expect(t.sizes.body).toBeGreaterThanOrEqual(14)
  })
  it('scales with the canvas width', () => {
    const small = assignTypeScale({}, 'neutral', 400)
    const large = assignTypeScale({}, 'neutral', 1080)
    expect(large.sizes.body).toBeGreaterThan(small.sizes.body)
  })
  it('is deterministic', () => {
    expect(assignTypeScale({ scale: 1.618 }, 'warm', 1080)).toEqual(
      assignTypeScale({ scale: 1.618 }, 'warm', 1080),
    )
  })
})
