// ─────────────────────────────────────────────────────────────
// v0.14 (D3): even-distribution geometry — the acceptance suite.
//
//   1. < 3 boxes = no-op (nothing to space evenly)
//   2. equal boxes: gaps come out equal, extremes stay fixed
//   3. unequal boxes: gaps still equal (that IS the contract)
//   4. output is in INPUT order, patching only the distributed axis
//   5. vertical axis mirrors horizontal exactly
//   6. overlapping boxes still distribute (gap < 0, no refusal)
//   7. integer positions, no drift, span preserved, no NaN
//   8. degenerate input (all stacked, zero size) stays finite
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import { distributeEvenly, type DistributableBox } from '@/lib/distribute'

const box = (x: number, y: number, w = 100, h = 50): DistributableBox => ({ x, y, width: w, height: h })

function gapsX(boxes: DistributableBox[]): number[] {
  const sorted = [...boxes].sort((a, b) => a.x - b.x)
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i].x - (sorted[i - 1].x + sorted[i - 1].width))
  return gaps
}

describe('distributeEvenly', () => {
  it('is a no-op for fewer than 3 boxes (positions returned verbatim)', () => {
    const one = [box(10, 20)]
    expect(distributeEvenly(one, 'x')).toEqual([{ x: 10, y: 20 }])
    const two = [box(0, 0), box(500, 300)]
    expect(distributeEvenly(two, 'x')).toEqual([{ x: 0, y: 0 }, { x: 500, y: 300 }])
    expect(distributeEvenly(two, 'y')).toEqual([{ x: 0, y: 0 }, { x: 500, y: 300 }])
  })

  it('equalizes gaps and keeps the extremes exactly where they were', () => {
    const boxes = [box(0, 0), box(400, 0), box(500, 0)] // gaps 300, 0
    const out = distributeEvenly(boxes, 'x')
    expect(out[0].x).toBe(0) // first fixed
    expect(out[2].x).toBe(500) // last fixed
    const moved = [
      { ...boxes[0], x: out[0].x },
      { ...boxes[1], x: out[1].x },
      { ...boxes[2], x: out[2].x },
    ]
    const gaps = gapsX(moved)
    expect(gaps[0]).toBe(gaps[1]) // 150 each
    expect(gaps[0]).toBe(150)
    expect(out.every((p) => p.y === 0)).toBe(true) // other axis untouched
  })

  it('equalizes gaps for UNEQUAL box sizes (the real contract)', () => {
    const boxes = [box(0, 0, 100), box(350, 0, 200), box(600, 0, 50), box(1400, 0, 300)]
    const out = distributeEvenly(boxes, 'x')
    expect(out[0].x).toBe(0)
    expect(out[3].x).toBe(1400) // last leading edge fixed
    const moved = boxes.map((b, i) => ({ ...b, x: out[i].x }))
    const gaps = gapsX(moved)
    // span 1700, sizes 650 → gap = (1700-650)/3 = 350 exactly
    expect(gaps).toEqual([350, 350, 350])
  })

  it('returns positions in INPUT order and only moves the distributed axis', () => {
    const boxes = [box(900, 7, 40), box(0, 3, 60), box(300, 11, 80)] // deliberately unsorted input
    const outX = distributeEvenly(boxes, 'x')
    expect(outX.map((p) => p.y)).toEqual([7, 3, 11]) // y passed through
    const outY = distributeEvenly(boxes, 'y')
    expect(outY.map((p) => p.x)).toEqual([900, 0, 300]) // x passed through
    // the input array itself is never mutated
    expect(boxes[1].x).toBe(0)
  })

  it('mirrors the geometry exactly on the vertical axis', () => {
    const hBoxes = [box(0, 0, 100, 40), box(400, 0, 100, 40), box(500, 0, 100, 40)]
    const vBoxes = [box(0, 0, 40, 100), box(0, 400, 40, 100), box(0, 500, 40, 100)]
    const hOut = distributeEvenly(hBoxes, 'x')
    const vOut = distributeEvenly(vBoxes, 'y')
    expect(vOut.map((p) => p.y)).toEqual(hOut.map((p) => p.x))
    expect(vOut.map((p) => p.x)).toEqual([0, 0, 0])
  })

  it('still distributes when boxes overlap (negative gap, no refusal)', () => {
    // three 200-wide boxes stacked on nearly the same spot
    const boxes = [box(0, 0, 200), box(10, 0, 200), box(20, 0, 200)]
    const out = distributeEvenly(boxes, 'x')
    expect(out[0].x).toBe(0)
    expect(out[2].x).toBe(20)
    const moved = boxes.map((b, i) => ({ ...b, x: out[i].x }))
    const gaps = gapsX(moved)
    expect(gaps[0]).toBe(gaps[1]) // evenly MORE overlapped — still even
    expect(gaps[0]).toBeLessThan(0)
  })

  it('produces integer positions with no drift and preserves the span', () => {
    const boxes = [box(0, 0, 33), box(111, 0, 77), box(222, 0, 11), box(333, 0, 99), box(444, 0, 55)]
    const out = distributeEvenly(boxes, 'x')
    for (const p of out) expect(Number.isInteger(p.x)).toBe(true)
    const minX = Math.min(...out.map((p) => p.x))
    const maxFar = Math.max(...out.map((p, i) => p.x + boxes[i].width))
    expect(minX).toBe(0)
    expect(maxFar).toBe(499) // 444 + 55 — the span is invariant
    const moved = boxes.map((b, i) => ({ ...b, x: out[i].x }))
    const gaps = gapsX(moved)
    for (const g of gaps) expect(Math.abs(g - gaps[0])).toBeLessThanOrEqual(1) // ≤ 1px rounding
  })

  it('is finite and gap-free on degenerate stacked zero-size input', () => {
    const boxes = [box(10, 10, 0, 0), box(10, 10, 0, 0), box(10, 10, 0, 0)]
    const out = distributeEvenly(boxes, 'x')
    for (const p of out) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
    }
    // zero span + zero sizes → gap 0 → everyone stays
    expect(out.map((p) => p.x)).toEqual([10, 10, 10])
  })

  it('handles zero-gap perfect input without moving anything', () => {
    const boxes = [box(0, 0, 100), box(100, 0, 100), box(200, 0, 100), box(300, 0, 100)]
    const out = distributeEvenly(boxes, 'x')
    expect(out.map((p) => p.x)).toEqual([0, 100, 200, 300])
  })
})
