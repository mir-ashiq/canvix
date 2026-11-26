/**
 * v0.32.7 · SPATIAL INTELLIGENCE — the 2D canvas map's contracts.
 * Pure geometry: rotation-aware AABBs, intentional layering (a card
 * behind its text is NOT a collision), section-scale band blocking,
 * free regions, hierarchy. Deterministic — no model in the loop.
 */
import { describe, expect, it } from 'vitest'
import {
  aabb,
  elementBoxes,
  intentionalOverlaps,
  freeVerticalBands,
  freeRegions2D,
  hierarchyLines,
  spatialCtx,
  isIntentional,
  overlapArea,
} from './spatial'
import type { AgentDesignCtx } from './context'

const W = 1080
const H = 1080
const d = (elements: unknown[]): AgentDesignCtx =>
  ({ name: 'S', width: W, height: H, elements }) as never as AgentDesignCtx

describe('spatial · rotation-aware AABB', () => {
  it('an unrotated box is unchanged', () => {
    expect(aabb(10, 20, 100, 50)).toEqual({ x: 10, y: 20, w: 100, h: 50 })
  })
  it('a 90° rotation swaps the extents around the center', () => {
    // 200x100 rotated 90° about its center keeps the center and
    // becomes 100x200
    const b = aabb(0, 0, 200, 100, 90)
    expect(Math.round(b.w)).toBe(100)
    expect(Math.round(b.h)).toBe(200)
    expect(Math.round(b.x + b.w / 2)).toBe(100) // center x preserved
    expect(Math.round(b.y + b.h / 2)).toBe(50) // center y preserved
  })
  it('a 45° rotation expands to w·√2/… (max coverage)', () => {
    const b = aabb(0, 0, 100, 100, 45)
    expect(b.w).toBeCloseTo(100 * Math.SQRT2, 0)
    expect(b.h).toBeCloseTo(100 * Math.SQRT2, 0)
  })
  it('elementBoxes expands a rotated element to its true footprint', () => {
    const boxes = elementBoxes(d([{ id: 'r', type: 'rect', x: 100, y: 100, width: 300, height: 100, rotation: 90 }]))
    expect(boxes).toHaveLength(1)
    expect(Math.round(boxes[0].w)).toBe(100)
    expect(Math.round(boxes[0].h)).toBe(300)
  })
})

describe('spatial · intentional layering is NOT a defect', () => {
  it('a card behind its text (≥80% contained) is intentional', () => {
    const boxes = elementBoxes(d([
      { id: 'card', type: 'rect', x: 100, y: 400, width: 400, height: 200 },
      { id: 'label', type: 'text', x: 120, y: 440, width: 360, height: 60, text: 'Feature one' },
    ]))
    const pairs = intentionalOverlaps(boxes, W, H)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({ back: { id: 'card' }, front: { id: 'label' }, kind: 'backing-card' })
    expect(isIntentional(pairs, 'card', 'label')).toBe(true)
  })
  it('a near-page-size backdrop behind anything is intentional', () => {
    const boxes = elementBoxes(d([
      { id: 'bg', type: 'rect', x: 0, y: 0, width: 1080, height: 1080 },
      { id: 'hero', type: 'text', x: 200, y: 100, width: 680, height: 200, text: 'Hero' },
    ]))
    expect(intentionalOverlaps(boxes, W, H)[0]).toMatchObject({ kind: 'backdrop' })
  })
  it('two same-layer elements side by side are NOT intentional (genuine collision stays a finding)', () => {
    const boxes = elementBoxes(d([
      { id: 'a', type: 'text', x: 100, y: 100, width: 500, height: 120, text: 'Headline' },
      { id: 'b', type: 'rect', x: 300, y: 140, width: 500, height: 200 },
    ]))
    // 55% contained at most — not a container; overlap exists but is genuine
    expect(overlapArea(boxes[0], boxes[1])).toBeGreaterThan(0)
    expect(isIntentional(intentionalOverlaps(boxes, W, H), 'a', 'b')).toBe(false)
  })
})

describe('spatial · vertical bands + partials (the plan solver feed)', () => {
  it('only section-scale elements (≥40% page width) block bands', () => {
    const { occupied, partials } = freeVerticalBands(d([
      { id: 'wide', type: 'text', x: 140, y: 65, width: 800, height: 200, text: 'Headline' },
      { id: 'tiny', type: 'icon', x: 460, y: 500, width: 160, height: 120 },
    ]))
    expect(occupied).toEqual([{ y: 65, h: 200, label: 'Headline' }])
    expect(partials.join(' ')).toContain('160x120 icon')
  })
  it('close blocking elements merge into one band (<40px gap)', () => {
    const { occupied } = freeVerticalBands(d([
      { id: 'a', type: 'rect', x: 0, y: 65, width: 900, height: 200 },
      { id: 'b', type: 'rect', x: 0, y: 300, width: 900, height: 100 },
    ]))
    expect(occupied).toEqual([{ y: 65, h: 335 }])
  })
  it('spatialCtx carries occupied + partials + freeRegions for ToolContext', () => {
    const ctx = spatialCtx(d([{ id: 'a', type: 'rect', x: 0, y: 65, width: 1080, height: 300 }]))
    expect(ctx.occupied).toHaveLength(1)
    expect(ctx.freeRegions.length).toBeGreaterThanOrEqual(1)
    expect(ctx.freeRegions[0].y).toBeGreaterThanOrEqual(365)
  })
})

describe('spatial · 2D free regions', () => {
  it('finds the free right half when the left half is occupied', () => {
    const regions = freeRegions2D(d([{ id: 'panel', type: 'rect', x: 0, y: 65, width: 500, height: 950 }]))
    expect(regions[0].x).toBeGreaterThanOrEqual(500)
    expect(regions[0].w).toBeGreaterThan(400)
  })
  it('an empty canvas yields the full safe area as the largest region', () => {
    const regions = freeRegions2D(d([]))
    expect(regions[0]).toMatchObject({ x: 65, y: 65, w: 950, h: 950 })
  })
})

describe('spatial · visual hierarchy', () => {
  it('reports the descending size ladder', () => {
    const lines = hierarchyLines(d([
      { id: 'h', type: 'text', x: 0, y: 65, width: 800, height: 140, fontSize: 96, text: 'Big headline' },
      { id: 's', type: 'text', x: 0, y: 300, width: 600, height: 40, fontSize: 30, text: 'Subline' },
    ]))
    expect(lines[0]).toContain('96px "Big headline" → 30px "Subline"')
    expect(lines).toHaveLength(1) // no flat-hierarchy advisory (96 ≫ 30)
  })
  it('flags a flat hierarchy as advisory', () => {
    const lines = hierarchyLines(d([
      { id: 'h', type: 'text', x: 0, y: 65, width: 800, height: 80, fontSize: 34, text: 'Meh headline' },
      { id: 'b1', type: 'text', x: 0, y: 200, width: 600, height: 40, fontSize: 32, text: 'body one' },
      { id: 'b2', type: 'text', x: 0, y: 300, width: 600, height: 40, fontSize: 30, text: 'body two' },
    ]))
    expect(lines.some((l) => l.startsWith('ADVISORY: flat hierarchy'))).toBe(true)
  })
})
