import { describe, expect, it } from 'vitest'
import { pluginSnapshot, SNAPSHOT_FIELD_CHAR_CAP } from './snapshot'
import type { AnyElement, PageData } from '@/lib/types'

// The snapshot is what a consented plugin sees of the design
// (§4.3): geometry + own small data, never bytes, never internal
// bookkeeping. The tests pin that contract.

function page(elements: AnyElement[], background: unknown = { type: 'solid', color: '#FFFFFF' }): PageData {
  return { id: 'page_1', background, elements } as PageData
}

function textElement(overrides: Partial<Extract<AnyElement, { type: 'text' }>> = {}): AnyElement {
  return {
    id: 'el_1',
    type: 'text',
    x: 10,
    y: 20,
    width: 300,
    height: 80,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    shadow: { enabled: false, x: 0, y: 0, blur: 0, color: '#000000' },
    text: 'Hello design',
    fontSize: 48,
    fontFamily: 'Inter',
    bold: true,
    italic: false,
    underline: false,
    strike: false,
    uppercase: false,
    fill: '#123456',
    align: 'center',
    lineHeight: 1.2,
    letterSpacing: 0,
    ...overrides,
  } as AnyElement
}

describe('pluginSnapshot', () => {
  it('projects geometry and type verbatim', () => {
    const snap = pluginSnapshot({ pages: [page([textElement()])], currentPage: 0 })
    const el = snap.pages[0]!.elements[0]!
    expect(el.id).toBe('el_1')
    expect(el.type).toBe('text')
    expect(el.x).toBe(10)
    expect(el.y).toBe(20)
    expect(el.width).toBe(300)
    expect(el.height).toBe(80)
  })

  it('keeps small own data (text, fill, fontSize) and the background', () => {
    const snap = pluginSnapshot({ pages: [page([textElement()], { type: 'gradient', from: '#000000', to: '#FFFFFF', angle: 90 })], currentPage: 0 })
    expect(snap.pages[0]!.background).toEqual({ type: 'gradient', from: '#000000', to: '#FFFFFF', angle: 90 })
    const el = snap.pages[0]!.elements[0]!
    expect(el.text).toBe('Hello design')
    expect(el.fill).toBe('#123456')
    expect(el.fontSize).toBe(48)
  })

  it('drops internal bookkeeping fields (_m, magicLayer, shadow, animation, beatPulse)', () => {
    const el = textElement({ _m: 'w:5:actor', beatPulse: 0.5 } as never)
    const snap = pluginSnapshot({ pages: [page([el])], currentPage: 0 })
    const view = snap.pages[0]!.elements[0]!
    expect('_m' in view).toBe(false)
    expect('beatPulse' in view).toBe(false)
    expect('shadow' in view).toBe(false)
    expect('animation' in view).toBe(false)
    expect('magicLayer' in view).toBe(false)
  })

  it('omits heavy fields (image dataURLs) and lists them in `omitted`', () => {
    const el = {
      ...textElement(),
      type: 'image',
      src: `data:image/png;base64,${'z'.repeat(50_000)}`,
    } as AnyElement
    const snap = pluginSnapshot({ pages: [page([el])], currentPage: 0 })
    const view = snap.pages[0]!.elements[0]!
    expect(view.src).toBeUndefined()
    expect(view.omitted).toContain('src')
  })

  it('keeps short src refs (e.g. /api/media ids)', () => {
    const el = { ...textElement(), type: 'image', src: '/api/media/abc123' } as AnyElement
    const snap = pluginSnapshot({ pages: [page([el])], currentPage: 0 })
    expect(snap.pages[0]!.elements[0]!.src).toBe('/api/media/abc123')
  })

  it('omits any oversized string field, not just known-heavy ones', () => {
    const el = textElement({ text: 't'.repeat(SNAPSHOT_FIELD_CHAR_CAP + 1) })
    const snap = pluginSnapshot({ pages: [page([el])], currentPage: 0 })
    const view = snap.pages[0]!.elements[0]!
    expect(view.text).toBeUndefined()
    expect(view.omitted).toContain('text')
  })

  it('projects group children recursively', () => {
    const child = textElement({ id: 'child_1' } as never)
    const group = {
      ...textElement(),
      id: 'group_1',
      type: 'group',
      children: [child],
    } as unknown as AnyElement
    const snap = pluginSnapshot({ pages: [page([group])], currentPage: 0 })
    const view = snap.pages[0]!.elements[0]!
    expect(Array.isArray(view.children)).toBe(true)
    expect((view.children as { id: string }[])[0]!.id).toBe('child_1')
  })

  it('keeps small nested plain objects (gradients) but drops exotic ones', () => {
    const el = textElement({ fillGradient: { from: '#000000', to: '#FFFFFF', angle: 45 } } as never)
    const snap = pluginSnapshot({ pages: [page([el])], currentPage: 0 })
    expect(snap.pages[0]!.elements[0]!.fillGradient).toEqual({ from: '#000000', to: '#FFFFFF', angle: 45 })

    const el2 = textElement({ fillGradient: { from: '#000000', nested: { deep: { x: 1 } } } } as never)
    const snap2 = pluginSnapshot({ pages: [page([el2])], currentPage: 0 })
    expect(snap2.pages[0]!.elements[0]!.fillGradient).toBeUndefined()
  })

  it('carries multi-page structure and currentPage', () => {
    const pages = [page([textElement()]), page([textElement({ id: 'el_2' } as never)])]
    const snap = pluginSnapshot({ pages, currentPage: 1 })
    expect(snap.pages).toHaveLength(2)
    expect(snap.currentPage).toBe(1)
    expect(snap.pages[1]!.elements[0]!.id).toBe('el_2')
  })
})
