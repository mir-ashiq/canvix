// ─────────────────────────────────────────────────────────────
// Vector page renderer for PDF export (v0.15 R4).
//
// Maps every element type to PDF operators, mirroring the SVG
// serializer's geometry decisions one-for-one (same table cell
// baselines, same star points, same embed card layout, same
// cover-fit frames). Anything the vector path cannot express —
// emoji stickers, plugin renders, filtered images, drop shadows,
// curved/fx/gradient text — falls back to a per-element RASTER
// STRIP rendered by the very Konva compositor the video export
// uses (buildKonvaNode), so no content ever vanishes: pages stay
// vector where it matters, pixel-perfect where they must.
//
// All geometry is computed in DESIGN space (y-down, matching the
// serializer) and mirrored to PDF space (y-up) at emission; path
// orientation flips with it, which is harmless for the nonzero
// winding fills and clips used here. Element-local paths (frame
// clips, authored path shapes) are transformed numerically into
// design space before emission — no nested cm juggling.
// ─────────────────────────────────────────────────────────────

import type {
  AnyElement,
  ChartElement,
  EmbedElement,
  FrameElement,
  GradientFill,
  GroupElement,
  ImageElement,
  LineElement,
  PageData,
  ShapeElement,
  StickerElement,
  StrokeElement,
  TableElement,
  TextElement,
} from '@/lib/types'
import { chartPrimitives } from '@/lib/chart-geometry'
import { embedLayout, frameClipPathD, hostOf, tableGeometry, youtubeThumbUrl } from '@/lib/v06-geometry'
import { isMaskShape, maskPolygon, polygonPoints, starPointsEx, stretchPts, scalePts } from '@/lib/shapes'
import { drawTextElement, type TextIo, PdfFontRegistry } from './text-ops'
import type { PdfImageEmbedder } from './image-embed'
import { pdfNum, pdfRgb, PdfWriter } from './pdf-writer'

// ── path commands in DESIGN space (y-down) ──────────────────

type PathCmd =
  | { c: 'M'; x: number; y: number }
  | { c: 'L'; x: number; y: number }
  | { c: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { c: 'Z' }

const flip = (y: number, pageH: number): number => pageH - y

function emitPath(cmds: PathCmd[], pageH: number): string {
  const out: string[] = []
  for (const cmd of cmds) {
    if (cmd.c === 'M') out.push(`${pdfNum(cmd.x)} ${pdfNum(flip(cmd.y, pageH))} m`)
    else if (cmd.c === 'L') out.push(`${pdfNum(cmd.x)} ${pdfNum(flip(cmd.y, pageH))} l`)
    else if (cmd.c === 'C')
      out.push(
        `${pdfNum(cmd.x1)} ${pdfNum(flip(cmd.y1, pageH))} ${pdfNum(cmd.x2)} ${pdfNum(flip(cmd.y2, pageH))} ${pdfNum(cmd.x)} ${pdfNum(flip(cmd.y, pageH))} c`,
      )
    else out.push('h')
  }
  return out.join('\n')
}

/** Transform path commands numerically (translate + scale). */
function transformCmds(cmds: PathCmd[], dx: number, dy: number, sx = 1, sy = 1): PathCmd[] {
  const tx = (v: number): number => dx + v * sx
  const ty = (v: number): number => dy + v * sy
  return cmds.map((cmd) => {
    if (cmd.c === 'M' || cmd.c === 'L') return { ...cmd, x: tx(cmd.x), y: ty(cmd.y) }
    if (cmd.c === 'C')
      return { ...cmd, x1: tx(cmd.x1), y1: ty(cmd.y1), x2: tx(cmd.x2), y2: ty(cmd.y2), x: tx(cmd.x), y: ty(cmd.y) }
    return cmd
  }) as PathCmd[]
}

/** SVG appendix F.6.5 — endpoint → center arc parameterization
 * (phi = 0: our arcs are axis-aligned). */
function arcEndpointToCenter(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rx: number,
  ry: number,
  largeArc: boolean,
  sweep: boolean,
): { cx: number; cy: number; theta1: number; dtheta: number } {
  const dx2 = (x1 - x2) / 2
  const dy2 = (y1 - y2) / 2
  const lam = (dx2 * dx2) / (rx * rx) + (dy2 * dy2) / (ry * ry)
  const s = lam > 1 ? Math.sqrt(lam) : 1
  const RX = rx * s
  const RY = ry * s
  const sign = largeArc !== sweep ? 1 : -1
  const num = RX * RX * RY * RY - RX * RX * dy2 * dy2 - RY * RY * dx2 * dx2
  const den = RX * RX * dy2 * dy2 + RY * RY * dx2 * dx2
  const co = sign * Math.sqrt(Math.max(0, den > 0 ? num / den : 0))
  const cx = (co * RX * dy2) / RY + (x1 + x2) / 2
  const cy = (-co * RY * dx2) / RX + (y1 + y2) / 2
  const theta1 = Math.atan2((y1 - cy) / RY, (x1 - cx) / RX)
  const theta2 = Math.atan2((y2 - cy) / RY, (x2 - cx) / RX)
  let dtheta = theta2 - theta1
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI
  if (sweep && dtheta < 0) dtheta += 2 * Math.PI
  return { cx, cy, theta1, dtheta }
}

/** Parse the sanitizer-approved SVG path subset (M L H V C S Q T
 * A Z, both cases) into cubic commands. */
export function svgPathToCmds(d: string): PathCmd[] {
  const cmds: PathCmd[] = []
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)/g
  const tokens: (string | number)[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(d))) tokens.push(m[1] ? m[1] : Number(m[0]))
  let i = 0
  let cx = 0
  let cy = 0
  let startX = 0
  let startY = 0
  let prevC2x: number | null = null
  let prevC2y: number | null = null
  let prevQx: number | null = null
  let prevQy: number | null = null
  const num = (): number => (typeof tokens[i] === 'number' ? (tokens[i++] as number) : 0)
  while (i < tokens.length) {
    const t = tokens[i++]
    if (typeof t !== 'string') continue
    switch (t) {
      case 'M':
      case 'm': {
        const rel = t === 'm'
        cx = num() + (rel ? cx : 0)
        cy = num() + (rel ? cy : 0)
        cmds.push({ c: 'M', x: cx, y: cy })
        startX = cx
        startY = cy
        prevC2x = prevC2y = prevQx = prevQy = null
        break
      }
      case 'L':
      case 'l': {
        const rel = t === 'l'
        cx = num() + (rel ? cx : 0)
        cy = num() + (rel ? cy : 0)
        cmds.push({ c: 'L', x: cx, y: cy })
        prevC2x = prevC2y = prevQx = prevQy = null
        break
      }
      case 'H':
      case 'h': {
        cx = num() + (t === 'h' ? cx : 0)
        cmds.push({ c: 'L', x: cx, y: cy })
        prevC2x = prevC2y = prevQx = prevQy = null
        break
      }
      case 'V':
      case 'v': {
        cy = num() + (t === 'v' ? cy : 0)
        cmds.push({ c: 'L', x: cx, y: cy })
        prevC2x = prevC2y = prevQx = prevQy = null
        break
      }
      case 'C':
      case 'c': {
        const rel = t === 'c'
        const x1 = num() + (rel ? cx : 0)
        const y1 = num() + (rel ? cy : 0)
        const x2 = num() + (rel ? cx : 0)
        const y2 = num() + (rel ? cy : 0)
        const x = num() + (rel ? cx : 0)
        const y = num() + (rel ? cy : 0)
        cmds.push({ c: 'C', x1, y1, x2, y2, x, y })
        prevC2x = x2
        prevC2y = y2
        prevQx = prevQy = null
        cx = x
        cy = y
        break
      }
      case 'S':
      case 's': {
        const rel = t === 's'
        const x2 = num() + (rel ? cx : 0)
        const y2 = num() + (rel ? cy : 0)
        const x = num() + (rel ? cx : 0)
        const y = num() + (rel ? cy : 0)
        const x1 = prevC2x != null ? 2 * cx - prevC2x : cx
        const y1 = prevC2y != null ? 2 * cy - prevC2y : cy
        cmds.push({ c: 'C', x1, y1, x2, y2, x, y })
        prevC2x = x2
        prevC2y = y2
        prevQx = prevQy = null
        cx = x
        cy = y
        break
      }
      case 'Q':
      case 'q': {
        const rel = t === 'q'
        const qx = num() + (rel ? cx : 0)
        const qy = num() + (rel ? cy : 0)
        const x = num() + (rel ? cx : 0)
        const y = num() + (rel ? cy : 0)
        cmds.push({
          c: 'C',
          x1: cx + (2 / 3) * (qx - cx),
          y1: cy + (2 / 3) * (qy - cy),
          x2: x + (2 / 3) * (qx - x),
          y2: y + (2 / 3) * (qy - y),
          x,
          y,
        })
        prevQx = qx
        prevQy = qy
        prevC2x = prevC2y = null
        cx = x
        cy = y
        break
      }
      case 'T':
      case 't': {
        const rel = t === 't'
        const x = num() + (rel ? cx : 0)
        const y = num() + (rel ? cy : 0)
        const qx = prevQx != null ? 2 * cx - prevQx : cx
        const qy = prevQy != null ? 2 * cy - prevQy : cy
        cmds.push({
          c: 'C',
          x1: cx + (2 / 3) * (qx - cx),
          y1: cy + (2 / 3) * (qy - cy),
          x2: x + (2 / 3) * (qx - x),
          y2: y + (2 / 3) * (qy - y),
          x,
          y,
        })
        prevQx = qx
        prevQy = qy
        prevC2x = prevC2y = null
        cx = x
        cy = y
        break
      }
      case 'A':
      case 'a': {
        const rel = t === 'a'
        const rx = Math.abs(num())
        const ry = Math.abs(num())
        num() // x-axis-rotation (0 for our arcs)
        const largeArc = num() !== 0
        const sweep = num() !== 0
        const x = num() + (rel ? cx : 0)
        const y = num() + (rel ? cy : 0)
        if (rx > 0 && ry > 0 && (x !== cx || y !== cy)) {
          const { cx: acx, cy: acy, theta1, dtheta } = arcEndpointToCenter(cx, cy, x, y, rx, ry, largeArc, sweep)
          const segs = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2)))
          const step = dtheta / segs
          const k = (4 / 3) * Math.tan(step / 4)
          let px = cx
          let py = cy
          for (let s = 0; s < segs; s++) {
            const t0 = theta1 + step * s
            const t1 = theta1 + step * (s + 1)
            const p1x = acx + rx * Math.cos(t1)
            const p1y = acy + ry * Math.sin(t1)
            cmds.push({
              c: 'C',
              x1: px + k * -rx * Math.sin(t0),
              y1: py + k * ry * Math.cos(t0),
              x2: p1x - k * -rx * Math.sin(t1),
              y2: p1y - k * ry * Math.cos(t1),
              x: p1x,
              y: p1y,
            })
            px = p1x
            py = p1y
          }
        }
        cx = x
        cy = y
        prevC2x = prevC2y = prevQx = prevQy = null
        break
      }
      case 'Z':
      case 'z': {
        cmds.push({ c: 'Z' })
        cx = startX
        cy = startY
        break
      }
    }
  }
  return cmds
}

// ── common shapes in DESIGN space ────────────────────────────

function ellipseCmds(cx: number, cy: number, rx: number, ry: number): PathCmd[] {
  const kx = 0.5523 * rx
  const ky = 0.5523 * ry
  return [
    { c: 'M', x: cx - rx, y: cy },
    { c: 'C', x1: cx - rx, y1: cy - ky, x2: cx - kx, y2: cy - ry, x: cx, y: cy - ry },
    { c: 'C', x1: cx + kx, y1: cy - ry, x2: cx + rx, y2: cy - ky, x: cx + rx, y: cy },
    { c: 'C', x1: cx + rx, y1: cy + ky, x2: cx + kx, y2: cy + ry, x: cx, y: cy + ry },
    { c: 'C', x1: cx - kx, y1: cy + ry, x2: cx - rx, y2: cy + ky, x: cx - rx, y: cy },
    { c: 'Z' },
  ]
}

function roundRectCmds(x: number, y: number, w: number, h: number, r: number): PathCmd[] {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2))
  if (rr <= 0.01)
    return [
      { c: 'M', x, y },
      { c: 'L', x: x + w, y },
      { c: 'L', x: x + w, y: y + h },
      { c: 'L', x, y: y + h },
      { c: 'Z' },
    ]
  const k = 0.5523 * rr
  return [
    { c: 'M', x: x + rr, y },
    { c: 'L', x: x + w - rr, y },
    { c: 'C', x1: x + w - rr + k, y1: y, x2: x + w, y2: y + rr - k, x: x + w, y: y + rr },
    { c: 'L', x: x + w, y: y + h - rr },
    { c: 'C', x1: x + w, y1: y + h - rr + k, x2: x + w - rr + k, y2: y + h, x: x + w - rr, y: y + h },
    { c: 'L', x: x + rr, y: y + h },
    { c: 'C', x1: x + rr - k, y1: y + h, x2: x, y2: y + h - rr + k, x: x, y: y + h - rr },
    { c: 'L', x, y: y + rr },
    { c: 'C', x1: x, y1: y + rr - k, x2: x + rr - k, y2: y, x: x + rr, y },
    { c: 'Z' },
  ]
}

function polygonCmds(pts: Array<[number, number]>): PathCmd[] {
  if (!pts.length) return []
  return pts.map((p, i) => ({ c: i === 0 ? 'M' : 'L', x: p[0], y: p[1] }) as PathCmd).concat([{ c: 'Z' }])
}

/** y-down arc (SVG sweep-1 semantics) as cubic segments. */
function arcCmds(cx: number, cy: number, r: number, a0: number, a1: number, out: PathCmd[]): void {
  const d = a1 - a0
  const segs = Math.max(1, Math.ceil(Math.abs(d) / (Math.PI / 2)))
  const step = d / segs
  const k = (4 / 3) * Math.tan(step / 4)
  for (let s = 0; s < segs; s++) {
    const t0 = a0 + step * s
    const t1 = a0 + step * (s + 1)
    const p0x = cx + r * Math.cos(t0)
    const p0y = cy + r * Math.sin(t0)
    const p1x = cx + r * Math.cos(t1)
    const p1y = cy + r * Math.sin(t1)
    out.push({
      c: 'C',
      x1: p0x - k * r * Math.sin(t0),
      y1: p0y + k * r * Math.cos(t0),
      x2: p1x + k * r * Math.sin(t1),
      y2: p1y - k * r * Math.cos(t1),
      x: p1x,
      y: p1y,
    })
  }
}

/** Rotation cm — SVG `rotate(deg ox oy)` (y-down) expressed in
 * page space. */
export function rotationCm(deg: number, ox: number, oyDown: number, pageH: number): string {
  if (!deg) return ''
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  const oy = pageH - oyDown
  const e = ox - (c * ox + s * oy)
  const f = oy - (-s * ox + c * oy)
  return `${pdfNum(c)} ${pdfNum(-s)} ${pdfNum(s)} ${pdfNum(c)} ${pdfNum(e)} ${pdfNum(f)} cm`
}

// ── the renderer ────────────────────────────────────────────

export interface VectorPageIo {
  text: TextIo
  images: Map<string, HTMLImageElement>
  pixelScale: number
}

export class VectorPageRenderer {
  private patterns = new Map<string, number>()
  private xobjects = new Map<string, number>()
  private extgstates = new Map<number, string>()
  private gsObjects = new Map<string, number>()
  private counters = { pattern: 0, gs: 0 }

  constructor(
    private pdf: PdfWriter,
    private fonts: PdfFontRegistry,
    private embedder: PdfImageEmbedder,
    private ctx: VectorPageIo,
    private designW: number,
    private designH: number,
  ) {}

  /** Render one page → { content ops, /Resources dict body }. */
  async renderPage(page: PageData): Promise<{ ops: string; resources: string }> {
    const parts: string[] = []
    if (page.background.type === 'solid') {
      parts.push(`${pdfRgb(page.background.color)} rg 0 0 ${pdfNum(this.designW)} ${pdfNum(this.designH)} re f`)
    } else if (page.background.type === 'gradient') {
      const pat = this.gradientPattern(
        { type: 'linear', from: page.background.from, to: page.background.to, angle: page.background.angle },
        0,
        0,
        this.designW,
        this.designH,
      )
      parts.push(`/Pattern cs ${pat} scn 0 0 ${pdfNum(this.designW)} ${pdfNum(this.designH)} re f`)
    }
    for (const el of (page.elements ?? []) as AnyElement[]) {
      if (!el || el.visible === false) continue
      const ops = await this.renderElement(el)
      if (ops) parts.push(ops)
    }
    return { ops: parts.join('\n'), resources: this.resourcesDict() }
  }

  resourcesDict(): string {
    const chunks = [` /Font ${this.fonts.resourcesDict()} `]
    if (this.patterns.size) {
      const parts = [...this.patterns.entries()].map(([, id]) => `/P${id} ${this.pdf.ref(this.patternObject(id))}`)
      chunks.push(` /Pattern << ${parts.join(' ')} >> `)
    }
    if (this.xobjects.size) {
      const parts = [...this.xobjects.entries()].map(([name, obj]) => `/${name} ${this.pdf.ref(obj)}`)
      chunks.push(` /XObject << ${parts.join(' ')} >> `)
    }
    if (this.gsObjects.size) {
      const parts = [...this.gsObjects.entries()].map(([name, obj]) => `/${name} ${this.pdf.ref(obj)}`)
      chunks.push(` /ExtGState << ${parts.join(' ')} >> `)
    }
    return `<<${chunks.join('')}>>`
  }

  private patternObjects = new Map<number, number>()

  private patternObject(id: number): number {
    return this.patternObjects.get(id)!
  }

  private gsName(alpha: number): string {
    const key = Math.round(alpha * 100) / 100
    let name = this.extgstates.get(key)
    if (!name) {
      name = `GS${++this.counters.gs}`
      this.extgstates.set(key, name)
      this.gsObjects.set(name, this.pdf.addObject(`<< /Type /ExtGState /CA ${pdfNum(key)} /ca ${pdfNum(key)} >>`))
    }
    return name
  }

  private gradientPattern(grad: GradientFill, x: number, y: number, w: number, h: number): string {
    const key = `${grad.type}|${grad.from}|${grad.to}|${grad.angle}|${x},${y},${w},${h}`
    const existing = this.patterns.get(key)
    if (existing !== undefined) return `/P${existing}`
    const id = ++this.counters.pattern
    const c0 = pdfRgb(grad.from)
    const c1 = pdfRgb(grad.to)
    const fn = this.pdf.addObject(`<< /FunctionType 2 /Domain [0 1] /C0 [${c0}] /C1 [${c1}] /N 1 >>`)
    let shadingDict: string
    if (grad.type === 'radial') {
      // SVG radialGradient cx=50% cy=50% r=75% in bbox units
      shadingDict = `<< /ShadingType 3 /ColorSpace /DeviceRGB /Coords [0.5 0.5 0 0.5 0.5 0.75] /Function ${this.pdf.ref(fn)} /Extend [true true] >>`
    } else {
      const rad = (grad.angle * Math.PI) / 180
      const x1 = 0.5 - Math.cos(rad) * 0.5
      const y1 = 0.5 - Math.sin(rad) * 0.5
      const x2 = 0.5 + Math.cos(rad) * 0.5
      const y2 = 0.5 + Math.sin(rad) * 0.5
      shadingDict = `<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [${pdfNum(x1)} ${pdfNum(y1)} ${pdfNum(x2)} ${pdfNum(y2)}] /Function ${this.pdf.ref(fn)} /Extend [true true] >>`
    }
    const shading = this.pdf.addObject(shadingDict)
    // pattern space = bbox units (y-down) → page space via Matrix
    const pattern = this.pdf.addObject(
      `<< /Type /Pattern /PatternType 2 /Shading ${this.pdf.ref(shading)} /Matrix [${pdfNum(w)} 0 0 ${pdfNum(-h)} ${pdfNum(x)} ${pdfNum(this.designH - y)}] >>`,
    )
    this.patterns.set(key, id)
    this.patternObjects.set(id, pattern)
    return `/P${id}`
  }

  private wrapOpacity(el: AnyElement, ops: string): string {
    const a = el.opacity ?? 1
    if (a >= 0.999) return ops
    return `q /${this.gsName(a)} gs\n${ops}\nQ`
  }

  private wrapRotation(el: AnyElement, ops: string, originX?: number, originY?: number): string {
    const deg = el.rotation ?? 0
    if (!deg) return ops
    return `q ${rotationCm(deg, originX ?? el.x, originY ?? el.y, this.designH)}\n${ops}\nQ`
  }

  private async embedImage(src: string, boxW: number, boxH: number): Promise<{ name: string } | null> {
    const maxW = Math.min(4096, Math.max(64, Math.round(boxW * this.ctx.pixelScale * 1.25)))
    const maxH = Math.min(4096, Math.max(64, Math.round(boxH * this.ctx.pixelScale * 1.25)))
    const img = await this.embedder.embedDataUrl(src, { maxW, maxH })
    if (!img) return null
    const name = `Im${img.objNum}`
    this.xobjects.set(name, img.objNum)
    return { name }
  }

  private imagePaint(imgName: string, x: number, y: number, w: number, h: number, flipH = false, flipV = false): string {
    const a = flipH ? -w : w
    const d = flipV ? -h : h
    const tx = flipH ? x + w : x
    const ty = flipV ? this.designH - y : this.designH - y - h
    return `q ${pdfNum(a)} 0 0 ${pdfNum(d)} ${pdfNum(tx)} ${pdfNum(ty)} cm /${imgName} Do Q`
  }

  // ── element dispatch ──────────────────────────────────────

  private async renderElement(el: AnyElement): Promise<string | null> {
    try {
      switch (el.type) {
        case 'text': {
          const t = el as TextElement
          const ops = drawTextElement(t, this.designH, this.fonts, this.ctx.text)
          if (ops === null) return this.rasterStrip(el)
          return this.wrapRotation(el, this.wrapOpacity(el, ops))
        }
        case 'rect':
        case 'ellipse':
        case 'triangle':
        case 'star':
        case 'polygon':
        case 'path':
          return await this.renderShape(el as ShapeElement)
        case 'line':
          return await this.renderLine(el as LineElement)
        case 'stroke':
          return await this.renderStroke(el as StrokeElement)
        case 'image':
          return await this.renderImage(el as ImageElement)
        case 'sticker':
          return this.rasterStrip(el as StickerElement)
        case 'plugin':
          return this.rasterStrip(el)
        case 'table':
          return await this.renderTable(el as TableElement)
        case 'frame':
          return await this.renderFrame(el as FrameElement)
        case 'chart':
          return await this.renderChart(el as ChartElement)
        case 'embed':
          return await this.renderEmbed(el as EmbedElement)
        case 'group':
          return this.renderGroup(el as unknown as GroupElement)
        default:
          return null // audio/video: dropped, matching the SVG export
      }
    } catch {
      // a mapper bug must never lose content — the strip is the net
      return this.rasterStrip(el)
    }
  }

  private fillOf(el: ShapeElement, cmds: PathCmd[]): string {
    if (el.fillGradient) {
      const pat = this.gradientPattern(el.fillGradient, el.x, el.y, el.width, el.height)
      return `/Pattern cs ${pat} scn ${emitPath(cmds, this.designH)} f`
    }
    if (el.fill && el.fill !== 'transparent') {
      return `${pdfRgb(el.fill)} rg ${emitPath(cmds, this.designH)} f`
    }
    return ''
  }

  private strokeOf(cmds: PathCmd[], color: string, width: number, dash?: [number, number], nonScalingScale?: number): string {
    if (!color || color === 'transparent' || !width) return ''
    const w = nonScalingScale ? width / nonScalingScale : width
    const dashOps = dash ? `[${pdfNum(dash[0])} ${pdfNum(dash[1])}] 0 d` : '[] 0 d'
    return `1 J 1 j ${dashOps} ${pdfRgb(color)} RG ${pdfNum(w)} w ${emitPath(cmds, this.designH)} S [] 0 d`
  }

  private async renderShape(s: ShapeElement): Promise<string | null> {
    if (s.shadow?.enabled) return this.rasterStrip(s)
    let cmds: PathCmd[] = []
    let origin: [number, number] | undefined
    let nonScalingScale: number | undefined
    switch (s.type) {
      case 'rect':
        cmds = roundRectCmds(s.x, s.y, s.width, s.height, s.cornerRadius)
        break
      case 'ellipse':
        cmds = ellipseCmds(s.x + s.width / 2, s.y + s.height / 2, s.width / 2, s.height / 2)
        origin = [s.x + s.width / 2, s.y + s.height / 2]
        break
      case 'triangle':
        cmds = polygonCmds([
          [s.x, s.y + s.height],
          [s.x + s.width / 2, s.y],
          [s.x + s.width, s.y + s.height],
        ])
        break
      case 'star': {
        // v0.18 (Wave 3): parametric — stretchPts geometry identical to
        // the canvas / SVG / video renderers (fills the element box)
        cmds = polygonCmds(
          stretchPts(starPointsEx(s.numPoints ?? 5, s.innerRatio), s.x, s.y, s.width, s.height).map(
            ([x, y]) => [x, y] as [number, number],
          ),
        )
        origin = [s.x + s.width / 2, s.y + s.height / 2]
        break
      }
      case 'polygon': {
        // v0.18 (Wave 3): regular polygon — centred geometry like the star
        cmds = polygonCmds(
          stretchPts(polygonPoints(s.sides ?? 6), s.x, s.y, s.width, s.height).map(
            ([x, y]) => [x, y] as [number, number],
          ),
        )
        origin = [s.x + s.width / 2, s.y + s.height / 2]
        break
      }
      case 'path': {
        if (!s.pathData) return ''
        const sx = s.width / 100
        const sy = s.height / 100
        cmds = transformCmds(svgPathToCmds(s.pathData), s.x, s.y, sx, sy)
        nonScalingScale = (sx + sy) / 2
        // gradient fills on authored paths use the flat fallback
        // colour (documented approximation — v1)
        if (s.fillGradient) {
          const fallback = s.fill ?? s.fillGradient.from
          const body =
            s.fill && s.fill !== 'transparent'
              ? `${pdfRgb(fallback)} rg ${emitPath(cmds, this.designH)} f`
              : ''
          const stroke = this.strokeOf(cmds, s.stroke, s.strokeWidth, undefined, nonScalingScale)
          const joined = [body, stroke].filter(Boolean).join('\n')
          return joined ? this.wrapRotation(s, this.wrapOpacity(s, joined)) : ''
        }
        break
      }
    }
    const fill = this.fillOf(s, cmds)
    const stroke = this.strokeOf(cmds, s.stroke, s.strokeWidth, undefined, nonScalingScale)
    const body = [fill, stroke].filter(Boolean).join('\n')
    if (!body) return ''
    return this.wrapRotation(s, this.wrapOpacity(s, body), origin?.[0], origin?.[1])
  }

  private async renderLine(l: LineElement): Promise<string | null> {
    const x2 = l.x + Math.max(l.width, 12)
    const cmds: PathCmd[] = [
      { c: 'M', x: l.x, y: l.y },
      { c: 'L', x: x2, y: l.y },
    ]
    const dash: [number, number] | undefined = l.dashed ? [l.strokeWidth * 2.2, l.strokeWidth * 1.8] : undefined
    let out = this.strokeOf(cmds, l.stroke, l.strokeWidth, dash)
    const pl = Math.max(10, l.strokeWidth * 2.4)
    const pw = Math.max(8, l.strokeWidth * 2)
    const arrows: PathCmd[] = []
    if (l.arrowStart) arrows.push(...polygonCmds([[l.x + pl, l.y - pw / 2], [l.x + pl, l.y + pw / 2], [l.x, l.y]]))
    if (l.arrowEnd) arrows.push(...polygonCmds([[x2 - pl, l.y - pw / 2], [x2 - pl, l.y + pw / 2], [x2, l.y]]))
    if (arrows.length) out += `\n${pdfRgb(l.stroke)} rg ${emitPath(arrows, this.designH)} f`
    if (!out) return ''
    return this.wrapRotation(l, this.wrapOpacity(l, out))
  }

  private async renderStroke(s: StrokeElement): Promise<string | null> {
    if (!s.points || s.points.length < 4) return ''
    const cmds: PathCmd[] = []
    for (let i = 0; i + 1 < s.points.length; i += 2) {
      cmds.push({ c: i === 0 ? 'M' : 'L', x: s.x + s.points[i], y: s.y + s.points[i + 1] })
    }
    const ops = this.strokeOf(cmds, s.stroke, s.strokeWidth)
    return ops ? this.wrapOpacity(s, ops) : ''
  }

  private async renderImage(im: ImageElement): Promise<string | null> {
    const filtered = (im.brightness ?? 0) !== 0 || (im.contrast ?? 0) !== 0 || (im.saturation ?? 0) !== 0
    if (im.shadow?.enabled || filtered) return this.rasterStrip(im)
    const img = await this.embedImage(im.src, im.width, im.height)
    if (!img) return null
    const cxImg = im.x + im.width / 2
    const cyImg = im.y + im.height / 2
    // v0.18 (Wave 3): validated shape mask — clip polygon from the
    // shared geometry module (scalePts = the mask convention, same as
    // the canvas clipShapeFunc and the SVG clipPath)
    const maskPts =
      isMaskShape(im.maskShape) && im.maskShape !== 'none'
        ? scalePts(maskPolygon(im.maskShape, im.maskSides, im.maskInnerRatio)!, im.x, im.y, im.width, im.height)
        : null
    let body: string
    if (maskPts) {
      const clip = polygonCmds(maskPts.map(([x, y]) => [x, y] as [number, number]))
      body = `q ${emitPath(clip, this.designH)} W n ${this.imagePaint(img.name, im.x, im.y, im.width, im.height, im.flipH, im.flipV)} Q`
    } else if (im.radius) {
      const clip = roundRectCmds(im.x, im.y, im.width, im.height, im.radius)
      body = `q ${emitPath(clip, this.designH)} W n ${this.imagePaint(img.name, im.x, im.y, im.width, im.height, im.flipH, im.flipV)} Q`
    } else {
      body = this.imagePaint(img.name, im.x, im.y, im.width, im.height, im.flipH, im.flipV)
    }
    return this.wrapRotation(im, this.wrapOpacity(im, body), cxImg, cyImg)
  }

  private async renderTable(tb: TableElement): Promise<string | null> {
    if (tb.shadow?.enabled) return this.rasterStrip(tb)
    const geo = tableGeometry(tb)
    const parts: string[] = []
    const cells = tb.cells ?? []
    for (let idx = 0; idx < tb.rows * tb.cols; idx++) {
      const r = Math.floor(idx / tb.cols)
      const c = idx % tb.cols
      const cell = cells[idx] ?? { text: '' }
      const isHeader = r === 0
      const cellFill = cell.fill ?? (isHeader ? tb.headerFill : tb.fill)
      const x = tb.x + geo.colX[c]
      const y = tb.y + r * geo.rowH
      const w = geo.colW[c]
      const h = geo.rowH
      if (cellFill && cellFill !== 'transparent') {
        parts.push(`${pdfRgb(cellFill)} rg ${pdfNum(x)} ${pdfNum(this.designH - y - h)} ${pdfNum(w)} ${pdfNum(h)} re f`)
      }
      parts.push(
        `${pdfRgb(tb.borderColor)} RG ${pdfNum(tb.borderWidth)} w ${pdfNum(x)} ${pdfNum(this.designH - y - h)} ${pdfNum(w)} ${pdfNum(h)} re S`,
      )
      if (cell.text) {
        const textColor = isHeader ? tb.headerTextColor ?? '#FFFFFF' : tb.textColor
        parts.push(
          this.fonts.drawRun({
            x: x + 10,
            y: y + h / 2 + tb.fontSize * 0.35,
            pageH: this.designH,
            text: cell.text,
            fontFamily: tb.fontFamily,
            fontSize: tb.fontSize,
            bold: !!cell.bold || isHeader,
            italic: false,
            color: textColor,
          }),
        )
      }
    }
    const body = parts.filter(Boolean).join('\n')
    if (!body) return ''
    return this.wrapRotation(tb, this.wrapOpacity(tb, body))
  }

  private async renderFrame(fr: FrameElement): Promise<string | null> {
    if (fr.shadow?.enabled) return this.rasterStrip(fr)
    const d = frameClipPathD(fr.frameShape, fr.width, fr.height, fr.radius)
    const clip = transformCmds(svgPathToCmds(d), fr.x, fr.y)
    let content = ''
    if (fr.src && fr.naturalWidth > 0 && fr.naturalHeight > 0) {
      const img = await this.embedImage(fr.src, fr.width, fr.height)
      if (img) {
        const scale = Math.max(fr.width / fr.naturalWidth, fr.height / fr.naturalHeight)
        const dw = fr.naturalWidth * scale
        const dh = fr.naturalHeight * scale
        const dx = fr.x + (fr.width - dw) / 2
        const dy = fr.y + (fr.height - dh) / 2
        content = `q ${emitPath(clip, this.designH)} W n ${this.imagePaint(img.name, dx, dy, dw, dh)} Q`
      }
    }
    if (!content) {
      // empty frame placeholder — tinted shape + dashed outline
      content =
        `q /${this.gsName(0.16)} gs ${pdfRgb(fr.fill)} rg ${emitPath(clip, this.designH)} f Q\n` +
        `q /${this.gsName(0.85)} gs [8 6] 0 d 1 1 1 RG 2 w ${emitPath(clip, this.designH)} S Q`
    }
    return this.wrapRotation(fr, this.wrapOpacity(fr, content))
  }

  private async renderChart(ch: ChartElement): Promise<string | null> {
    if (ch.shadow?.enabled) return this.rasterStrip(ch)
    const parts: string[] = []
    const f = (n: number): number => Math.round(n * 10) / 10
    for (const p of chartPrimitives(ch)) {
      switch (p.kind) {
        case 'rect': {
          const cmds = roundRectCmds(ch.x + p.x, ch.y + p.y, p.w, p.h, p.r ?? 0)
          let ops = `${pdfRgb(p.fill)} rg ${emitPath(cmds, this.designH)} f`
          if (p.stroke) ops += `\n${this.strokeOf(cmds, p.stroke, p.strokeWidth ?? 1)}`
          parts.push(ops)
          break
        }
        case 'line': {
          const cmds: PathCmd[] = [
            { c: 'M', x: f(ch.x + p.x1), y: f(ch.y + p.y1) },
            { c: 'L', x: f(ch.x + p.x2), y: f(ch.y + p.y2) },
          ]
          parts.push(this.strokeOf(cmds, p.stroke, p.width, p.dash ? [p.dash[0], p.dash[1]] : undefined))
          break
        }
        case 'polyline': {
          const cmds: PathCmd[] = []
          for (let i = 0; i + 1 < p.points.length; i += 2) {
            cmds.push({ c: i === 0 ? 'M' : 'L', x: ch.x + p.points[i], y: ch.y + p.points[i + 1] })
          }
          parts.push(this.strokeOf(cmds, p.stroke, p.width))
          break
        }
        case 'circle': {
          const cmds = ellipseCmds(ch.x + p.cx, ch.y + p.cy, p.r, p.r)
          let ops = `${pdfRgb(p.fill)} rg ${emitPath(cmds, this.designH)} f`
          if (p.stroke) ops += `\n${this.strokeOf(cmds, p.stroke, p.strokeWidth ?? 1)}`
          parts.push(ops)
          break
        }
        case 'arc': {
          const cx = ch.x + p.cx
          const cy = ch.y + p.cy
          const cmds: PathCmd[] = [
            { c: 'M', x: cx + p.rOut * Math.cos(p.a0), y: cy + p.rOut * Math.sin(p.a0) },
          ]
          arcCmds(cx, cy, p.rOut, p.a0, p.a1, cmds)
          cmds.push({ c: 'L', x: cx + p.rIn * Math.cos(p.a1), y: cy + p.rIn * Math.sin(p.a1) })
          arcCmds(cx, cy, p.rIn, p.a1, p.a0, cmds)
          cmds.push({ c: 'Z' })
          parts.push(`${pdfRgb(p.fill)} rg ${emitPath(cmds, this.designH)} f`)
          break
        }
        case 'text': {
          const width = this.ctx.text.measure(p.text, {
            bold: !!p.bold,
            italic: false,
            fontSize: p.size,
            fontFamily: p.family,
            letterSpacing: 0,
          })
          const x =
            p.anchor === 'middle' ? p.x - width / 2 : p.anchor === 'end' ? p.x - width : p.x
          parts.push(
            this.fonts.drawRun({
              x: f(ch.x + x),
              y: f(ch.y + p.y),
              pageH: this.designH,
              text: p.text,
              fontFamily: p.family,
              fontSize: p.size,
              bold: !!p.bold,
              italic: false,
              color: p.fill,
              width,
            }),
          )
          break
        }
      }
    }
    const body = parts.filter(Boolean).join('\n')
    if (!body) return ''
    return this.wrapRotation(ch, this.wrapOpacity(ch, body))
  }

  private async renderEmbed(em: EmbedElement): Promise<string | null> {
    if (em.shadow?.enabled) return this.rasterStrip(em)
    const { bandH, iconR } = embedLayout(em.width, em.height)
    const x = em.x
    const y = em.y
    const w = em.width
    const h = em.height
    const cx = x + w / 2
    const cy = y + bandH / 2
    const parts: string[] = []
    parts.push(`${pdfRgb('#15171C')} rg ${pdfNum(x)} ${pdfNum(this.designH - y - h)} ${pdfNum(w)} ${pdfNum(h)} re f`)
    const thumb = em.kind === 'youtube' ? youtubeThumbUrl(em.url) : null
    const bandPath = roundRectCmds(x, y, w, bandH, 14)
    if (thumb) {
      const img = await this.embedImage(thumb, w, bandH)
      if (img) {
        parts.push(`q ${emitPath(bandPath, this.designH)} W n ${this.imagePaint(img.name, x, y, w, bandH)} Q`)
      } else {
        parts.push(`q /${this.gsName(0.28)} gs ${pdfRgb(em.tint)} rg ${emitPath(bandPath, this.designH)} f Q`)
      }
    } else {
      parts.push(`q /${this.gsName(0.28)} gs ${pdfRgb(em.tint)} rg ${emitPath(bandPath, this.designH)} f Q`)
    }
    if (em.kind === 'youtube') {
      const circ = ellipseCmds(cx, cy, iconR, iconR)
      parts.push(`q /${this.gsName(0.92)} gs 1 1 1 rg ${emitPath(circ, this.designH)} f Q`)
      parts.push(
        `${pdfRgb('#FF0033')} rg ${emitPath(
          polygonCmds([
            [cx - iconR * 0.32, cy - iconR * 0.42],
            [cx - iconR * 0.32, cy + iconR * 0.42],
            [cx + iconR * 0.46, cy],
          ]),
          this.designH,
        )} f`,
      )
    } else if (em.kind === 'map') {
      const circ = ellipseCmds(cx, cy, iconR, iconR)
      parts.push(`q /${this.gsName(0.95)} gs 1 1 1 rg ${emitPath(circ, this.designH)} f Q`)
      parts.push(`${pdfRgb('#34A853')} rg ${emitPath(ellipseCmds(cx, cy - iconR * 0.12, iconR * 0.34, iconR * 0.46), this.designH)} f`)
      parts.push(
        `${pdfRgb('#34A853')} rg ${emitPath(
          polygonCmds([
            [cx - iconR * 0.24, cy + iconR * 0.1],
            [cx, cy + iconR * 0.58],
            [cx + iconR * 0.24, cy + iconR * 0.1],
          ]),
          this.designH,
        )} f`,
      )
    } else {
      const s = iconR * 0.8
      const circ = ellipseCmds(cx, cy, iconR, iconR)
      parts.push(`q /${this.gsName(0.14)} gs 1 1 1 rg ${emitPath(circ, this.designH)} f Q`)
      parts.push(`q /${this.gsName(0.9)} gs 1 1 1 RG ${pdfNum(Math.max(2, iconR * 0.16))} w ${emitPath(circ, this.designH)} S Q`)
      const glyph: PathCmd[] = [
        { c: 'M', x: cx - s * 0.4, y: cy + s * 0.4 },
        { c: 'L', x: cx + s * 0.42, y: cy - s * 0.42 },
        { c: 'M', x: cx - s * 0.05, y: cy - s * 0.42 },
        { c: 'L', x: cx + s * 0.42, y: cy - s * 0.42 },
        { c: 'L', x: cx + s * 0.42, y: cy + s * 0.05 },
      ]
      parts.push(`q /${this.gsName(1)} gs 1 1 1 RG ${pdfNum(Math.max(2, iconR * 0.16))} w 1 J 1 j ${emitPath(glyph, this.designH)} S Q`)
    }
    const host = hostOf(em.url).toUpperCase()
    const title = em.title ?? em.url
    parts.push(
      this.fonts.drawRun({
        x: x + 14,
        y: y + bandH + 24,
        pageH: this.designH,
        text: host,
        fontFamily: 'Inter',
        fontSize: Math.max(9, Math.round(h * 0.055)),
        bold: false,
        italic: false,
        color: '#FFFFFF',
        letterSpacing: 1.2,
      }),
      this.fonts.drawRun({
        x: x + 14,
        y: y + bandH + 44,
        pageH: this.designH,
        text: title.length > 46 ? title.slice(0, 46) + '…' : title,
        fontFamily: 'Inter',
        fontSize: Math.max(11, Math.round(h * 0.07)),
        bold: true,
        italic: false,
        color: '#FFFFFF',
      }),
    )
    // host label at 55% white (SVG rgba(255,255,255,0.55))
    const body = parts.filter(Boolean).join('\n')
    if (!body) return ''
    return this.wrapRotation(em, this.wrapOpacity(em, body))
  }

  private async renderGroup(g: GroupElement): Promise<string | null> {
    const parts: string[] = []
    for (const child of (g.children ?? []) as AnyElement[]) {
      if (!child || child.visible === false) continue
      const ops = await this.renderElement(child)
      if (ops) parts.push(ops)
    }
    let body = parts.join('\n')
    if (g.rotation) body = `q ${rotationCm(g.rotation, g.x, g.y, this.designH)}\n${body}\nQ`
    if (!body) return ''
    return this.wrapOpacity(g, body)
  }

  // ── the raster strip (fail-safe per element) ──────────────

  private async rasterStrip(el: AnyElement): Promise<string | null> {
    if (typeof document === 'undefined') return null // node/tests: skip strips
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
      const scale = Math.min(4096 / Math.max(bw, bh), Math.max(0.25, this.ctx.pixelScale))
      const cw = Math.max(1, Math.round(bw * scale))
      const chh = Math.max(1, Math.round(bh * scale))
      const host = document.createElement('div')
      host.style.cssText = 'position:fixed;left:-99999px;top:0;'
      document.body.appendChild(host)
      try {
        const stage = new K.Stage({ container: host, width: cw, height: chh })
        const layer = new K.Layer({
          listening: false,
          scale: { x: scale, y: scale },
          x: -bx * scale,
          y: -by * scale,
        })
        const node = buildKonvaNode(el, this.ctx.images, new Map())
        const shape = node as unknown as {
          shadowColor?: (c: string) => void
          shadowBlur?: (n: number) => void
          shadowOffset?: (o: { x: number; y: number }) => void
        }
        if (el.shadow?.enabled && typeof shape.shadowColor === 'function') {
          shape.shadowColor!(el.shadow.color)
          shape.shadowBlur!(el.shadow.blur)
          shape.shadowOffset!({ x: el.shadow.offsetX, y: el.shadow.offsetY })
        }
        node.opacity(el.opacity ?? 1)
        layer.add(node as never)
        stage.add(layer)
        layer.draw()
        const canvas = stage.toCanvas({ x: 0, y: 0, width: cw, height: chh }) as HTMLCanvasElement
        const data = canvas.getContext('2d')?.getImageData(0, 0, cw, chh)
        if (!data) return null
        const img = await this.embedder.embedCanvas({ width: cw, height: chh, data: new Uint8Array(data.data) })
        const name = `Im${img.objNum}`
        this.xobjects.set(name, img.objNum)
        return this.imagePaint(name, bx, by, bw, bh)
      } finally {
        host.remove()
      }
    } catch {
      return null
    }
  }
}
