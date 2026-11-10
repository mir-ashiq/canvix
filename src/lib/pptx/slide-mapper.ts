// ─────────────────────────────────────────────────────────────
// slide-mapper — Canvix PageData → one PPTX slide (Wave 5).
//
// The export-parity doctrine of the house: render from DATA, map
// what the target format expresses natively, raster-fallback the
// rest at the chosen detail level. Native in v1:
//   • text (paragraphs, rich-text spans, lists, RTL, align,
//     line height, letter spacing, auto-fit shrink)
//   • rect / rounded rect / ellipse / triangle (preset geometry)
//   • star / polygon (custGeom from the SAME lib/shapes.ts
//     geometry the canvas, SVG, PDF and video renderers use)
//   • lines with dashes and arrowheads
//   • images (embedded PNG/JPEG, corner radius, flips, opacity)
//   • emoji stickers (text runs)
//   • solid + gradient fills, strokes, element opacity, rotation
//     (with the top-left→centre origin re-base), soft shadows
//   • per-page solid/gradient backgrounds, speaker notes
// Raster fallback (honest limits, documented): charts, tables,
// embeds, frames, plugin elements, audio/video cards, freehand
// strokes, curved text, masked/filtered images, text effects.
// ─────────────────────────────────────────────────────────────

import type {
  AnyElement,
  GradientFill,
  ImageElement,
  LineElement,
  PageData,
  ShapeElement,
  StickerElement,
  TextElement,
  TextSpan,
} from '@/lib/types'
import { normalizeSpans } from '@/lib/rich-text'
import { polygonPoints, starPointsEx, stretchPts, type Pt } from '@/lib/shapes'
import { fitFontSize } from '@/lib/text-fit'
import { emu, centerAfterRotation, parseColor, solidFill, strokeLn, xesc } from './xml-helpers'

// ── context ──────────────────────────────────────────────────

export interface SlideMapContext {
  /** preloaded images keyed by src (the video-export loader) */
  images: Map<string, HTMLImageElement>
  /** detail for raster fallbacks (the dialog's 1×/2×/3×) */
  pixelScale: number
  /** media bag: registers a source and returns its part name */
  media: PptxMediaBag
  /** next shape id (PowerPoint wants unique ids per slide) */
  nextId: () => number
}

/** Media registration seam — implemented by the orchestrator. */
export interface PptxMediaBag {
  /** returns the media part name (e.g. 'media/image3.png') for an
   *  image source (dataURL / media URL), or null when unavailable */
  imagePart(src: string): Promise<string | null>
  /** register raw raster bytes (fallback renders) → part name */
  registerRaster(bytes: Uint8Array): Promise<string>
}

export interface MappedSlide {
  xml: string
  /** relationship entries: rel id → media target */
  imageRels: Map<string, string>
  rasters: number
  natives: number
}

// ── fills / shared property blocks ───────────────────────────

function gradFillXml(g: { type?: string; from: string; to: string; angle: number }, opacity: number): string {
  const from = withAlpha(g.from, opacity)
  const to = withAlpha(g.to, opacity)
  if (g.type === 'radial') {
    return (
      `<a:gradFill><a:gsLst>` +
      `<a:gs pos="0">${from}</a:gs><a:gs pos="100000">${to}</a:gs>` +
      `</a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill>`
    )
  }
  // Canvix angle: 0 = →, 90 = ↓ (clockwise) — the OOXML lin ang
  // convention is the same, in 60000ths of a degree.
  const ang = Math.round(((g.angle % 360) + 360) % 360 * 60000)
  return (
    `<a:gradFill rotWithShape="1"><a:gsLst>` +
    `<a:gs pos="0">${from}</a:gs><a:gs pos="100000">${to}</a:gs>` +
    `</a:gsLst><a:lin ang="${ang}" scaled="0"/></a:gradFill>`
  )
}

/** fold an element-level opacity into a colour string */
function withAlpha(color: string, opacity: number): string {
  const c = parseColor(color)
  if (!c) return `<a:srgbClr val="000000"/>`
  if (opacity >= 1 && c.alpha >= 1) return `<a:srgbClr val="${c.hex}"/>`
  const a = Math.round(c.alpha * Math.min(1, Math.max(0, opacity)) * 100000)
  return `<a:srgbClr val="${c.hex}"><a:alpha val="${a}"/></a:srgbClr>`
}

function fillXml(el: { fill: string; fillGradient?: GradientFill | null }, opacity: number): string {
  if (el.fillGradient) return gradFillXml(el.fillGradient, opacity)
  const f = el.fill
  const c = parseColor(f)
  if (!c) return '<a:noFill/>'
  return `<a:solidFill>${withAlpha(f, opacity)}</a:solidFill>`
}

function shadowXml(el: AnyElement): string {
  const s = el.shadow
  if (!s?.enabled) return ''
  const c = parseColor(s.color)
  const dist = Math.round(Math.hypot(s.offsetX, s.offsetY) * 9525)
  // atan2(y, x) matches OOXML dir (clockwise from +x, 60000ths)
  const dir = Math.round(((Math.atan2(s.offsetY, s.offsetX) * 180) / Math.PI + 360) % 360 * 60000)
  const alpha = Math.round((c?.alpha ?? 1) * 100000)
  return (
    `<a:effectLst><a:outerShdw blurRad="${Math.round(s.blur * 9525)}" dist="${dist}" dir="${dir}" rotWithShape="0">` +
    `<a:srgbClr val="${c?.hex ?? '000000'}"><a:alpha val="${alpha}"/></a:srgbClr>` +
    `</a:outerShdw></a:effectLst>`
  )
}

/** The xfrm block — re-bases top-left-rotating elements so the
 *  centre-rotation OOXML semantics land the box identically. */
function xfrmXml(
  el: { x: number; y: number; width: number; height: number; rotation: number },
  origin: 'topleft' | 'center',
  flipH = false,
  flipV = false,
): string {
  const { cx, cy } = centerAfterRotation(el.x, el.y, el.width, el.height, el.rotation, origin)
  const rot = Math.round(((el.rotation % 360) + 360) % 360 * 60000)
  return (
    `<a:xfrm${rot ? ` rot="${rot}"` : ''}${flipH ? ' flipH="1"' : ''}${flipV ? ' flipV="1"' : ''}>` +
    `<a:off x="${emu(cx - el.width / 2)}" y="${emu(cy - el.height / 2)}"/>` +
    `<a:ext cx="${emu(el.width)}" cy="${emu(Math.max(el.height, 0.01))}"/>` +
    `</a:xfrm>`
  )
}

function nvSpPr(id: number, name: string): string {
  return (
    `<p:nvSpPr><p:cNvPr id="${id}" name="${xesc(name)}"/>` +
    `<p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
  )
}

// ── custGeom from the shared shape geometry ──────────────────

function custGeomFromPts(pts: Pt[], w: number, h: number): string {
  if (!pts.length) return '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
  // path coordinates share the coordinate space declared by <a:w>/<a:h>
  // — stretchPts is in box pixels, so map 1:1 to EMU with the box
  const path: string[] = []
  path.push(`<a:moveTo><a:pt x="${emu(pts[0][0])}" y="${emu(pts[0][1])}"/></a:moveTo>`)
  for (let i = 1; i < pts.length; i++) {
    path.push(`<a:lnTo><a:pt x="${emu(pts[i][0])}" y="${emu(pts[i][1])}"/></a:lnTo>`)
  }
  path.push('<a:close/>')
  return (
    `<a:custGeom><a:avLst/><a:gdLst/>` +
    `<a:ahLst/><a:rect l="l" t="t" r="r" b="b"/><a:pathLst>` +
    `<a:path w="${emu(w)}" h="${emu(h)}">${path.join('')}</a:path>` +
    `</a:pathLst></a:custGeom>`
  )
}

// ── native element writers ───────────────────────────────────

function shapeXml(s: ShapeElement, id: number, ctx: SlideMapContext): string | null {
  void ctx
  let geom = ''
  const origin: 'topleft' | 'center' = s.type === 'ellipse' || s.type === 'star' || s.type === 'polygon' ? 'center' : 'topleft'
  if (s.type === 'rect') {
    geom =
      s.cornerRadius > 0
        ? `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${Math.min(50000, Math.round((s.cornerRadius / Math.max(1, Math.min(s.width, s.height))) * 100000))}"/></a:avLst></a:prstGeom>`
        : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
  } else if (s.type === 'ellipse') {
    geom = '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>'
  } else if (s.type === 'triangle') {
    geom = '<a:prstGeom prst="triangle"><a:avLst/></a:prstGeom>'
  } else if (s.type === 'star') {
    const pts = stretchPts(starPointsEx(s.numPoints ?? 5, s.innerRatio), 0, 0, s.width, s.height)
    geom = custGeomFromPts(pts, s.width, s.height)
  } else if (s.type === 'polygon') {
    const pts = stretchPts(polygonPoints(s.sides ?? 6), 0, 0, s.width, s.height)
    geom = custGeomFromPts(pts, s.width, s.height)
  } else {
    return null // path — raster fallback
  }
  const stroke = s.strokeWidth > 0 ? strokeLn(s.stroke, s.strokeWidth) : '<a:ln><a:noFill/></a:ln>'
  return (
    `<p:sp>` +
    nvSpPr(id, s.name || `Shape ${id}`) +
    `<p:spPr>` +
    xfrmXml(s, origin) +
    geom +
    fillXml(s, s.opacity) +
    stroke +
    shadowXml(s) +
    `</p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>` +
    `</p:sp>`
  )
}

function lineXml(l: LineElement, id: number): string {
  // Canvix lines: width = length, height 0, rotation = angle.
  // OOXML: a "line" preset geometry of the given length, rotated.
  const h = Math.max(l.height, 1)
  const el = { ...l, height: h }
  const stroke = `<a:ln w="${emu(Math.max(l.strokeWidth, 0.5))}" cap="rnd">` +
    (parseColor(l.stroke) ? solidFill(l.stroke) : '<a:solidFill><a:srgbClr val="000000"/></a:solidFill>') +
    (l.dashed ? '<a:prstDash val="dash"/>' : '') +
    (l.arrowStart ? '<a:headEnd type="triangle" w="med" len="med"/>' : '') +
    (l.arrowEnd ? '<a:tailEnd type="triangle" w="med" len="med"/>' : '') +
    `</a:ln>`
  return (
    `<p:sp>` +
    nvSpPr(id, l.name || `Line ${id}`) +
    `<p:spPr>` +
    xfrmXml(el, 'topleft') +
    `<a:prstGeom prst="line"><a:avLst/></a:prstGeom>` +
    `<a:noFill/>` +
    stroke +
    `</p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>` +
    `</p:sp>`
  )
}

// ── text mapping (paragraphs, spans, lists, rtl) ─────────────

interface RunStyle {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  color?: string
}

function runXml(text: string, style: RunStyle, el: TextElement, fontSizePx: number): string {
  const rPr = [
    `lang="en-US"`,
    `sz="${Math.max(100, Math.round(fontSizePx * 0.75 * 100))}"`,
    el.bold || style.bold ? 'b="1"' : '',
    el.italic || style.italic ? 'i="1"' : '',
    el.underline || style.underline ? 'u="sng"' : '',
    el.strike || style.strike ? 'strike="sngStrike"' : '',
    el.letterSpacing ? `spc="${Math.round(el.letterSpacing * 0.75 * 100)}"` : '',
  ]
    .filter(Boolean)
    .join(' ')
  const font = `<a:latin typeface="${xesc(el.fontFamily)}"/><a:ea typeface="${xesc(el.fontFamily)}"/><a:cs typeface="${xesc(el.fontFamily)}"/>`
  const fill = solidFill(style.color && parseColor(style.color) ? style.color : el.fillGradient ? el.fillGradient.from : el.fill, { opacity: el.opacity })
  return `<a:r><a:rPr ${rPr} dirty="0">${font}${fill}</a:rPr><a:t>${xesc(text)}</a:t></a:r>`
}

/** Split a text + span list into paragraphs of styled runs. */
function paragraphsOf(el: TextElement): { runs: { text: string; style: RunStyle }[] }[] {
  const source = el.uppercase ? el.text.toUpperCase() : el.text
  const spans = normalizeSpans(el.spans, el.text)
  // apply the same case transform to span text (normalizeSpans
  // guarantees the concatenation equals el.text)
  const styled: { text: string; style: RunStyle }[] = spans
    ? spans.map((sp: TextSpan) => ({ text: el.uppercase ? sp.text.toUpperCase() : sp.text, style: sp }))
    : [{ text: source, style: {} }]
  const paras: { runs: { text: string; style: RunStyle }[] }[] = [{ runs: [] }]
  for (const r of styled) {
    const pieces = r.text.split('\n')
    pieces.forEach((piece, i) => {
      if (i > 0) paras.push({ runs: [] })
      if (piece) paras[paras.length - 1].runs.push({ text: piece, style: r.style })
    })
  }
  return paras
}

function textXml(t: TextElement, id: number, ctx: SlideMapContext): string | null {
  void ctx
  const effSize = effectiveFontSize(t)
  const paras = paragraphsOf(t)
  const rtl = t.direction === 'rtl'
  const align = t.align === 'center' ? 'ctr' : t.align === 'justify' ? 'just' : rtl ? (t.align === 'left' ? 'r' : 'l') : t.align === 'right' ? 'r' : 'l'
  const bodyPr =
    `<a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t">` +
    (t.autoFit && effSize < t.fontSize
      ? `<a:normAutofit fontScale="${Math.max(10000, Math.round((effSize / t.fontSize) * 100000))}" lnSpcReduction="0"/>`
      : '') +
    `</a:bodyPr>`
  const ppr =
    `<a:pPr algn="${align}"${rtl ? ' rtl="1"' : ''}>` +
    (t.lineHeight !== 1 ? `<a:lnSpc><a:spcPct val="${Math.round(t.lineHeight * 100000)}"/></a:lnSpc>` : '') +
    (t.listStyle === 'bullet'
      ? `<a:buFont typeface="Arial"/><a:buChar char="•"/>`
      : t.listStyle === 'number'
        ? `<a:buAutoNum type="arabicPeriod"/>`
        : '') +
    `</a:pPr>`
  const body = paras
    .map((p) => {
      if (!p.runs.length) return `<a:p>${ppr}</a:p>`
      return `<a:p>${ppr}${p.runs.map((r) => runXml(r.text, r.style, t, effSize)).join('')}</a:p>`
    })
    .join('')
  return (
    `<p:sp>` +
    nvSpPr(id, t.name || `Text ${id}`) +
    `<p:spPr>` +
    xfrmXml(t, 'topleft') +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `<a:noFill/>` +
    `<a:ln><a:noFill/></a:ln>` +
    (t.shadow?.enabled ? '' : '') +
    `</p:spPr>` +
    `<p:txBody>${bodyPr}<a:lstStyle/>${body}</p:txBody>` +
    `</p:sp>`
  )
}

/** A canvas text measurer — the same shape svg-export's uses
 *  (letterSpacing folded in so the search sees canvas widths). */
let measureCtx: CanvasRenderingContext2D | null = null
function measure(text: string, fontFamily: string, fontSize: number, bold: boolean): number {
  if (typeof document === 'undefined') return text.length * fontSize * 0.6
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return text.length * fontSize * 0.6
  measureCtx.font = `${bold ? 'bold ' : ''}${fontSize}px ${fontFamily}`
  return measureCtx.measureText(text).width
}

function measureWithSpacing(
  text: string,
  style: { fontFamily: string; bold: boolean; italic: boolean; letterSpacing: number; fontSize: number },
): number {
  return measure(text, style.fontFamily, style.fontSize, style.bold) + (style.letterSpacing ? style.letterSpacing * text.length : 0)
}

/** The auto-fit derived size — same derivation as the SVG export
 *  (lib/text-fit is the single source of truth; node tests fall
 *  back to the authored size without a canvas). */
function effectiveFontSize(t: TextElement): number {
  if (!t.autoFit) return t.fontSize
  if (typeof document === 'undefined') return t.fontSize
  return fitFontSize(
    {
      text: t.uppercase ? t.text.toUpperCase() : t.text,
      fontFamily: t.fontFamily,
      bold: t.bold,
      italic: t.italic,
      letterSpacing: t.letterSpacing,
      lineHeight: t.lineHeight,
      fontSize: t.fontSize,
    },
    { width: t.width, height: t.height },
    measureWithSpacing,
  )
}

function stickerXml(s: StickerElement, id: number): string {
  return (
    `<p:sp>` +
    nvSpPr(id, s.name || `Sticker ${id}`) +
    `<p:spPr>` +
    xfrmXml(s, 'topleft') +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `<a:noFill/><a:ln><a:noFill/></a:ln>` +
    `</p:spPr>` +
    `<p:txBody>` +
    `<a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"/>` +
    `<a:lstStyle/>` +
    `<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="${Math.round(s.fontSize * 0.75 * 100)}"><a:latin typeface="Segoe UI Emoji"/></a:rPr><a:t>${xesc(s.char)}</a:t></a:r></a:p>` +
    `</p:txBody>` +
    `</p:sp>`
  )
}

async function imageXml(im: ImageElement, id: number, ctx: SlideMapContext, imageRels: Map<string, string>): Promise<string | null> {
  // masked / filtered / shadowed images ride the raster path
  if (im.maskShape && im.maskShape !== 'none') return null
  if (im.brightness || im.contrast || im.saturation || im.shadow?.enabled) return null
  const part = await ctx.media.imagePart(im.src)
  if (!part) return null
  let rid = imageRels.get(part)
  if (!rid) {
    rid = `rId${imageRels.size + 1}`
    imageRels.set(part, rid)
  }
  const geom =
    im.radius > 0
      ? `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${Math.min(50000, Math.round((im.radius / Math.max(1, Math.min(im.width, im.height))) * 100000))}"/></a:avLst></a:prstGeom>`
      : `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`
  const alpha = im.opacity < 1 ? `<a:alphaModFix amt="${Math.round(im.opacity * 100000)}"/>` : ''
  return (
    `<p:pic>` +
    `<p:nvPicPr><p:cNvPr id="${id}" name="${xesc(im.name || `Image ${id}`)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${rid}"${alpha ? `>${alpha}</a:blip` : '/>'}` +
    `<a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr>` +
    xfrmXml(im, 'topleft', im.flipH, im.flipV) +
    geom +
    `<a:ln><a:noFill/></a:ln>` +
    `</p:spPr>` +
    `</p:pic>`
  )
}

// ── the raster fallback (the PDF rasterStrip pattern) ────────

async function rasterXml(el: AnyElement, id: number, ctx: SlideMapContext, imageRels: Map<string, string>): Promise<string | null> {
  if (typeof document === 'undefined') return null
  try {
    const { buildKonvaNode } = await import('@/lib/video-export')
    const K = (await import('konva')).default
    const pad = el.shadow?.enabled
      ? el.shadow.blur + Math.max(Math.abs(el.shadow.offsetX), Math.abs(el.shadow.offsetY)) + 4
      : 2
    const bx = el.x - pad
    const by = el.y - pad
    const bw = Math.max(1, el.width + pad * 2)
    const bh = Math.max(1, el.height + pad * 2)
    const scale = Math.min(4096 / Math.max(bw, bh), Math.max(0.25, ctx.pixelScale))
    const cw = Math.max(1, Math.round(bw * scale))
    const chh = Math.max(1, Math.round(bh * scale))
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:-99999px;top:0;'
    document.body.appendChild(host)
    try {
      const stage = new K.Stage({ container: host, width: cw, height: chh })
      const layer = new K.Layer({ listening: false, scale: { x: scale, y: scale }, x: -bx * scale, y: -by * scale })
      const node = buildKonvaNode(el, ctx.images, new Map())
      node.opacity(el.opacity ?? 1)
      layer.add(node as never)
      stage.add(layer)
      layer.draw()
      const canvas = stage.toCanvas({ x: 0, y: 0, width: cw, height: chh }) as HTMLCanvasElement
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), 'image/png'))
      if (!blob) return null
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const part = await ctx.media.registerRaster(bytes)
      if (!part) return null
      let rid = imageRels.get(part)
      if (!rid) {
        rid = `rId${imageRels.size + 1}`
        imageRels.set(part, rid)
      }
      return (
        `<p:pic>` +
        `<p:nvPicPr><p:cNvPr id="${id}" name="${xesc(el.name || `Element ${id}`)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
        `<p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
        `<p:spPr>` +
        xfrmXml({ x: bx, y: by, width: bw, height: bh, rotation: 0 }, 'topleft') +
        `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
        `</p:spPr>` +
        `</p:pic>`
      )
    } finally {
      host.remove()
    }
  } catch {
    return null
  }
}

// ── per-page size → deck size transform (video-export parity) ──

/** The fit-and-centre transform for a page whose size differs from
 *  the deck (v0.18 per-page sizes): every element is rebased in
 *  place — geometry AND every size-bearing field (font sizes,
 *  strokes, radii, shadows) — so native writers and the raster
 *  fallback (buildKonvaNode reads the same fields) agree to the
 *  pixel. Pages at the deck size take the identity fast path. */
function pageTransform(page: PageData, designW: number, designH: number): { f: number; ox: number; oy: number } {
  const pw = page.width || designW
  const ph = page.height || designH
  if (Math.abs(pw - designW) < 0.01 && Math.abs(ph - designH) < 0.01) return { f: 1, ox: 0, oy: 0 }
  const f = Math.min(designW / pw, designH / ph)
  return { f, ox: (designW - pw * f) / 2, oy: (designH - ph * f) / 2 }
}

function transformElement(el: AnyElement, t: { f: number; ox: number; oy: number }): AnyElement {
  if (t.f === 1) return el
  const f = t.f
  const scaled: Record<string, unknown> = {
    ...el,
    x: t.ox + el.x * f,
    y: t.oy + el.y * f,
    width: el.width * f,
    height: el.height * f,
  }
  if (el.type === 'text') {
    const t2 = scaled as unknown as TextElement
    t2.fontSize = el.fontSize * f
    if (el.letterSpacing) t2.letterSpacing = el.letterSpacing * f
  } else if (el.type === 'sticker') {
    ;(scaled as unknown as StickerElement).fontSize = (el as StickerElement).fontSize * f
  } else if (el.type === 'rect' || el.type === 'ellipse' || el.type === 'triangle' || el.type === 'star' || el.type === 'polygon') {
    const s = scaled as unknown as ShapeElement
    s.strokeWidth = el.strokeWidth * f
    if (el.cornerRadius) s.cornerRadius = el.cornerRadius * f
  } else if (el.type === 'line') {
    ;(scaled as unknown as LineElement).strokeWidth = (el as LineElement).strokeWidth * f
  } else if (el.type === 'image') {
    const im = scaled as unknown as ImageElement
    if (el.radius) im.radius = el.radius * f
  }
  if (el.shadow?.enabled) {
    scaled.shadow = {
      ...el.shadow,
      blur: el.shadow.blur * f,
      offsetX: el.shadow.offsetX * f,
      offsetY: el.shadow.offsetY * f,
    }
  }
  return scaled as unknown as AnyElement
}

// ── the slide ────────────────────────────────────────────────

export async function mapSlide(
  page: PageData,
  designW: number,
  designH: number,
  ctx: SlideMapContext,
): Promise<MappedSlide> {
  const imageRels = new Map<string, string>()
  const shapes: string[] = []
  let rasters = 0
  let natives = 0
  const t = pageTransform(page, designW, designH)

  const background =
    page.background.type === 'gradient'
      ? `<p:bg><p:bgPr>${gradFillXml(page.background, 1)}<a:effectLst/></p:bgPr></p:bg>`
      : `<p:bg><p:bgPr>${solidFill(page.background.type === 'solid' ? page.background.color : '#FFFFFF')}<a:effectLst/></p:bgPr></p:bg>`

  void designW
  void designH

  const walk = async (els: AnyElement[]): Promise<void> => {
    for (const raw of els) {
      if (!raw.visible) continue
      const el = transformElement(raw, t)
      const id = ctx.nextId()
      let xml: string | null = null
      let native = true
      if (el.type === 'text') {
        const te = el as TextElement
        // curved text / text effects / shadowed text → raster
        if (te.curve || te.effect || te.effectBackground || te.shadow?.enabled) native = false
        else xml = textXml(te, id, ctx)
      } else if (el.type === 'rect' || el.type === 'ellipse' || el.type === 'triangle' || el.type === 'star' || el.type === 'polygon') {
        xml = shapeXml(el as ShapeElement, id, ctx)
      } else if (el.type === 'line') {
        xml = lineXml(el as LineElement, id)
      } else if (el.type === 'sticker') {
        // v0.22: emoji stickers stay native text runs; authored vector
        // stickers ride the raster path (buildKonvaNode draws the
        // preloaded SVG bitmap — same as charts/tables fallbacks)
        const sk = el as StickerElement
        if (sk.svg) native = false
        else xml = stickerXml(sk, id)
      } else if (el.type === 'image') {
        xml = await imageXml(el as ImageElement, id, ctx, imageRels)
      } else if (el.type === 'group') {
        // children are page-absolute (svg-export parity) — recurse
        await walk((el as { children: AnyElement[] }).children)
        continue
      } else {
        native = false
      }
      if (!xml || !native) {
        const r = await rasterXml(el, id, ctx, imageRels)
        if (r) {
          shapes.push(r)
          rasters++
        }
        continue
      }
      shapes.push(xml)
      natives++
    }
  }
  await walk(page.elements)

  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
    `<p:cSld>` +
    background +
    `<p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    shapes.join('') +
    `</p:spTree>` +
    `</p:cSld>` +
    `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>` +
    `</p:sld>`
  return { xml, imageRels, rasters, natives }
}
