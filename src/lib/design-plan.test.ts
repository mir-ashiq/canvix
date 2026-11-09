// Wave 4 — lib/design-plan.ts unit tests.
// The review-gate transforms: hostile-input coercion + plan→pages.
import { describe, expect, it } from 'vitest'
import { MAX_PLAN_ELEMENTS_PER_PAGE, MAX_PLAN_PAGES, normalizePlan, planToPages, planSystemPrompt } from './design-plan'

const W = 1080
const H = 1080

describe('normalizePlan', () => {
  it('normalizes a well-formed plan', () => {
    const plan = normalizePlan(
      {
        name: 'Coffee launch',
        summary: 'Warm 3-page launch kit',
        pages: [
          {
            title: 'Cover',
            background: { type: 'gradient', from: '#7630D7', to: '#02C0CC', angle: 90 },
            elements: [
              { type: 'text', text: 'Grand Opening', x: 100, y: 200, width: 800, fontSize: 96, fontFamily: 'Poppins', bold: true, fill: '#FFFFFF', align: 'center' },
              { type: 'rect', x: 0, y: 0, width: 1080, height: 120, fill: '#111111', cornerRadius: 0 },
            ],
          },
        ],
      },
      W,
      H,
    )
    expect(plan.name).toBe('Coffee launch')
    expect(plan.summary).toBe('Warm 3-page launch kit')
    expect(plan.pages).toHaveLength(1)
    expect(plan.pages[0].elements).toHaveLength(2)
    expect(plan.pages[0].background).toEqual({ type: 'gradient', from: '#7630D7', to: '#02C0CC', angle: 90 })
    expect(plan.pages[0].elements[0].text).toBe('Grand Opening')
    expect(plan.pages[0].elements[0].enabled).toBe(true)
  })

  it('survives hostile input: nulls, wrong types, junk colors, unknown fonts', () => {
    const plan = normalizePlan(
      {
        name: 42,
        pages: [
          {
            elements: [
              null,
              { type: 'bomb', x: 'x' },
              { type: 'text', text: 7, fontSize: 99999, fontFamily: 'Comic Sans XSS', fill: 'javascript:', align: 'diagonal' },
              { type: 'ellipse', x: -500, y: 1e9, width: 3, height: 2, fill: 'red' },
            ],
            background: { type: 'lava', color: 'nope' },
          },
        ],
      },
      W,
      H,
    )
    // `bomb` is dropped; `null` coerces to a default text element (the
    // MCP normalizer's `e ?? {}` semantics) — 3 of 4 survive
    const els = plan.pages[0].elements
    expect(els).toHaveLength(3)
    expect(els.find((e) => (e.type as string) === 'bomb')).toBeUndefined()
    const text = els.find((e) => e.type === 'text' && e.fill !== '#00C4CC')!
    expect(text.fontSize).toBeLessThanOrEqual(280)
    expect(text.fontFamily).toBe('Poppins')
    expect(text.fill).toMatch(/^#[0-9a-fA-F]{6}$/)
    expect(text.align).toBe('center')
    const ellipse = els.find((e) => e.type === 'ellipse')!
    expect(ellipse.x).toBeGreaterThanOrEqual(0)
    expect(ellipse.x).toBeLessThanOrEqual(W)
    expect(ellipse.y).toBeLessThanOrEqual(H)
    expect(ellipse.fill).toBe('#00C4CC')
    expect(plan.pages[0].background).toEqual({ type: 'solid', color: '#FFFFFF' })
    expect(plan.name).toBe('AI plan')
  })

  it('caps pages and per-page elements', () => {
    const raw = {
      pages: Array.from({ length: 20 }, (_, pi) => ({
        title: `p${pi}`,
        elements: Array.from({ length: 60 }, (_, ei) => ({
          type: 'rect',
          x: ei * 10,
          y: pi * 10,
          width: 20,
          height: 20,
        })),
      })),
    }
    const plan = normalizePlan(raw, W, H)
    expect(plan.pages.length).toBeLessThanOrEqual(MAX_PLAN_PAGES)
    for (const p of plan.pages) {
      expect(p.elements.length).toBeLessThanOrEqual(MAX_PLAN_ELEMENTS_PER_PAGE)
    }
  })

  it('drops element-less pages and defaults to an empty plan on garbage', () => {
    const empty = normalizePlan({ pages: [{ elements: [] }, { elements: [{ type: 'nope' }, { type: 'bomb' }] }] }, W, H)
    expect(empty.pages).toHaveLength(0)
    const garbage = normalizePlan('just a string', W, H)
    expect(garbage.pages).toHaveLength(0)
    expect(garbage.width).toBe(W)
    expect(garbage.height).toBe(H)
    expect(() => normalizePlan(null, W, H)).not.toThrow()
  })

  it('gives every page and element a unique id', () => {
    const plan = normalizePlan(
      {
        pages: [1, 2].map((pi) => ({
          elements: [1, 2, 3].map((ei) => ({ type: 'rect', x: ei * 30, y: pi * 30, width: 20, height: 20 })),
        })),
      },
      W,
      H,
    )
    const ids = [
      ...plan.pages.map((p) => p.id),
      ...plan.pages.flatMap((p) => p.elements.map((e) => e.id)),
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('planToPages', () => {
  const plan = normalizePlan(
    {
      pages: [
        {
          title: 'Cover',
          elements: [
            { type: 'text', text: 'Hello', x: 100, y: 100, width: 400, fontSize: 64 },
            { type: 'rect', x: 0, y: 0, width: 200, height: 100 },
            { type: 'table', x: 100, y: 500, width: 500, rows: 3, header: ['a', 'b'] },
          ],
        },
        { title: 'Skipped', elements: [{ type: 'ellipse', x: 1, y: 1, width: 5, height: 5 }] },
      ],
    },
    W,
    H,
  )

  it('builds real editor elements with fresh ids', () => {
    const pages = planToPages(plan)
    expect(pages).toHaveLength(2)
    const [p1] = pages
    expect(p1.elements).toHaveLength(3)
    expect(p1.elements[0].type).toBe('text')
    expect(p1.elements[0].id).not.toBe(plan.pages[0].elements[0].id)
    expect(p1.elements[1].type).toBe('rect')
    expect(p1.elements[2].type).toBe('table')
    expect(pages.every((p) => p.background.type === 'solid')).toBe(true)
  })

  it('honors the review gate: disabled pages and elements are skipped', () => {
    const edited = {
      ...plan,
      pages: [
        { ...plan.pages[0], enabled: false },
        { ...plan.pages[1], elements: plan.pages[1].elements.map((e, i) => ({ ...e, enabled: i === 0 })) },
      ],
    }
    const pages = planToPages(edited)
    expect(pages).toHaveLength(1)
    expect(pages[0].elements).toHaveLength(1)
  })
})

describe('planSystemPrompt', () => {
  it('pins the page geometry, page count and JSON contract', () => {
    const s = planSystemPrompt(800, 600, 3)
    expect(s).toContain('800x600px')
    expect(s).toContain('3 page(s)')
    expect(s).toContain('"pages"')
    expect(s).toContain('no markdown fences')
  })
})
