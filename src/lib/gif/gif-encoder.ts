// ─────────────────────────────────────────────────────────────
// GIF89a container writer (v0.15 R5) — hand-rolled, zero deps
// (the R2 WebM-muxer pattern applied to GIF). Frames stream in
// one at a time so the orchestrator can enforce the byte cap
// DURING the encode: a too-big export aborts early instead of
// wasting the whole render.
//
// Layout written:
//   "GIF89a" · Logical Screen Descriptor · Global Color Table
//   · NETSCAPE2.0 loop extension (loop forever by default)
//   · per frame: Graphic Control Extension (delay, disposal)
//                · Image Descriptor · LZW sub-blocks
//   · trailer 0x3B
// ─────────────────────────────────────────────────────────────

import { lzwEncode } from './lzw'
import type { GifPalette } from './palette'

/** smallest power of two ≥ n, floored at 2 (the GIF minimum) */
function pow2AtLeast(n: number): number {
  let p = 2
  while (p < n) p <<= 1
  return p
}

/** log2 of a power-of-two ≥ 2 (exact — no float log involved) */
function log2Pow2(p: number): number {
  return 31 - Math.clz32(p)
}

class ByteBuf {
  private buf = new Uint8Array(4096)
  private len = 0

  get length(): number {
    return this.len
  }

  private ensure(extra: number): void {
    if (this.len + extra <= this.buf.length) return
    let cap = this.buf.length * 2
    while (cap < this.len + extra) cap *= 2
    const grown = new Uint8Array(cap)
    grown.set(this.buf.subarray(0, this.len))
    this.buf = grown
  }

  pushByte(b: number): void {
    this.ensure(1)
    this.buf[this.len++] = b & 0xff
  }

  pushBytes(bytes: Uint8Array): void {
    this.ensure(bytes.length)
    this.buf.set(bytes, this.len)
    this.len += bytes.length
  }

  pushUint16LE(v: number): void {
    this.pushByte(v & 0xff)
    this.pushByte((v >> 8) & 0xff)
  }

  pushAscii(s: string): void {
    for (let i = 0; i < s.length; i++) this.pushByte(s.charCodeAt(i))
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.len)
  }
}

export interface GifWriterOptions {
  width: number
  height: number
  palette: GifPalette
  /** NETSCAPE loop count — 0 (the default) means loop forever */
  loopCount?: number
}

/** Streaming GIF89a writer. `addFrame` takes palette indices (one
 *  per pixel, row-major, top-down); `finish` seals the file. */
export class GifWriter {
  readonly width: number
  readonly height: number
  private readonly palette: GifPalette
  private readonly minCodeSize: number
  private readonly buf = new ByteBuf()
  private frameCount = 0
  private finished = false

  constructor(opts: GifWriterOptions) {
    // fail-closed validation of every field the format constrains
    if (!Number.isInteger(opts.width) || opts.width < 1 || opts.width > 0xffff) {
      throw new Error(`GifWriter: width must be an integer 1..65535, got ${opts.width}`)
    }
    if (!Number.isInteger(opts.height) || opts.height < 1 || opts.height > 0xffff) {
      throw new Error(`GifWriter: height must be an integer 1..65535, got ${opts.height}`)
    }
    if (opts.palette.size < 1 || opts.palette.colors.length < opts.palette.size * 3) {
      throw new Error('GifWriter: malformed palette')
    }
    const loop = opts.loopCount ?? 0
    if (!Number.isInteger(loop) || loop < 0 || loop > 0xffff) {
      throw new Error(`GifWriter: loopCount must be an integer 0..65535, got ${loop}`)
    }
    this.width = opts.width
    this.height = opts.height
    this.palette = opts.palette

    // the Global Color Table must be a power-of-two size; pad with
    // black (padded entries are never referenced by any index)
    const padded = pow2AtLeast(opts.palette.size)
    this.minCodeSize = Math.max(2, log2Pow2(padded))
    const sizeField = log2Pow2(padded) - 1 // 3 bits in the LSD

    this.buf.pushAscii('GIF89a')
    // Logical Screen Descriptor: GCT present, colour resolution 7,
    // no sort, GCT size field; background index 0 (never visible —
    // every frame is a full opaque rectangle); square pixels
    this.buf.pushUint16LE(opts.width)
    this.buf.pushUint16LE(opts.height)
    this.buf.pushByte(0x80 | 0x70 | sizeField)
    this.buf.pushByte(0)
    this.buf.pushByte(0)
    // Global Color Table, zero-padded to the declared size
    const gct = new Uint8Array(padded * 3)
    gct.set(opts.palette.colors.subarray(0, opts.palette.size * 3))
    this.buf.pushBytes(gct)
    // NETSCAPE2.0 loop extension — the de-facto standard block
    // every browser/social platform honors (0 = loop forever)
    this.buf.pushBytes(new Uint8Array([0x21, 0xff, 0x0b]))
    this.buf.pushAscii('NETSCAPE2.0')
    this.buf.pushBytes(new Uint8Array([0x03, 0x01]))
    this.buf.pushUint16LE(loop)
    this.buf.pushByte(0)
  }

  get byteLength(): number {
    return this.buf.length
  }

  get frames(): number {
    return this.frameCount
  }

  addFrame(indices: Uint8Array, delayCs: number): void {
    if (this.finished) throw new Error('GifWriter: finish() was already called')
    const n = this.width * this.height
    if (indices.length !== n) {
      throw new Error(`GifWriter.addFrame: expected ${n} palette indices, got ${indices.length}`)
    }
    if (!Number.isInteger(delayCs) || delayCs < 0 || delayCs > 0xffff) {
      throw new Error(`GifWriter.addFrame: delayCs must be an integer 0..65535, got ${delayCs}`)
    }
    for (let i = 0; i < n; i++) {
      if (indices[i] >= this.palette.size) {
        throw new Error(`GifWriter.addFrame: index ${indices[i]} at pixel ${i} is outside the ${this.palette.size}-colour palette`)
      }
    }

    // Graphic Control Extension: disposal 1 (do-not-dispose —
    // every frame covers the full canvas, so nothing can ever
    // show through), no transparency, delay in centiseconds
    this.buf.pushBytes(new Uint8Array([0x21, 0xf9, 0x04, 0x04]))
    this.buf.pushUint16LE(delayCs)
    this.buf.pushBytes(new Uint8Array([0x00, 0x00]))
    // Image Descriptor: full canvas at 0,0, no local table, no interlace
    this.buf.pushByte(0x2c)
    this.buf.pushUint16LE(0)
    this.buf.pushUint16LE(0)
    this.buf.pushUint16LE(this.width)
    this.buf.pushUint16LE(this.height)
    this.buf.pushByte(0x00)
    // LZW minimum code size + sub-block chunking (≤ 255 bytes each)
    this.buf.pushByte(this.minCodeSize)
    const compressed = lzwEncode(indices, this.minCodeSize)
    for (let i = 0; i < compressed.length; i += 255) {
      const len = Math.min(255, compressed.length - i)
      this.buf.pushByte(len)
      this.buf.pushBytes(compressed.subarray(i, i + len))
    }
    this.buf.pushByte(0x00)
    this.frameCount++
  }

  finish(): Uint8Array {
    if (this.finished) throw new Error('GifWriter: finish() was already called')
    this.finished = true
    this.buf.pushByte(0x3b)
    return this.buf.result()
  }
}
