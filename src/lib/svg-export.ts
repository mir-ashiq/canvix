// ─────────────────────────────────────────────────────────────
// SVG export (v0.5) — true vector serialization of Canvix pages
//
// text, shapes, paths, strokes, images (href/clip), gradients,
// opacity, transforms (rotation/shadow) — no rasterization of
// vector elements. Text uses font-family references (viewers
// fall back gracefully); wrapping is measured with canvas 2D,
// mirroring Konva's algorithm.
//
// SECURITY: all text is XML-escaped; hrefs only allow data:/https?/;
// no <script>, no event attributes, no foreignObject. Output is
// safe to open in browsers and vector editors.
// ─────────────────────────────────────────────────────────────

import type {
  AnyElement,
  EmbedElement,
  FrameElement,
  GradientFill,
  ImageElement,
  LineElement,
  PageData,
  ShapeElement,
  StrokeElement,
  StickerElement,
  TableElement,
  TextElement,
  GroupElement,
} from '@/lib/types'
import { arcForCurve, embedLayout, frameClipPathD, hostOf, tableGeometry, youtubeThumbUrl } from '@/lib/v06-geometry'

// ── escaping ─────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function safeHref(src: string): string | null {
  if (src.startsWith('data:image/')) return src
  if (/^https?:\/\//i.test(src)) return src
  return null
}

// ── id sanitization for url(#id) references ─────────────────

let refCounter = 0
function refId(prefix: string): string {
  refCounter += 1
  return `${prefix}${refCounter}`
}

// ── gradient defs ────────────────────────────────────────────

function gradientDef(grad: GradientFill, w: number, h: number, id: string): string {
  if (grad.type === 'radial') {
    return `  <radialGradient id="${id}" cx="50%" cy="50%" r="75%">
    <stop offset="0%" stop-color="${esc(grad.from)}" />
    <stop offset="100%" stop-color="${esc(grad.to)}" />
  </radialGradient>`
  }
  // linear: angle in degrees (0 = →, 90 = ↓) — SVG gradient coords
  const rad = (grad.angle * Math.PI) / 180
  const cx = 0.5
  const cy = 0.5
  const half = 0.5
  const x1 = cx - Math.cos(rad) * half
  const y1 = cy - Math.sin(rad) * half
  const x2 = cx + Math.cos(rad) * half
  const y2 = cy + Math.sin(rad) * half
  return `  <linearGradient id="${id}" x1="${x1.toFixed(4)}" y1="${y1.toFixed(4)}" x2="${x2.toFixed(4)}" y2="${y2.toFixed(4)}">
    <stop offset="0%" stop-color="${esc(grad.from)}" />
    <stop offset="100%" stop-color="${esc(grad.to)}" />
  </linearGradient>`
}

// ── text wrapping (mirrors Konva word wrap) ─────────────────

function wrapText(text: string, fontFamily: string, fontSize: number, bold: boolean, maxWidth: number): string[] {
  if (!text) return []
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (!paragraph) {
      lines.push('')
      continue
    }
    const words = paragraph.split(' ')
    let line = ''
    for (const word of words) {
      const test = line ? `${line} ${word}` : word
      if (measureText(test, fontFamily, fontSize, bold) > maxWidth && line) {
        lines.push(line)
        line = word
      } else {
        line = test
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

let measureCtx: CanvasRenderingContext2D | null = null
function measureText(text: string, fontFamily: string, fontSize: number, bold: boolean): number {
  try {
    if (!measureCtx) {
      const canvas = document.createElement('canvas')
      measureCtx = canvas.getContext('2d')
    }
    if (!measureCtx) return text.length * fontSize * 0.55
    measureCtx.font = `${bold ? '700' : '400'} ${fontSize}px ${fontFamily}`
    return measureCtx.measureText(text).width
  } catch {
    return text.length * fontSize * 0.55
  }
}

// ── element serializers ──────────────────────────────────────

interface SvgContext {
  defs: string[]
}

function fillAttrs(el: { fill: string; fillGradient?: GradientFill | null; width: number; height: number }, ctx: SvgContext): { fill: string; strokeAttrs: string } {
  if (el.fillGradient) {
    const id = refId('grad')
    ctx.defs.push(gradientDef(el.fillGradient, el.width, el.height, id))
    return { fill: `url(#${id})`, strokeAttrs: '' }
  }
  return { fill: el.fill, strokeAttrs: '' }
}

function rotationTransform(el: { x: number; y: number; rotation?: number }, originX?: number, originY?: number): string {
  if (!el.rotation) return ''
  return ` rotate(${el.rotation} ${originX ?? el.x} ${originY ?? el.y})`
}

function opacityAttr(el: { opacity?: number }): string {
  return el.opacity !== undefined && el.opacity < 1 ? ` opacity="${el.opacity.toFixed(3)}"` : ''
}

function shadowAttrs(el: { shadow?: { enabled: boolean; color: string; blur: number; offsetX: number; offsetY: number } }, ctx: SvgContext): string {
  const s = el.shadow
  if (!s || !s.enabled) return ''
  const id = refId('shadow')
  ctx.defs.push(
    `  <filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">
    <feDropShadow dx="${s.offsetX}" dy="${s.offsetY}" stdDeviation="${Math.max(0.5, s.blur / 3)}" flood-color="${esc(s.color)}" />
  </filter>`
  )
  return ` filter="url(#${id})"`
}

function starPoints(cx: number, cy: number, outer: number, inner: number): string {
  const pts: string[] = []
  for (let i = 0; i < 5; i++) {
    const outerAngle = (Math.PI / 2) * -1 + (i * 2 * Math.PI) / 5
    const innerAngle = outerAngle + Math.PI / 5
    pts.push(`${(cx + outer * Math.cos(outerAngle)).toFixed(2)},${(cy + outer * Math.sin(outerAngle)).toFixed(2)}`)
    pts.push(`${(cx + inner * Math.cos(innerAngle)).toFixed(2)},${(cy + inner * Math.sin(innerAngle)).toFixed(2)}`)
  }
  return pts.join(' ')
}

function serializeElement(el: AnyElement, ctx: SvgContext): string {
  if (!el.visible) return ''
  const transformBase = rotationTransform(el)

  switch (el.type) {
    case 'text': {
      const t = el as TextElement
      const rendered = t.uppercase ? t.text.toUpperCase() : t.text

      // v0.6: curved text → textPath on an arc (path def carries the translate)
      const arc = arcForCurve(t.curve ?? 0, t.width)
      if (arc) {
        const pathId = refId('arc')
        ctx.defs.push(`  <path id="${pathId}" transform="translate(${t.x} ${t.y})" d="${arc.data}" fill="none" />`)
        const fill = t.fillGradient ? gradientRefFor(t, ctx) : t.fill
        const decor = [t.underline ? 'underline' : '', t.strike ? 'line-through' : ''].filter(Boolean).join(' ')
        const attrs = [
          `font-family="${esc(t.fontFamily)}"`,
          `font-size="${t.fontSize}"`,
          `font-weight="${t.bold ? 700 : 400}"`,
          `font-style="${t.italic ? 'italic' : 'normal'}"`,
          decor ? `text-decoration="${decor}"` : '',
          t.letterSpacing ? `letter-spacing="${t.letterSpacing}"` : '',
          `fill="${fill}"`,
          opacityAttr(t),
          shadowAttrs(t, ctx),
        ]
          .filter(Boolean)
          .join(' ')
        const transform = t.rotation ? ` transform="rotate(${t.rotation} ${t.x} ${t.y})"` : ''
        return `  <text ${attrs}${transform} xml:space="preserve"><textPath href="#${pathId}" xlink:href="#${pathId}">${esc(rendered)}</textPath></text>`
      }

      const lines = wrapText(rendered, t.fontFamily, t.fontSize, t.bold, t.width)
      const lineHeight = t.fontSize * t.lineHeight
      const fill = t.fillGradient ? gradientRefFor(t, ctx) : t.fill
      const anchor = t.align === 'center' ? 'middle' : t.align === 'right' ? 'end' : 'start'
      const anchorX = t.align === 'center' ? t.x + t.width / 2 : t.align === 'right' ? t.x + t.width : t.x
      // first baseline ≈ top + ascent (0.8 × fontSize approximates Konva's ascent)
      const firstBaseline = t.y + t.fontSize * 0.8
      const tspans = lines
        .map((line, i) => `<tspan x="${anchorX}" ${i === 0 ? `y="${firstBaseline.toFixed(1)}"` : `dy="${lineHeight.toFixed(1)}"`}>${esc(line)}</tspan>`)
        .join('')
      const decor = [t.underline ? 'underline' : '', t.strike ? 'line-through' : ''].filter(Boolean).join(' ')
      const attrs = [
        `font-family="${esc(t.fontFamily)}"`,
        `font-size="${t.fontSize}"`,
        `font-weight="${t.bold ? 700 : 400}"`,
        `font-style="${t.italic ? 'italic' : 'normal'}"`,
        decor ? `text-decoration="${decor}"` : '',
        t.letterSpacing ? `letter-spacing="${t.letterSpacing}"` : '',
        `text-anchor="${anchor}"`,
        `fill="${fill}"`,
        opacityAttr(t),
        shadowAttrs(t, ctx),
      ]
        .filter(Boolean)
        .join(' ')
      // rotation around the text box top-left (Konva semantics)
      const transform = t.rotation ? ` transform="rotate(${t.rotation} ${t.x} ${t.y})"` : ''
      return `  <text ${attrs}${transform} xml:space="preserve">${tspans}</text>`
    }

    case 'rect': {
      const s = el as ShapeElement
      const { fill } = fillAttrs(s, ctx)
      const gradFill = s.fillGradient ? gradientRefFor(s, ctx) : fill
      return `  <rect x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}"${s.cornerRadius ? ` rx="${s.cornerRadius}"` : ''}${s.stroke && s.stroke !== 'transparent' && s.strokeWidth ? ` stroke="${s.stroke}" stroke-width="${s.strokeWidth}"` : ''} fill="${gradFill}"${opacityAttr(s)}${shadowAttrs(s, ctx)}${transformBase ? ` transform="rotate(${s.rotation} ${s.x} ${s.y})"` : ''} />`
    }

    case 'ellipse': {
      const s = el as ShapeElement
      const cx = s.x + s.width / 2
      const cy = s.y + s.height / 2
      const gradFill = s.fillGradient ? gradientRefFor(s, ctx) : s.fill
      return `  <ellipse cx="${cx}" cy="${cy}" rx="${s.width / 2}" ry="${s.height / 2}"${s.stroke && s.stroke !== 'transparent' && s.strokeWidth ? ` stroke="${s.stroke}" stroke-width="${s.strokeWidth}"` : ''} fill="${gradFill}"${opacityAttr(s)}${shadowAttrs(s, ctx)}${transformBase ? ` transform="rotate(${s.rotation} ${cx} ${cy})"` : ''} />`
    }

    case 'triangle': {
      const s = el as ShapeElement
      const pts = `${s.x},${s.y + s.height} ${s.x + s.width / 2},${s.y} ${s.x + s.width},${s.y + s.height}`
      const gradFill = s.fillGradient ? gradientRefFor(s, ctx) : s.fill
      return `  <polygon points="${pts}"${s.stroke && s.stroke !== 'transparent' && s.strokeWidth ? ` stroke="${s.stroke}" stroke-width="${s.strokeWidth}" stroke-linejoin="round"` : ''} fill="${gradFill}"${opacityAttr(s)}${shadowAttrs(s, ctx)}${transformBase ? ` transform="rotate(${s.rotation} ${s.x} ${s.y})"` : ''} />`
    }

    case 'star': {
      const s = el as ShapeElement
      const cx = s.x + s.width / 2
      const cy = s.y + s.height / 2
      const outer = Math.min(s.width, s.height) / 2
      const gradFill = s.fillGradient ? gradientRefFor(s, ctx) : s.fill
      return `  <polygon points="${starPoints(cx, cy, outer, outer * 0.55)}"${s.stroke && s.stroke !== 'transparent' && s.strokeWidth ? ` stroke="${s.stroke}" stroke-width="${s.strokeWidth}" stroke-linejoin="round"` : ''} fill="${gradFill}"${opacityAttr(s)}${shadowAttrs(s, ctx)}${transformBase ? ` transform="rotate(${s.rotation} ${cx} ${cy})"` : ''} />`
    }

    case 'path': {
      const s = el as ShapeElement
      if (!s.pathData) return ''
      const sx = s.width / 100
      const sy = s.height / 100
      const gradFill = s.fillGradient ? gradientRefFor(s, ctx) : s.fill
      const sw = s.strokeWidth / Math.max(0.01, sx)
      return `  <path d="${sanitizePathData(s.pathData)}" transform="translate(${s.x} ${s.y}) scale(${sx.toFixed(4)} ${sy.toFixed(4)})${s.rotation ? ` rotate(${s.rotation} 0 0)` : ''}"${s.stroke && s.stroke !== 'transparent' && s.strokeWidth ? ` stroke="${s.stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"` : ''} fill="${gradFill}"${opacityAttr(s)}${shadowAttrs(s, ctx)} />`
    }

    case 'line': {
      const l = el as LineElement
      const x2 = l.x + Math.max(l.width, 12)
      const dash = l.dashed ? ` stroke-dasharray="${l.strokeWidth * 2.2} ${l.strokeWidth * 1.8}"` : ''
      let out = `  <line x1="${l.x}" y1="${l.y}" x2="${x2}" y2="${l.y}" stroke="${l.stroke}" stroke-width="${l.strokeWidth}" stroke-linecap="round"${dash}${opacityAttr(l)}${transformBase ? ` transform="rotate(${l.rotation} ${l.x} ${l.y})"` : ''} />`
      // arrowheads
      const pl = Math.max(10, l.strokeWidth * 2.4)
      const pw = Math.max(8, l.strokeWidth * 2)
      if (l.arrowStart) {
        out += `\n  <polygon points="${l.x + pl},${l.y - pw / 2} ${l.x + pl},${l.y + pw / 2} ${l.x},${l.y}" fill="${l.stroke}"${transformBase ? ` transform="rotate(${l.rotation} ${l.x} ${l.y})"` : ''} />`
      }
      if (l.arrowEnd) {
        out += `\n  <polygon points="${x2 - pl},${l.y - pw / 2} ${x2 - pl},${l.y + pw / 2} ${x2},${l.y}" fill="${l.stroke}"${transformBase ? ` transform="rotate(${l.rotation} ${l.x} ${l.y})"` : ''} />`
      }
      return out
    }

    case 'stroke': {
      const s = el as StrokeElement
      if (!s.points || s.points.length < 4) return ''
      const pts: string[] = []
      for (let i = 0; i + 1 < s.points.length; i += 2) {
        pts.push(`${(s.x + s.points[i]).toFixed(1)},${(s.y + s.points[i + 1]).toFixed(1)}`)
      }
      return `  <polyline points="${pts.join(' ')}" fill="none" stroke="${s.stroke}" stroke-width="${s.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${opacityAttr(s)} />`
    }

    case 'image': {
      const im = el as ImageElement
      const href = safeHref(im.src)
      if (!href) return ''
      const clipId = im.radius ? refId('clip') : null
      if (im.radius) {
        ctx.defs.push(`  <clipPath id="${clipId}"><rect x="${im.x}" y="${im.y}" width="${im.width}" height="${im.height}" rx="${im.radius}" /></clipPath>`)
      }
      // flips mirror around the image center: x' = 2·cx − x
      const cxImg = im.x + im.width / 2
      const cyImg = im.y + im.height / 2
      const fx = im.flipH ? `translate(${2 * cxImg} 0) scale(-1 1)` : ''
      const fy = im.flipV ? `translate(0 ${2 * cyImg}) scale(1 -1)` : ''
      const transform = [fx, fy, im.rotation ? `rotate(${im.rotation} ${cxImg} ${cyImg})` : '']
        .filter(Boolean)
        .join(' ')
      return `  <image href="${esc(href)}" x="${im.x}" y="${im.y}" width="${im.width}" height="${im.height}"${clipId ? ` clip-path="url(#${clipId})"` : ''}${transform ? ` transform="${transform}"` : ''}${opacityAttr(im)}${shadowAttrs(im, ctx)} preserveAspectRatio="none" />`
    }

    case 'sticker': {
      const sk = el as StickerElement
      const cx = sk.x + sk.width / 2
      const cy = sk.y + sk.height / 2
      return `  <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="${sk.fontSize}" font-family="'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif"${opacityAttr(sk)}${transformBase ? ` transform="rotate(${sk.rotation} ${cx} ${cy})"` : ''}>${esc(sk.char)}</text>`
    }

    case 'group': {
      const g = el as GroupElement
      const children = g.children
        .filter((c) => c.visible)
        .map((c) => serializeElement({ ...c, x: c.x - g.x, y: c.y - g.y, rotation: c.rotation } as AnyElement, ctx))
        .filter(Boolean)
        .join('\n')
      return `  <g transform="translate(${g.x} ${g.y})${g.rotation ? ` rotate(${g.rotation})` : ''}"${opacityAttr(g)}>\n${children}\n  </g>`
    }

    case 'table': {
      const tb = el as TableElement
      const geo = tableGeometry(tb)
      const parts: string[] = []
      for (let idx = 0; idx < tb.rows * tb.cols; idx += 1) {
        const r = Math.floor(idx / tb.cols)
        const c = idx % tb.cols
        const cell = tb.cells[idx] ?? { text: '' }
        const isHeader = r === 0
        const cellFill = cell.fill ?? (isHeader ? tb.headerFill : tb.fill)
        const x = tb.x + geo.colX[c]
        const y = tb.y + r * geo.rowH
        const w = geo.colW[c]
        const h = geo.rowH
        parts.push(`  <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"${cellFill !== 'transparent' ? ` fill="${cellFill}"` : ' fill="none"'} stroke="${tb.borderColor}" stroke-width="${tb.borderWidth}" />`)
        if (cell.text) {
          const textColor = isHeader ? (tb.headerTextColor ?? '#FFFFFF') : tb.textColor
          const baseline = y + h / 2 + tb.fontSize * 0.35
          parts.push(`  <text x="${(x + 10).toFixed(1)}" y="${baseline.toFixed(1)}" font-family="${esc(tb.fontFamily)}" font-size="${tb.fontSize}" font-weight="${cell.bold || isHeader ? 700 : 400}" fill="${textColor}">${esc(cell.text)}</text>`)
        }
      }
      const transform = tb.rotation ? ` transform="rotate(${tb.rotation} ${tb.x} ${tb.y})"` : ''
      const open = `<g${transform}${opacityAttr(tb)}${shadowAttrs(tb, ctx)}>`
      return `${open}\n${parts.join('\n')}\n  </g>`
    }

    case 'frame': {
      const fr = el as FrameElement
      const clipId = refId('fclip')
      const d = frameClipPathD(fr.frameShape, fr.width, fr.height, fr.radius)
      ctx.defs.push(`  <clipPath id="${clipId}"><path transform="translate(${fr.x} ${fr.y})" d="${d}" /></clipPath>`)
      const rotate = fr.rotation ? ` transform="rotate(${fr.rotation} ${fr.x} ${fr.y})"` : ''
      const href = fr.src ? safeHref(fr.src) : null
      let content = ''
      if (href && fr.naturalWidth > 0 && fr.naturalHeight > 0) {
        // cover-fit like the canvas renderer
        const scale = Math.max(fr.width / fr.naturalWidth, fr.height / fr.naturalHeight)
        const dw = fr.naturalWidth * scale
        const dh = fr.naturalHeight * scale
        const dx = fr.x + (fr.width - dw) / 2
        const dy = fr.y + (fr.height - dh) / 2
        content = `  <image href="${esc(href)}" x="${dx.toFixed(1)}" y="${dy.toFixed(1)}" width="${dw.toFixed(1)}" height="${dh.toFixed(1)}" clip-path="url(#${clipId})" preserveAspectRatio="none" />`
      } else {
        // empty frame placeholder — tinted shape + dashed outline
        content = `  <path transform="translate(${fr.x} ${fr.y})" d="${d}" fill="${fr.fill}" fill-opacity="0.16" stroke="rgba(255,255,255,0.85)" stroke-width="2" stroke-dasharray="8 6" />`
      }
      const open = `<g${rotate}${opacityAttr(fr)}${shadowAttrs(fr, ctx)}>`
      return `${open}\n${content}\n  </g>`
    }

    case 'embed': {
      const em = el as EmbedElement
      const { bandH, iconR } = embedLayout(em.width, em.height)
      const x = em.x
      const y = em.y
      const w = em.width
      const h = em.height
      const cx = x + w / 2
      const cy = y + bandH / 2
      const parts: string[] = []
      parts.push(`  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="#15171C" />`)
      const thumb = em.kind === 'youtube' ? youtubeThumbUrl(em.url) : null
      // top-rounded media band path (bottom edge straight, meets the label area)
      const bandPath = `M ${x + 14} ${y} H ${x + w - 14} Q ${x + w} ${y} ${x + w} ${y + 14} V ${y + bandH} H ${x} V ${y + 14} Q ${x} ${y} ${x + 14} ${y} Z`
      if (thumb) {
        const clipId = refId('eclip')
        ctx.defs.push(`  <clipPath id="${clipId}"><path d="${bandPath}" /></clipPath>`)
        parts.push(`  <image href="${esc(thumb)}" x="${x}" y="${y}" width="${w}" height="${bandH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})" />`)
      } else {
        parts.push(`  <path d="${bandPath}" fill="${em.tint}" fill-opacity="0.28" />`)
      }
      // icon glyph
      if (em.kind === 'youtube') {
        parts.push(`  <circle cx="${cx}" cy="${cy}" r="${iconR}" fill="rgba(255,255,255,0.92)" />`)
        parts.push(`  <polygon points="${cx - iconR * 0.32},${cy - iconR * 0.42} ${cx - iconR * 0.32},${cy + iconR * 0.42} ${cx + iconR * 0.46},${cy}" fill="#FF0033" />`)
      } else if (em.kind === 'map') {
        parts.push(`  <circle cx="${cx}" cy="${cy}" r="${iconR}" fill="rgba(255,255,255,0.95)" />`)
        parts.push(`  <ellipse cx="${cx}" cy="${cy - iconR * 0.12}" rx="${iconR * 0.34}" ry="${iconR * 0.46}" fill="#34A853" />`)
        parts.push(`  <polygon points="${cx - iconR * 0.24},${cy + iconR * 0.1} ${cx},${cy + iconR * 0.58} ${cx + iconR * 0.24},${cy + iconR * 0.1}" fill="#34A853" />`)
      } else {
        const s = iconR * 0.8
        parts.push(`  <circle cx="${cx}" cy="${cy}" r="${iconR}" fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.9)" stroke-width="2.5" />`)
        parts.push(`  <path d="M ${cx - s * 0.4} ${cy + s * 0.4} L ${cx + s * 0.42} ${cy - s * 0.42} M ${cx - s * 0.05} ${cy - s * 0.42} L ${cx + s * 0.42} ${cy - s * 0.42} L ${cx + s * 0.42} ${cy + s * 0.05}" stroke="#FFFFFF" stroke-width="${Math.max(2, iconR * 0.16)}" stroke-linecap="round" stroke-linejoin="round" fill="none" />`)
      }
      // labels
      const host = hostOf(em.url).toUpperCase()
      const title = em.title ?? em.url
      parts.push(`  <text x="${x + 14}" y="${y + bandH + 24}" font-family="Inter" font-size="${Math.max(9, Math.round(h * 0.055))}" letter-spacing="1.2" fill="rgba(255,255,255,0.55)">${esc(host)}</text>`)
      parts.push(`  <text x="${x + 14}" y="${y + bandH + 44}" font-family="Inter" font-size="${Math.max(11, Math.round(h * 0.07))}" font-weight="600" fill="#FFFFFF">${esc(title.length > 46 ? title.slice(0, 46) + '…' : title)}</text>`)
      const rotate = em.rotation ? ` transform="rotate(${em.rotation} ${x} ${y})"` : ''
      const open = `<g${rotate}${opacityAttr(em)}${shadowAttrs(em, ctx)}>`
      return `${open}\n${parts.join('\n')}\n  </g>`
    }

    default:
      return ''
    }
}

function gradientRefFor(el: { fillGradient?: GradientFill | null; width: number; height: number }, ctx: SvgContext): string {
  if (!el.fillGradient) return 'none'
  const id = refId('grad')
  ctx.defs.push(gradientDef(el.fillGradient, el.width, el.height, id))
  return `url(#${id})`
}

/** Path data sanitizer — keeps a safe subset of SVG path commands. */
function sanitizePathData(d: string): string {
  // allow M,m,L,l,H,h,V,v,C,c,S,s,Q,q,T,t,A,a,Z,z + numbers/commas/spaces
  const cleaned = d.replace(/[^MmLlHhVvCcSsQqTtAaZz0-9.,\s+-]/g, '')
  return esc(cleaned)
}

// ── page → SVG ───────────────────────────────────────────────

/** Serialize one page to a standalone SVG document string. */
export function exportPageToSVG(page: PageData, designWidth: number, designHeight: number): string {
  refCounter = 0
  const ctx: SvgContext = { defs: [] }

  // background
  let bgOut = ''
  if (page.background.type === 'solid') {
    bgOut = `  <rect width="${designWidth}" height="${designHeight}" fill="${esc(page.background.color)}" />`
  } else if (page.background.type === 'gradient') {
    const bgGrad: GradientFill = {
      type: 'linear',
      from: page.background.from,
      to: page.background.to,
      angle: page.background.angle,
    }
    const fill = gradientRefFor({ fillGradient: bgGrad, width: designWidth, height: designHeight }, ctx)
    bgOut = `  <rect width="${designWidth}" height="${designHeight}" fill="${fill}" />`
  }

  const elements = page.elements
    .map((el) => serializeElement(el, ctx))
    .filter(Boolean)
    .join('\n')

  const defs = ctx.defs.length ? `<defs>\n${ctx.defs.join('\n')}\n</defs>\n` : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${designWidth}" height="${designHeight}" viewBox="0 0 ${designWidth} ${designHeight}">
${defs}${bgOut}
${elements}
</svg>
`
}

/** Serialize all pages → array of SVG strings (one file per page). */
export function exportDesignToSVGs(pages: PageData[], designWidth: number, designHeight: number): string[] {
  return pages.map((p) => exportPageToSVG(p, designWidth, designHeight))
}

/** Trigger a browser download of an SVG string. */
export function downloadSVG(svg: string, filename: string): void {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
