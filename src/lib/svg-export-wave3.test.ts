import { describe, it, expect } from 'vitest'
import { exportPageToSVG } from '@/lib/svg-export'
import type { PageData, AnyElement } from '@/lib/types'

// jsdom has no 2D canvas — measureText falls back to the char-count
// approximation, which is deterministic and enough to assert structure.

function page(elements: AnyElement[], over: Partial<PageData> = {}): PageData {
  return {
    id: 'p1',
    background: { type: 'solid', color: '#FFFFFF' },
    elements,
    ...over,
  }
}

function el(over: Record<string, unknown>): AnyElement {
  return {
    id: 'e1',
    type: 'rect',
    x: 10,
    y: 10,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    fill: '#00C4CC',
    stroke: 'transparent',
    strokeWidth: 0,
    cornerRadius: 0,
    ...over,
  } as AnyElement
}

describe('svg-export — Wave 3 features', () => {
  it('polygon → <polygon> with the sides from the element, filling the box', () => {
    const svg = exportPageToSVG(page([el({ type: 'polygon', sides: 8 })]), 1080, 1080)
    expect(svg).toContain('<polygon points="')
    // 8 vertices → 8 coordinate pairs
    const points = svg.match(/<polygon points="([^"]+)"/)![1].trim().split(' ')
    expect(points).toHaveLength(8)
    // stretchPts (THE shape mapping): the first vertex sits at the top
    // edge, centred — x=10+100/2=60, y=10 (matches the canvas Konva)
    expect(points[0]).toBe('60,10')
  })

  it('star honours numPoints + innerRatio and fills the box', () => {
    const svg = exportPageToSVG(page([el({ type: 'star', numPoints: 9, innerRatio: 0.4 })]), 1080, 1080)
    const points = svg.match(/<polygon points="([^"]+)"/)![1].trim().split(' ')
    expect(points).toHaveLength(18) // 2 × points
    // top outer vertex: x=10+100/2=60, y=10 — the box edge (stretchPts)
    expect(points[0]).toBe('60,10')
  })

  it('star without params keeps the classic 5-point default', () => {
    const svg = exportPageToSVG(page([el({ type: 'star' })]), 1080, 1080)
    const points = svg.match(/<polygon points="([^"]+)"/)![1].trim().split(' ')
    expect(points).toHaveLength(10)
  })

  it('image mask → clipPath polygon (not the corner-radius rect)', () => {
    const svg = exportPageToSVG(
      page([el({ type: 'image', src: 'data:image/png;base64,iVBORw0KGgo=', maskShape: 'circle', radius: 20 })]),
      1080,
      1080
    )
    expect(svg).toContain('<clipPath id="clip')
    expect(svg).toMatch(/<clipPath[^>]*><polygon points="/)
    // the image references the clip
    expect(svg).toMatch(/<image [^>]*clip-path="url\(#clip/)
  })

  it('hostile mask shape degrades to no clip (validated by isMaskShape)', () => {
    const svg = exportPageToSVG(
      page([el({ type: 'image', src: 'data:image/png;base64,iVBORw0KGgo=', maskShape: '<script>' })]),
      1080,
      1080
    )
    expect(svg).not.toContain('clipPath')
  })

  it('image without mask keeps the corner-radius clip', () => {
    const svg = exportPageToSVG(
      page([el({ type: 'image', src: 'data:image/png;base64,iVBORw0KGgo=', radius: 16 })]),
      1080,
      1080
    )
    expect(svg).toMatch(/<clipPath id="clip[^"]*"><rect /)
  })

  it('list text renders marker + line tspans', () => {
    const svg = exportPageToSVG(
      page([
        el({
          type: 'text',
          text: 'first\nsecond',
          listStyle: 'bullet',
          fontSize: 24,
          fontFamily: 'Inter',
          fill: '#000000',
          align: 'left',
          lineHeight: 1.2,
          letterSpacing: 0,
          width: 400,
          height: 100,
        }),
      ]),
      1080,
      1080
    )
    expect(svg).toContain('•')
    expect(svg.match(/<tspan /g)!.length).toBeGreaterThanOrEqual(4) // 2 markers + 2 lines
  })

  it('rtl text emits direction="rtl"', () => {
    const svg = exportPageToSVG(
      page([
        el({
          type: 'text',
          text: 'مرحبا',
          direction: 'rtl',
          fontSize: 24,
          fontFamily: 'Inter',
          fill: '#000000',
          align: 'left',
          lineHeight: 1.2,
          letterSpacing: 0,
          width: 400,
          height: 100,
        }),
      ]),
      1080,
      1080
    )
    expect(svg).toContain('direction="rtl"')
  })

  it('per-page size override drives the svg width/height/viewBox', () => {
    const svg = exportPageToSVG(page([], { width: 500, height: 400 }), 1080, 1080)
    expect(svg).toContain('width="500"')
    expect(svg).toContain('viewBox="0 0 500 400"')
    // background covers the page box
    expect(svg).toContain('<rect width="500" height="400"')
  })

  it('per-page size out of range falls back to the design size', () => {
    const svg = exportPageToSVG(page([], { width: 999999, height: -5 }), 800, 600)
    expect(svg).toContain('width="800"')
    expect(svg).toContain('height="600"')
  })

  it('auto-fit shrinks the emitted font-size below the authored one', () => {
    const many = Array.from({ length: 30 }, (_, i) => `line of text number ${i}`).join('\n')
    const svg = exportPageToSVG(
      page([
        el({
          type: 'text',
          text: many,
          autoFit: true,
          fontSize: 60,
          fontFamily: 'Inter',
          fill: '#000000',
          align: 'left',
          lineHeight: 1.25,
          letterSpacing: 0,
          width: 300,
          height: 120,
        }),
      ]),
      1080,
      1080
    )
    const size = Number(svg.match(/font-size="([\d.]+)"/)![1])
    expect(size).toBeLessThan(60)
    expect(size).toBeGreaterThanOrEqual(6)
  })
})
