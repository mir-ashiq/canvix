import { describe, expect, it } from 'vitest'
import { GifWriter } from './gif-encoder'
import { medianCutPalette, type GifPalette } from './palette'
import { lzwDecode } from './lzw.test'

function paletteOf(...triples: number[]): GifPalette {
  return medianCutPalette(new Uint8Array(triples))
}

function ascii(bytes: Uint8Array, start: number, len: number): string {
  return String.fromCharCode(...Array.from(bytes.subarray(start, start + len)))
}

/** walk the container: header/LSD/GCT/loop block, then per-frame
 *  GCE + image descriptor + LZW sub-blocks; returns the delays and
 *  the reassembled LZW stream of each frame */
function walkGif(bytes: Uint8Array): {
  version: string
  width: number
  height: number
  gctEntries: number
  loop: number | null
  delays: number[]
  frames: Uint8Array[]
  minCodeSize: number[]
  trailerAt: number
} {
  expect(ascii(bytes, 0, 6)).toMatch(/^GIF8[79]a$/)
  const version = ascii(bytes, 0, 6).slice(3)
  const width = bytes[6] | (bytes[7] << 8)
  const height = bytes[8] | (bytes[9] << 8)
  const packed = bytes[10]
  let pos = 13
  let gctEntries = 0
  if (packed & 0x80) {
    gctEntries = 2 << (packed & 0x07)
    pos += gctEntries * 3
  }
  let loop: number | null = null
  const delays: number[] = []
  const frames: Uint8Array[] = []
  const minCodeSize: number[] = []
  for (;;) {
    const b = bytes[pos]
    if (b === 0x3b) break
    if (b === 0x21) {
      const label = bytes[pos + 1]
      pos += 2
      if (label === 0xff) {
        expect(bytes[pos]).toBe(11)
        expect(ascii(bytes, pos + 1, 11)).toBe('NETSCAPE2.0')
        expect(bytes[pos + 12]).toBe(3)
        expect(bytes[pos + 13]).toBe(1)
        loop = bytes[pos + 14] | (bytes[pos + 15] << 8)
        expect(bytes[pos + 16]).toBe(0)
        pos += 17
      } else if (label === 0xf9) {
        expect(bytes[pos]).toBe(4)
        delays.push(bytes[pos + 2] | (bytes[pos + 3] << 8))
        expect(bytes[pos + 4]).toBe(0)
        pos += 6 // size + 4-byte payload + terminator
      } else {
        while (bytes[pos] !== 0) pos += 1 + bytes[pos]
        pos += 1
      }
    } else if (b === 0x2c) {
      pos += 1
      const l = bytes[pos] | (bytes[pos + 1] << 8)
      const t = bytes[pos + 2] | (bytes[pos + 3] << 8)
      const w = bytes[pos + 4] | (bytes[pos + 5] << 8)
      const h = bytes[pos + 6] | (bytes[pos + 7] << 8)
      expect([l, t, w, h]).toEqual([0, 0, width, height])
      expect(bytes[pos + 8]).toBe(0) // no local table, no interlace
      pos += 9
      const mcs = bytes[pos]
      pos += 1
      const chunks: number[] = []
      while (bytes[pos] !== 0) {
        const len = bytes[pos]
        expect(len).toBeLessThanOrEqual(255)
        for (let i = 0; i < len; i++) chunks.push(bytes[pos + 1 + i])
        pos += 1 + len
      }
      pos += 1
      minCodeSize.push(mcs)
      frames.push(new Uint8Array(chunks))
    } else {
      throw new Error(`walkGif: unknown block 0x${b.toString(16)} at ${pos}`)
    }
  }
  return { version, width, height, gctEntries, loop, delays, frames, minCodeSize, trailerAt: pos }
}

describe('GifWriter container', () => {
  it('writes the exact header / LSD / GCT / loop bytes for a 2-colour image', () => {
    const p = paletteOf(0, 0, 0, 255, 255, 255)
    const w = new GifWriter({ width: 2, height: 2, palette: p })
    w.addFrame(new Uint8Array([0, 1, 1, 0]), 8)
    const bytes = w.finish()
    expect(ascii(bytes, 0, 6)).toBe('GIF89a')
    // LSD: 2×2 canvas, GCT present | colour resolution 7 | size field 0
    expect(Array.from(bytes.subarray(6, 13))).toEqual([2, 0, 2, 0, 0xf0, 0, 0])
    // GCT: the two palette colours, padded to 2 entries
    expect(Array.from(bytes.subarray(13, 19))).toEqual([0, 0, 0, 255, 255, 255])
    // NETSCAPE2.0 loop-forever block, byte for byte
    expect(Array.from(bytes.subarray(19, 38))).toEqual([
      0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, 0x03, 0x01, 0x00, 0x00, 0x00,
    ])
    // GCE (disposal 1, delay 8cs) + image descriptor
    expect(Array.from(bytes.subarray(38, 46))).toEqual([0x21, 0xf9, 0x04, 0x04, 8, 0, 0x00, 0x00])
    expect(Array.from(bytes.subarray(46, 56))).toEqual([0x2c, 0, 0, 0, 0, 2, 0, 2, 0, 0x00])
    expect(bytes[bytes.length - 1]).toBe(0x3b)
  })

  it('round-trips frames through the independent decoder with correct delays', () => {
    const p = paletteOf(255, 0, 0, 0, 255, 0, 0, 0, 255)
    const w = new GifWriter({ width: 4, height: 3, palette: p, loopCount: 0 })
    const f0 = new Uint8Array(12).fill(0)
    const f1 = new Uint8Array(12).fill(2)
    const f2 = new Uint8Array([0, 1, 2, 0, 1, 2, 2, 1, 0, 2, 1, 0])
    w.addFrame(f0, 10)
    w.addFrame(f1, 5)
    w.addFrame(f2, 7)
    const bytes = w.finish()
    const walk = walkGif(bytes)
    expect(walk.loop).toBe(0)
    expect(walk.delays).toEqual([10, 5, 7])
    expect(walk.frames.length).toBe(3)
    expect(walk.minCodeSize).toEqual([2, 2, 2]) // 3 palette entries pad to 4 → mcs 2
    expect(Array.from(lzwDecode(walk.frames[0], 2, 12))).toEqual(Array.from(f0))
    expect(Array.from(lzwDecode(walk.frames[1], 2, 12))).toEqual(Array.from(f1))
    expect(Array.from(lzwDecode(walk.frames[2], 2, 12))).toEqual(Array.from(f2))
    expect(walk.trailerAt).toBe(bytes.length - 1) // nothing after the trailer
  })

  it('pads a 137-colour palette to 256 entries and uses minCodeSize 8', () => {
    const triples: number[] = []
    for (let i = 0; i < 137; i++) {
      triples.push((i * 3) % 256, (i * 5) % 256, (i * 7) % 256)
    }
    const p = medianCutPalette(new Uint8Array(triples))
    expect(p.size).toBe(137)
    const w = new GifWriter({ width: 4, height: 1, palette: p })
    w.addFrame(new Uint8Array([0, 136, 50, 50]), 4)
    const bytes = w.finish()
    const walk = walkGif(bytes)
    expect(walk.gctEntries).toBe(256)
    expect(walk.minCodeSize).toEqual([8])
  })

  it('keeps a 1-colour palette legal (padded to 2, mcs 2)', () => {
    const p = medianCutPalette(new Uint8Array([9, 9, 9]))
    const w = new GifWriter({ width: 2, height: 1, palette: p })
    w.addFrame(new Uint8Array([0, 0]), 4)
    const walk = walkGif(w.finish())
    expect(walk.gctEntries).toBe(2)
    expect(walk.minCodeSize).toEqual([2])
  })

  it('chunks LZW output into ≤255-byte sub-blocks and reassembles losslessly', () => {
    // 128×64 2-colour TRUE noise (xorshift — an LCG's low bit merely
    // alternates and compresses to nothing): LZW output lands well
    // past 255 bytes, and the 2-symbol alphabet still exhausts the
    // 4096-entry table mid-stream
    const p = paletteOf(0, 0, 0, 255, 255, 255)
    const px = new Uint8Array(128 * 64)
    let s = 42
    for (let i = 0; i < px.length; i++) {
      s ^= s << 13
      s ^= s >>> 17
      s ^= s << 5
      px[i] = s & 1
    }
    const w = new GifWriter({ width: 128, height: 64, palette: p })
    w.addFrame(px, 4)
    const bytes = w.finish()
    const walk = walkGif(bytes)
    expect(walk.frames[0].length).toBeGreaterThan(255)
    expect(Array.from(lzwDecode(walk.frames[0], 2, px.length))).toEqual(Array.from(px))
  })

  it('exposes byteLength and frames for the orchestrator cap checks', () => {
    const p = paletteOf(0, 0, 0, 255, 255, 255)
    const w = new GifWriter({ width: 64, height: 64, palette: p })
    const before = w.byteLength
    w.addFrame(new Uint8Array(64 * 64), 4)
    expect(w.frames).toBe(1)
    expect(w.byteLength).toBeGreaterThan(before)
  })

  it('fails closed on every misuse', () => {
    const p = paletteOf(0, 0, 0, 255, 255, 255)
    const w = new GifWriter({ width: 2, height: 2, palette: p })
    expect(() => new GifWriter({ width: 0, height: 2, palette: p })).toThrow(/width/)
    expect(() => new GifWriter({ width: 2, height: 2, palette: { colors: new Uint8Array(0), size: 0 } })).toThrow(/palette/)
    expect(() => new GifWriter({ width: 2, height: 2, palette: p, loopCount: -1 })).toThrow(/loopCount/)
    expect(() => w.addFrame(new Uint8Array([0, 1]), 4)).toThrow(/expected 4/)
    expect(() => w.addFrame(new Uint8Array([0, 1, 2, 0]), 4)).toThrow(/outside/) // index 2 ≥ size 2
    expect(() => w.addFrame(new Uint8Array(4), 1.5)).toThrow(/delayCs/)
    const done = new GifWriter({ width: 2, height: 2, palette: p })
    done.finish()
    expect(() => done.addFrame(new Uint8Array(4), 4)).toThrow(/finish/)
    expect(() => done.finish()).toThrow(/finish/)
  })

  it('is deterministic end to end', () => {
    const p = paletteOf(10, 20, 30, 200, 100, 50, 1, 2, 3, 250, 250, 250)
    const build = (): Uint8Array => {
      const w = new GifWriter({ width: 8, height: 8, palette: p })
      for (let f = 0; f < 3; f++) {
        const px = new Uint8Array(64)
        for (let i = 0; i < 64; i++) px[i] = (i + f) % 4
        w.addFrame(px, 6)
      }
      return w.finish()
    }
    expect(Array.from(build())).toEqual(Array.from(build()))
  })
})
