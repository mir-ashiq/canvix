// Wave 4 — MCP vision grounding normalizer tests.
import { describe, expect, it } from 'vitest'
import { MAX_GROUNDED, normalizeGrounding, visionGroundPrompt } from './vision-ground'

describe('normalizeGrounding', () => {
  it('normalizes bounds, maps to pixels, keeps colors', () => {
    const g = normalizeGrounding(
      {
        description: 'Hero layout with  headline on top.',
        elements: [
          { label: 'Summer Sale', role: 'headline', bounds: { x: 0.1, y: 0.05, w: 0.8, h: 0.15 }, color: '#ff00aa' },
          { label: 'product photo', role: 'image', bounds: { x: '0.2', y: '0.3', width: 0.6, height: 0.5 } },
        ],
      },
      1000,
      500,
    )
    expect(g.description).toBe('Hero layout with headline on top.')
    expect(g.elements).toHaveLength(2)
    const [headline, photo] = g.elements
    expect(headline.px).toEqual({ x: 100, y: 25, w: 800, h: 75 })
    expect(headline.color).toBe('#FF00AA')
    // string numbers + width/height aliases work too
    expect(photo.px).toEqual({ x: 200, y: 150, w: 600, h: 250 })
    expect(photo.color).toBeUndefined()
  })

  it('clamps fractions, drops junk, caps the inventory', () => {
    const g = normalizeGrounding(
      {
        elements: [
          { label: 'x', bounds: { x: -5, y: 2, w: 0.5, h: 0.5 } }, // clamped
          { label: '', bounds: { x: 0, y: 0, w: 0.5, h: 0.5 } }, // no label → dropped
          { label: 'y', bounds: { x: 'junk' } }, // no box → dropped
          { label: 'z' }, // no bounds → dropped
          ...Array.from({ length: 60 }, (_, i) => ({
            label: `e${i}`,
            bounds: { x: 0, y: 0, w: 0.1, h: 0.1 },
          })),
        ],
      },
      100,
      100,
    )
    expect(g.elements.length).toBeLessThanOrEqual(MAX_GROUNDED)
    expect(g.elements[0].box.x).toBe(0)
    expect(g.elements.every((e) => e.label)).toBe(true)
  })

  it('is total on garbage input', () => {
    expect(() => normalizeGrounding(null, 10, 10)).not.toThrow()
    expect(normalizeGrounding('junk', 10, 10).elements).toEqual([])
    expect(normalizeGrounding({}, 10, 10).description).toBe('')
  })
})

describe('visionGroundPrompt', () => {
  it('pins the JSON contract and carries the focus question', () => {
    const s = visionGroundPrompt('where is the logo?')
    expect(s).toContain('{"description"')
    expect(s).toContain('FRACTIONS')
    expect(s).toContain('where is the logo?')
    expect(visionGroundPrompt()).not.toContain('Pay special attention')
  })
})
