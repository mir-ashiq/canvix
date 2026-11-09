import { describe, it, expect } from 'vitest'
import {
  polygonPoints,
  starPointsEx,
  maskPolygon,
  isMaskShape,
  isParametricMask,
  scalePts,
  ptsToSvg,
  tracePts,
  MASK_SHAPES,
  clampInt,
  clampNum,
} from '@/lib/shapes'

// ── polygons ─────────────────────────────────────────────────

describe('polygonPoints', () => {
  it('emits exactly `sides` vertices', () => {
    for (const n of [3, 5, 6, 8, 12]) {
      expect(polygonPoints(n)).toHaveLength(n)
    }
  })

  it('clamps sides to 3..12', () => {
    expect(polygonPoints(2)).toHaveLength(3)
    expect(polygonPoints(0)).toHaveLength(3)
    expect(polygonPoints(99)).toHaveLength(12)
    expect(polygonPoints(NaN)).toHaveLength(3)
  })

  it('keeps every vertex inside the 100×100 authoring box', () => {
    for (const [x, y] of polygonPoints(7)) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(100)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(100)
    }
  })

  it('places the first vertex at the top (x ≈ centre, y < centre)', () => {
    const [x, y] = polygonPoints(5)[0]
    expect(Math.abs(x - 50)).toBeLessThan(0.001)
    expect(y).toBeLessThan(50)
  })

  it('is deterministic (same input → same output)', () => {
    expect(polygonPoints(6)).toEqual(polygonPoints(6))
  })
})

// ── stars ────────────────────────────────────────────────────

describe('starPointsEx', () => {
  it('emits 2 × points vertices (outer/inner alternating)', () => {
    expect(starPointsEx(5)).toHaveLength(10)
    expect(starPointsEx(16)).toHaveLength(32)
  })

  it('clamps points to 3..16 and ratio to 0.15..0.85', () => {
    expect(starPointsEx(2)).toHaveLength(6)
    expect(starPointsEx(100)).toHaveLength(32)
    // ratio clamped, not thrown
    const pts = starPointsEx(5, 99)
    expect(pts).toHaveLength(10)
    const rs = pts.map(([x, y]) => Math.hypot(x - 50, y - 50))
    expect(Math.max(...rs)).toBeLessThanOrEqual(48.001)
  })

  it('alternates outer (r=48) and inner radii per the ratio', () => {
    const pts = starPointsEx(6, 0.5)
    for (let i = 0; i < pts.length; i++) {
      const r = Math.hypot(pts[i][0] - 50, pts[i][1] - 50)
      if (i % 2 === 0) expect(r).toBeCloseTo(48, 0)
      else expect(r).toBeCloseTo(24, 0)
    }
  })

  it('default ratio is the classic 0.55 (pre-v0.18 look)', () => {
    const pts = starPointsEx(5)
    const r = Math.hypot(pts[1][0] - 50, pts[1][1] - 50)
    expect(r).toBeCloseTo(48 * 0.55, 0)
  })
})

// ── masks ────────────────────────────────────────────────────

describe('maskPolygon', () => {
  it('returns null for "none" and unknown shapes', () => {
    expect(maskPolygon('none')).toBeNull()
    // @ts-expect-error hostile input
    expect(maskPolygon('evil-shape')).toBeNull()
  })

  it('every preset yields a closed, sane polygon in the 100-box', () => {
    for (const shape of MASK_SHAPES) {
      if (shape === 'none') continue
      const pts = maskPolygon(shape, 6, 0.55)
      expect(pts, `mask ${shape}`).not.toBeNull()
      expect(pts!.length).toBeGreaterThanOrEqual(3)
      for (const [x, y] of pts!) {
        expect(x).toBeGreaterThanOrEqual(-1)
        expect(x).toBeLessThanOrEqual(101)
        expect(y).toBeGreaterThanOrEqual(-1)
        expect(y).toBeLessThanOrEqual(101)
      }
    }
  })

  it('heart is non-convex (some cross products flip sign)', () => {
    const pts = maskPolygon('heart')!
    const crosses: number[] = []
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i]
      const [x2, y2] = pts[(i + 1) % pts.length]
      const [x3, y3] = pts[(i + 2) % pts.length]
      crosses.push((x2 - x1) * (y3 - y2) - (y2 - y1) * (x3 - x2))
    }
    const pos = crosses.filter((c) => c > 0).length
    const neg = crosses.filter((c) => c < 0).length
    expect(pos).toBeGreaterThan(0)
    expect(neg).toBeGreaterThan(0)
  })

  it('blob is deterministic (fixed seed — every replica renders the same)', () => {
    expect(maskPolygon('blob')).toEqual(maskPolygon('blob'))
  })

  it('parametric masks honour sides', () => {
    expect(maskPolygon('poly', 8)!.length).toBe(8)
    expect(maskPolygon('polyStar', 7)!.length).toBe(14)
  })
})

describe('isMaskShape / isParametricMask', () => {
  it('validates membership', () => {
    expect(isMaskShape('circle')).toBe(true)
    expect(isMaskShape('nope')).toBe(false)
    expect(isMaskShape(undefined)).toBe(false)
    expect(isMaskShape(42)).toBe(false)
  })

  it('flags the two parametric modes', () => {
    expect(isParametricMask('poly')).toBe(true)
    expect(isParametricMask('polyStar')).toBe(true)
    expect(isParametricMask('circle')).toBe(false)
  })
})

// ── transforms ───────────────────────────────────────────────

describe('scalePts / ptsToSvg / tracePts', () => {
  it('scales the 100-box into an element box with offset', () => {
    const out = scalePts([[0, 0], [100, 100]], 10, 20, 200, 100)
    expect(out[0]).toEqual([10, 20])
    expect(out[1]).toEqual([210, 120])
  })

  it('emits "x,y x,y" pairs', () => {
    expect(ptsToSvg([[1.234, 2.567], [3, 4]])).toBe('1.23,2.57 3,4')
  })

  it('tracePts walks a canvas-like context', () => {
    const calls: string[] = []
    const ctx = {
      beginPath: () => calls.push('begin'),
      moveTo: (x: number, y: number) => calls.push(`m${x},${y}`),
      lineTo: (x: number, y: number) => calls.push(`l${x},${y}`),
      closePath: () => calls.push('close'),
    }
    tracePts(ctx, [[0, 0], [50, 100]], 100, 50)
    expect(calls[0]).toBe('begin')
    expect(calls[1]).toBe('m0,0')
    expect(calls[2]).toBe('l50,50')
    expect(calls.at(-1)).toBe('close')
  })
})

describe('numeric clamps', () => {
  it('clampInt rounds + bounds', () => {
    expect(clampInt(5.7, 3, 12)).toBe(6)
    expect(clampInt(1, 3, 12)).toBe(3)
    expect(clampInt('x', 3, 12, 8)).toBe(8)
  })

  it('clampNum bounds', () => {
    expect(clampNum(0.9, 0.15, 0.85)).toBe(0.85)
    expect(clampNum(0.3, 0.15, 0.85)).toBe(0.3)
  })
})
