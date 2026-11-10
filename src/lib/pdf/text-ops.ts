// ─────────────────────────────────────────────────────────────
// Vector text for PDF export (v0.15 R4) — the text model of the
// SVG serializer (rich-text.ts layoutRichLines) emitted as real
// PDF text operators with embedded subset fonts.
//
// Two font paths, one drawing contract:
//   • embedded  — Type0/CIDFontType2 with a subset TrueType
//     FontFile2 + /W widths + ToUnicode CMap; glyphs positioned
//     per-codepoint via TJ adjustment numbers computed from the
//     SAME canvas measurements the editor wraps with, so glyph
//     placement matches the canvas to the pixel.
//   • std14     — the font ladder's fallback (Helvetica/Times/
//     Courier + WinAnsi): viewer-laid-out runs (spacing may
//     differ slightly from the canvas — documented degradation,
//     text stays real and extractable).
//
// Baselines use Konva's exact formula (measured 'M' ascent /
// descent), decorations use Konva's exact geometry (underline
// at baseline + fontSize/4, strike at baseline − fontSize/4,
// thickness fontSize/15) — editor parity by construction.
// ─────────────────────────────────────────────────────────────

import type { AnyElement, ChartElement, EmbedElement, TableElement, TextElement, TextSpan } from '@/lib/types'
import { chartPrimitives } from '@/lib/chart-geometry'
import { hostOf } from '@/lib/v06-geometry'
import { layoutRichLines, normalizeSpans, resolveSpanStyle, type MeasureText, type SpanMeasureStyle } from '@/lib/rich-text'
import { fitFontSize } from '@/lib/text-fit'
import { faceKey, resolveFontFace, type FontFaceRequest, type FontLadderIo, type Std14Base } from './fonts'
import { subsetTtf, type SubsetResult } from './ttf'
import { pdfNum, pdfRgb, PdfWriter } from './pdf-writer'

// ── measurement IO (browser default, injectable for tests) ──

export interface TextIo {
  /** rich-text.ts measure contract (advance incl. letterSpacing × len) */
  measure: MeasureText
  /** exact x-offset per code point (relative to run start) or null */
  glyphPositions: (text: string, style: SpanMeasureStyle) => number[] | null
  /** 'M' metrics for Konva's baseline formula */
  mAscentDescent: (style: SpanMeasureStyle) => { ascent: number; descent: number }
}

const CHUNK = 12

/** Chunked prefix measurement: exact at chunk boundaries, kerning
 * drift distributed proportionally inside (bounded to one chunk
 * — sub-pixel for design-size text). */
function chunkedPositions(measure: MeasureText): (text: string, style: SpanMeasureStyle) => number[] | null {
  return (text, style) => {
    try {
      const cps = Array.from(text)
      if (cps.length > 4096) return null // hostile-size guard → hmtx layout
      const out = new Array<number>(cps.length).fill(0)
      let anchor = 0
      let anchorX = 0
      while (anchor + 1 < cps.length) {
        const end = Math.min(anchor + CHUNK, cps.length)
        const endX = measure(cps.slice(0, end).join(''), style)
        const ws: number[] = []
        let sum = 0
        for (let i = anchor; i < end; i++) {
          const w = Math.max(0, measure(cps[i], style))
          ws.push(w)
          sum += w
        }
        const scale = sum > 0 ? (endX - anchorX) / sum : 1
        let acc = anchorX
        for (let i = 0; i < ws.length - 1; i++) {
          acc += ws[i] * scale
          out[anchor + 1 + i] = acc
        }
        anchor = end
        anchorX = endX
        if (anchor < cps.length) out[anchor] = anchorX
      }
      return out
    } catch {
      return null
    }
  }
}

/** A deterministic fake for tests: fixed 0.5 em advance per
 * code point (so expected positions are hand-computable). */
export function createFakeTextIo(charWidth = 0.5): TextIo {
  const measure: MeasureText = (text, style) =>
    Array.from(text).length * (style.fontSize * charWidth + style.letterSpacing)
  return {
    measure,
    glyphPositions: chunkedPositions(measure),
    mAscentDescent: (style) => ({ ascent: style.fontSize * 0.8, descent: style.fontSize * 0.2 }),
  }
}

/** Canvas-backed IO (the export path). Falls back to the same
 * 0.55 × fontSize approximation the other renderers use when no
 * 2D context exists. */
export function createBrowserTextIo(): TextIo {
  let ctx: CanvasRenderingContext2D | null | undefined
  const fontOf = (style: SpanMeasureStyle): string =>
    `${style.italic ? 'italic ' : ''}${style.bold ? 700 : 400} ${style.fontSize}px ${style.fontFamily}`
  const getCtx = (): CanvasRenderingContext2D | null => {
    if (ctx === undefined) {
      try {
        ctx = document.createElement('canvas').getContext('2d')
      } catch {
        ctx = null
      }
    }
    return ctx
  }
  const measure: MeasureText = (text, style) => {
    const c = getCtx()
    if (!c) return Array.from(text).length * (style.fontSize * 0.55 + style.letterSpacing)
    c.font = fontOf(style)
    return c.measureText(text).width + style.letterSpacing * Array.from(text).length
  }
  return {
    measure,
    glyphPositions: chunkedPositions(measure),
    mAscentDescent: (style) => {
      const c = getCtx()
      if (!c) return { ascent: style.fontSize * 0.8, descent: style.fontSize * 0.2 }
      c.font = fontOf(style)
      const m = c.measureText('M')
      const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent ?? style.fontSize * 0.8
      const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? style.fontSize * 0.2
      return { ascent, descent }
    },
  }
}

// ── laid-out runs (element-local, baselines included) ───────

export interface LaidRun {
  /** baseline start in ELEMENT-BOX coordinates (x right, y down) */
  x: number
  y: number
  /** top of this run's line box (element-local, for block height) */
  lineTop: number
  text: string
  color: string
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  /** measured advance (decorations + background block) */
  width: number
  /** per-codepoint x offsets from run start, or null (hmtx layout) */
  positions: number[] | null
  style: SpanMeasureStyle
}

/** Konva's baseline: (ascent − descent)/2 + lineHeight/2 from the
 * text-box top (verticalAlign top, padding 0). */
function konvaBaseline(io: TextIo, style: SpanMeasureStyle, lineHeightPx: number): number {
  const { ascent, descent } = io.mAscentDescent(style)
  return (ascent - descent) / 2 + lineHeightPx / 2
}

/** Is this text element beyond the vector path (curve / gradient /
 * text effects) and bound for the raster-strip fallback? */
export function textElementIsRaster(el: TextElement): boolean {
  const curved = el.curve != null && Math.abs(el.curve) >= 2 && el.width >= 12
  const gradient = !!el.fillGradient
  const effect = !!el.effect && el.effect !== 'none' && el.effect !== 'background'
  // v0.18 (Wave 3): list markers + RTL direction ride the raster strip
  // — the vector text path lays LTR plain runs only (documented
  // approximation v1: pixel-perfect via the strip, no selectable text
  // for these two styles yet; the canvas/SVG/video exports are exact)
  const listed = !!el.listStyle && el.listStyle !== 'none'
  const rtl = el.direction === 'rtl'
  return curved || gradient || effect || listed || rtl
}

/** Lay a text element out (rich spans or flat — one span) into
 * baseline-positioned runs. */
export function layoutTextElement(el: TextElement, io: TextIo): LaidRun[] {
  const spans: TextSpan[] = (normalizeSpans(el.spans, el.text) ?? [
    { text: el.uppercase ? el.text.toUpperCase() : el.text },
  ]) as TextSpan[]
  const laid = layoutRichLines(el, spans, io.measure)
  const lineHeightPx = el.fontSize * el.lineHeight
  return laid.map((run) => {
    const style: SpanMeasureStyle = {
      bold: run.style.bold,
      italic: run.style.italic,
      fontSize: el.fontSize,
      fontFamily: el.fontFamily,
      letterSpacing: el.letterSpacing,
    }
    const baseline = konvaBaseline(io, style, lineHeightPx)
    return {
      x: run.x,
      y: run.y + baseline,
      lineTop: run.y,
      text: run.text,
      color: run.style.color,
      bold: run.style.bold,
      italic: run.style.italic,
      underline: run.style.underline,
      strike: run.style.strike,
      width: run.width,
      positions: io.glyphPositions(run.text, style),
      style,
    }
  })
}

// ── face collection (the pre-pass before font building) ─────

export interface FaceNotes {
  face: FontFaceRequest
  codepoints: Set<number>
}

const noteText = (map: Map<string, FaceNotes>, face: FontFaceRequest, text: string): void => {
  const key = faceKey(face)
  let entry = map.get(key)
  if (!entry) {
    entry = { face, codepoints: new Set() }
    map.set(key, entry)
  }
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp >= 0x20 && cp <= 0xfffe) entry.codepoints.add(cp)
  }
}

const textFacesOf = (map: Map<string, FaceNotes>, el: TextElement): void => {
  if (el.spans) {
    const spans = normalizeSpans(el.spans, el.text)
    if (spans) {
      for (const span of spans) {
        const style = resolveSpanStyle(el, span)
        noteText(
          map,
          { family: el.fontFamily, bold: style.bold, italic: style.italic },
          el.uppercase ? span.text.toUpperCase() : span.text,
        )
      }
      return
    }
  }
  noteText(map, { family: el.fontFamily, bold: el.bold, italic: el.italic }, el.uppercase ? el.text.toUpperCase() : el.text)
}

/** Every font face + codepoint the pages' text needs (groups
 * walked, raster-bound text skipped). */
export function collectTextFaces(pages: { elements: unknown[] }[]): Map<string, FaceNotes> {
  const map = new Map<string, FaceNotes>()
  const walk = (el: AnyElement): void => {
    if (!el || (el as { visible?: boolean }).visible === false) return
    switch (el.type) {
      case 'text': {
        const t = el as TextElement
        if (textElementIsRaster(t)) return
        textFacesOf(map, t)
        return
      }
      case 'table': {
        const tb = el as TableElement
        const cellCount = tb.cells?.length ?? 0
        for (let i = 0; i < cellCount; i++) {
          const cell = tb.cells[i]
          if (!cell?.text) continue
          const isHeader = Math.floor(i / tb.cols) === 0
          noteText(map, { family: tb.fontFamily, bold: !!cell.bold || isHeader, italic: false }, cell.text)
        }
        return
      }
      case 'chart': {
        const ch = el as ChartElement
        // defensive: documents from before the series/labels chart
        // shape (and hostile hand-built ones) have neither — they
        // contribute no text instead of crashing the face walk
        if (!ch.series || !ch.labels) return
        for (const p of chartPrimitives(ch)) {
          if (p.kind === 'text') {
            noteText(map, { family: p.family, bold: !!p.bold, italic: false }, p.text)
          }
        }
        return
      }
      case 'embed': {
        const em = el as EmbedElement
        noteText(map, { family: 'Inter', bold: false, italic: false }, hostOf(em.url).toUpperCase())
        noteText(map, { family: 'Inter', bold: true, italic: false }, em.title ?? em.url)
        return
      }
      case 'group': {
        const g = el as { children?: AnyElement[] }
        for (const c of g.children ?? []) walk(c)
        return
      }
      default:
        return
    }
  }
  for (const page of pages) {
    for (const el of (page.elements ?? []) as AnyElement[]) walk(el)
  }
  return map
}

// ── the font registry (PDF objects + run drawing) ───────────

interface RegistryEntry {
  key: string
  name: string // /F1 …
  kind: 'ttf' | 'std14'
  subset?: SubsetResult
  base?: Std14Base
  bold: boolean
  italic: boolean
}

export interface RunDrawSpec {
  /** baseline start, PAGE coordinates (y measured from page top) */
  x: number
  y: number
  pageH: number
  text: string
  fontFamily: string
  fontSize: number
  bold: boolean
  italic: boolean
  color: string
  letterSpacing?: number
  underline?: boolean
  strike?: boolean
  /** per-codepoint x offsets from x (exact mode); null/absent → hmtx layout */
  positions?: number[] | null
  /** measured advance of the run (decorations); falls back to an estimate */
  width?: number
}

// WinAnsi codes for the U+0080..U+009F range (rest of Latin-1 is identity)
const WINANSI_HIGH: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e,
  0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
}

function winAnsiByte(cp: number): number | null {
  if (cp >= 0x20 && cp <= 0x7e) return cp
  if (cp >= 0xa1 && cp <= 0xff) return cp
  if (cp === 0xa0) return 0x20
  return WINANSI_HIGH[cp] ?? null
}

const STD14_VARIANTS: Record<string, string[]> = {
  Helvetica: ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
  Times: ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
  Courier: ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'],
}

function buildToUnicode(subset: SubsetResult): string {
  const lines = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <ffff>',
    'endcodespacerange',
  ]
  const entries = [...subset.codepointToGid.entries()].sort((a, b) => a[1] - b[1])
  for (let i = 0; i < entries.length; i += 100) {
    const batch = entries.slice(i, i + 100)
    lines.push(`${batch.length} beginbfchar`)
    for (const [cp, gid] of batch) {
      lines.push(`<${gid.toString(16).padStart(4, '0')}> <${cp.toString(16).padStart(4, '0')}>`)
    }
    lines.push('endbfchar')
  }
  lines.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end')
  return lines.join('\n')
}

export class PdfFontRegistry {
  private entries = new Map<string, RegistryEntry>()
  private fontRefs = new Map<string, number>()
  private counter = 0
  private subsetTag = 0

  constructor(private pdf: PdfWriter) {}

  /** Embed every noted face (ladder → subset → PDF objects). */
  async build(notes: Map<string, FaceNotes>, io: FontLadderIo = {}): Promise<void> {
    for (const { face, codepoints } of notes.values()) {
      const resolved = await resolveFontFace(face, io)
      const key = faceKey(face)
      const name = `F${++this.counter}`
      if (resolved.kind === 'ttf') {
        const subset = subsetTtf(resolved.bytes, codepoints)
        const obj = this.emitTtfFont(name, subset)
        this.fontRefs.set(name, obj)
        this.entries.set(key, { key, name, kind: 'ttf', subset, bold: face.bold, italic: face.italic })
      } else {
        const obj = this.emitStd14Font(name, resolved.base, face.bold, face.italic)
        this.fontRefs.set(name, obj)
        this.entries.set(key, { key, name, kind: 'std14', base: resolved.base, bold: face.bold, italic: face.italic })
      }
    }
  }

  private emitTtfFont(name: string, subset: SubsetResult): number {
    void name
    const tag = `CVX${String(++this.subsetTag).padStart(3, '0')}`
    const baseFont = `/${tag}+${subset.psName}`
    const ff2 = this.pdf.addStreamObject(`/Length1 ${subset.bytes.length}`, subset.bytes)
    const descriptor = this.pdf.addObject(
      `<< /Type /FontDescriptor /FontName ${baseFont} /Flags 4 /FontBBox [${subset.bbox.map((n) => pdfNum(n)).join(' ')}] ` +
        `/ItalicAngle ${pdfNum(subset.italicAngle)} /Ascent ${pdfNum(subset.ascent)} /Descent ${pdfNum(subset.descent)} ` +
        `/CapHeight ${pdfNum(subset.capHeight)} /StemV ${pdfNum(subset.stemV)} /FontFile2 ${this.pdf.ref(ff2)} >>`,
    )
    const w = `/W [0 [${subset.advances.map((a) => pdfNum(a * subset.scale)).join(' ')}]]`
    const cidFont = this.pdf.addObject(
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont ${baseFont} ` +
        `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
        `/FontDescriptor ${this.pdf.ref(descriptor)} /DW 1000 ${w} /CIDToGIDMap /Identity >>`,
    )
    const toUnicode = this.pdf.addStreamObject('', buildToUnicode(subset))
    return this.pdf.addObject(
      `<< /Type /Font /Subtype /Type0 /BaseFont ${baseFont} /Encoding /Identity-H ` +
        `/DescendantFonts [${this.pdf.ref(cidFont)}] /ToUnicode ${this.pdf.ref(toUnicode)} >>`,
    )
  }

  private emitStd14Font(name: string, base: Std14Base, bold: boolean, italic: boolean): number {
    void name
    const variant = STD14_VARIANTS[base][(bold ? 1 : 0) | (italic ? 2 : 0)]
    return this.pdf.addObject(
      `<< /Type /Font /Subtype /Type1 /BaseFont /${variant} /Encoding /WinAnsiEncoding >>`,
    )
  }

  /** `<< /F1 n 0 R … >>` for page /Resources /Font dicts. */
  resourcesDict(): string {
    const parts = [...this.fontRefs.entries()].map(([name, obj]) => `/${name} ${this.pdf.ref(obj)}`)
    return parts.length ? `<< ${parts.join(' ')} >>` : '<< >>'
  }

  get(face: FontFaceRequest): RegistryEntry | undefined {
    return this.entries.get(faceKey(face))
  }

  /** Draw one text run; returns ops (empty string for empty text). */
  drawRun(spec: RunDrawSpec): string {
    if (!spec.text) return ''
    const entry = this.entries.get(faceKey({ family: spec.fontFamily, bold: spec.bold, italic: spec.italic }))
    if (!entry) return '' // face never collected — the raster strip covers visuals
    const flipY = spec.pageH - spec.y
    const ops: string[] = []
    const color = pdfRgb(spec.color)

    if (entry.kind === 'ttf' && entry.subset) {
      const sub = entry.subset
      const cps = Array.from(spec.text)
      const gids: number[] = []
      const xs: number[] = []
      let cursor = 0 // running x for the hmtx fallback layout
      for (let i = 0; i < cps.length; i++) {
        const cp = cps[i].codePointAt(0)!
        if (cp > 0xfffe) continue // astral → unrepresentable CID, skip
        const gid = sub.codepointToGid.get(cp) ?? 0
        gids.push(gid)
        if (spec.positions && spec.positions.length === cps.length) {
          xs.push(spec.x + spec.positions[i])
        } else {
          xs.push(spec.x + cursor)
          cursor += (sub.advances[gid] * sub.scale) / 1000 * spec.fontSize + (spec.letterSpacing ?? 0)
        }
      }
      if (!gids.length) return ''

      const parts: string[] = []
      for (let i = 0; i < gids.length; i++) {
        parts.push(`<${gids[i].toString(16).padStart(4, '0')}>`)
        if (i + 1 < gids.length) {
          const penAfter = xs[i] + ((sub.advances[gids[i]] * sub.scale) / 1000) * spec.fontSize
          // TJ adjustments displace by adj × fontSize/1000 in user
          // space (measured empirically against poppler — see
          // tests/e2e/vector-pdf-export.spec.ts)
          const adj = Math.round((penAfter - xs[i + 1]) * (1000 / spec.fontSize))
          if (adj !== 0) parts.push(String(adj))
        }
      }
      ops.push(
        `BT /${entry.name} ${pdfNum(spec.fontSize)} Tf ${color} rg`,
        `1 0 0 1 ${pdfNum(xs[0])} ${pdfNum(flipY)} Tm`,
        `[${parts.join(' ')}] TJ`,
        'ET',
      )
    } else {
      // std14 — viewer-laid run (documented degradation)
      let body = ''
      for (const ch of Array.from(spec.text)) {
        const cp = ch.codePointAt(0)!
        const byte = winAnsiByte(cp)
        if (byte == null) {
          if (cp <= 0xfffe) body += '?'
          continue
        }
        if (byte === 0x28 || byte === 0x29 || byte === 0x5c) body += '\\' + String.fromCharCode(byte)
        else if (byte >= 32 && byte <= 126) body += String.fromCharCode(byte)
        else body += '\\' + byte.toString(8).padStart(3, '0')
      }
      if (!body) return ''
      const tc = spec.letterSpacing ? ` ${pdfNum(spec.letterSpacing)} Tc` : ''
      ops.push(
        `BT /${entry.name} ${pdfNum(spec.fontSize)} Tf ${color} rg${tc}`,
        `1 0 0 1 ${pdfNum(spec.x)} ${pdfNum(flipY)} Tm (${body}) Tj`,
        'ET',
      )
    }

    // decorations — Konva's exact geometry (y-down → flipped)
    if (spec.underline || spec.strike) {
      const th = spec.fontSize / 15
      const count = Array.from(spec.text).length
      const w = spec.width ?? count * spec.fontSize * 0.55 + (spec.letterSpacing ?? 0) * count
      if (spec.underline) {
        const y = spec.y + Math.round(spec.fontSize / 4)
        ops.push(`${color} rg ${pdfNum(spec.x)} ${pdfNum(spec.pageH - y - th / 2)} ${pdfNum(w)} ${pdfNum(th)} re f`)
      }
      if (spec.strike) {
        const y = spec.y - Math.round(spec.fontSize / 4)
        ops.push(`${color} rg ${pdfNum(spec.x)} ${pdfNum(spec.pageH - y - th / 2)} ${pdfNum(w)} ${pdfNum(th)} re f`)
      }
    }
    return ops.join('\n')
  }
}

// ── element-level drawing (used by the page renderer) ───────

/** Draw a text element's runs at page coordinates. Returns null
 * when the element is raster-bound (caller rasterizes). */
export function drawTextElement(
  el: TextElement,
  pageH: number,
  fonts: PdfFontRegistry,
  io: TextIo,
): string | null {
  if (textElementIsRaster(el)) return null
  // v0.18 (Wave 3): auto-fit — the effective size is derived here with
  // the SAME binary search the canvas/SVG/video renderers run
  // (lib/text-fit), laid out at that size. Rich spans keep the authored
  // size (the flat-path feature, matching every other renderer).
  const effSize = el.autoFit && !normalizeSpans(el.spans, el.text)
    ? fitFontSize(
        {
          text: el.uppercase ? el.text.toUpperCase() : el.text,
          fontFamily: el.fontFamily,
          bold: el.bold,
          italic: el.italic,
          letterSpacing: el.letterSpacing,
          lineHeight: el.lineHeight,
          fontSize: el.fontSize,
        },
        { width: el.width, height: el.height },
        (text, style) => io.measure(text, style),
      )
    : el.fontSize
  const sized = effSize === el.fontSize ? el : ({ ...el, fontSize: effSize } as TextElement)
  const runs = layoutTextElement(sized, io)
  const out: string[] = []
  // the background effect rides behind the runs (editor parity)
  if (el.effect === 'background') {
    const blockH = runs.length
      ? Math.max(...runs.map((r) => r.lineTop)) + effSize * el.lineHeight
      : effSize * el.lineHeight
    const h = Math.max(el.height, blockH, effSize * el.lineHeight + 8)
    out.push(roundedRectOps(el.x, el.y, el.width, h, Math.min(8, effSize * 0.2), el.effectBackground ?? '#EFEFEF', pageH))
  }
  for (const run of runs) {
    const entry = fonts.get({ family: el.fontFamily, bold: run.bold, italic: run.italic })
    // quality gate: without glyph coverage the raster strip beats a page of tofu
    if (entry?.kind === 'ttf' && entry.subset) {
      const cps = Array.from(run.text)
      const mapped = cps.filter((c) => {
        const cp = c.codePointAt(0)!
        return cp > 0xfffe || entry.subset!.codepointToGid.has(cp)
      }).length
      if (cps.length > 0 && mapped / cps.length < 0.75) return null
    }
    const ops = fonts.drawRun({
      x: el.x + run.x,
      y: el.y + run.y,
      pageH,
      text: run.text,
      fontFamily: el.fontFamily,
      fontSize: effSize,
      bold: run.bold,
      italic: run.italic,
      color: run.color,
      letterSpacing: el.letterSpacing,
      underline: run.underline,
      strike: run.strike,
      positions: run.positions,
      width: run.width,
    })
    if (ops) out.push(ops)
  }
  return out.join('\n')
}

/** Rounded-rect fill ops (shared with the shape mappers) — four
 * circular Bézier corners, k = 0.5523 × r. */
export function roundedRectOps(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
  pageH: number,
): string {
  const yT = pageH - y
  const yB = pageH - y - h
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2))
  if (rr <= 0.01) {
    return `${pdfRgb(fill)} rg ${pdfNum(x)} ${pdfNum(yB)} ${pdfNum(w)} ${pdfNum(h)} re f`
  }
  const k = 0.5523 * rr
  return [
    `${pdfRgb(fill)} rg`,
    `${pdfNum(x + rr)} ${pdfNum(yT)} m`,
    `${pdfNum(x + w - rr)} ${pdfNum(yT)} l`,
    `${pdfNum(x + w - rr + k)} ${pdfNum(yT)} ${pdfNum(x + w)} ${pdfNum(yT - rr + k)} ${pdfNum(x + w)} ${pdfNum(yT - rr)} c`,
    `${pdfNum(x + w)} ${pdfNum(yB + rr)} l`,
    `${pdfNum(x + w)} ${pdfNum(yB + rr - k)} ${pdfNum(x + w - rr + k)} ${pdfNum(yB)} ${pdfNum(x + w - rr)} ${pdfNum(yB)} c`,
    `${pdfNum(x + rr)} ${pdfNum(yB)} l`,
    `${pdfNum(x + rr - k)} ${pdfNum(yB)} ${pdfNum(x)} ${pdfNum(yB + rr - k)} ${pdfNum(x)} ${pdfNum(yB + rr)} c`,
    `${pdfNum(x)} ${pdfNum(yT - rr)} l`,
    `${pdfNum(x)} ${pdfNum(yT - rr + k)} ${pdfNum(x + rr - k)} ${pdfNum(yT)} ${pdfNum(x + rr)} ${pdfNum(yT)} c`,
    'h f',
  ].join('\n')
}
