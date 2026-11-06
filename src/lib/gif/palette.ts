// ─────────────────────────────────────────────────────────────
// GIF colour quantization (v0.15 R5) — median cut over a
// deterministic sample of the timeline, plus a 15-bit
// nearest-colour lookup table so per-pixel indexing is O(1).
//
// Pure data-in/data-out: no DOM, node-testable. The sample is
// taken by the orchestrator (gif-export.ts) at fixed timeline
// times, so the same design always yields the same palette.
// ─────────────────────────────────────────────────────────────

/** A quantized palette: `colors` holds `size` RGB triples. */
export interface GifPalette {
  readonly colors: Uint8Array
  readonly size: number
}

export const MAX_GIF_COLORS = 256

interface HistEntry {
  r: number
  g: number
  b: number
  count: number
}

/** One median-cut box: the half-open range [lo, hi) of the shared
 *  histogram array, plus its population and widest channel. */
interface Box {
  lo: number
  hi: number
  population: number
  channel: 0 | 1 | 2
  spread: number
}

function boxStats(entries: HistEntry[], lo: number, hi: number): { population: number; channel: 0 | 1 | 2; spread: number } {
  let minR = 255
  let maxR = 0
  let minG = 255
  let maxG = 0
  let minB = 255
  let maxB = 0
  let population = 0
  for (let i = lo; i < hi; i++) {
    const e = entries[i]
    if (e.r < minR) minR = e.r
    if (e.r > maxR) maxR = e.r
    if (e.g < minG) minG = e.g
    if (e.g > maxG) maxG = e.g
    if (e.b < minB) minB = e.b
    if (e.b > maxB) maxB = e.b
    population += e.count
  }
  const ranges: [number, number, number] = [maxR - minR, maxG - minG, maxB - minB]
  let channel: 0 | 1 | 2 = 0
  if (ranges[1] > ranges[channel]) channel = 1
  if (ranges[2] > ranges[channel]) channel = 2
  return { population, channel, spread: ranges[channel] }
}

/** Median-cut quantization. `samples` is a flat RGB triple array
 *  (length divisible by 3; the orchestrator strides it down to a
 *  bounded budget). Deterministic: histogram keeps first-seen
 *  order, box selection tie-breaks fully, and Array#sort is
 *  stable — the same input always produces the same palette.
 *
 *  Each palette entry is the MOST-POPULAR colour of its box, not
 *  the box average: flat design fills pass through EXACTLY, and
 *  the palette never invents a colour the design never showed. */
export function medianCutPalette(samples: Uint8Array, maxColors = MAX_GIF_COLORS): GifPalette {
  if (samples.length % 3 !== 0) throw new Error('medianCutPalette: samples length must be a multiple of 3')
  const limit = Math.max(2, Math.min(MAX_GIF_COLORS, Math.floor(maxColors)))

  const hist = new Map<number, HistEntry>()
  for (let i = 0; i + 2 < samples.length; i += 3) {
    const r = samples[i]
    const g = samples[i + 1]
    const b = samples[i + 2]
    const key = (r << 16) | (g << 8) | b
    const e = hist.get(key)
    if (e) e.count++
    else hist.set(key, { r, g, b, count: 1 })
  }
  if (hist.size === 0) return { colors: new Uint8Array([0, 0, 0]), size: 1 }

  const entries = Array.from(hist.values())
  if (entries.length <= limit) {
    const colors = new Uint8Array(entries.length * 3)
    entries.forEach((e, i) => {
      colors[i * 3] = e.r
      colors[i * 3 + 1] = e.g
      colors[i * 3 + 2] = e.b
    })
    return { colors, size: entries.length }
  }

  let boxes: Box[] = []
  {
    const s = boxStats(entries, 0, entries.length)
    boxes.push({ lo: 0, hi: entries.length, ...s })
  }
  while (boxes.length < limit) {
    // the splittable box with the largest channel spread; ties →
    // larger population, then lower lo (full determinism)
    let best = -1
    for (let i = 0; i < boxes.length; i++) {
      const bx = boxes[i]
      if (bx.hi - bx.lo < 2 || bx.spread === 0) continue
      if (best === -1) {
        best = i
        continue
      }
      const cur = boxes[best]
      if (
        bx.spread > cur.spread ||
        (bx.spread === cur.spread && (bx.population > cur.population || (bx.population === cur.population && bx.lo < cur.lo)))
      ) {
        best = i
      }
    }
    if (best === -1) break // every box is a single colour already
    const bx = boxes[best]
    // sort the range by its widest channel (stable sort ⇒ deterministic)
    const ch = bx.channel
    const seg = entries.slice(bx.lo, bx.hi)
    seg.sort((a, b) => (ch === 0 ? a.r - b.r : ch === 1 ? a.g - b.g : a.b - b.b))
    for (let i = 0; i < seg.length; i++) entries[bx.lo + i] = seg[i]
    // split at the population median so each side keeps ~half the pixels
    const half = bx.population / 2
    let acc = 0
    let cut = bx.lo
    for (let i = bx.lo; i < bx.hi - 1; i++) {
      acc += entries[i].count
      if (acc >= half) {
        cut = i + 1
        break
      }
    }
    if (cut <= bx.lo) cut = bx.lo + 1
    if (cut >= bx.hi) cut = bx.hi - 1
    boxes.splice(best, 1)
    boxes.push({ lo: bx.lo, hi: cut, ...boxStats(entries, bx.lo, cut) })
    boxes.push({ lo: cut, hi: bx.hi, ...boxStats(entries, cut, bx.hi) })
  }

  // most-popular colour per box; stable sort by descending
  // popularity so common colours get the low (short) LZW codes
  const picked: HistEntry[] = boxes.map((bx) => {
    let best = entries[bx.lo]
    for (let i = bx.lo + 1; i < bx.hi; i++) if (entries[i].count > best.count) best = entries[i]
    return best
  })
  picked.sort((a, b) => b.count - a.count)
  const colors = new Uint8Array(picked.length * 3)
  picked.forEach((e, i) => {
    colors[i * 3] = e.r
    colors[i * 3 + 1] = e.g
    colors[i * 3 + 2] = e.b
  })
  return { colors, size: picked.length }
}

/** A 15-bit (5 bits/channel) direct-mapped nearest-colour table:
 *  index = (r5 << 10) | (g5 << 5) | b5 → palette index. Distances
 *  are measured in 5-bit channel space — the same space the
 *  indexer reduces pixels into — so every palette colour maps to
 *  its own bin (identity for exact matches). Built once per
 *  export (32 768 × size distance evaluations, a few ms), then
 *  every pixel costs one shift-mask-and-load. */
export function buildNearestLUT(palette: GifPalette): Int16Array {
  if (palette.size < 1 || palette.colors.length < palette.size * 3) {
    throw new Error('buildNearestLUT: malformed palette')
  }
  const size = palette.size
  const pr = new Uint8Array(size)
  const pg = new Uint8Array(size)
  const pb = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    pr[i] = palette.colors[i * 3] >> 3
    pg[i] = palette.colors[i * 3 + 1] >> 3
    pb[i] = palette.colors[i * 3 + 2] >> 3
  }
  const lut = new Int16Array(32768)
  for (let idx = 0; idx < 32768; idx++) {
    const r5 = (idx >> 10) & 31
    const g5 = (idx >> 5) & 31
    const b5 = idx & 31
    let best = 0
    let bestD = Number.POSITIVE_INFINITY
    for (let i = 0; i < size; i++) {
      const dr = r5 - pr[i]
      const dg = g5 - pg[i]
      const db = b5 - pb[i]
      const d = dr * dr + dg * dg + db * db
      if (d < bestD) {
        bestD = d
        best = i
        if (d === 0) break
      }
    }
    lut[idx] = best
  }
  return lut
}
