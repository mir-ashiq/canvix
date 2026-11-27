import { describe, expect, it } from 'vitest'
import { planRepair } from './repair'
import type { AgentDesignCtx, AgentElementCtx } from './context'

/** page fixture in the audit tests' style (the ctx shape the loop's
 *  refreshedContext returns — fields the repair engine reads). */
function page(els: AgentElementCtx[], background = '#0a0a1e'): AgentDesignCtx {
  return {
    name: 't',
    width: 1080,
    height: 1080,
    pageCount: 1,
    currentPageIndex: 0,
    background,
    elements: els,
    colorsInUse: [],
    otherPages: [],
  } as unknown as AgentDesignCtx
}

const COVERED = ['Text "NEON 2027" is covered by rect#r1 (100% of it) — move the shape below the text (reorder_layers) or move one of them.']
const CONTRAST = ['Low contrast: text "tagline" #7630d7 on its effective backdrop #0a0a1e is 2.1:1 (needs 3:1) — change the text fill or the card behind it.']
const OFFCANVAS = ['image#img1 is entirely OFF the canvas (@1200,100 300x200) — move it inside the page.']
const SLIVER = ['sticker#st1 is a sliver (6x6px) — resize it to be visible.']

describe('v0.34 · the deterministic correction engine (repair.ts)', () => {
  it('covered text is RAISED above the opaque coverer — never moved, never rewritten', () => {
    const els: AgentElementCtx[] = [
      { id: 't1', type: 'text', text: 'NEON 2027', x: 100, y: 100, width: 400, height: 80, fill: '#02C0CC', fontSize: 96 },
      { id: 'r1', type: 'rect', x: 0, y: 0, width: 1080, height: 1080, fill: '#000000' },
    ]
    const plan = planRepair(page(els), COVERED)
    expect(plan.actions).toHaveLength(1)
    const a = plan.actions[0] as unknown as { type: string; ids: string[]; dir?: string }
    expect(a.type).toBe('reorderLayers')
    expect(a.ids).toEqual(['t1'])
    expect(a.dir).toBe('front')
    expect(plan.notes[0]).toContain('raised text "NEON 2027"')
  })

  it('readable text-on-card (intentional layering) is never touched', () => {
    // the card sits BEHIND the text (lower z) — intentional layering,
    // invisible to the covered-text detection, never "repaired"
    const els: AgentElementCtx[] = [
      { id: 'card', type: 'rect', x: 90, y: 90, width: 420, height: 100, fill: '#1a1a3a' },
      { id: 't1', type: 'text', text: 'On its card', x: 100, y: 100, width: 400, height: 80, fill: '#FFFFFF', fontSize: 40 },
    ]
    expect(planRepair(page(els), COVERED).actions).toHaveLength(0)
  })

  it('an element entirely off-canvas is clamped back inside the page', () => {
    const els: AgentElementCtx[] = [{ id: 'img1', type: 'image', x: 1200, y: 100, width: 300, height: 200 }]
    const plan = planRepair(page(els), OFFCANVAS)
    expect(plan.actions).toHaveLength(1)
    const a = plan.actions[0] as unknown as { type: string; ids: string[]; patch: { x: number; y: number } }
    expect(a.type).toBe('updateElements')
    expect(a.ids).toEqual(['img1'])
    // x clamps to the right safe edge (1080 − 300 − 24), y stays —
    // already inside the safe band
    expect(a.patch.x).toBe(756)
    expect(a.patch.y).toBe(100)
  })

  it('a full-bleed background rect is NEVER clamped (deliberate bleed)', () => {
    // larger than the page, offset negative for print bleed — not
    // "entirely off-canvas", so the repair leaves it alone
    const els: AgentElementCtx[] = [
      { id: 'bleed', type: 'rect', x: -50, y: -50, width: 1180, height: 1180, fill: '#111122' },
      { id: 'img1', type: 'image', x: 1200, y: 100, width: 300, height: 200 },
    ]
    const plan = planRepair(page(els), OFFCANVAS)
    expect(plan.actions).toHaveLength(1)
    expect((plan.actions[0] as unknown as { ids: string[] }).ids).toEqual(['img1'])
  })

  it('unreadable text gets the first ladder fill that clears the WCAG need', () => {
    // dark violet on near-black: white is the first passing candidate
    const els: AgentElementCtx[] = [
      { id: 't2', type: 'text', text: 'tagline', x: 100, y: 300, width: 400, height: 60, fill: '#7630d7', fontSize: 40 },
    ]
    const plan = planRepair(page(els), CONTRAST)
    expect(plan.actions).toHaveLength(1)
    const a = plan.actions[0] as { type: string; ids: string[]; patch: { fill: string } }
    expect(a.type).toBe('updateElements')
    expect(a.ids).toEqual(['t2'])
    expect(a.patch.fill).toBe('#FFFFFF')
  })

  it('sliver assets are scaled to visibility, keeping aspect and centre', () => {
    const els: AgentElementCtx[] = [{ id: 'st1', type: 'sticker', x: 497, y: 497, width: 6, height: 6 }]
    const plan = planRepair(page(els), SLIVER)
    expect(plan.actions).toHaveLength(1)
    const a = plan.actions[0] as unknown as { patch: { width: number; height: number; x: number; y: number } }
    expect(a.patch.width).toBeGreaterThanOrEqual(24)
    expect(a.patch.height).toBeGreaterThanOrEqual(24)
    // centre preserved: (500, 500) before and after
    expect(a.patch.x + a.patch.width / 2).toBeCloseTo(500)
    expect(a.patch.y + a.patch.height / 2).toBeCloseTo(500)
  })

  it('locked (user-owned) elements are never repaired', () => {
    const els: AgentElementCtx[] = [
      { id: 't1', type: 'text', text: 'locked', x: 100, y: 100, width: 400, height: 80, fill: '#7630d7', fontSize: 40, locked: true },
    ]
    expect(planRepair(page(els), [...COVERED, ...CONTRAST]).actions).toHaveLength(0)
  })

  it('nothing is repaired without a matching issue class — never speculative', () => {
    const els: AgentElementCtx[] = [
      { id: 't1', type: 'text', text: 'NEON 2027', x: 100, y: 100, width: 400, height: 80, fill: '#02C0CC', fontSize: 96 },
      { id: 'r1', type: 'rect', x: 0, y: 0, width: 1080, height: 1080, fill: '#000000' },
    ]
    // advisories only (alignment/typography/hierarchy) — no repair
    expect(planRepair(page(els), ['ADVISORY alignment: wide text is off the page center']).actions).toHaveLength(0)
    // and with no issues at all
    expect(planRepair(page(els), []).actions).toHaveLength(0)
  })
})
