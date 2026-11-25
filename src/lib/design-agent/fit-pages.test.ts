// Unit tests for fit-pages (v0.31, DesignAgent panel) — the
// deterministic canvas fit. Invariants that matter for a CHECKED
// design: uniform factor (wrap points preserved), centering, no
// element ever dropped, identity when no rescale is needed.

import { describe, it, expect } from 'vitest'
import { fitPagesToCanvas } from './fit-pages'
import type { AnyElement, PageData, TextElement } from '@/lib/types'

function textEl(over: Partial<TextElement> = {}): TextElement {
  return {
    id: 't1', type: 'text', x: 100, y: 100, width: 200, height: 50,
    rotation: 0, opacity: 1, locked: false, visible: true, shadow: {} as never,
    text: 'Hello', fontSize: 40, fontFamily: 'Poppins', bold: false, italic: false,
    underline: false, strike: false, uppercase: false, fill: '#FFFFFF',
    align: 'left', lineHeight: 1.2, letterSpacing: 2,
    ...over,
  } as TextElement
}

function page(elements: AnyElement[]): PageData {
  return { id: 'p1', background: { type: 'solid', color: '#FFFFFF' }, elements } as PageData
}

describe('fitPagesToCanvas', () => {
  it('is identity when the formats already match', () => {
    const p = page([textEl()])
    const r = fitPagesToCanvas([p], { width: 1080, height: 1350 }, { width: 1080, height: 1350 })
    expect(r.scale).toBe(1)
    expect(r.pages[0]!.elements[0]).toBe(p.elements[0]) // untouched object
  })

  it('uniformly rescales and centers a portrait compile onto a square canvas', () => {
    const el = textEl()
    const r = fitPagesToCanvas([page([el])], { width: 1080, height: 1350 }, { width: 1080, height: 1080 })
    // scale = min(1080/1080, 1080/1350) = 0.8; x offset = (1080 - 864)/2 = 108
    expect(r.scale).toBeCloseTo(0.8)
    expect(r.offsetX).toBeCloseTo(108)
    expect(r.offsetY).toBeCloseTo(0)
    const t = r.pages[0]!.elements[0] as TextElement
    expect(t.x).toBeCloseTo(100 * 0.8 + 108) // 188
    expect(t.y).toBeCloseTo(100 * 0.8)
    expect(t.width).toBeCloseTo(160)
    expect(t.fontSize).toBeCloseTo(32)
    expect(t.letterSpacing).toBeCloseTo(1.6)
    expect(t.text).toBe('Hello') // content never changes
  })

  it('scales group children recursively (nested boxes ride the same factor)', () => {
    const inner = textEl({ id: 'inner' })
    const group = {
      id: 'g1', type: 'group', x: 50, y: 50, width: 400, height: 400,
      rotation: 0, opacity: 1, locked: false, visible: true, shadow: {} as never,
      children: [inner],
    } as unknown as AnyElement
    const r = fitPagesToCanvas([page([group])], { width: 1000, height: 1000 }, { width: 500, height: 500 })
    expect(r.scale).toBeCloseTo(0.5)
    const g = r.pages[0]!.elements[0] as unknown as { width: number; children: TextElement[] }
    expect(g.width).toBeCloseTo(200)
    expect(g.children[0]!.fontSize).toBeCloseTo(20)
  })

  it('never drops or filters elements — count is preserved exactly', () => {
    const els = Array.from({ length: 12 }, (_, i) => textEl({ id: `t${i}`, x: i * 80 }))
    const r = fitPagesToCanvas([page(els), page([textEl({ id: 'x' })])], { width: 1080, height: 1920 }, { width: 1080, height: 1080 })
    expect(r.pages[0]!.elements.length).toBe(12)
    expect(r.pages[1]!.elements.length).toBe(1)
  })

  it('is identity for degenerate inputs (empty pages or unknown format)', () => {
    expect(fitPagesToCanvas([], { width: 1080, height: 1080 }, { width: 500, height: 500 }).pages).toEqual([])
    const p = page([textEl()])
    const r = fitPagesToCanvas([p], { width: 0, height: NaN }, { width: 500, height: 500 })
    expect(r.scale).toBe(1)
    expect(r.pages[0]).toBe(p)
  })
})
