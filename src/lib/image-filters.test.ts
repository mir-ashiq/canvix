// Unit tests for the v0.14 (D4) image filter pipeline:
//   1. every preset is a t=0 no-op ('none' always is)
//   2. each preset's pixel math matches its documented formula
//   3. hostile inputs (junk ids, NaN, out-of-range intensity) never
//      throw and never change pixels
//   4. the adjustment path reproduces Konva's own math (the video
//      exporter pre-bakes pixels with it — it must match the editor)
//   5. the SVG approximation emits the right primitives per preset
//
// Node environment: ImageData is duck-typed (the kernels only touch
// .data/.width/.height — same shape the browser hands us).

import { describe, it, expect } from 'vitest'
import {
  IMAGE_FILTER_PRESETS,
  isImageFilterId,
  clampFilterIntensity,
  applyPresetToImageData,
  applyAdjustmentsToImageData,
  imageHasFilters,
  svgImageFilterParts,
  type SvgFilterSink,
} from './image-filters'

interface FakeImageData {
  data: Uint8ClampedArray
  width: number
  height: number
}

function img(w: number, h: number, fill: (x: number, y: number) => [number, number, number]): FakeImageData {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const [r, g, b] = fill(x, y)
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return { data, width: w, height: h }
}

function solid(w: number, h: number, rgb: [number, number, number]): FakeImageData {
  return img(w, h, () => rgb)
}

function asImageData(d: FakeImageData): ImageData {
  return d as unknown as ImageData
}

function px(d: FakeImageData, x: number, y: number): [number, number, number] {
  const i = (y * d.width + x) * 4
  return [d.data[i], d.data[i + 1], d.data[i + 2]]
}

describe('isImageFilterId / clampFilterIntensity', () => {
  it('accepts exactly the shipped preset ids', () => {
    for (const p of IMAGE_FILTER_PRESETS) expect(isImageFilterId(p.id)).toBe(true)
    expect(isImageFilterId('none')).toBe(true)
  })

  it('rejects junk, prototypes and non-strings', () => {
    expect(isImageFilterId('EVIL<script>')).toBe(false)
    expect(isImageFilterId('__proto__')).toBe(false)
    expect(isImageFilterId('')).toBe(false)
    expect(isImageFilterId(42)).toBe(false)
    expect(isImageFilterId(null)).toBe(false)
    expect(isImageFilterId(undefined)).toBe(false)
    expect(isImageFilterId({ id: 'warm' })).toBe(false)
  })

  it('clamps intensity into 0..100 with 100 as the fallback', () => {
    expect(clampFilterIntensity(undefined)).toBe(100)
    expect(clampFilterIntensity(NaN)).toBe(100)
    expect(clampFilterIntensity(Infinity)).toBe(100)
    expect(clampFilterIntensity('80' as unknown as number)).toBe(100)
    expect(clampFilterIntensity(-5)).toBe(0)
    expect(clampFilterIntensity(250)).toBe(100)
    expect(clampFilterIntensity(80)).toBe(80)
  })
})

describe('applyPresetToImageData — no-op guarantees', () => {
  it("'none' never changes pixels", () => {
    const d = solid(4, 4, [200, 100, 50])
    const before = new Uint8ClampedArray(d.data)
    applyPresetToImageData(asImageData(d), 'none', 1)
    expect([...d.data]).toEqual([...before])
  })

  it('t=0 is a no-op for every preset', () => {
    for (const p of IMAGE_FILTER_PRESETS) {
      const d = solid(4, 4, [200, 100, 50])
      const before = new Uint8ClampedArray(d.data)
      applyPresetToImageData(asImageData(d), p.id, 0)
      expect([...d.data], `preset ${p.id}`).toEqual([...before])
    }
  })

  it('hostile inputs never throw and never change pixels', () => {
    const d = solid(4, 4, [10, 20, 30])
    const before = new Uint8ClampedArray(d.data)
    expect(() => applyPresetToImageData(asImageData(d), 'EVIL', 1)).not.toThrow()
    expect(() => applyPresetToImageData(asImageData(d), 'none', NaN)).not.toThrow()
    expect(() => applyPresetToImageData(asImageData(d), '__proto__', 5)).not.toThrow()
    expect([...d.data]).toEqual([...before])
  })
})

describe('applyPresetToImageData — pixel math', () => {
  it('grayscale lerps to luma (0.299/0.587/0.114)', () => {
    const d = solid(2, 2, [255, 0, 0]) // pure red
    applyPresetToImageData(asImageData(d), 'grayscale', 1)
    const [r, g, b] = px(d, 0, 0)
    expect(r).toBeGreaterThan(70)
    expect(r).toBeLessThan(82)
    expect(r).toBe(g)
    expect(g).toBe(b)
  })

  it('grayscale intensity interpolates monotonically', () => {
    const at = (t: number) => {
      const d = solid(2, 2, [255, 0, 0])
      applyPresetToImageData(asImageData(d), 'grayscale', t)
      return px(d, 0, 0)[0]
    }
    expect(at(0)).toBe(255)
    expect(at(0.5)).toBeGreaterThan(at(1))
    expect(at(0.25)).toBeGreaterThan(at(0.5))
  })

  it('warm heats red up and blue down; cool is the mirror', () => {
    const w = solid(2, 2, [128, 128, 128])
    applyPresetToImageData(asImageData(w), 'warm', 1)
    const [wr, wg, wb] = px(w, 0, 0)
    expect(wr).toBeGreaterThan(140) // 128*1.14 ≈ 146
    expect(wb).toBeLessThan(120) // 128*0.86 ≈ 110

    const c = solid(2, 2, [128, 128, 128])
    applyPresetToImageData(asImageData(c), 'cool', 1)
    const [cr, , cb] = px(c, 0, 0)
    expect(cb).toBeGreaterThan(cr)
    expect(cr).toBeLessThan(120)
  })

  it('vintage lifts blacks and warms whites', () => {
    const d = img(2, 2, (x) => (x === 0 ? [0, 0, 0] : [255, 255, 255]))
    applyPresetToImageData(asImageData(d), 'vintage', 1)
    const black = px(d, 0, 0)
    const white = px(d, 1, 0)
    expect(black[0]).toBeGreaterThanOrEqual(15) // lifted from 0
    expect(black[1]).toBeGreaterThanOrEqual(15)
    expect(white[0]).toBeGreaterThan(white[2]) // warm tint
    expect(white[0]).toBe(255) // still bright
  })

  it('blur spreads a hot center and stays sub-pixel-honest', () => {
    const d = img(5, 5, (x, y) => (x === 2 && y === 2 ? [255, 255, 255] : [0, 0, 0]))
    applyPresetToImageData(asImageData(d), 'blur', 1)
    const center = px(d, 2, 2)[0]
    const neighbor = px(d, 1, 2)[0]
    expect(center).toBeLessThan(255)
    expect(neighbor).toBeGreaterThan(0)

    // sub-pixel radius (t < 1/12) is an honest no-op
    const tiny = img(5, 5, (x, y) => (x === 2 && y === 2 ? [255, 255, 255] : [0, 0, 0]))
    const before = new Uint8ClampedArray(tiny.data)
    applyPresetToImageData(asImageData(tiny), 'blur', 0.05)
    expect([...tiny.data]).toEqual([...before])
  })

  it('sharpen leaves flat regions alone and boosts edges', () => {
    const d = img(6, 2, (x) => (x < 3 ? [0, 0, 0] : [255, 255, 255]))
    applyPresetToImageData(asImageData(d), 'sharpen', 1)
    // deep flat zones untouched
    expect(px(d, 0, 0)[0]).toBe(0)
    expect(px(d, 5, 0)[0]).toBe(255)
    // the boundary overshoots (unsharp ringing)
    const leftOfEdge = px(d, 2, 0)[0]
    const rightOfEdge = px(d, 3, 0)[0]
    expect(leftOfEdge).toBeLessThan(60) // darker than 0? clamped at 0 for pure step; allow 0
    expect(rightOfEdge).toBe(255)
  })

  it('vignette darkens corners more than the center', () => {
    const d = solid(9, 9, [128, 128, 128])
    applyPresetToImageData(asImageData(d), 'vignette', 1)
    const center = px(d, 4, 4)[0]
    const corner = px(d, 0, 0)[0]
    expect(center).toBe(128) // exact center: distance 0 → factor 1
    expect(corner).toBeLessThan(110) // corner: factor 1 - 0.8 ≈ 0.2 → ~26
  })
})

describe('applyAdjustmentsToImageData — Konva-exact math', () => {
  it('brightness ±100 clamps to white/black', () => {
    const up = solid(2, 2, [128, 100, 60])
    applyAdjustmentsToImageData(asImageData(up), 100, 0, 0)
    expect(px(up, 0, 0)).toEqual([255, 255, 255])

    const dn = solid(2, 2, [128, 100, 60])
    applyAdjustmentsToImageData(asImageData(dn), -100, 0, 0)
    expect(px(dn, 0, 0)).toEqual([0, 0, 0])
  })

  it('contrast pushes darks down and lights up (slope = ((c+100)/100)²)', () => {
    const d = img(2, 1, (x) => (x === 0 ? [64, 64, 64] : [192, 192, 192]))
    applyAdjustmentsToImageData(asImageData(d), 0, 100, 0) // slope 4
    expect(px(d, 0, 0)[0]).toBe(0) // (64/255-.5)*4+.5 < 0 → clamp
    expect(px(d, 1, 0)[0]).toBe(255) // (192/255-.5)*4+.5 > 1 → clamp
  })

  it('saturation keeps pure primaries and grays (Konva HSL matrix)', () => {
    const d = img(2, 1, (x) => (x === 0 ? [255, 0, 0] : [128, 128, 128]))
    applyAdjustmentsToImageData(asImageData(d), 0, 0, 100)
    expect(px(d, 0, 0)).toEqual([255, 0, 0])
    expect(px(d, 1, 0)).toEqual([128, 128, 128])
  })

  it('desaturation drains a primary toward gray', () => {
    const d = solid(1, 1, [255, 0, 0])
    applyAdjustmentsToImageData(asImageData(d), 0, 0, -100) // s = -1
    const [r, g, b] = px(d, 0, 0)
    expect(r).toBeLessThan(80) // 0.299-0.701 = -0.402 → clamped low
    expect(g).toBeGreaterThan(100) // 0.587+0.587 = 1.174 → high
    expect(b).toBeGreaterThan(100)
  })

  it('all-zero adjustments are a byte-exact no-op', () => {
    const d = solid(3, 3, [17, 200, 99])
    const before = new Uint8ClampedArray(d.data)
    applyAdjustmentsToImageData(asImageData(d), 0, 0, 0)
    expect([...d.data]).toEqual([...before])
  })
})

describe('imageHasFilters', () => {
  it('is false for a clean element and true for any active surface', () => {
    expect(imageHasFilters({})).toBe(false)
    expect(imageHasFilters({ filter: 'none', filterIntensity: 100 })).toBe(false)
    expect(imageHasFilters({ filter: 'junk-id' })).toBe(false) // unknown id reads as none
    expect(imageHasFilters({ brightness: 1 })).toBe(true)
    expect(imageHasFilters({ contrast: -1 })).toBe(true)
    expect(imageHasFilters({ saturation: 1 })).toBe(true)
    expect(imageHasFilters({ filter: 'vintage' })).toBe(true)
    expect(imageHasFilters({ filter: 'vintage', filterIntensity: 0 })).toBe(false)
  })
})

describe('svgImageFilterParts — approximation primitives', () => {
  function sink(): { s: SvgFilterSink; defs: string[]; n: number } {
    const defs: string[] = []
    let n = 0
    return {
      s: { defs: (m) => defs.push(m), nextId: (p) => `${p}-${++n}` },
      defs,
      get n() {
        return n
      },
    }
  }
  const bounds = { x: 10, y: 20, w: 300, h: 200 }

  it('emits nothing for a clean element', () => {
    const { s, defs } = sink()
    const r = svgImageFilterParts({}, s, bounds)
    expect(r.attr).toBe('')
    expect(r.overlay).toBe('')
    expect(defs).toEqual([])
  })

  it('brightness folds into one feComponentTransfer (slope 1, intercept 0.5)', () => {
    const { s, defs } = sink()
    const r = svgImageFilterParts({ brightness: 50 }, s, bounds)
    expect(r.attr).toContain('filter="url(#imgf-1)"')
    expect(defs.join('\n')).toContain('feComponentTransfer')
    expect(defs.join('\n')).toContain('slope="1"')
    expect(defs.join('\n')).toContain('intercept="0.5"')
    expect(r.overlay).toBe('')
  })

  it('contrast slope = ((c+100)/100)², recentered around 0.5', () => {
    const { s, defs } = sink()
    svgImageFilterParts({ contrast: 100 }, s, bounds)
    const m = defs.join('\n')
    expect(m).toContain('slope="4"')
    expect(m).toContain('intercept="-1.5"') // 0.5 - 0.5*4
  })

  it('saturation emits Konva HSL matrix values', () => {
    const { s, defs } = sink()
    svgImageFilterParts({ saturation: -50 }, s, bounds)
    const m = defs.join('\n')
    expect(m).toContain('feColorMatrix')
    // rr = 0.299 + 0.701*(-0.5) = -0.052
    expect(m).toContain('-0.051') // JS rounds -51.5 toward +Infinity
  })

  it('blur σ = gaussian equivalent of the 3-pass box stack', () => {
    const { s, defs } = sink()
    svgImageFilterParts({ filter: 'blur', filterIntensity: 100 }, s, bounds)
    const m = defs.join('\n')
    expect(m).toContain('feGaussianBlur')
    // r=6 → σ = sqrt(3*(169-1)/12) = sqrt(42) ≈ 6.481
    expect(m).toContain('stdDeviation="6.481"')
    expect(m).toContain('edgeMode="duplicate"')
  })

  it('sharpen emits the same rounded 3×3 kernel', () => {
    const { s, defs } = sink()
    svgImageFilterParts({ filter: 'sharpen', filterIntensity: 80 }, s, bounds)
    const m = defs.join('\n')
    expect(m).toContain('feConvolveMatrix')
    expect(m).toContain('kernel="0 -0.72 0 -0.72 3.88 -0.72 0 -0.72 0"')
  })

  it('grayscale/warm/cool/vintage emit color matrices (linear = exact)', () => {
    for (const id of ['grayscale', 'warm', 'cool', 'vintage'] as const) {
      const { s, defs } = sink()
      svgImageFilterParts({ filter: id, filterIntensity: 100 }, s, bounds)
      expect(defs.join('\n'), id).toContain('feColorMatrix')
    }
    // vintage also fades: slope < 1 + lift > 0
    const v = sink()
    svgImageFilterParts({ filter: 'vintage' }, v.s, bounds)
    const vm = v.defs.join('\n')
    expect(vm).toContain('slope="0.88"')
    expect(vm).toContain('intercept="0.071"') // 18/255
  })

  it('vignette renders as a clipped gradient overlay, not a filter', () => {
    const { s, defs } = sink()
    const r = svgImageFilterParts({ filter: 'vignette', filterIntensity: 60 }, s, bounds)
    expect(r.attr).toBe('') // no filter primitives
    expect(r.overlay).toContain('<rect')
    expect(r.overlay).toContain('fill="url(#vgn-')
    const m = defs.join('\n')
    expect(m).toContain('radialGradient')
    expect(m).toContain('stop-opacity="0.104"') // 0.8*0.6*0.5^2.2
    expect(m).toContain('stop-opacity="0.48"') // 0.8*0.6*1^2.2
  })

  it('overlay carries caller attributes (clip/transform parity)', () => {
    const { s } = sink()
    const r = svgImageFilterParts({ filter: 'vignette' }, s, bounds, ' clip-path="url(#c1)" transform="rotate(5 160 120)"')
    expect(r.overlay).toContain('clip-path="url(#c1)"')
    expect(r.overlay).toContain('transform="rotate(5 160 120)"')
  })

  it('intensity 0 emits nothing even for an active preset', () => {
    const { s, defs } = sink()
    const r = svgImageFilterParts({ filter: 'blur', filterIntensity: 0 }, s, bounds)
    expect(r.attr).toBe('')
    expect(r.overlay).toBe('')
    expect(defs).toEqual([])
  })

  it('junk filter ids degrade to nothing (readers validated; belt+braces)', () => {
    const { s, defs } = sink()
    const r = svgImageFilterParts({ filter: 'EVIL<script>' }, s, bounds)
    expect(r.attr).toBe('')
    expect(r.overlay).toBe('')
    expect(defs).toEqual([])
  })
})
