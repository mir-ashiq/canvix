import { describe, it, expect } from 'vitest'
import { fitFontSize, wrapLines, type MeasureFn, type TextFitStyle } from '@/lib/text-fit'

// Deterministic fake measure: width = chars × fontSize × 0.5 (no letter spacing)
const measure: MeasureFn = (text, style) => text.length * style.fontSize * 0.5 + style.letterSpacing * text.length

function style(over: Partial<TextFitStyle> = {}): TextFitStyle {
  return {
    text: 'hello world',
    fontFamily: 'Inter',
    bold: false,
    italic: false,
    letterSpacing: 0,
    lineHeight: 1.2,
    fontSize: 40,
    ...over,
  }
}

describe('wrapLines', () => {
  it('keeps a fitting paragraph on one line', () => {
    const lines = wrapLines('hi', 1000, style(), measure)
    expect(lines).toEqual(['hi'])
  })

  it('wraps at spaces (never mid-word when avoidable)', () => {
    const s = style({ fontSize: 10, text: 'aaa bbb ccc' })
    // width per char = 5px → 'aaa bbb' = 35px fits 40, 'aaa bbb ccc' = 55px does not
    const lines = wrapLines(s.text, 40, s, measure)
    expect(lines).toEqual(['aaa bbb', 'ccc'])
  })

  it('preserves empty paragraphs as blank lines', () => {
    const s = style({ fontSize: 10, text: 'a\n\nb' })
    expect(wrapLines(s.text, 100, s, measure)).toEqual(['a', '', 'b'])
  })
})

describe('fitFontSize', () => {
  it('returns the authored size when it already fits (fast path)', () => {
    const size = fitFontSize(style({ fontSize: 40, text: 'hi' }), { width: 400, height: 400 }, measure)
    expect(size).toBe(40)
  })

  it('shrinks until the block fits the height', () => {
    // 10 lines × 40px × 1.2 = 480px > 240px box → must shrink below 40
    const s = style({ fontSize: 40, text: Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n') })
    const size = fitFontSize(s, { width: 4000, height: 240 }, measure)
    expect(size).toBeLessThan(40)
    // and the shrunk size actually fits
    const lines = wrapLines(s.text, 4000, { ...s, fontSize: size }, measure)
    expect(lines.length * size * s.lineHeight).toBeLessThanOrEqual(240 + 0.5)
  })

  it('shrinks when a single unbreakable token overflows the width', () => {
    const s = style({ fontSize: 40, text: 'x'.repeat(20) }) // 20 chars × 20px = 400px
    const size = fitFontSize(s, { width: 100, height: 4000 }, measure)
    expect(size).toBeLessThan(40)
    expect(size * 0.5 * 20).toBeLessThanOrEqual(100 + 0.5)
  })

  it('a token too long even at 6px floors at 6 (overflow is the caller\'s to show)', () => {
    const s = style({ fontSize: 40, text: 'x'.repeat(50) })
    const size = fitFontSize(s, { width: 100, height: 4000 }, measure)
    expect(size).toBe(6)
  })

  it('never grows past the authored size', () => {
    const size = fitFontSize(style({ fontSize: 12, text: 'tiny' }), { width: 4000, height: 4000 }, measure)
    expect(size).toBe(12)
  })

  it('floors at 6px instead of collapsing to zero', () => {
    const s = style({ fontSize: 40, text: 'x'.repeat(5000) })
    const size = fitFontSize(s, { width: 50, height: 50 }, measure)
    expect(size).toBeGreaterThanOrEqual(6)
  })

  it('degenerate boxes return the authored size', () => {
    expect(fitFontSize(style(), { width: 0, height: 0 }, measure)).toBe(40)
    expect(fitFontSize(style(), { width: NaN, height: 100 }, measure)).toBe(40)
  })

  it('empty text returns the authored size', () => {
    expect(fitFontSize(style({ text: '' }), { width: 100, height: 100 }, measure)).toBe(40)
  })
})
