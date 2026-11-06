import { describe, expect, it } from 'vitest'
import { buildNearestLUT, medianCutPalette } from './palette'

function rgb(...triples: number[]): Uint8Array {
  return new Uint8Array(triples)
}

describe('medianCutPalette', () => {
  it('passes distinct colours through untouched in first-seen order', () => {
    const p = medianCutPalette(rgb(10, 20, 30, 200, 100, 50, 1, 1, 1))
    expect(p.size).toBe(3)
    expect(Array.from(p.colors)).toEqual([10, 20, 30, 200, 100, 50, 1, 1, 1])
  })

  it('returns a single black entry for empty input', () => {
    const p = medianCutPalette(new Uint8Array(0))
    expect(p.size).toBe(1)
    expect(Array.from(p.colors)).toEqual([0, 0, 0])
  })

  it('caps at 256 colours and only emits colours that were sampled', () => {
    const samples = new Uint8Array(300 * 3)
    for (let i = 0; i < 300; i++) {
      samples[i * 3] = i
      samples[i * 3 + 1] = (i * 7) % 256
      samples[i * 3 + 2] = (i * 13) % 256
    }
    const p = medianCutPalette(samples)
    expect(p.size).toBe(256)
    const seen = new Set<string>()
    for (let i = 0; i < 300; i++) seen.add(`${samples[i * 3]},${samples[i * 3 + 1]},${samples[i * 3 + 2]}`)
    for (let i = 0; i < p.size; i++) {
      expect(seen.has(`${p.colors[i * 3]},${p.colors[i * 3 + 1]},${p.colors[i * 3 + 2]}`)).toBe(true)
    }
  })

  it('keeps the most-popular colour of each box (never invents colours)', () => {
    // 60 samples of pure red, 30 of pure blue, 10 of pure green →
    // two boxes must resolve to red and blue (the popular pair)
    const samples: number[] = []
    for (let i = 0; i < 60; i++) samples.push(255, 0, 0)
    for (let i = 0; i < 30; i++) samples.push(0, 0, 255)
    for (let i = 0; i < 10; i++) samples.push(0, 255, 0)
    const p = medianCutPalette(new Uint8Array(samples), 2)
    expect(p.size).toBe(2)
    const got = new Set([`${p.colors[0]},${p.colors[1]},${p.colors[2]}`, `${p.colors[3]},${p.colors[4]},${p.colors[5]}`])
    expect(got.has('255,0,0')).toBe(true)
    expect(got.has('0,0,255')).toBe(true)
  })

  it('sorts palette entries by descending popularity (short LZW codes first)', () => {
    const samples: number[] = []
    for (let i = 0; i < 100; i++) samples.push(9, 9, 9)
    for (let i = 0; i < 5; i++) samples.push(250, 250, 250)
    const p = medianCutPalette(new Uint8Array(samples))
    expect([p.colors[0], p.colors[1], p.colors[2]]).toEqual([9, 9, 9])
  })

  it('is deterministic for a mixed input', () => {
    const samples = new Uint8Array(999 * 3)
    let s = 12345
    for (let i = 0; i < samples.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      samples[i] = s % 256
    }
    const a = medianCutPalette(samples)
    const b = medianCutPalette(new Uint8Array(samples))
    expect(a.size).toBe(b.size)
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors))
  })

  it('rejects malformed sample arrays', () => {
    expect(() => medianCutPalette(new Uint8Array([1, 2]))).toThrow(/multiple of 3/)
  })
})

describe('buildNearestLUT', () => {
  it('maps every 5-bit-distinct palette colour to its own index', () => {
    // entries on distinct 5-bit bins (multiples of 8)
    const p = medianCutPalette(rgb(0, 0, 0, 64, 128, 192, 248, 248, 248))
    const lut = buildNearestLUT(p)
    const bins = [0, (64 >> 3) << 10 | (128 >> 3) << 5 | (192 >> 3), (248 >> 3) << 10 | (248 >> 3) << 5 | (248 >> 3)]
    bins.forEach((bin, i) => expect(lut[bin]).toBe(i))
  })

  it('snaps a query colour to the nearest palette entry', () => {
    const p = medianCutPalette(rgb(0, 0, 0, 240, 240, 240))
    const lut = buildNearestLUT(p)
    expect(lut[(100 >> 3) << 10 | (100 >> 3) << 5 | (100 >> 3)]).toBe(0)
    expect(lut[(200 >> 3) << 10 | (200 >> 3) << 5 | (200 >> 3)]).toBe(1)
  })

  it('covers all 32768 bins with valid indices', () => {
    const p = medianCutPalette(rgb(3, 6, 9, 100, 150, 200))
    const lut = buildNearestLUT(p)
    let ok = 0
    for (let i = 0; i < 32768; i++) if (lut[i] === 0 || lut[i] === 1) ok++
    expect(ok).toBe(32768)
  })

  it('rejects a malformed palette', () => {
    expect(() => buildNearestLUT({ colors: new Uint8Array(3), size: 5 })).toThrow(/malformed/)
  })
})
