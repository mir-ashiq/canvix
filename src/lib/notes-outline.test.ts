// Wave 4 — lib/notes-outline.ts unit tests.
import { describe, expect, it } from 'vitest'
import { extractOutlines, notesSystemPrompt, normalizeNotes, outlineToPrompt } from './notes-outline'
import type { PageData } from './types'

function page(elements: unknown[], id = 'p1'): PageData {
  return { id, background: { type: 'solid', color: '#fff' }, elements } as unknown as PageData
}

describe('extractOutlines', () => {
  it('titles from the largest text element, bullets from the rest', () => {
    const outlines = extractOutlines([
      page([
        { type: 'text', text: 'Small print', fontSize: 14 },
        { type: 'text', text: 'Quarterly Results', fontSize: 72 },
        { type: 'text', text: 'Revenue up 24% YoY', fontSize: 28 },
        { type: 'rect', x: 0, y: 0, width: 10, height: 10 },
      ]),
    ])
    expect(outlines).toHaveLength(1)
    expect(outlines[0].title).toBe('Quarterly Results')
    expect(outlines[0].bullets).toEqual(['Small print', 'Revenue up 24% YoY'])
    expect(outlines[0].media).toEqual([])
  })

  it('summarizes media elements and skips shapes', () => {
    const outlines = extractOutlines([
      page([
        { type: 'chart', text: 'Sales by region', series: [] },
        { type: 'table', rows: 2, cols: 2 },
        { type: 'image', src: 'x' },
        { type: 'ellipse', x: 1, y: 1, width: 2, height: 2 },
        { type: 'sticker', char: '🎉' },
      ]),
    ])
    expect(outlines[0].title).toBe('Page 1') // no text elements
    expect(outlines[0].media).toEqual([
      'a chart titled "Sales by region"',
      'a data table',
      'an image',
      'a 🎉 sticker',
    ])
  })

  it('is total on hostile/empty pages and caps length', () => {
    expect(() => extractOutlines([])).not.toThrow()
    const outlines = extractOutlines([page(null as unknown as unknown[])])
    expect(outlines[0].bullets).toEqual([])
    const long = extractOutlines([
      page([{ type: 'text', text: 'x'.repeat(500), fontSize: 10 }]),
    ])
    expect(long[0].bullets[0].length).toBeLessThanOrEqual(160)
  })

  it('caps the page count', () => {
    const many = Array.from({ length: 60 }, (_, i) => page([], `p${i}`))
    expect(extractOutlines(many)).toHaveLength(40)
  })
})

describe('outlineToPrompt', () => {
  it('renders readable prompt blocks', () => {
    const text = outlineToPrompt([
      { index: 0, title: 'Cover', bullets: ['Hello'], media: ['an image'] },
      { index: 1, title: 'End', bullets: [], media: [] },
    ])
    expect(text).toContain('PAGE 1: Cover')
    expect(text).toContain('- Hello')
    expect(text).toContain('- contains an image')
    expect(text).toContain('PAGE 2: End')
  })
})

describe('notesSystemPrompt', () => {
  it('pins count, JSON contract and tone', () => {
    const s = notesSystemPrompt(4, 'confident')
    expect(s).toContain('exactly 4 entries')
    expect(s).toContain('{"notes"')
    expect(s).toContain('confident')
  })
})

describe('normalizeNotes', () => {
  it('keeps valid entries, drops junk, clamps pages, dedupes', () => {
    const notes = normalizeNotes(
      {
        notes: [
          { page: 1, text: '  Welcome everyone.   ' },
          { page: 0, text: 'out of range' },
          { page: 9, text: 'out of range' },
          { page: 2, text: 42 },
          { page: 2, text: 'duplicate page' },
          { page: '3', text: 'string page number works' },
          null,
          { text: 'no page' },
        ],
      },
      3,
    )
    expect(notes).toEqual([
      { page: 1, text: 'Welcome everyone.' },
      // {page:2,text:42} drops first (text not a string), so the string
      // page-2 entry is the first VALID one and stays
      { page: 2, text: 'duplicate page' },
      { page: 3, text: 'string page number works' },
    ])
  })

  it('survives non-object input', () => {
    expect(normalizeNotes('nope', 3)).toEqual([])
    expect(normalizeNotes(null, 3)).toEqual([])
    expect(normalizeNotes({ notes: 'nope' }, 3)).toEqual([])
  })

  it('caps note length', () => {
    const notes = normalizeNotes({ notes: [{ page: 1, text: 'y'.repeat(2000) }] }, 1)
    expect(notes[0].text.length).toBeLessThanOrEqual(600)
  })
})
