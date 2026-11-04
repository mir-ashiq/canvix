// Unit tests for the v0.14 (D1) media-image export path:
//   1. safeHref accepts media-store URLs (first-party, same-origin)
//   2. inlineMediaImages rewrites media srcs to data URLs on a COPY —
//      the live pages object is never mutated
//   3. failed fetches degrade honestly: the relative src survives
//      (safeHref still accepts it; the exported file shows a broken
//      image rather than silently losing content)
//   4. non-media srcs (data:, https:) pass through untouched

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { safeHref, inlineMediaImages } from './svg-export'

function pageWith(elements: unknown[]): { elements: unknown[] } {
  return { elements }
}

describe('safeHref (v0.14 D1)', () => {
  it('accepts data, https and media-store srcs', () => {
    expect(safeHref('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    expect(safeHref('https://example.com/a.png')).toBe('https://example.com/a.png')
    expect(safeHref('/api/media/cm123')).toBe('/api/media/cm123')
  })

  it('rejects other protocols and relative paths', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('ftp://x/y.png')).toBeNull()
    expect(safeHref('/static/other.png')).toBeNull()
    expect(safeHref('blob:https://x')).toBeNull()
  })
})

describe('inlineMediaImages (v0.14 D1)', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url === '/api/media/ok1') {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        })
      }
      return new Response('nope', { status: 404 })
    })
  })
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('rewrites media srcs to data URLs on a copy; never mutates the input', async () => {
    const pages = [
      pageWith([
        { type: 'image', id: 'a', src: '/api/media/ok1' },
        { type: 'image', id: 'b', src: 'https://cdn.example.com/x.png' },
        { type: 'text', id: 'c', text: 'hello' },
      ]),
    ]
    const out = await inlineMediaImages(pages)
    expect(out).not.toBe(pages)
    expect(out[0].elements[0]).toMatchObject({ id: 'a', src: 'data:image/png;base64,AQID' })
    // https src untouched
    expect(out[0].elements[1]).toMatchObject({ id: 'b', src: 'https://cdn.example.com/x.png' })
    // live pages NEVER mutated (exports must not touch the document)
    expect(pages[0].elements[0]).toMatchObject({ id: 'a', src: '/api/media/ok1' })
  })

  it('leaves failed fetches as relative srcs (honest degradation)', async () => {
    const pages = [pageWith([{ type: 'image', id: 'x', src: '/api/media/gone' }])]
    const out = await inlineMediaImages(pages)
    expect(out[0].elements[0]).toMatchObject({ id: 'x', src: '/api/media/gone' })
  })

  it('handles nested groups and returns pages with no media srcs unchanged', async () => {
    const plain = [pageWith([{ type: 'text', id: 't', text: 'hi' }])]
    expect(await inlineMediaImages(plain)).toBe(plain)

    const nested = [
      pageWith([
        { type: 'group', id: 'g', children: [{ type: 'image', id: 'i', src: '/api/media/ok1' }] },
      ]),
    ]
    const out = await inlineMediaImages(nested)
    const group = out[0].elements[0] as { children: { src: string }[] }
    expect(group.children[0].src).toBe('data:image/png;base64,AQID')
  })
})
