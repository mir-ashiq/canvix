// ─────────────────────────────────────────────────────────────
// xml-helpers — unit conversions, colour parsing and XML string
// safety for the PPTX writers (Wave 5). Kept tiny and pure: the
// slide mapper only ever speaks EMU / 100ths-of-a-point / OOXML
// colour elements through this module.
//
// Conversions on record:
//   • Canvix design space is CSS px @ 96 dpi → 1 px = 9525 EMU
//   • font sizes: px × 0.75 = pt; OOXML sz is 1/100 pt
//   • letter spacing: px → spc (1/100 pt) the same way
//   • rotation: OOXML rot = degrees × 60000 (clockwise, like the
//     canvas — but always around the shape CENTRE, which is why
//     the mapper re-bases top-left-rotating elements)
// ─────────────────────────────────────────────────────────────

/** XML-escape a text node / attribute value. */
export function xesc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** px → EMU (English Metric Units), the OOXML length unit. */
export function emu(px: number): number {
  if (!Number.isFinite(px)) return 0
  return Math.round(px * 9525)
}

/** px → pt (font sizes, line widths). */
export function pxToPt(px: number): number {
  return px * 0.75
}

/** Parse a Canvix colour into {hex, alpha} — accepts #rgb, #rgba,
 * #rrggbb, #rrggbbaa and plain rrggbb. `transparent` and anything
 * unparseable resolves to null (callovers treat it as "no fill"). */
export function parseColor(color: string | undefined | null): { hex: string; alpha: number } | null {
  if (!color || typeof color !== 'string') return null
  const s = color.trim().toLowerCase()
  if (!s || s === 'transparent' || s === 'none') return null
  const hex = s.startsWith('#') ? s.slice(1) : s
  if (!/^[0-9a-f]+$/.test(hex)) return null
  if (hex.length === 3) {
    return { hex: hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2], alpha: 1 }
  }
  if (hex.length === 4) {
    return {
      hex: hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2],
      alpha: parseInt(hex[3] + hex[3], 16) / 255,
    }
  }
  if (hex.length === 6) return { hex, alpha: 1 }
  if (hex.length === 8) return { hex: hex.slice(0, 6), alpha: parseInt(hex.slice(6, 8), 16) / 255 }
  return null
}

/** An `<a:solidFill>` (or a bare `<a:srgbClr>`) for a Canvix colour.
 *  Alpha < 1 rides as the child element; `opacity` folds an
 *  element-level opacity into the same alpha. Returns '' for no
 *  colour. */
export function solidFill(
  color: string | undefined | null,
  opts: { bare?: boolean; opacity?: number } = {},
): string {
  const c = parseColor(color)
  if (!c) return ''
  const alpha = Math.round(c.alpha * Math.min(1, Math.max(0, opts.opacity ?? 1)) * 100000)
  const clr = `<a:srgbClr val="${c.hex}">${alpha < 100000 ? `<a:alpha val="${alpha}"/>` : ''}</a:srgbClr>`
  return opts.bare ? clr : `<a:solidFill>${clr}</a:solidFill>`
}

/** An `<a:ln>` stroke for shape borders: width in px, colour, dash. */
export function strokeLn(stroke: string, widthPx: number, dashed = false): string {
  const fill = solidFill(stroke)
  if (!fill || !widthPx || widthPx <= 0) return ''
  return (
    `<a:ln w="${emu(widthPx)}">` +
    fill +
    (dashed ? '<a:prstDash val="dash"/>' : '') +
    `<a:round/>` +
    `</a:ln>`
  )
}

/** The position a Canvix element's box CENTRE occupies after the
 *  editor rotates it around its rotation origin. Canvix rotates
 *  most node types around the box top-left (Konva semantics —
 *  see element-node.tsx / svg-export.ts); ellipse/star/polygon
 *  nodes sit at their centre, so they rotate around the centre.
 *  OOXML always rotates around the centre, so top-left-rotating
 *  elements need this re-base to land pixel-identically. */
export function centerAfterRotation(
  x: number,
  y: number,
  w: number,
  h: number,
  rotationDeg: number,
  origin: 'topleft' | 'center',
): { cx: number; cy: number } {
  const cx = x + w / 2
  const cy = y + h / 2
  if (!rotationDeg || origin === 'center') return { cx, cy }
  // clockwise rotation in screen coords (y grows down):
  // [cos −sin; sin cos] applied around the origin point
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  // vector origin → centre, rotated
  const vx = w / 2
  const vy = h / 2
  return { cx: x + vx * cos - vy * sin, cy: y + vx * sin + vy * cos }
}

/** Clamp + format an OOXML percentage attribute (0..100000 style). */
export function pct(v: number): number {
  return Math.min(100000, Math.max(0, Math.round(v)))
}
