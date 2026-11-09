// Wave 4 — lib/upscale.ts unit tests.
// Lanczos-3 resampling: geometry, alpha discipline, determinism.
import { describe, expect, it } from 'vitest'
import { clampFactor, factorFor, lanczosUpscale, type Raster } from './upscale'

/** solid-color raster */
function solid(w: number, h: number, rgba: [number, number, number, number]): Raster {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgba[0]
    data[i * 4 + 1] = rgba[1]
    data[i * 4 + 2] = rgba[2]
    data[i * 4 + 3] = rgba[3]
  }
  return { data, width: w, height: h }
}

describe('clampFactor', () => {
  it('clamps to 1..4 and floors non-integers', () => {
    expect(clampFactor(0)).toBe(1)
    expect(clampFactor(-3)).toBe(1)
    expect(clampFactor(NaN)).toBe(1)
    expect(clampFactor(1.9)).toBe(1)
    expect(clampFactor(2)).toBe(2)
    expect(clampFactor(4)).toBe(4)
    expect(clampFactor(9)).toBe(4)
    expect(clampFactor(Infinity)).toBe(4)
  })
})

describe('factorFor', () => {
  it('never lets a side exceed the output cap', () => {
    // 5000px side: 2x would be 10000 > 8192 → capped to 1
    expect(factorFor(5000, 100, 2)).toBe(1)
    // 3000px side: 2x = 6000 ok, 4x = 12000 no → 2
    expect(factorFor(3000, 100, 4)).toBe(2)
    expect(factorFor(100, 100, 3)).toBe(3)
  })
})

describe('lanczosUpscale', () => {
  it('factor 1 returns an equal copy (and a copy, not the same buffer)', () => {
    const src = solid(3, 2, [10, 20, 30, 255])
    const out = lanczosUpscale(src, 1)
    expect(out.width).toBe(3)
    expect(out.height).toBe(2)
    expect(Array.from(out.data)).toEqual(Array.from(src.data))
    expect(out.data).not.toBe(src.data)
  })

  it('produces the exact target geometry', () => {
    const src = solid(5, 3, [200, 10, 10, 255])
    const out = lanczosUpscale(src, 3)
    expect(out.width).toBe(15)
    expect(out.height).toBe(9)
    expect(out.data.length).toBe(15 * 9 * 4)
  })

  it('keeps a solid opaque image solid (Lanczos preserves constants)', () => {
    const src = solid(4, 4, [120, 60, 200, 255])
    const out = lanczosUpscale(src, 2)
    for (let i = 0; i < out.width * out.height; i++) {
      expect(out.data[i * 4]).toBeCloseTo(120, 0)
      expect(out.data[i * 4 + 1]).toBeCloseTo(60, 0)
      expect(out.data[i * 4 + 2]).toBeCloseTo(200, 0)
      expect(out.data[i * 4 + 3]).toBe(255)
    }
  })

  it('preserves a horizontal color step within kernel tolerance', () => {
    // left half red, right half blue; upscaling must keep the plateau
    // colors and place the transition between the halves
    const w = 8
    const src: Raster = { data: new Uint8ClampedArray(w * 2 * 4), width: w, height: 2 }
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const red = x < w / 2
        src.data[i] = red ? 255 : 0
        src.data[i + 1] = 0
        src.data[i + 2] = red ? 0 : 255
        src.data[i + 3] = 255
      }
    }
    const out = lanczosUpscale(src, 4)
    // far-left plateau stays red, far-right stays blue
    const left = 1 * 4
    const right = (out.width - 2) * 4
    expect(out.data[left]).toBeGreaterThan(240)
    expect(out.data[left + 2]).toBeLessThan(15)
    expect(out.data[right]).toBeLessThan(15)
    expect(out.data[right + 2]).toBeGreaterThan(240)
  })

  it('does not bleed transparent-pixel colors into opaque regions', () => {
    // a fully transparent GREEN column next to opaque RED columns —
    // without premultiplication the red edge turns muddy
    const w = 6
    const src: Raster = { data: new Uint8ClampedArray(w * 1 * 4), width: w, height: 1 }
    for (let x = 0; x < w; x++) {
      const i = x * 4
      if (x === 3) {
        src.data[i] = 0
        src.data[i + 1] = 255
        src.data[i + 2] = 0
        src.data[i + 3] = 0
      } else {
        src.data[i] = 255
        src.data[i + 1] = 0
        src.data[i + 2] = 0
        src.data[i + 3] = 255
      }
    }
    const out = lanczosUpscale(src, 2)
    // the opaque plateau must stay pure red; alpha stays opaque there
    const i = 2 * 4 // destination x=2 (source x=1 area)
    expect(out.data[i + 3]).toBe(255)
    expect(out.data[i + 1]).toBeLessThan(30) // no green bleed
    expect(out.data[i]).toBeGreaterThan(225)
  })

  it('is deterministic — same input, same output', () => {
    const src = solid(7, 5, [1, 2, 3, 200])
    // vary a couple of pixels
    src.data[0] = 250
    src.data[9] = 9
    const a = lanczosUpscale(src, 2)
    const b = lanczosUpscale(src, 2)
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
  })

  it('rejects empty rasters and mismatched buffers', () => {
    expect(() => lanczosUpscale({ data: new Uint8ClampedArray(0), width: 0, height: 4 }, 2)).toThrow()
    expect(() =>
      lanczosUpscale({ data: new Uint8ClampedArray(4), width: 4, height: 4 }, 2),
    ).toThrow()
  })

  it('handles odd dimensions', () => {
    const src = solid(3, 5, [9, 9, 9, 255])
    const out = lanczosUpscale(src, 3)
    expect(out.width).toBe(9)
    expect(out.height).toBe(15)
  })
})
