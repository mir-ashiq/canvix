import { describe, it, expect } from 'vitest'
import {
  chartPrimitives,
  formatChartNumber,
  isChartKind,
  clampChartHole,
  sanitizeChartLabels,
  sanitizeChartSeries,
  MAX_CHART_LABELS,
  MAX_CHART_SERIES,
  type ChartPrimitive,
} from '@/lib/chart-geometry'
import { createChartElement, type ChartElement, type ChartSeries } from '@/lib/types'

// ── helpers ──────────────────────────────────────────────────

function chart(over: Partial<ChartElement> = {}): ChartElement {
  const el = createChartElement(over.kind ?? 'bar', over)
  return { ...el, ...over }
}

function ofKind<T extends ChartPrimitive['kind']>(prims: ChartPrimitive[], kind: T): Extract<ChartPrimitive, { kind: T }>[] {
  return prims.filter((p): p is Extract<ChartPrimitive, { kind: T }> => p.kind === kind)
}

/** every number in every primitive must be finite — the renderers
 *  would emit `NaN` attributes otherwise (the classic geometry bug) */
function expectAllFinite(prims: ChartPrimitive[]): void {
  const walk = (v: unknown): void => {
    if (typeof v === 'number') expect(Number.isFinite(v), `non-finite coordinate: ${v}`).toBe(true)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  prims.forEach(walk)
}

// ── number formatting ────────────────────────────────────────

describe('formatChartNumber', () => {
  it('compacts large magnitudes', () => {
    expect(formatChartNumber(12_340)).toBe('12.3k')
    expect(formatChartNumber(1500000)).toBe('1.5M')
    expect(formatChartNumber(2_400_000_000)).toBe('2.4B')
    expect(formatChartNumber(-42_000)).toBe('-42k')
  })
  it('keeps small numbers exact-ish', () => {
    expect(formatChartNumber(42)).toBe('42')
    expect(formatChartNumber(12.34)).toBe('12.3')
    expect(formatChartNumber(-7)).toBe('-7')
    expect(formatChartNumber(0)).toBe('0')
  })
})

// ── untrusted-input sanitizers (paste + MCP share these) ─────

describe('sanitizeChartSeries / sanitizeChartLabels', () => {
  it('drops junk, caps counts, clamps magnitudes', () => {
    const hostile = [
      { name: 42, color: 'javascript:alert(1)', values: [1, 'x', NaN, 2e12, -2e12] },
      'not-an-object',
      null,
      { name: 'ok', color: '#02C0CC', values: [1, 2, 3] },
    ]
    const out = sanitizeChartSeries(hostile, false)
    expect(out).toHaveLength(2)
    expect(out[0].name).toBe('Series 1')
    expect(out[0].color).toMatch(/^#/) // palette fallback, not the javascript: string
    expect(out[0].values).toEqual([1, 1e9, -1e9]) // non-finite dropped, ±2e12 clamped to the 1e9 cap
    expect(out[1].values).toEqual([1, 2, 3])
  })

  it('caps series at the limit', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `s${i}`, values: [i] }))
    expect(sanitizeChartSeries(many, false)).toHaveLength(MAX_CHART_SERIES)
  })

  it('caps values per shape and keeps scatter pairs even', () => {
    const values = Array.from({ length: 60 }, (_, i) => i)
    const bar = sanitizeChartSeries([{ name: 'a', values }], false)
    expect(bar[0].values).toHaveLength(MAX_CHART_LABELS)
    const scatter = sanitizeChartSeries([{ name: 'a', values }], true)
    expect(scatter[0].values.length).toBeLessThanOrEqual(48)
    expect(scatter[0].values.length % 2).toBe(0)
  })

  it('labels: strings only, sliced', () => {
    expect(sanitizeChartLabels(['ok', 7, null, 'x'.repeat(60), ...Array.from({ length: 40 }, () => 'y')])).toEqual([
      'ok',
      'x'.repeat(24),
      ...Array.from({ length: 22 }, () => 'y'),
    ])
  })
})

describe('isChartKind / clampChartHole', () => {
  it('whitelists the four kinds', () => {
    expect(isChartKind('bar')).toBe(true)
    expect(isChartKind('line')).toBe(true)
    expect(isChartKind('donut')).toBe(true)
    expect(isChartKind('scatter')).toBe(true)
    expect(isChartKind('EVIL')).toBe(false)
    expect(isChartKind({})).toBe(false)
  })
  it('clamps the hole ratio', () => {
    expect(clampChartHole(0.9)).toBe(0.85)
    expect(clampChartHole(-1)).toBe(0)
    expect(clampChartHole('junk')).toBe(0.62)
    expect(clampChartHole(0.5)).toBe(0.5)
  })
})

// ── geometry: bar ────────────────────────────────────────────

describe('chartPrimitives — bar', () => {
  const el = chart({ kind: 'bar', width: 560, height: 360, showLegend: false })
  const prims = chartPrimitives(el)

  it('emits a background panel, one rect per (label × series), axis lines and category labels', () => {
    expect(ofKind(prims, 'rect')[0]).toMatchObject({ x: 0, y: 0, w: 560, h: 360, r: 12 })
    const barRects = ofKind(prims, 'rect').slice(1)
    expect(barRects).toHaveLength(4 * 2) // 4 quarters × 2 series
    const texts = ofKind(prims, 'text')
    expect(texts.some((t) => t.text === 'Q1')).toBe(true)
    expect(texts.some((t) => t.text === 'Q4')).toBe(true)
    expect(ofKind(prims, 'line').length).toBeGreaterThan(0)
  })

  it('a bigger value in the SAME chart draws a taller bar', () => {
    const p = chartPrimitives(chart({ showLegend: false, series: [{ name: 'a', color: '#7630D7', values: [10, 20] }] }))
    const hs = ofKind(p, 'rect').slice(1).map((r) => (r as { h: number }).h)
    expect(hs[1]).toBeGreaterThan(hs[0])
  })

  it('stack mode renders per-label segments, not per-series bars', () => {
    const stacked = chartPrimitives(chart({ barMode: 'stack', showLegend: false }))
    const barRects = ofKind(stacked, 'rect').slice(1)
    expect(barRects).toHaveLength(4 * 2) // every (label, series) still has a segment
    const segs = barRects.filter((r) => (r as { h: number }).h > 0)
    expect(segs.length).toBeGreaterThan(0)
  })

  it('showValues adds one value label per bar', () => {
    const withValues = chartPrimitives(chart({ showValues: true }))
    const texts = ofKind(withValues, 'text').map((t) => t.text)
    expect(texts).toContain('128')
    expect(texts).toContain('190')
  })

  it('never emits non-finite coordinates', () => {
    const hostile = chart({
      width: 560,
      height: 360,
      series: [{ name: 'a', color: '#7630D7', values: [1, 2, 3] }, { name: 'b', color: '#02C0CC', values: [1, 2, 3] }],
    })
    expectAllFinite(chartPrimitives(hostile))
  })
})

// ── geometry: line ───────────────────────────────────────────

describe('chartPrimitives — line', () => {
  it('one polyline + dots per series, category labels on the x axis', () => {
    const prims = chartPrimitives(chart({ kind: 'line' }))
    expect(ofKind(prims, 'polyline')).toHaveLength(2)
    // 6 labels × 2 series of dots
    expect(ofKind(prims, 'circle')).toHaveLength(12)
    expect(ofKind(prims, 'text').some((t) => t.text === 'Jan')).toBe(true)
  })

  it('smooth sampling densifies the polyline but keeps the endpoints', () => {
    const smooth = chartPrimitives(chart({ kind: 'line', smooth: true }))
    const straight = chartPrimitives(chart({ kind: 'line', smooth: false }))
    const sp = ofKind(smooth, 'polyline')[0] as { points: number[] }
    const rp = ofKind(straight, 'polyline')[0] as { points: number[] }
    expect(sp.points.length).toBeGreaterThan(rp.points.length)
    expect(sp.points[0]).toBe(rp.points[0])
    expect(sp.points[sp.points.length - 1]).toBeCloseTo(rp.points[rp.points.length - 1], 6)
  })
})

// ── geometry: donut ──────────────────────────────────────────

describe('chartPrimitives — donut', () => {
  const el = chart({ kind: 'donut', hole: 0.5 })
  const prims = chartPrimitives(el)

  it('sweeps 2π across the segments and honors the hole ratio', () => {
    const arcs = ofKind(prims, 'arc')
    expect(arcs.length).toBeGreaterThan(0)
    const sweep = arcs.reduce((a, s) => a + ((s as { a1: number }).a1 - (s as { a0: number }).a0), 0)
    expect(sweep).toBeCloseTo(Math.PI * 2, 5)
    const first = arcs[0] as { rIn: number; rOut: number }
    expect(first.rIn).toBeCloseTo(first.rOut * 0.5, 5)
  })

  it('renders the total in the centre and the first series only', () => {
    const texts = ofKind(prims, 'text').map((t) => t.text)
    expect(texts).toContain('125') // 32+41+18+22+12
    // a second series exists on the element but donut uses series[0]
    const two = chartPrimitives(chart({ kind: 'donut', series: [
      { name: 'a', color: '#7630D7', values: [1, 1] },
      { name: 'b', color: '#02C0CC', values: [5, 5] },
    ] }))
    expect(ofKind(two, 'text').map((t) => t.text)).toContain('2')
  })

  it('a single 100% slice splits into two half arcs (renderer-safe)', () => {
    const prims2 = chartPrimitives(chart({ kind: 'donut', labels: ['only'], series: [{ name: 'a', color: '#7630D7', values: [10] }] }))
    const arcs = ofKind(prims2, 'arc')
    expect(arcs).toHaveLength(2)
    expect((arcs[0] as { a1: number }).a1 - (arcs[0] as { a0: number }).a0).toBeCloseTo(Math.PI, 5)
  })

  it('value labels are percentages of the whole', () => {
    const prims3 = chartPrimitives(chart({ kind: 'donut', showValues: true }))
    const texts = ofKind(prims3, 'text').map((t) => t.text)
    expect(texts).toContain('26%') // 32/125
    expect(texts).toContain('10%') // 12/125
  })
})

// ── geometry: scatter ────────────────────────────────────────

describe('chartPrimitives — scatter', () => {
  it('one dot per (x,y) pair with numeric axes', () => {
    const prims = chartPrimitives(chart({ kind: 'scatter' }))
    expect(ofKind(prims, 'circle')).toHaveLength(8)
    const texts = ofKind(prims, 'text').map((t) => t.text)
    expect(texts.some((t) => /^-?\d+(\.\d+)?$/.test(t))).toBe(true)
  })

  it('scales to the data range (non-zero origin allowed)', () => {
    const prims = chartPrimitives(chart({
      kind: 'scatter',
      series: [{ name: 'a', color: '#02C0CC', values: [100, 100, 200, 200, 300, 300] }],
    }))
    const xs = ofKind(prims, 'circle').map((c) => (c as { cx: number }).cx)
    expect(Math.min(...xs)).toBeGreaterThan(0)
    expectAllFinite(prims)
  })
})

// ── degenerate + honest states ───────────────────────────────

describe('chartPrimitives — honest degradation', () => {
  it('empty series/labels → a visible "No data" hint, no crash', () => {
    for (const kind of ['bar', 'line', 'donut', 'scatter'] as const) {
      const prims = chartPrimitives(chart({ kind, labels: [], series: [] as ChartSeries[] }))
      expect(ofKind(prims, 'text').some((t) => t.text === 'No data')).toBe(true)
      expectAllFinite(prims)
    }
  })

  it('tiny elements degrade instead of drawing unreadable geometry', () => {
    const prims = chartPrimitives(chart({ kind: 'bar', width: 30, height: 30 }))
    expect(ofKind(prims, 'text').some((t) => t.text === 'No data')).toBe(true)
  })

  it('transparent fill skips the background rect', () => {
    const prims = chartPrimitives(chart({ fill: 'transparent', showLegend: false }))
    expect(ofKind(prims, 'rect')).toHaveLength(8) // bars only
  })
})
