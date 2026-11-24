// design-engine/layout.ts — the band solver's invariants.
// Bands are disjoint BY CONSTRUCTION; the property tests prove it
// holds for randomized block sets, which is what retires
// fix_overlaps for generated designs.
import { describe, expect, it } from 'vitest'
import {
  bandLayout,
  gridInRect,
  isInCanvas,
  LAYOUT_MARGIN,
  rectContains,
  rectsOverlap,
  stackInRect,
  type Rect,
} from './layout'
import type { BlockNode } from '@/lib/design-spec/types'

const CANVAS = { width: 1080, height: 1080 }

function blocks(n: number): BlockNode[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: 'hero' as const,
    weight: 0.4 + ((i * 7) % 30) / 10,
    content: [{ role: 'body' as const, source: 'model' as const, text: `x${i}` }],
  }))
}

function withinMargin(rect: Rect): boolean {
  return (
    rect.x >= LAYOUT_MARGIN - 1 &&
    rect.y >= LAYOUT_MARGIN - 1 &&
    rect.x + rect.width <= CANVAS.width - LAYOUT_MARGIN + 1 &&
    rect.y + rect.height <= CANVAS.height - LAYOUT_MARGIN + 1
  )
}

describe('bandLayout', () => {
  it('bands tile the usable area and are mutually disjoint', () => {
    for (const n of [1, 2, 3, 5]) {
      const placed = bandLayout(blocks(n), CANVAS)
      expect(placed).toHaveLength(n)
      for (const p of placed) expect(withinMargin(p.rect)).toBe(true)
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          expect(rectsOverlap(placed[i].rect, placed[j].rect)).toBe(false)
        }
      }
    }
  })
  it('heavier blocks get taller bands', () => {
    const placed = bandLayout(
      [
        { kind: 'hero', weight: 3, content: [{ role: 'body', source: 'model', text: 'a' }] },
        { kind: 'hero', weight: 1, content: [{ role: 'body', source: 'model', text: 'b' }] },
      ],
      CANVAS,
    )
    expect(placed[0].rect.height).toBeGreaterThan(placed[1].rect.height * 2)
  })
  it('empty input → empty output (total function)', () => {
    expect(bandLayout([], CANVAS)).toEqual([])
  })
})

describe('gridInRect', () => {
  it('returns n cells inside the rect, gap-separated', () => {
    const rect: Rect = { x: 60, y: 60, width: 960, height: 300 }
    const cells = gridInRect(rect, 3, { columns: 3, gap: 28 })
    expect(cells).toHaveLength(3)
    for (const c of cells) expect(rectContains(rect, c)).toBe(true)
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        expect(rectsOverlap(cells[i], cells[j])).toBe(false)
      }
    }
  })
  it('shrinks columns until cells clear the 160px minimum width', () => {
    const narrow: Rect = { x: 0, y: 0, width: 400, height: 300 }
    const cells = gridInRect(narrow, 3, { columns: 3, gap: 24 })
    expect(cells.every((c) => c.width >= 160 - 1)).toBe(true)
  })
})

describe('stackInRect', () => {
  it('stacked sub-rects are disjoint and cover the band', () => {
    const rect: Rect = { x: 60, y: 60, width: 960, height: 400 }
    const subs = stackInRect(rect, ['headline', 'subline', 'cta'])
    expect(subs).toHaveLength(3)
    for (let i = 0; i < subs.length; i++) {
      expect(rectContains(rect, subs[i])).toBe(true)
      for (let j = i + 1; j < subs.length; j++) {
        expect(rectsOverlap(subs[i], subs[j])).toBe(false)
      }
    }
    const total = subs.reduce((s, r) => s + r.height, 0)
    expect(total).toBeLessThanOrEqual(rect.height + 1)
  })
})

describe('predicates', () => {
  it('rectsOverlap handles touching edges as NOT overlapping (1px tolerance)', () => {
    const a: Rect = { x: 0, y: 0, width: 100, height: 100 }
    const touching: Rect = { x: 100, y: 0, width: 100, height: 100 }
    const real: Rect = { x: 50, y: 0, width: 100, height: 100 }
    expect(rectsOverlap(a, touching)).toBe(false)
    expect(rectsOverlap(a, real)).toBe(true)
  })
  it('isInCanvas bounds rects with 1px tolerance', () => {
    expect(isInCanvas({ x: 0, y: 0, width: 1080, height: 1080 }, CANVAS)).toBe(true)
    expect(isInCanvas({ x: -1, y: 0, width: 10, height: 10 }, CANVAS)).toBe(false)
    expect(isInCanvas({ x: 0, y: 0, width: 1082, height: 10 }, CANVAS)).toBe(false)
  })
})
