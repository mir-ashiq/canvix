// ─────────────────────────────────────────────────────────────
// v0.6 shared geometry — pure functions used by BOTH the Konva
// renderers (client) and the SVG exporter (server-safe). No DOM,
// no Konva imports allowed in this file.
// ─────────────────────────────────────────────────────────────

import type { EmbedKind, FrameShape, TableElement } from '@/lib/types'

// ── curved text ──────────────────────────────────────────────

/** Arc geometry for a curved text element (local coords, origin = element x/y).
 *  curve: −180..180 (0 = straight). Positive = arch up, negative = valley.
 *  Returns the SVG path data + the arc's visual height. */
export function arcForCurve(curve: number, width: number): { data: string; height: number } | null {
  const deg = Math.max(-180, Math.min(180, Math.abs(curve)))
  if (deg < 2 || width < 12) return null
  const a = (deg * Math.PI) / 180 // total sweep (radians)
  const r = Math.max(10, width / 2 / Math.sin(a / 2))
  const sag = r - r * Math.cos(a / 2) // peak height of the arc
  if (!Number.isFinite(r) || !Number.isFinite(sag)) return null
  const largeArc = a > Math.PI ? 1 : 0
  if (curve > 0) {
    // arch up: baseline peaks at y=0, ends dip to y=sag
    return {
      data: `M 0 ${sag.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${largeArc} 1 ${width.toFixed(2)} ${sag.toFixed(2)}`,
      height: sag,
    }
  }
  // valley: starts at y=0, dips to y=sag
  return {
    data: `M 0 0 A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${largeArc} 0 ${width.toFixed(2)} 0`,
    height: sag,
  }
}

// ── tables ───────────────────────────────────────────────────

/** Effective column/row geometry (proportional when el.width ≠ ΣcolWidths). */
export function tableGeometry(el: TableElement): { colX: number[]; colW: number[]; rowH: number } {
  const sum = el.colWidths.reduce((a, b) => a + b, 0)
  const scale = sum > 0 ? el.width / sum : 1
  const colW = el.colWidths.map((w) => w * scale)
  const colX: number[] = []
  let acc = 0
  for (const w of colW) {
    colX.push(acc)
    acc += w
  }
  const rowH = el.rows > 0 ? el.height / el.rows : el.rowHeight
  return { colX, colW, rowH }
}

// ── frames ───────────────────────────────────────────────────

export function hexPoints(w: number, h: number): [number, number][] {
  return [
    [w, h / 2],
    [w * 0.75, h],
    [w * 0.25, h],
    [0, h / 2],
    [w * 0.25, 0],
    [w * 0.75, 0],
  ]
}

/** SVG path data for a frame clip shape (local coords, origin = element x/y). */
export function frameClipPathD(shape: FrameShape, w: number, h: number, r: number): string {
  switch (shape) {
    case 'ellipse':
    case 'circle': {
      const rx = shape === 'circle' ? Math.min(w, h) / 2 : w / 2
      const ry = shape === 'circle' ? Math.min(w, h) / 2 : h / 2
      // approximate an ellipse with two arcs
      return `M 0 ${h / 2} A ${rx} ${ry} 0 0 1 ${w} ${h / 2} A ${rx} ${ry} 0 0 1 0 ${h / 2} Z`
    }
    case 'triangle':
      return `M 0 ${h} L ${w / 2} 0 L ${w} ${h} Z`
    case 'hexagon':
      return hexPoints(w, h).map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ') + ' Z'
    default: {
      const rr = Math.min(r, w / 2, h / 2)
      if (rr <= 0) return `M 0 0 H ${w} V ${h} H 0 Z`
      return `M ${rr} 0 H ${w - rr} Q ${w} 0 ${w} ${rr} V ${h - rr} Q ${w} ${h} ${w - rr} ${h} H ${rr} Q 0 ${h} 0 ${h - rr} V ${rr} Q 0 0 ${rr} 0 Z`
    }
  }
}

// ── embeds ───────────────────────────────────────────────────

export function youtubeThumbUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'youtu.be') return null
    const v = u.searchParams.get('v') || (host === 'youtu.be' ? u.pathname.split('/').pop() : '') || ''
    return v ? `https://i.ytimg.com/vi/${v}/hqdefault.jpg` : null
  } catch {
    return null
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'link'
  }
}

export function embedTintFor(kind: EmbedKind): string {
  if (kind === 'youtube') return '#FF0033'
  if (kind === 'map') return '#34A853'
  return '#7630D7'
}

/** embed card layout metrics */
export function embedLayout(w: number, h: number): { bandH: number; iconR: number } {
  const bandH = Math.round(h * 0.62)
  const iconR = Math.max(18, Math.min(34, Math.round(Math.min(w, bandH) * 0.18)))
  return { bandH, iconR }
}
