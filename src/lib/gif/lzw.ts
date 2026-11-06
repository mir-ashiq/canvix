// ─────────────────────────────────────────────────────────────
// GIF LZW compressor (v0.15 R5) — the GIF89a variant: variable
// code width starting at minCodeSize+1, a hard 4096-entry table
// ceiling relieved by clear codes, and NO early change (the
// classic GIF/TIFF divergence — the width bumps only when the
// next code would not fit).
//
// Verified in lzw.test.ts against PIL-generated golden streams
// and through an independent in-test decoder (the R4 lesson:
// never trust only your own re-implementation).
// ─────────────────────────────────────────────────────────────

/** Compress `indices` (one palette index per pixel) into raw LZW
 *  data — sub-block chunking is the container writer's job.
 *
 *  minCodeSize is the palette's power-of-two log (2..8); the GIF
 *  spec floor is 2 even for a 2-colour image. */
export function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  if (!Number.isInteger(minCodeSize) || minCodeSize < 2 || minCodeSize > 8) {
    throw new Error(`lzwEncode: minCodeSize must be an integer 2..8, got ${minCodeSize}`)
  }
  if (indices.length === 0) throw new Error('lzwEncode: empty input')

  const clear = 1 << minCodeSize
  const eoi = clear + 1

  // growable output, LSB-first bit packing (GIF bit order)
  let cap = Math.max(64, indices.length + (indices.length >> 3) + 16)
  let out = new Uint8Array(cap)
  let outLen = 0
  let bitBuf = 0
  let bitCnt = 0
  const pushBits = (code: number, width: number): void => {
    bitBuf |= code << bitCnt
    bitCnt += width
    while (bitCnt >= 8) {
      if (outLen === cap) {
        cap *= 2
        const grown = new Uint8Array(cap)
        grown.set(out)
        out = grown
      }
      out[outLen++] = bitBuf & 0xff
      bitBuf >>>= 8
      bitCnt -= 8
    }
  }

  // dictionary: (prefixCode << 8) | symbol → code. prefix ≤ 4095
  // and symbol ≤ 255, so every key fits in 20 bits.
  let dict = new Map<number, number>()
  let next = eoi + 1
  let width = minCodeSize + 1

  const resetTable = (): void => {
    dict = new Map()
    next = eoi + 1
    width = minCodeSize + 1
  }

  pushBits(clear, width)
  let cur = indices[0]
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]
    const key = (cur << 8) | k
    const hit = dict.get(key)
    if (hit !== undefined) {
      cur = hit
      continue
    }
    // miss: emit the prefix, then teach the table the new entry
    pushBits(cur, width)
    if (next < 4096) {
      dict.set(key, next)
      next++
      // bump AFTER the insert: when the next code to ASSIGN would
      // not fit in `width` bits, every code emitted from here on is
      // written one bit wider. The decoder's table runs one entry
      // behind at the matching stream position, so both sides bump
      // on the same code — this is the no-early-change GIF rule.
      if (width < 12 && next > 1 << width) width++
    } else {
      // table full: emit a clear and start over so long inputs
      // keep compressing (the giflib/PIL policy)
      pushBits(clear, width)
      resetTable()
    }
    cur = k
  }
  pushBits(cur, width)
  pushBits(eoi, width)
  if (bitCnt > 0) {
    if (outLen === cap) {
      const grown = new Uint8Array(cap * 2)
      grown.set(out)
      out = grown
      cap *= 2
    }
    out[outLen++] = bitBuf & 0xff
  }
  return out.subarray(0, outLen)
}
