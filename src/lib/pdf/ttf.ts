// ─────────────────────────────────────────────────────────────
// TrueType font parser + glyph subsetter (v0.15 R4).
//
// Reads exactly what a PDF FontFile2 embed needs from a
// glyf-flavored TrueType font (sfnt 1.0 — the format Google
// Fonts serves for legacy user agents; CFF/'OTTO' fonts are
// rejected and the caller falls down the font ladder), and
// builds a minimal valid subset: used glyphs only (composite
// components pulled in transitively), re-indexed cmap, rebuilt
// hmtx/loca/maxp, long loca, correct table directory checksums.
//
// ZERO dependencies — the R2 hand-rolled-muxer pattern applied
// to fonts. Every emitted subset is re-parsed by the same parser
// (and by fontTools-authored fixtures) in ttf.test.ts.
// ─────────────────────────────────────────────────────────────

export class TtfError extends Error {}

// ── little-endian-free byte readers (TTF is big-endian) ─────

class Reader {
  pos = 0
  constructor(private data: Uint8Array) {}
  get remaining(): number {
    return this.data.length - this.pos
  }
  u8(): number {
    if (this.pos + 1 > this.data.length) throw new TtfError('u8 past end')
    return this.data[this.pos++]
  }
  u16(): number {
    if (this.pos + 2 > this.data.length) throw new TtfError('u16 past end')
    const v = (this.data[this.pos] << 8) | this.data[this.pos + 1]
    this.pos += 2
    return v
  }
  s16(): number {
    const v = this.u16()
    return v >= 0x8000 ? v - 0x10000 : v
  }
  u32(): number {
    if (this.pos + 4 > this.data.length) throw new TtfError('u32 past end')
    const v = ((this.data[this.pos] << 24) | (this.data[this.pos + 1] << 16) | (this.data[this.pos + 2] << 8) | this.data[this.pos + 3]) >>> 0
    this.pos += 4
    return v
  }
  tag(): string {
    return String.fromCharCode(this.u8(), this.u8(), this.u8(), this.u8())
  }
  bytes(n: number): Uint8Array {
    if (this.pos + n > this.data.length) throw new TtfError('bytes past end')
    const out = this.data.slice(this.pos, this.pos + n)
    this.pos += n
    return out
  }
  seek(p: number): void {
    if (p < 0 || p > this.data.length) throw new TtfError('seek out of range')
    this.pos = p
  }
}

// ── composite glyph flags (glyf spec) ────────────────────────
const ARG_1_AND_2_ARE_WORDS = 0x0001
const ARGS_ARE_XY_VALUES = 0x0002
const WE_HAVE_A_SCALE = 0x0008
const MORE_COMPONENTS = 0x0020
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040
const WE_HAVE_A_TWO_BY_TWO = 0x0080

interface TableEntry {
  offset: number
  length: number
}

export interface ParsedTtf {
  unitsPerEm: number
  numGlyphs: number
  bbox: { xMin: number; yMin: number; xMax: number; yMax: number }
  ascent: number
  descent: number
  capHeight: number
  xHeight: number
  italicAngle: number
  isFixedPitch: boolean
  weightClass: number
  isItalic: boolean
  psName: string
  /** cmap lookup: unicode → glyph id (0 = .notdef) */
  glyphId(codepoint: number): number
  /** hmtx advance in font units */
  advance(glyphId: number): number
  /** hmtx left side bearing in font units */
  lsb(glyphId: number): number
  /** component glyph ids for a composite glyph (empty otherwise) */
  components(glyphId: number): number[]
  /** raw glyf bytes for a glyph (empty when it has no outline) */
  glyphData(glyphId: number): Uint8Array
}

/** Parse a TrueType font. Throws TtfError on anything malformed —
 * the caller falls back down the font ladder, never crashes. */
export function parseTtf(bytes: Uint8Array): ParsedTtf {
  const r = new Reader(bytes)
  const magic = r.u32()
  if (magic !== 0x00010000) {
    throw new TtfError(`not a glyf TrueType font (sfnt 0x${magic.toString(16)})`)
  }
  const numTables = r.u16()
  r.u16() // searchRange
  r.u16() // entrySelector
  r.u16() // rangeShift
  const tables = new Map<string, TableEntry>()
  for (let i = 0; i < numTables; i++) {
    const tag = r.tag()
    r.u32() // checksum
    const offset = r.u32()
    const length = r.u32()
    if (offset + length > bytes.length) throw new TtfError(`table ${tag} out of bounds`)
    tables.set(tag, { offset, length })
  }
  const need = (tag: string): TableEntry => {
    const t = tables.get(tag)
    if (!t) throw new TtfError(`missing required table ${tag}`)
    return t
  }
  const at = (tag: string): Reader => {
    const t = need(tag)
    return new Reader(bytes.subarray(t.offset, t.offset + t.length))
  }

  // head
  const head = at('head')
  head.u32() // version
  head.u32() // fontRevision
  head.u32() // checkSumAdjustment
  head.u32() // magicNumber
  head.u16() // flags
  const unitsPerEm = head.u16() || 1000
  head.bytes(16) // created + modified
  const xMin = head.s16()
  const yMin = head.s16()
  const xMax = head.s16()
  const yMax = head.s16()
  head.u16() // macStyle
  head.u16() // lowestRecPPEM
  head.s16() // fontDirectionHint
  const indexToLocFormat = head.s16()

  // hhea
  const hhea = at('hhea')
  hhea.u32() // version
  const ascent = hhea.s16()
  const descent = hhea.s16()
  hhea.bytes(26) // lineGap … metricDataFormat
  const numberOfHMetrics = hhea.u16() // offset 34 (hhea = 36 bytes)

  // maxp
  const maxp = at('maxp')
  maxp.u32() // version
  const numGlyphs = maxp.u16()

  // OS/2 (optional — metrics fall back to hhea/defaults)
  let capHeight = ascent
  let xHeight = 0
  let weightClass = 400
  let isItalic = false
  const os2 = tables.get('OS/2')
  if (os2 && os2.length >= 66) {
    const o = new Reader(bytes.subarray(os2.offset, os2.offset + os2.length))
    o.u16() // version @0
    o.u16() // xAvgCharWidth @2
    weightClass = o.u16() // usWeightClass @4
    o.seek(64) // fsSelection
    const fsSelection = o.u16()
    isItalic = (fsSelection & 0x0001) !== 0
    if (os2.length >= 96) {
      o.seek(86) // sxHeight (v2+)
      xHeight = o.s16()
      o.seek(92) // sCapHeight (v2+)
      capHeight = o.s16() || ascent
    }
  }

  // post (optional)
  let italicAngle = 0
  let isFixedPitch = false
  const post = tables.get('post')
  if (post) {
    const p = new Reader(bytes.subarray(post.offset, post.offset + post.length))
    p.u32() // version
    italicAngle = p.s16() + p.u16() / 65536
    p.u16() // underlinePosition
    p.u16() // underlineThickness
    isFixedPitch = p.u32() !== 0
  }

  // name → PostScript name (id 6)
  let psName = 'CanvixFont'
  const nameT = tables.get('name')
  if (nameT) {
    const n = new Reader(bytes.subarray(nameT.offset, nameT.offset + nameT.length))
    n.u16() // format
    const count = n.u16()
    const stringOffset = n.u16()
    let best = ''
    for (let i = 0; i < count; i++) {
      const platform = n.u16()
      const encoding = n.u16()
      const language = n.u16()
      const nameId = n.u16()
      const length = n.u16()
      const offset = n.u16()
      if (nameId !== 6 || length === 0) continue
      void language
      if (platform === 3 && (encoding === 1 || encoding === 10)) {
        const base = nameT.offset + stringOffset + offset
        const s = new Reader(bytes.subarray(base, base + length))
        let out = ''
        while (s.remaining >= 2) out += String.fromCharCode(s.u16())
        best = out
        break
      }
      if (platform === 1 && !best) {
        const base = nameT.offset + stringOffset + offset
        const s = new Reader(bytes.subarray(base, base + length))
        let out = ''
        while (s.remaining >= 1) out += String.fromCharCode(s.u8())
        best = out
      }
    }
    // PostScript names are ASCII, no spaces
    const safe = best.replace(/[^A-Za-z0-9-]/g, '')
    if (safe.length >= 2) psName = safe
  }

  // hmtx
  const hmtx = at('hmtx')
  const advances = new Array<number>(numGlyphs).fill(0)
  const lsbs = new Array<number>(numGlyphs).fill(0)
  let lastAdvance = 0
  for (let g = 0; g < numGlyphs; g++) {
    if (g < numberOfHMetrics) {
      lastAdvance = hmtx.u16()
      lsbs[g] = hmtx.s16()
    }
    advances[g] = lastAdvance
  }

  // loca
  const locaT = need('loca')
  const loca = new Reader(bytes.subarray(locaT.offset, locaT.offset + locaT.length))
  const glyphOffsets = new Array<number>(numGlyphs + 1).fill(0)
  for (let g = 0; g <= numGlyphs; g++) {
    glyphOffsets[g] = indexToLocFormat === 0 ? loca.u16() * 2 : loca.u32()
  }

  // cmap — prefer (3,1), then (3,10), then any (0,x)
  const cmapT = need('cmap')
  const cmap = new Reader(bytes.subarray(cmapT.offset, cmapT.offset + cmapT.length))
  cmap.u16() // version
  const encCount = cmap.u16()
  let chosen = -1
  for (let i = 0; i < encCount; i++) {
    const platform = cmap.u16()
    const encoding = cmap.u16()
    const offset = cmap.u32()
    const score = platform === 3 && encoding === 1 ? 3 : platform === 3 && encoding === 10 ? 2 : platform === 0 ? 1 : 0
    if (score > chosen && score > 0) {
      chosen = score
      // remember offset for the best; keep scanning for better
      ;(cmap as Reader & { _best?: number })._best = offset
    }
  }
  const bestOffset = (cmap as Reader & { _best?: number })._best
  if (chosen <= 0 || bestOffset === undefined) throw new TtfError('no unicode cmap subtable')
  const sub = new Reader(bytes.subarray(cmapT.offset + bestOffset))
  const cmapMap = new Map<number, number>()
  const format = sub.u16()
  if (format === 4) {
    sub.u16() // length
    sub.u16() // language
    const segCountX2 = sub.u16()
    const segCount = segCountX2 / 2
    sub.u16() // searchRange
    sub.u16() // entrySelector
    sub.u16() // rangeShift
    const endCodes: number[] = []
    for (let i = 0; i < segCount; i++) endCodes.push(sub.u16())
    sub.u16() // reservedPad
    const startCodes: number[] = []
    for (let i = 0; i < segCount; i++) startCodes.push(sub.u16())
    const idDeltas: number[] = []
    for (let i = 0; i < segCount; i++) idDeltas.push(sub.s16())
    const idRangeOffsetPos = sub.pos
    const idRangeOffsets: number[] = []
    for (let i = 0; i < segCount; i++) idRangeOffsets.push(sub.u16())
    for (let i = 0; i < segCount; i++) {
      for (let cp = startCodes[i]; cp <= endCodes[i]; cp++) {
        let gid: number
        if (idRangeOffsets[i] === 0) {
          gid = (cp + idDeltas[i]) & 0xffff
        } else {
          const glyphPos = idRangeOffsetPos + i * 2 + idRangeOffsets[i] + (cp - startCodes[i]) * 2
          const gr = new Reader(bytes.subarray(cmapT.offset + bestOffset + glyphPos))
          gid = gr.u16()
          if (gid !== 0) gid = (gid + idDeltas[i]) & 0xffff
        }
        if (gid !== 0) cmapMap.set(cp, gid)
      }
    }
  } else if (format === 12) {
    sub.u16() // reserved
    sub.u32() // length
    sub.u32() // language
    const nGroups = sub.u32()
    for (let i = 0; i < nGroups; i++) {
      const start = sub.u32()
      const end = sub.u32()
      const startGid = sub.u32()
      for (let cp = start; cp <= end && cp <= 0x10ffff; cp++) {
        if (cp >= 0 && cp <= 0xffff) cmapMap.set(cp, startGid + (cp - start))
      }
    }
  } else if (format === 6 || format === 0) {
    if (format === 6) {
      sub.u16() // length
      sub.u16() // language
      const first = sub.u16()
      const count = sub.u16()
      for (let i = 0; i < count; i++) cmapMap.set(first + i, sub.u16())
    } else {
      for (let cp = 0; cp < 256; cp++) {
        const gid = sub.u8()
        if (gid !== 0) cmapMap.set(cp, gid)
      }
    }
  } else {
    throw new TtfError(`unsupported cmap format ${format}`)
  }

  const glyphData = (g: number): Uint8Array => {
    if (g < 0 || g >= numGlyphs) return new Uint8Array(0)
    const start = glyphOffsets[g]
    const end = glyphOffsets[g + 1]
    if (end <= start) return new Uint8Array(0)
    return bytes.subarray(glyfT.offset + start, glyfT.offset + end)
  }
  const glyfT = need('glyf')

  const components = (g: number): number[] => {
    const data = glyphData(g)
    if (data.length < 2) return []
    const gr = new Reader(data)
    const numContours = gr.s16()
    if (numContours !== -1) return []
    gr.bytes(8) // bbox
    const out: number[] = []
    let guard = 0
    for (;;) {
      if (++guard > 64) break // corrupt loop guard
      const flags = gr.u16()
      out.push(gr.u16()) // component glyph index
      if (flags & ARG_1_AND_2_ARE_WORDS) gr.bytes(4)
      else gr.bytes(2)
      if (flags & WE_HAVE_A_SCALE) gr.bytes(2)
      else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) gr.bytes(4)
      else if (flags & WE_HAVE_A_TWO_BY_TWO) gr.bytes(8)
      if (!(flags & MORE_COMPONENTS)) break
    }
    return out
  }

  return {
    unitsPerEm,
    numGlyphs,
    bbox: { xMin, yMin, xMax, yMax },
    ascent,
    descent,
    capHeight,
    xHeight,
    italicAngle,
    isFixedPitch,
    weightClass,
    isItalic,
    psName,
    glyphId: (cp) => cmapMap.get(cp) ?? 0,
    advance: (g) => advances[g] ?? 0,
    lsb: (g) => lsbs[g] ?? 0,
    components,
    glyphData,
  }
}

// ── subsetter ───────────────────────────────────────────────

export interface SubsetResult {
  bytes: Uint8Array
  /** old glyph id → new glyph id */
  gidMap: Map<number, number>
  /** codepoint → new glyph id (only mapped, non-notdef) */
  codepointToGid: Map<number, number>
  unitsPerEm: number
  /** new gid → advance in font units */
  advances: number[]
  /** scale factor to PDF glyph units (1000/em) */
  scale: number
  bbox: [number, number, number, number]
  ascent: number
  descent: number
  capHeight: number
  italicAngle: number
  isFixedPitch: boolean
  stemV: number
  psName: string
}

/** Rewrite a composite glyph's component indices to subset gids,
 * byte-for-byte otherwise (flags/args/transform untouched). */
function rewriteComposite(data: Uint8Array, gidMap: Map<number, number>): Uint8Array {
  const out = new Uint8Array(data.length + 2) // may need +2 if last flags change? no — same layout
  out.set(data.subarray(0, 10), 0) // numberOfContours + bbox
  let src = 10
  let dst = 10
  let guard = 0
  for (;;) {
    if (++guard > 64 || src + 4 > data.length) break
    const flags = (data[src] << 8) | data[src + 1]
    const oldGid = (data[src + 2] << 8) | data[src + 3]
    const newGid = gidMap.get(oldGid) ?? 0
    out[dst] = data[src]
    out[dst + 1] = data[src + 1]
    out[dst + 2] = (newGid >> 8) & 0xff
    out[dst + 3] = newGid & 0xff
    src += 4
    dst += 4
    const argsLen = flags & ARG_1_AND_2_ARE_WORDS ? 4 : 2
    const copy = (n: number): void => {
      out.set(data.subarray(src, src + n), dst)
      src += n
      dst += n
    }
    copy(argsLen)
    if (flags & WE_HAVE_A_SCALE) copy(2)
    else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) copy(4)
    else if (flags & WE_HAVE_A_TWO_BY_TWO) copy(8)
    if (!(flags & MORE_COMPONENTS)) break
  }
  return out.subarray(0, dst)
}

/** Build a (3,1) format-4 cmap subtable from codepoint→gid. */
function buildFormat4(map: Map<number, number>): Uint8Array {
  const entries = [...map.entries()].filter(([cp]) => cp <= 0xfffe).sort((a, b) => a[0] - b[0])
  // segments: consecutive codepoints whose gids are also consecutive
  interface Seg {
    start: number
    end: number
    delta: number
  }
  const segs: Seg[] = []
  for (const [cp, gid] of entries) {
    const last = segs[segs.length - 1]
    if (last && cp === last.end + 1 && gid === ((last.end + last.delta + 1) & 0xffff)) {
      last.end = cp
      continue
    }
    segs.push({ start: cp, end: cp, delta: (gid - cp) & 0xffff })
  }
  // 0xFFFF sentinel (maps to .notdef) — required by format 4
  if (!segs.length || segs[segs.length - 1].end < 0xffff) {
    segs.push({ start: 0xffff, end: 0xffff, delta: 0 })
  }
  const segCount = segs.length
  const sub = new Uint8Array(16 + segCount * 8)
  const w = (p: number, v: number): void => {
    sub[p] = (v >> 8) & 0xff
    sub[p + 1] = v & 0xff
  }
  w(0, 4) // format
  w(2, sub.length) // length
  w(4, 0) // language
  w(6, segCount * 2)
  const searchRange = 2 * Math.pow(2, Math.floor(Math.log2(segCount)))
  w(8, searchRange)
  w(10, Math.floor(Math.log2(segCount)))
  w(12, segCount * 2 - searchRange)
  let p = 16
  for (const s of segs) {
    w(p, s.end)
    p += 2
  }
  w(p, 0) // reservedPad
  p += 2
  for (const s of segs) {
    w(p, s.start)
    p += 2
  }
  for (const s of segs) {
    w(p, s.delta > 0x7fff ? s.delta - 0x10000 : s.delta)
    p += 2
  }
  for (let i = 0; i < segCount; i++) w(p + i * 2, 0) // idRangeOffset = 0 everywhere
  return sub
}

function tableChecksum(bytes: Uint8Array): number {
  let sum = 0
  const padded = bytes.length % 4 ? Math.ceil(bytes.length / 4) * 4 : bytes.length
  for (let i = 0; i < padded; i += 4) {
    const b0 = bytes[i] ?? 0
    const b1 = bytes[i + 1] ?? 0
    const b2 = bytes[i + 2] ?? 0
    const b3 = bytes[i + 3] ?? 0
    sum = (sum + ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3)) >>> 0
  }
  return sum >>> 0
}

/** Subset `bytes` to the glyphs needed for `codepoints` (plus
 * .notdef and every composite component, transitively). */
export function subsetTtf(bytes: Uint8Array, codepoints: Iterable<number>): SubsetResult {
  const font = parseTtf(bytes)

  // 1. seed glyphs from the cmap
  const cpToOld = new Map<number, number>()
  for (const cp of codepoints) {
    if (cp < 0 || cp > 0xfffe) continue // BMP only — astral falls to .notdef
    if (cpToOld.has(cp)) continue
    const gid = font.glyphId(cp)
    if (gid !== 0) cpToOld.set(cp, gid)
  }

  // 2. glyph closure (composites pull their components in)
  const include = new Set<number>([0])
  const queue: number[] = [0, ...cpToOld.values()]
  while (queue.length) {
    const g = queue.pop()!
    if (include.has(g)) continue
    include.add(g)
    for (const c of font.components(g)) if (!include.has(c)) queue.push(c)
  }

  // 3. new gid assignment (ascending old gid; .notdef stays 0)
  const sorted = [...include].sort((a, b) => a - b)
  const gidMap = new Map<number, number>()
  sorted.forEach((oldGid, i) => gidMap.set(oldGid, i))
  const newCount = sorted.length

  // 4. rebuilt glyf + loca (long format, even-padded glyphs)
  const glyfParts: Uint8Array[] = []
  const loca: number[] = [0]
  let glyfLen = 0
  for (const oldGid of sorted) {
    const raw = font.glyphData(oldGid)
    const data = font.components(oldGid).length ? rewriteComposite(raw, gidMap) : raw
    const padded = data.length % 2 ? new Uint8Array(data.length + 1) : data
    if (padded !== data) padded.set(data, 0)
    glyfParts.push(padded)
    glyfLen += padded.length
    loca.push(glyfLen)
  }
  const glyf = new Uint8Array(glyfLen)
  let at = 0
  for (const part of glyfParts) {
    glyf.set(part, at)
    at += part.length
  }
  const locaBytes = new Uint8Array(loca.length * 4)
  loca.forEach((v, i) => {
    locaBytes[i * 4] = (v >>> 24) & 0xff
    locaBytes[i * 4 + 1] = (v >>> 16) & 0xff
    locaBytes[i * 4 + 2] = (v >>> 8) & 0xff
    locaBytes[i * 4 + 3] = v & 0xff
  })

  // 5. hmtx — one entry per new glyph (advance + original lsb)
  const advances = sorted.map((g) => font.advance(g))
  const lsbs = sorted.map((g) => font.lsb(g))
  const hmtx = new Uint8Array(newCount * 4)
  advances.forEach((adv, i) => {
    const lsb = lsbs[i] | 0
    hmtx[i * 4] = (adv >> 8) & 0xff
    hmtx[i * 4 + 1] = adv & 0xff
    hmtx[i * 4 + 2] = (lsb >> 8) & 0xff
    hmtx[i * 4 + 3] = lsb & 0xff
  })

  // 6. patched head (long loca, zeroed adjustment), hhea, maxp
  const orig = (tag: string): Uint8Array | null => {
    const r = new Reader(bytes)
    r.u32()
    const n = r.u16()
    r.u16()
    r.u16()
    r.u16()
    for (let i = 0; i < n; i++) {
      const t = r.tag()
      r.u32()
      const off = r.u32()
      const len = r.u32()
      if (t === tag) return bytes.subarray(off, off + len)
    }
    return null
  }
  const head = new Uint8Array(orig('head')!)
  head[8] = head[9] = head[10] = head[11] = 0 // checkSumAdjustment
  head[50] = 0
  head[51] = 1 // indexToLocFormat = long
  const hheaOrig = orig('hhea')!
  const hheaNew = new Uint8Array(hheaOrig)
  hheaNew[34] = (newCount >> 8) & 0xff // numberOfHMetrics at offset 34
  hheaNew[35] = newCount & 0xff
  const maxp = new Uint8Array(orig('maxp')!)
  maxp[4] = (newCount >> 8) & 0xff
  maxp[5] = newCount & 0xff

  // 7. rebuilt cmap (3,1) format 4
  const cpToNew = new Map<number, number>()
  for (const [cp, oldGid] of cpToOld) cpToNew.set(cp, gidMap.get(oldGid)!)
  const cmapSub = buildFormat4(cpToNew)
  const cmap = new Uint8Array(4 + 8 + cmapSub.length)
  cmap[0] = 0
  cmap[1] = 0 // version
  cmap[2] = 0
  cmap[3] = 1 // one encoding record
  cmap[4] = 0
  cmap[5] = 3 // platformID
  cmap[6] = 0
  cmap[7] = 1 // encodingID
  const subOff = 12
  cmap[8] = 0
  cmap[9] = 0
  cmap[10] = (subOff >> 8) & 0xff
  cmap[11] = subOff & 0xff
  cmap.set(cmapSub, subOff)

  // 8. assemble the sfnt — tables sorted by tag
  const parts: Array<{ tag: string; data: Uint8Array }> = [
    { tag: 'cmap', data: cmap },
    { tag: 'glyf', data: glyf },
    { tag: 'head', data: head },
    { tag: 'hhea', data: hheaNew },
    { tag: 'hmtx', data: hmtx },
    { tag: 'loca', data: locaBytes },
    { tag: 'maxp', data: maxp },
  ]
  const nameOrig = orig('name')
  if (nameOrig) parts.push({ tag: 'name', data: nameOrig })
  const os2Orig = orig('OS/2')
  if (os2Orig) parts.push({ tag: 'OS/2', data: os2Orig })
  const postOrig = orig('post')
  if (postOrig) parts.push({ tag: 'post', data: postOrig })
  parts.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))

  const numTables = parts.length
  const dirLen = 12 + numTables * 16
  let total = dirLen
  const offsets: number[] = []
  for (const part of parts) {
    offsets.push(total)
    total += part.data.length
    if (total % 4) total += 4 - (total % 4)
  }
  const out = new Uint8Array(total)
  const w16 = (p: number, v: number): void => {
    out[p] = (v >> 8) & 0xff
    out[p + 1] = v & 0xff
  }
  const w32 = (p: number, v: number): void => {
    out[p] = (v >>> 24) & 0xff
    out[p + 1] = (v >>> 16) & 0xff
    out[p + 2] = (v >>> 8) & 0xff
    out[p + 3] = v & 0xff
  }
  w32(0, 0x00010000)
  w16(4, numTables)
  const searchRange = 16 * Math.pow(2, Math.floor(Math.log2(numTables)))
  w16(6, searchRange)
  w16(8, Math.floor(Math.log2(numTables)))
  w16(10, numTables * 16 - searchRange)
  parts.forEach((part, i) => {
    const p = 12 + i * 16
    for (let c = 0; c < 4; c++) out[p + c] = part.tag.charCodeAt(c)
    w32(p + 4, tableChecksum(part.data))
    w32(p + 8, offsets[i])
    w32(p + 12, part.data.length)
    out.set(part.data, offsets[i])
  })

  // whole-font checkSumAdjustment (head table, offset 8)
  let sum = 0
  for (let i = 0; i < out.length; i += 4) {
    sum = (sum + ((out[i] << 24) | (out[i + 1] << 16) | (out[i + 2] << 8) | out[i + 3])) >>> 0
  }
  const adjust = (0xb1b0afba - sum) >>> 0
  // find head's offset and write the adjustment there
  parts.forEach((part, i) => {
    if (part.tag === 'head') {
      const p = offsets[i] + 8
      out[p] = (adjust >>> 24) & 0xff
      out[p + 1] = (adjust >>> 16) & 0xff
      out[p + 2] = (adjust >>> 8) & 0xff
      out[p + 3] = adjust & 0xff
    }
  })

  const scale = 1000 / font.unitsPerEm
  const stemV = Math.max(10, Math.round(10 + 220 * Math.pow(font.weightClass / 1000, 2)))

  return {
    bytes: out,
    gidMap,
    codepointToGid: cpToNew,
    unitsPerEm: font.unitsPerEm,
    advances,
    scale,
    bbox: [font.bbox.xMin * scale, font.bbox.yMin * scale, font.bbox.xMax * scale, font.bbox.yMax * scale],
    ascent: font.ascent * scale,
    descent: font.descent * scale,
    capHeight: font.capHeight * scale,
    italicAngle: font.italicAngle,
    isFixedPitch: font.isFixedPitch,
    stemV,
    psName: font.psName,
  }
}
