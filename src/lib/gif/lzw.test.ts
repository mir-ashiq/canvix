import { describe, expect, it } from 'vitest'
import golden from './golden-vectors.json'
import { lzwEncode } from './lzw'

/** An INDEPENDENT LZW decoder, written from the GIF89a spec for
 *  these tests only — the encoder is never allowed to be validated
 *  by its own inverse alone (the R4 lesson: run a real parser).
 *  Dictionary entries are plain arrays: obviously correct, and
 *  test-sized inputs make the O(n²) copying irrelevant. */
export function lzwDecode(data: Uint8Array, minCodeSize: number, expectedPixels: number): Uint8Array {
  const clear = 1 << minCodeSize
  const eoi = clear + 1
  let pos = 0
  let bitBuf = 0
  let bitCnt = 0
  const readCode = (width: number): number => {
    while (bitCnt < width) {
      if (pos >= data.length) throw new Error('decoder: ran out of LZW data before EOI')
      bitBuf |= data[pos++] << bitCnt
      bitCnt += 8
    }
    const code = bitBuf & ((1 << width) - 1)
    bitBuf >>= width
    bitCnt -= width
    return code
  }
  const table: number[][] = []
  const reset = (): void => {
    table.length = 0
    for (let i = 0; i < clear; i++) table.push([i])
    table.push([]) // clear placeholder — never dereferenced
    table.push([]) // eoi placeholder — never dereferenced
  }
  reset()
  let width = minCodeSize + 1
  let prev: number[] | null = null
  const out: number[] = []
  for (;;) {
    const code = readCode(width)
    if (code === eoi) break
    if (code === clear) {
      reset()
      width = minCodeSize + 1
      prev = null
      continue
    }
    let entry: number[]
    if (code < table.length) {
      entry = table[code]
    } else if (prev !== null && code === table.length) {
      entry = [...prev, prev[0]] // the KwKwK case
    } else {
      throw new Error(`decoder: invalid code ${code} (table size ${table.length})`)
    }
    out.push(...entry)
    if (prev !== null) {
      table.push([...prev, entry[0]])
      // the decoder-side twin of the encoder's bump rule — ONE
      // ENTRY EARLIER: the decoder's table lags the encoder's by a
      // code at every stream position (it defines the entry the
      // encoder defined on the PREVIOUS emission), so it must bump
      // when its table REACHES 2^width, while the encoder bumps
      // when its next slot EXCEEDS it. This asymmetry is the GIF
      // no-early-change rule.
      if (table.length >= 1 << width && width < 12) width++
    }
    prev = entry
    if (out.length > expectedPixels) throw new Error('decoder: produced more pixels than expected')
  }
  if (out.length !== expectedPixels) {
    throw new Error(`decoder: produced ${out.length} pixels, expected ${expectedPixels}`)
  }
  return new Uint8Array(out)
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function b64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

describe('lzwEncode against PIL golden streams', () => {
  // PIL wrote each case as a real GIF; the golden vectors hold the
  // pixel indices PIL actually stored (read back from the file) and
  // the exact LZW bytes it emitted (parsed out of the file).
  for (const c of golden) {
    it(`decodes PIL's ${c.name} stream to PIL's own pixels (${c.width}×${c.height})`, () => {
      const pixels = lzwDecode(hexToBytes(c.lzw), c.minCodeSize, c.width * c.height)
      expect(Array.from(pixels)).toEqual(Array.from(b64ToBytes(c.indices)))
    })
    it(`round-trips ${c.name} through the independent decoder`, () => {
      const pixels = b64ToBytes(c.indices)
      const encoded = lzwEncode(pixels, c.minCodeSize)
      const decoded = lzwDecode(encoded, c.minCodeSize, pixels.length)
      expect(Array.from(decoded)).toEqual(Array.from(pixels))
    })
  }
})

describe('lzwEncode behavioural edges', () => {
  it('rejects invalid minCodeSize and empty input (fail-closed)', () => {
    expect(() => lzwEncode(new Uint8Array([0]), 1)).toThrow(/2\.\.8/)
    expect(() => lzwEncode(new Uint8Array([0]), 9)).toThrow(/2\.\.8/)
    expect(() => lzwEncode(new Uint8Array([0]), 2.5)).toThrow(/2\.\.8/)
    expect(() => lzwEncode(new Uint8Array(0), 2)).toThrow(/empty/)
  })

  it('compresses a single-colour image to a couple hundred bytes', () => {
    // LZW table entries grow LINEARLY (entry n = entry n-1 + one
    // char), so 10k same-colour pixels ≈ 140 codes ≈ 160 bytes —
    // not the exponential squash LZ77-style coders achieve
    const px = new Uint8Array(10_000).fill(7)
    const out = lzwEncode(px, 8)
    expect(out.length).toBeLessThan(220)
    expect(Array.from(lzwDecode(out, 8, px.length))).toEqual(Array.from(px))
  })

  it('survives table exhaustion with a clear-code reset (noise input)', () => {
    // 200×200 deterministic noise over 256 colours — the code table
    // passes 4096 entries mid-stream and must reset, not corrupt
    const px = new Uint8Array(40_000)
    let s = 0x5eed1234
    for (let i = 0; i < px.length; i++) {
      s ^= s << 13
      s ^= s >>> 17
      s ^= s << 5
      px[i] = (s >>> 3) & 0xff
    }
    const out = lzwEncode(px, 8)
    expect(out.length).toBeGreaterThan(30_000) // noise barely compresses
    expect(Array.from(lzwDecode(out, 8, px.length))).toEqual(Array.from(px))
  })

  it('is deterministic', () => {
    const px = new Uint8Array(5000)
    for (let i = 0; i < px.length; i++) px[i] = (i * 31) % 200
    const a = lzwEncode(px, 8)
    const b = lzwEncode(new Uint8Array(px), 8)
    expect(Array.from(a)).toEqual(Array.from(b))
  })
})
