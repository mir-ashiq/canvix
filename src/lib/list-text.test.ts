import { describe, it, expect } from 'vitest'
import { layoutListLines, type ListLayoutStyle, type ListMeasure } from '@/lib/list-text'

const measure: ListMeasure = (text, style) => text.length * style.fontSize * 0.5

function style(over: Partial<ListLayoutStyle> = {}): ListLayoutStyle {
  return {
    text: 'first item\nsecond item',
    fontFamily: 'Inter',
    bold: false,
    italic: false,
    letterSpacing: 0,
    lineHeight: 1.25,
    fontSize: 20,
    width: 400,
    listStyle: 'bullet',
    direction: 'ltr',
    ...over,
  }
}

describe('layoutListLines — bullets', () => {
  it('marks every first line with the bullet, continuations without', () => {
    const lines = layoutListLines(style(), measure)
    const firsts = lines.filter((l) => l.marker === '•')
    expect(firsts.length).toBe(2)
    // all lines are laid out vertically in order
    expect(lines.map((l) => l.text)).toEqual(['first item', 'second item'])
  })

  it('indents text past the marker column (hanging indent)', () => {
    const lines = layoutListLines(style(), measure)
    expect(lines[0].markerX).toBe(0)
    expect(lines[0].textX).toBeGreaterThan(0)
    expect(lines[0].textWidth).toBeLessThan(style().width)
  })

  it('wrapped continuation lines keep the same indent as their item', () => {
    // 'aaaa bbbb' = 18px/char… make width force a wrap: each char 10px at fontSize 20
    const s = style({ text: 'aaa bbb ccc ddd', width: 60 })
    const lines = layoutListLines(s, measure)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines[0].marker).toBe('•')
    for (const l of lines.slice(1)) expect(l.marker).toBe('')
    // all text lines share the same x + width
    for (const l of lines) expect(l.textX).toBe(lines[0].textX)
  })

  it('empty paragraphs produce blank spacer lines', () => {
    const lines = layoutListLines(style({ text: 'a\n\nb' }), measure)
    expect(lines.some((l) => l.text === '' && l.marker === '')).toBe(true)
  })
})

describe('layoutListLines — numbers', () => {
  it('numbers items sequentially across paragraphs', () => {
    const lines = layoutListLines(style({ listStyle: 'number', text: 'one\ntwo\nthree' }), measure)
    expect(lines.map((l) => l.marker)).toEqual(['1.', '2.', '3.'])
  })

  it('skips numbering on continuation lines', () => {
    const lines = layoutListLines(style({ listStyle: 'number', text: 'aaa bbb ccc ddd', width: 60 }), measure)
    expect(lines[0].marker).toBe('1.')
    for (const l of lines.slice(1)) expect(l.marker).toBe('')
  })

  it('the marker column fits the widest number (no overlap)', () => {
    const s = style({ listStyle: 'number', text: Array.from({ length: 12 }, (_, i) => `item ${i + 1}`).join('\n') })
    const lines = layoutListLines(s, measure)
    const widest = measure('12.', s)
    expect(lines[0].textX).toBeGreaterThanOrEqual(widest)
  })
})

describe('layoutListLines — none / rtl', () => {
  it("listStyle 'none' degrades to a plain block (no markers, no indent)", () => {
    const lines = layoutListLines(style({ listStyle: 'none' }), measure)
    expect(lines.every((l) => l.marker === '' && l.markerX === 0)).toBe(true)
    expect(lines[0].textX).toBe(0)
    expect(lines[0].textWidth).toBe(style().width)
  })

  it('rtl mirrors the marker to the right edge', () => {
    const ltr = layoutListLines(style({ direction: 'ltr' }), measure)
    const rtl = layoutListLines(style({ direction: 'rtl' }), measure)
    const w = style().width
    expect(ltr[0].markerX).toBe(0)
    expect(rtl[0].markerX).toBeGreaterThan(0)
    expect(rtl[0].markerX).toBeLessThanOrEqual(w)
    expect(rtl[0].textX).toBe(0) // text box starts at the left edge, aligns right
    expect(rtl[0].textWidth).toBe(ltr[0].textWidth)
  })
})
