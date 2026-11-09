// Wave 4 — lib/inpaint.ts unit tests.
// Pyramid-diffusion reconstruction: constants, gradients, isolation.
import { describe, expect, it } from 'vitest'
import { inpaint, type Mask } from './inpaint'
import type { Raster } from './upscale'

function raster(w: number, h: number, fill: (x: number, y: number) => [number, number, number, number]): Raster {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fill(x, y)
      const i = (y * w + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = a
    }
  }
  return { data, width: w, height: h }
}

/** rectangular brush mask */
function rectMask(w: number, h: number, x0: number, y0: number, x1: number, y1: number): Mask {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      data[(y * w + x) * 4 + 3] = 255
    }
  }
  return { data, width: w, height: h }
}

describe('inpaint', () => {
  it('reconstructs a hole in a solid color exactly', () => {
    const src = raster(16, 16, () => [90, 140, 60, 255])
    // paint garbage in the hole region first — it must be ignored
    for (let y = 5; y <= 10; y++)
      for (let x = 5; x <= 10; x++) {
        const i = (y * 16 + x) * 4
        src.data[i] = 255
        src.data[i + 1] = 0
        src.data[i + 2] = 0
      }
    const mask = rectMask(16, 16, 5, 5, 10, 10)
    const out = inpaint(src, mask)
    for (let y = 5; y <= 10; y++) {
      for (let x = 5; x <= 10; x++) {
        const i = (y * 16 + x) * 4
        expect(out.data[i]).toBeLessThanOrEqual(92)
        expect(out.data[i]).toBeGreaterThanOrEqual(88)
        expect(out.data[i + 1]).toBeLessThanOrEqual(142)
        expect(out.data[i + 1]).toBeGreaterThanOrEqual(138)
        expect(out.data[i + 2]).toBeLessThanOrEqual(62)
        expect(out.data[i + 2]).toBeGreaterThanOrEqual(58)
        expect(out.data[i + 3]).toBe(255)
      }
    }
  })

  it('interpolates a linear gradient across the hole', () => {
    // horizontal ramp 0..255 over 32px
    const src = raster(32, 8, (x) => [x * 8, x * 8, x * 8, 255])
    const mask = rectMask(32, 8, 12, 2, 19, 5)
    const out = inpaint(src, mask)
    for (let y = 2; y <= 5; y++) {
      for (let x = 13; x <= 18; x++) {
        const i = (y * 32 + x) * 4
        const want = x * 8
        // diffusion converges toward the harmonic solution ≈ linear ramp
        expect(Math.abs(out.data[i] - want)).toBeLessThanOrEqual(12)
      }
    }
  })

  it('leaves pixels outside the mask byte-identical', () => {
    const src = raster(20, 20, (x, y) => [(x * 13 + y * 7) % 256, x, y, 255])
    const before = new Uint8ClampedArray(src.data)
    const mask = rectMask(20, 20, 8, 8, 12, 12)
    const out = inpaint(src, mask)
    for (let i = 0; i < 20 * 20; i++) {
      const inHole = i % 20 >= 8 && i % 20 <= 12 && Math.floor(i / 20) >= 8 && Math.floor(i / 20) <= 12
      if (inHole) continue
      expect(out.data[i * 4]).toBe(before[i * 4])
      expect(out.data[i * 4 + 3]).toBe(before[i * 4 + 3])
    }
  })

  it('returns a copy unchanged when the mask is empty', () => {
    const src = raster(8, 8, () => [1, 2, 3, 255])
    const mask = rectMask(8, 8, 0, 0, -1, -1) // empty (x1 < x0)
    const out = inpaint(src, mask)
    expect(Array.from(out.data)).toEqual(Array.from(src.data))
    expect(out.data).not.toBe(src.data)
  })

  it('keeps a fully transparent region transparent', () => {
    // left half opaque gradient, right half fully transparent; hole
    // entirely inside the transparent half
    const src = raster(24, 10, (x) =>
      x < 12 ? [10, 20, 30, 255] : [0, 0, 0, 0],
    )
    const mask = rectMask(24, 10, 15, 3, 20, 6)
    const out = inpaint(src, mask)
    for (let y = 3; y <= 6; y++) {
      for (let x = 15; x <= 20; x++) {
        const i = (y * 24 + x) * 4
        expect(out.data[i + 3]).toBeLessThanOrEqual(2)
      }
    }
  })

  it('fills a hole that covers an entire coarse block (mean seed path)', () => {
    // tiny image, hole covers more than half — the pyramid must seed
    // from the coarsest level mean rather than bilinear neighbours
    const src = raster(8, 8, (x, y) => [x < 4 ? 200 : 40, 100, 100, 255])
    const mask = rectMask(8, 8, 0, 0, 6, 6)
    const out = inpaint(src, mask)
    // every hole pixel is opaque and within the value range
    for (let y = 0; y <= 6; y++) {
      for (let x = 0; x <= 6; x++) {
        const i = (y * 8 + x) * 4
        expect(out.data[i + 3]).toBe(255)
        expect(out.data[i]).toBeLessThanOrEqual(210)
        expect(out.data[i]).toBeGreaterThanOrEqual(30)
      }
    }
  })

  it('rejects a mask whose geometry does not match', () => {
    const src = raster(4, 4, () => [0, 0, 0, 255])
    const mask = rectMask(5, 4, 0, 0, 1, 1)
    expect(() => inpaint(src, mask)).toThrow()
    expect(() => inpaint({ data: new Uint8ClampedArray(0), width: 0, height: 0 }, rectMask(0, 0, 0, 0, -1, -1))).toThrow()
  })

  it('is deterministic', () => {
    const src = raster(18, 18, (x, y) => [(x * 5) % 256, (y * 9) % 256, 77, 255])
    const mask = rectMask(18, 18, 4, 4, 12, 12)
    const a = inpaint(src, mask)
    const b = inpaint(src, mask)
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
  })
})
