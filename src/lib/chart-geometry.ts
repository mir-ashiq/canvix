// ─────────────────────────────────────────────────────────────
// chart-geometry (v0.14, D7) — the ONE pure layout module for the
// data-bound chart element.
//
// chartPrimitives(element) turns a ChartElement into a flat list of
// vector primitives in ELEMENT-LOCAL coordinates (origin = element
// top-left; adapters add x/y/rotation/opacity). Three thin adapters
// map the same list:
//
//   editor        src/components/editor/canvas/chart-node.tsx  (react-konva)
//   video export  src/lib/video-export.ts buildKonvaNode       (Konva)
//   SVG export    src/lib/svg-export.ts serializeElement       (SVG strings)
//
// → geometric parity across all three renderers BY CONSTRUCTION.
//
// Text handling: primitives carry a baseline `y` + anchor
// ('start' | 'middle' | 'end'). SVG maps that to text-anchor; the
// Konva adapters center/right-align inside a wide box offset from the
// anchor so both renderers agree without measuring text. The Konva
// box top = baseline − 0.78 × size (documented approximation of the
// Inter ascent — labels sit within a pixel of the SVG rendering).
//
// Documented approximations (same spirit as image-filters.ts):
//   • donut renders the FIRST series — multi-ring donuts are out of
//     scope for v1; the data editor says so
//   • stacked bars run two cursors: positives stack up from zero,
//     negatives stack down from zero
//   • smooth lines are Catmull-Rom splines sampled HERE (16 points
//     per segment), not by the renderer — every renderer draws
//     identical pixels
//   • scatter ignores showValues (per-point labels are noise);
//     bar/line/donut honor it
// ─────────────────────────────────────────────────────────────

import type { ChartElement, ChartKind, ChartSeries } from '@/lib/types'

// ── caps (every untrusted boundary enforces these) ───────────

export const MAX_CHART_SERIES = 6
export const MAX_CHART_LABELS = 24
/** scatter values are flat [x,y,…] pairs — 24 points max */
export const MAX_CHART_SCATTER_NUMBERS = 48
export const CHART_VALUE_LIMIT = 1e9

/** fallback series colors (also the MCP/paste fallback) */
export const CHART_PALETTE = ['#7630D7', '#02C0CC', '#FF5C8A', '#FFD166', '#22C55E', '#3B82F6'] as const

export function isChartKind(v: unknown): v is ChartKind {
  return v === 'bar' || v === 'line' || v === 'donut' || v === 'scatter'
}

/** donut hole ratio 0–0.85, junk → 0.62 */
export function clampChartHole(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0.62
  return Math.min(0.85, Math.max(0, n))
}

/** labels: strings only, ≤ MAX_CHART_LABELS, each ≤ 24 chars */
export function sanitizeChartLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((l): l is string => typeof l === 'string')
    .slice(0, MAX_CHART_LABELS)
    .map((l) => l.slice(0, 24))
}

function hexColor(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : fallback
}

/**
 * Series from untrusted input (paste envelope, MCP patch): ≤ 6 series,
 * finite values clamped to ±1e9, ≤ 24 values per series (bar/line/donut)
 * or ≤ 48 flat numbers kept even-length (scatter). Never throws.
 */
export function sanitizeChartSeries(raw: unknown, scatter: boolean): ChartSeries[] {
  if (!Array.isArray(raw)) return []
  const out: ChartSeries[] = []
  for (const item of raw.slice(0, MAX_CHART_SERIES)) {
    if (!item || typeof item !== 'object') continue
    const s = item as Record<string, unknown>
    const name = typeof s.name === 'string' ? s.name.slice(0, 40) : `Series ${out.length + 1}`
    const color = hexColor(s.color, CHART_PALETTE[out.length % CHART_PALETTE.length])
    const values: number[] = []
    if (Array.isArray(s.values)) {
      for (const v of s.values.slice(0, scatter ? MAX_CHART_SCATTER_NUMBERS : MAX_CHART_LABELS)) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          values.push(Math.max(-CHART_VALUE_LIMIT, Math.min(CHART_VALUE_LIMIT, v)))
        }
      }
      // scatter pairs must stay even-length
      if (scatter && values.length % 2 === 1) values.pop()
    }
    out.push({ name, color, values })
  }
  return out
}

// ── primitives ───────────────────────────────────────────────

export type ChartPrimitive =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; r?: number; fill: string; stroke?: string; strokeWidth?: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; width: number; dash?: number[] }
  | { kind: 'polyline'; points: number[]; stroke: string; width: number }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill: string; stroke?: string; strokeWidth?: number }
  | { kind: 'arc'; cx: number; cy: number; rIn: number; rOut: number; a0: number; a1: number; fill: string }
  | {
      kind: 'text'
      x: number
      /** baseline */
      y: number
      text: string
      size: number
      family: string
      fill: string
      bold?: boolean
      anchor: 'start' | 'middle' | 'end'
    }

// ── small pure helpers ───────────────────────────────────────

const GRID_COLOR = '#E4E6EB'
const AXIS_COLOR = '#D1D5DB'

/** compact human numbers: 1.2k / 3.4M / 2B / 12.5 */
export function formatChartNumber(v: number): string {
  const a = Math.abs(v)
  const trim = (n: number): string => String(Math.round(n * 10) / 10)
  if (a >= 1e9) return `${trim(v / 1e9)}B`
  if (a >= 1e6) return `${trim(v / 1e6)}M`
  if (a >= 1e4) return `${trim(v / 1e3)}k`
  if (a >= 100) return String(Math.round(v))
  if (Number.isInteger(v)) return String(v)
  return String(Math.round(v * 10) / 10)
}

/** truncate a label to fit `maxChars` (≥ 2) with an honest ellipsis */
function fitLabel(s: string, maxChars: number): string {
  if (maxChars < 2) return s.length ? `${s.slice(0, 1)}…` : ''
  return s.length > maxChars ? `${s.slice(0, maxChars - 1)}…` : s
}

interface TickScale {
  lo: number
  hi: number
  ticks: number[]
}

/** nice round ticks for a value range (1-2-5 decades); zero-span padded */
function niceScale(min: number, max: number, count: number, includeZero: boolean): TickScale {
  let lo = Number.isFinite(min) ? min : 0
  let hi = Number.isFinite(max) ? max : 1
  if (includeZero) {
    if (lo > 0) lo = 0
    if (hi < 0) hi = 0
  }
  if (hi - lo === 0 || !Number.isFinite(hi - lo)) {
    const pad = Math.max(1, Math.abs(hi) * 0.5)
    lo -= pad
    hi += pad
  }
  const rawStep = (hi - lo) / Math.max(1, count)
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const norm = rawStep / mag
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag
  const tLo = Math.floor(lo / step) * step
  const tHi = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let t = tLo; t <= tHi + step / 2; t += step) {
    ticks.push(Math.round(t * 1e6) / 1e6)
    if (ticks.length > 12) break
  }
  return { lo: tLo, hi: tHi, ticks }
}

/** uniform Catmull-Rom through pts, sampled `per` points per segment */
function catmullRomSampled(pts: { x: number; y: number }[], per = 16): number[] {
  if (pts.length < 3) return pts.flatMap((p) => [p.x, p.y])
  const out: number[] = [pts[0].x, pts[0].y]
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? pts[i + 1]
    for (let s = 1; s <= per; s += 1) {
      const t = s / per
      const t2 = t * t
      const t3 = t2 * t
      const x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3)
      const y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
      out.push(x, y)
    }
  }
  return out
}

interface Point {
  x: number
  y: number
}

interface Plot {
  x: number
  y: number
  w: number
  h: number
}

// ── shared furniture: grid, axes, legend ─────────────────────

function legendPrimitives(el: ChartElement, cx: number, topY: number): ChartPrimitive[] {
  const out: ChartPrimitive[] = []
  if (!el.showLegend || el.series.length < 2) return out
  const size = Math.min(13, Math.max(9, el.fontSize))
  const chip = size * 0.72
  const gap = 14
  const items = el.series.map((s, i) => {
    const label = s.name || `Series ${i + 1}`
    return { label, color: s.color, w: label.length * size * 0.58 + chip + 6 }
  })
  const totalW = items.reduce((a, b) => a + b.w + gap, -gap)
  let lx = cx - totalW / 2
  const baseline = topY + size
  for (const it of items) {
    out.push({ kind: 'rect', x: lx, y: baseline - chip + 1, w: chip, h: chip, r: 3, fill: it.color })
    out.push({ kind: 'text', x: lx + chip + 6, y: baseline, text: it.label, size, family: el.fontFamily, fill: el.textColor, anchor: 'start' })
    lx += it.w + gap
  }
  return out
}

function yAxisPrimitives(el: ChartElement, plot: Plot, scale: TickScale): ChartPrimitive[] {
  const out: ChartPrimitive[] = []
  const span = scale.hi - scale.lo || 1
  const py = (v: number): number => plot.y + plot.h * (1 - (v - scale.lo) / span)
  for (const t of scale.ticks) {
    const y = py(t)
    if (el.showGrid) {
      out.push({ kind: 'line', x1: plot.x, y1: y, x2: plot.x + plot.w, y2: y, stroke: GRID_COLOR, width: 1 })
    }
    out.push({
      kind: 'text',
      x: plot.x - 8,
      y: y + el.fontSize * 0.36,
      text: formatChartNumber(t),
      size: el.fontSize,
      family: el.fontFamily,
      fill: el.textColor,
      anchor: 'end',
    })
  }
  out.push({ kind: 'line', x1: plot.x, y1: plot.y, x2: plot.x, y2: plot.y + plot.h, stroke: AXIS_COLOR, width: 1 })
  return out
}

function noDataPrimitives(el: ChartElement): ChartPrimitive[] {
  return [
    {
      kind: 'text',
      x: el.width / 2,
      y: el.height / 2 + el.fontSize * 0.36,
      text: 'No data',
      size: Math.max(12, el.fontSize),
      family: el.fontFamily,
      fill: el.textColor,
      anchor: 'middle',
    },
  ]
}

// ── per-kind geometry (all element-local) ────────────────────

function barPrimitives(el: ChartElement): ChartPrimitive[] {
  const out: ChartPrimitive[] = []
  if (!el.series.length || !el.labels.length) return noDataPrimitives(el)
  const legendH = el.showLegend && el.series.length > 1 ? el.fontSize + 18 : 0
  const scale = barScale(el)
  const labelW = Math.max(...scale.ticks.map((t) => formatChartNumber(t).length), 1) * el.fontSize * 0.6 + 6
  const plot: Plot = {
    x: labelW + 8,
    y: 8,
    w: el.width - labelW - 18,
    h: el.height - 16 - el.fontSize - 12 - legendH,
  }
  if (plot.w < 40 || plot.h < 40) return noDataPrimitives(el)
  out.push(...yAxisPrimitives(el, plot, scale))
  const span = scale.hi - scale.lo || 1
  const py = (v: number): number => plot.y + plot.h * (1 - (v - scale.lo) / span)
  const zeroY = py(Math.min(Math.max(0, scale.lo), scale.hi))
  out.push({ kind: 'line', x1: plot.x, y1: zeroY, x2: plot.x + plot.w, y2: zeroY, stroke: AXIS_COLOR, width: 1.5 })

  const n = el.labels.length
  const bandW = plot.w / n
  const maxChars = Math.max(2, Math.floor(bandW / (el.fontSize * 0.55)))
  const valueSize = Math.max(9, Math.min(el.fontSize, 13))

  if (el.barMode === 'stack') {
    const seriesW = Math.min(bandW * 0.6, 120)
    for (let b = 0; b < n; b += 1) {
      const bx = plot.x + b * bandW + (bandW - seriesW) / 2
      const barW = Math.max(2, seriesW - 1)
      let pos = 0
      let neg = 0
      for (const s of el.series) {
        const v = s.values[b] ?? 0
        if (!v) continue
        const y0 = v > 0 ? py(pos) : py(neg)
        const y1 = v > 0 ? py(pos + v) : py(neg + v)
        out.push({ kind: 'rect', x: bx, y: Math.min(y0, y1), w: barW, h: Math.max(1, Math.abs(y1 - y0)), r: Math.min(3, barW / 2), fill: s.color })
        if (v > 0) pos += v
        else neg += v
      }
      const topY = Math.min(py(pos), py(neg))
      if (el.showValues) {
        out.push({ kind: 'text', x: bx + barW / 2, y: topY - 5, text: formatChartNumber(pos + neg), size: valueSize, family: el.fontFamily, fill: el.textColor, anchor: 'middle' })
      }
      out.push({ kind: 'text', x: bx + seriesW / 2, y: plot.y + plot.h + el.fontSize, text: fitLabel(el.labels[b], maxChars), size: el.fontSize, family: el.fontFamily, fill: el.textColor, anchor: 'middle' })
    }
  } else {
    const seriesW = bandW * 0.68
    const barW = Math.max(2, seriesW / el.series.length - 1)
    for (let b = 0; b < n; b += 1) {
      const bandX = plot.x + b * bandW + (bandW - seriesW) / 2
      el.series.forEach((s, si) => {
        const v = s.values[b] ?? 0
        const bx = bandX + si * (seriesW / el.series.length)
        const y1 = py(v)
        out.push({ kind: 'rect', x: bx, y: Math.min(y1, zeroY), w: barW, h: Math.max(1, Math.abs(y1 - zeroY)), r: Math.min(4, barW / 2), fill: s.color })
        if (el.showValues) {
          out.push({ kind: 'text', x: bx + barW / 2, y: Math.min(y1, zeroY) - 5, text: formatChartNumber(v), size: valueSize, family: el.fontFamily, fill: el.textColor, anchor: 'middle' })
        }
      })
      out.push({ kind: 'text', x: bandX + seriesW / 2, y: plot.y + plot.h + el.fontSize, text: fitLabel(el.labels[b], maxChars), size: el.fontSize, family: el.fontFamily, fill: el.textColor, anchor: 'middle' })
    }
  }
  out.push(...legendPrimitives(el, el.width / 2, plot.y + plot.h + el.fontSize + 10))
  return out
}

function barScale(el: ChartElement): TickScale {
  let min = Infinity
  let max = -Infinity
  for (const s of el.series) for (const v of s.values) {
    if (!Number.isFinite(v)) continue
    min = Math.min(min, v)
    max = Math.max(max, v)
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return niceScale(0, 1, 4, true)
  return niceScale(min, max, 4, true)
}

function linePrimitives(el: ChartElement): ChartPrimitive[] {
  const out: ChartPrimitive[] = []
  if (!el.series.length || el.labels.length < 2) return noDataPrimitives(el)
  const scale = barScale(el)
  const legendH = el.showLegend && el.series.length > 1 ? el.fontSize + 18 : 0
  const labelW = Math.max(...scale.ticks.map((t) => formatChartNumber(t).length), 1) * el.fontSize * 0.6 + 6
  const plot: Plot = {
    x: labelW + 8,
    y: 10,
    w: el.width - labelW - 18,
    h: el.height - 18 - el.fontSize - 12 - legendH,
  }
  if (plot.w < 40 || plot.h < 40 || el.labels.length < 2) return noDataPrimitives(el)
  out.push(...yAxisPrimitives(el, plot, scale))
  out.push({ kind: 'line', x1: plot.x, y1: plot.y + plot.h, x2: plot.x + plot.w, y2: plot.y + plot.h, stroke: AXIS_COLOR, width: 1.5 })

  const count = el.labels.length
  const stepX = plot.w / Math.max(1, count - 1)
  const span = scale.hi - scale.lo || 1
  const py = (v: number): number => plot.y + plot.h * (1 - (v - scale.lo) / span)
  const maxChars = Math.max(2, Math.floor((stepX + 4) / (el.fontSize * 0.55)))
  const valueSize = Math.max(9, Math.min(el.fontSize, 13))

  el.series.forEach((s) => {
    const pts: (Point & { v: number })[] = []
    for (let i = 0; i < count; i += 1) {
      const v = s.values[i]
      if (typeof v !== 'number' || !Number.isFinite(v)) continue
      pts.push({ x: plot.x + i * stepX, y: py(v), v })
    }
    if (pts.length === 0) return
    const flat = el.smooth && pts.length > 2 ? catmullRomSampled(pts) : pts.flatMap((p) => [p.x, p.y])
    out.push({ kind: 'polyline', points: flat, stroke: s.color, width: 3 })
    const dotR = count > 16 ? 2.5 : count > 10 ? 3.5 : 4.5
    for (const p of pts) {
      out.push({ kind: 'circle', cx: p.x, cy: p.y, r: dotR, fill: '#FFFFFF', stroke: s.color, strokeWidth: 2 })
      if (el.showValues) {
        out.push({ kind: 'text', x: p.x, y: p.y - dotR - 5, text: formatChartNumber(p.v), size: valueSize, family: el.fontFamily, fill: el.textColor, anchor: 'middle' })
      }
    }
  })

  for (let i = 0; i < count; i += 1) {
    out.push({ kind: 'text', x: plot.x + i * stepX, y: plot.y + plot.h + el.fontSize, text: fitLabel(el.labels[i], maxChars), size: el.fontSize, family: el.fontFamily, fill: el.textColor, anchor: 'middle' })
  }
  out.push(...legendPrimitives(el, el.width / 2, plot.y + plot.h + el.fontSize + 10))
  return out
}

function donutPrimitives(el: ChartElement): ChartPrimitive[] {
  const out: ChartPrimitive[] = []
  const s = el.series[0]
  if (!s || !el.labels.length) return noDataPrimitives(el)
  const legendH = el.showLegend && el.series.length > 1 ? el.fontSize + 18 : 0
  const cx = el.width / 2
  const cy = (el.height - legendH) / 2
  const rOut = Math.max(10, Math.min(cx, cy) - 10)
  const rIn = rOut * clampChartHole(el.hole)
  const weights = el.labels.map((_, i) => Math.max(0, s.values[i] ?? 0))
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) return noDataPrimitives(el)

  let a = -Math.PI / 2
  const labelR = (rIn + rOut) / 2
  for (let i = 0; i < weights.length; i += 1) {
    const w = weights[i]
    if (w <= 0) continue
    const sweep = (w / total) * Math.PI * 2
    const a0 = a
    const a1 = a + sweep
    if (sweep >= Math.PI * 2 - 1e-6) {
      // a single 100% slice — two half arcs so every renderer closes it
      out.push({ kind: 'arc', cx, cy, rIn, rOut, a0, a1: a0 + sweep / 2, fill: s.color })
      out.push({ kind: 'arc', cx, cy, rIn, rOut, a0: a0 + sweep / 2, a1, fill: s.color })
    } else {
      out.push({ kind: 'arc', cx, cy, rIn, rOut, a0, a1, fill: s.color })
    }
    if (el.showValues && rOut - rIn > 18) {
      const mid = a0 + sweep / 2
      const pct = Math.round((w / total) * 100)
      out.push({
        kind: 'text',
        x: cx + Math.cos(mid) * labelR,
        y: cy + Math.sin(mid) * labelR + el.fontSize * 0.36,
        text: `${pct}%`,
        size: el.fontSize,
        family: el.fontFamily,
        fill: '#FFFFFF',
        bold: true,
        anchor: 'middle',
      })
    }
    a = a1
  }
  // centre total
  out.push({
    kind: 'text',
    x: cx,
    y: cy + el.fontSize * 0.5,
    text: formatChartNumber(total),
    size: Math.max(14, Math.round(el.fontSize * 1.7)),
    family: el.fontFamily,
    fill: el.textColor,
    bold: true,
    anchor: 'middle',
  })
  out.push(...legendPrimitives(el, el.width / 2, el.height - legendH + 6))
  return out
}

function scatterPrimitives(el: ChartElement): ChartPrimitive[] {
  const out: ChartPrimitive[] = []
  const pts = scatterPoints(el)
  if (!pts.length) return noDataPrimitives(el)
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const xScale = niceScale(Math.min(...xs), Math.max(...xs), 4, false)
  const yScale = niceScale(Math.min(...ys), Math.max(...ys), 4, false)
  const legendH = el.showLegend && el.series.length > 1 ? el.fontSize + 18 : 0
  const labelW = Math.max(...yScale.ticks.map((t) => formatChartNumber(t).length), 1) * el.fontSize * 0.6 + 6
  const plot: Plot = {
    x: labelW + 8,
    y: 10,
    w: el.width - labelW - 18,
    h: el.height - 18 - el.fontSize - 12 - legendH,
  }
  if (plot.w < 40 || plot.h < 40) return noDataPrimitives(el)
  const px = (v: number): number => plot.x + ((v - xScale.lo) / (xScale.hi - xScale.lo || 1)) * plot.w
  const py = (v: number): number => plot.y + plot.h * (1 - (v - yScale.lo) / (yScale.hi - yScale.lo || 1))

  out.push(...yAxisPrimitives(el, plot, yScale))
  if (el.showGrid) {
    for (const t of xScale.ticks) {
      out.push({ kind: 'line', x1: px(t), y1: plot.y, x2: px(t), y2: plot.y + plot.h, stroke: GRID_COLOR, width: 1 })
    }
  }
  out.push({ kind: 'line', x1: plot.x, y1: plot.y + plot.h, x2: plot.x + plot.w, y2: plot.y + plot.h, stroke: AXIS_COLOR, width: 1.5 })
  out.push({ kind: 'line', x1: plot.x, y1: plot.y, x2: plot.x, y2: plot.y + plot.h, stroke: AXIS_COLOR, width: 1.5 })

  for (const t of xScale.ticks) {
    out.push({ kind: 'text', x: px(t), y: plot.y + plot.h + el.fontSize, text: formatChartNumber(t), size: el.fontSize, family: el.fontFamily, fill: el.textColor, anchor: 'middle' })
  }
  const dotR = pts.length > 40 ? 3.5 : 5
  for (const p of pts) {
    out.push({ kind: 'circle', cx: px(p.x), cy: py(p.y), r: dotR, fill: p.color, stroke: '#FFFFFF', strokeWidth: 1.5 })
  }
  out.push(...legendPrimitives(el, el.width / 2, plot.y + plot.h + el.fontSize + 10))
  return out
}

interface ScatterPoint extends Point {
  color: string
}

function scatterPoints(el: ChartElement): ScatterPoint[] {
  const out: ScatterPoint[] = []
  for (const s of el.series) {
    for (let i = 0; i + 1 < s.values.length; i += 2) {
      const x = s.values[i]
      const y = s.values[i + 1]
      if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y, color: s.color })
    }
  }
  return out.slice(0, MAX_CHART_SCATTER_NUMBERS)
}

// ── the public entry ─────────────────────────────────────────

/** Full geometry for a chart element, element-local coordinates. */
export function chartPrimitives(el: ChartElement): ChartPrimitive[] {
  const out: ChartPrimitive[] = []
  if (el.fill !== 'transparent') {
    out.push({ kind: 'rect', x: 0, y: 0, w: el.width, h: el.height, r: 12, fill: el.fill })
  }
  const body: ChartPrimitive[] =
    el.kind === 'donut'
      ? donutPrimitives(el)
      : el.kind === 'line'
        ? linePrimitives(el)
        : el.kind === 'scatter'
          ? scatterPrimitives(el)
          : barPrimitives(el)
  out.push(...body)
  return out
}
