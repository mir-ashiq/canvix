import { describe, expect, it } from 'vitest'
import {
  applyStyleToRange,
  layoutRichLines,
  MAX_SPANS,
  normalizeSpans,
  reconcileSpans,
  resolveLineX,
  resolveSpanStyle,
  sanitizeLink,
  styleStateInRange,
  type MeasureText,
} from './rich-text'
import type { TextElement, TextSpan } from './types'

function makeText(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: 't1',
    type: 'text',
    name: 'text',
    x: 100,
    y: 50,
    width: 400,
    height: 80,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    text: 'Hello world',
    fontSize: 32,
    fontFamily: 'Poppins',
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    uppercase: false,
    fill: '#1F2226',
    align: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    ...overrides,
  } as TextElement
}

/** deterministic fake: every character is 10px wide, +letterSpacing per char */
const fakeMeasure: MeasureText = (text, style) => text.length * 10 + style.letterSpacing * text.length

// ── sanitizeLink ───────────────────────────────────────────────

describe('sanitizeLink', () => {
  it('accepts http and https, trims and strips control chars', () => {
    expect(sanitizeLink('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(sanitizeLink('http://example.com')).toBe('http://example.com')
    expect(sanitizeLink('  https://example.com  ')).toBe('https://example.com')
    expect(sanitizeLink('https://exa\nmple.com')).toBe('https://example.com')
    expect(sanitizeLink('HTTPS://EXAMPLE.COM')).toBe('HTTPS://EXAMPLE.COM')
  })
  it('fails closed on every dangerous shape', () => {
    expect(sanitizeLink('javascript:alert(1)')).toBeNull()
    expect(sanitizeLink(' data:text/html,<script>')).toBeNull()
    expect(sanitizeLink('vbscript:msgbox')).toBeNull()
    expect(sanitizeLink('/design/abc')).toBeNull()
    expect(sanitizeLink('example.com')).toBeNull()
    expect(sanitizeLink('')).toBeNull()
    expect(sanitizeLink(null)).toBeNull()
    expect(sanitizeLink(undefined)).toBeNull()
    expect(sanitizeLink('https://' + 'a'.repeat(600))).toBeNull()
  })
})

// ── normalizeSpans ─────────────────────────────────────────────

describe('normalizeSpans', () => {
  it('returns null for absent / empty / single-plain', () => {
    expect(normalizeSpans(null, 'abc')).toBeNull()
    expect(normalizeSpans(undefined, 'abc')).toBeNull()
    expect(normalizeSpans([], 'abc')).toBeNull()
    expect(normalizeSpans([{ text: 'abc' }], 'abc')).toBeNull()
    expect(normalizeSpans([{ text: 'abc', bold: false }], 'abc')).toBeNull()
  })
  it('drops empty runs and merges adjacent same-style runs', () => {
    const out = normalizeSpans([{ text: '' }, { text: 'ab', bold: true }, { text: 'cd', bold: true }, { text: 'e' }], 'abcde')
    expect(out).toEqual([{ text: 'abcd', bold: true }, { text: 'e' }])
  })
  it('falsy booleans normalize to inherit and merge with plain runs', () => {
    const out = normalizeSpans([{ text: 'a', bold: false }, { text: 'b' }], 'ab')
    expect(out).toBeNull()
  })
  it('drops invalid links and over-long colours', () => {
    const out = normalizeSpans([{ text: 'ab', link: 'javascript:x' }, { text: 'cd', color: 'x'.repeat(65) }], 'abcd')
    expect(out).toBeNull()
    const kept = normalizeSpans([{ text: 'ab', link: 'https://ok.dev' }, { text: 'cd', color: '#FF0000' }], 'abcd')
    expect(kept).toEqual([{ text: 'ab', link: 'https://ok.dev' }, { text: 'cd', color: '#FF0000' }])
  })
  it('fails safe (null) on text-length mismatch and run-cap overflow', () => {
    expect(normalizeSpans([{ text: 'abc', bold: true }], 'abcd')).toBeNull()
    const many: TextSpan[] = []
    for (let i = 0; i < MAX_SPANS + 5; i++) many.push({ text: 'a', bold: i % 2 === 0 })
    expect(normalizeSpans(many, 'a'.repeat(MAX_SPANS + 5))).toBeNull()
  })
  it('never mutates its input', () => {
    const input = [{ text: 'ab', bold: true }, { text: 'cd', bold: true }]
    normalizeSpans(input, 'abcd')
    expect(input).toEqual([{ text: 'ab', bold: true }, { text: 'cd', bold: true }])
  })
})

// ── resolveSpanStyle ───────────────────────────────────────────

describe('resolveSpanStyle', () => {
  const el = makeText({ fill: '#111111' })
  it('inherits every base field when the span is bare', () => {
    expect(resolveSpanStyle(el, { text: 'a' })).toMatchObject({
      bold: false, italic: false, underline: false, strike: false, color: '#111111', link: null,
    })
  })
  it('span keys override, link implies blue + underline', () => {
    expect(resolveSpanStyle(el, { text: 'a', bold: true })).toMatchObject({ bold: true, color: '#111111' })
    expect(resolveSpanStyle(el, { text: 'a', link: 'https://x.dev' })).toMatchObject({ color: '#1155CC', underline: true, link: 'https://x.dev' })
    expect(resolveSpanStyle(el, { text: 'a', link: 'https://x.dev', color: '#FF0000' })).toMatchObject({ color: '#FF0000' })
  })
  it('invalid stored link resolves as no link', () => {
    expect(resolveSpanStyle(el, { text: 'a', link: 'javascript:x' }).link).toBeNull()
  })
})

// ── styleStateInRange ──────────────────────────────────────────

describe('styleStateInRange', () => {
  it('flat text reports none/null everywhere', () => {
    const s = styleStateInRange(null, 'Hello world', 0, 11)
    expect(s).toMatchObject({ bold: 'none', italic: 'none', underline: 'none', strike: 'none', color: null, link: null })
  })
  it('aggregates all / mixed per property and dedupes colors', () => {
    const spans: TextSpan[] = [{ text: 'ab', bold: true, color: '#FF0000' }, { text: 'cd', bold: true }, { text: 'ef' }]
    expect(styleStateInRange(spans, 'abcdef', 0, 4).bold).toBe('all')
    expect(styleStateInRange(spans, 'abcdef', 0, 6).bold).toBe('mixed')
    expect(styleStateInRange(spans, 'abcdef', 0, 2).color).toBe('#FF0000')
    expect(styleStateInRange(spans, 'abcdef', 0, 4).color).toBe('mixed')
    expect(styleStateInRange(spans, 'abcdef', 4, 6).bold).toBe('none')
  })
})

// ── applyStyleToRange ──────────────────────────────────────────

describe('applyStyleToRange', () => {
  it('creates spans from flat (the migration moment) and splits mid-run', () => {
    const out = applyStyleToRange(null, 'Hello world', 0, 5, { bold: true })
    expect(out).toEqual([{ text: 'Hello', bold: true }, { text: ' world' }])
  })
  it('un-bolding a fully-bold range strips back to inherit', () => {
    const spans: TextSpan[] = [{ text: 'Hello', bold: true }, { text: ' world' }]
    const out = applyStyleToRange(spans, 'Hello world', 0, 5, { bold: false })
    expect(out).toBeNull()
  })
  it('everything back to plain normalizes to null (flat again — lossless)', () => {
    let spans = applyStyleToRange(null, 'Hello world', 0, 5, { bold: true })
    spans = applyStyleToRange(spans, 'Hello world', 6, 11, { color: '#FF0000' })
    expect(spans).not.toBeNull()
    spans = applyStyleToRange(spans, 'Hello world', 0, 5, { bold: false })
    spans = applyStyleToRange(spans, 'Hello world', 6, 11, { color: null })
    expect(spans).toBeNull()
  })
  it('sanitizes links on apply — javascript: strips to no link', () => {
    const out = applyStyleToRange(null, 'abcdef', 0, 3, { link: 'javascript:alert(1)' })
    expect(out).toBeNull()
    const kept = applyStyleToRange(null, 'abcdef', 0, 3, { link: 'https://ok.dev' })
    expect(kept).toEqual([{ text: 'abc', link: 'https://ok.dev' }, { text: 'def' }])
    const stripped = applyStyleToRange(kept, 'abcdef', 0, 3, { link: null })
    expect(stripped).toBeNull()
  })
  it('merges newly-adjacent same-style runs', () => {
    const spans: TextSpan[] = [{ text: 'ab', bold: true }, { text: 'cd' }, { text: 'ef', bold: true }]
    const out = applyStyleToRange(spans, 'abcdef', 2, 4, { bold: true })
    expect(out).toEqual([{ text: 'abcdef', bold: true }])
  })
  it('a collapsed range is a no-op', () => {
    expect(applyStyleToRange(null, 'abc', 1, 1, { bold: true })).toBeNull()
  })
  it('refuses ops that would exceed MAX_SPANS (returns input unchanged)', () => {
    // 126 alternating single-char runs + one 3-char run = 127 runs,
    // 129 chars; styling the middle char of the tail run splits it in
    // three → 129 runs > cap → the op is refused, input returned as-is
    const text = 'a'.repeat(126) + 'xyz'
    const spans: TextSpan[] = []
    for (let i = 0; i < 126; i++) spans.push({ text: 'a', bold: i % 2 === 0 })
    spans.push({ text: 'xyz', italic: true })
    expect(spans).toHaveLength(127)
    const out = applyStyleToRange(spans, text, 127, 128, { strike: true })
    expect(out).toEqual(spans)
  })
})

// ── reconcileSpans ─────────────────────────────────────────────

describe('reconcileSpans', () => {
  const spans: TextSpan[] = [{ text: 'Hello' }, { text: ' bold', bold: true }]
  it('typing inside a styled run extends it', () => {
    const out = reconcileSpans(spans, 'Hello bold', 'Hello boldX')
    expect(out).toEqual([{ text: 'Hello' }, { text: ' boldX', bold: true }])
  })
  it('typing at a style boundary appends to the PREVIOUS run', () => {
    const out = reconcileSpans(spans, 'Hello bold', 'Hello boldy')
    expect(out).toEqual([{ text: 'Hello' }, { text: ' boldy', bold: true }])
  })
  it('typing in the unstyled head extends the unstyled run', () => {
    const out = reconcileSpans(spans, 'Hello bold', 'XHello bold')
    expect(out).toEqual([{ text: 'XHello' }, { text: ' bold', bold: true }])
  })
  it('deleting across the boundary shrinks both runs', () => {
    const out = reconcileSpans(spans, 'Hello bold', 'Heold')
    expect(out).toEqual([{ text: 'He' }, { text: 'old', bold: true }])
  })
  it('deleting the styled tail flattens to null', () => {
    const out = reconcileSpans(spans, 'Hello bold', 'Hello')
    expect(out).toBeNull()
  })
  it('deleting everything → null; pasting over a selection splices', () => {
    expect(reconcileSpans(spans, 'Hello bold', '')).toBeNull()
    const out = reconcileSpans(spans, 'Hello bold', 'HeXXld') // replaced 'llo bo'
    expect(out).not.toBeNull()
    expect(out!.map((r) => r.text).join('')).toBe('HeXXld')
    expect(out![0].text).toBe('HeXX') // insertion rides the run ending at the cut
    expect(out![0].bold).toBeUndefined()
    expect(out![1]).toMatchObject({ text: 'ld', bold: true })
  })
  it('no-change returns the same spans', () => {
    expect(reconcileSpans(spans, 'Hello bold', 'Hello bold')).toBe(spans)
  })
  it('malformed input (length mismatch) fails safe to null', () => {
    expect(reconcileSpans([{ text: 'xy', bold: true }], 'abc', 'abcd')).toBeNull()
  })
})

// ── layoutRichLines ────────────────────────────────────────────

describe('layoutRichLines', () => {
  it('single line, one style: one coalesced run at x=0', () => {
    const el = makeText({ text: 'abc def', width: 400 })
    const spans = normalizeSpans([{ text: 'abc', bold: true }, { text: ' def', bold: true }], 'abc def')!
    const runs = layoutRichLines(el, spans, fakeMeasure)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ x: 0, y: 0, text: 'abc def', width: 70 })
    expect(runs[0].style.bold).toBe(true)
  })
  it('wraps at the box width and steps y by fontSize × lineHeight', () => {
    const el = makeText({ text: 'aaaa bbbb', width: 45 }) // 'aaaa bbbb' = 90px; line cap 45
    const spans = normalizeSpans([{ text: 'aaaa', bold: true }, { text: ' bbbb' }], 'aaaa bbbb')!
    const runs = layoutRichLines(el, spans, fakeMeasure)
    expect(runs.map((r) => r.text)).toEqual(['aaaa', 'bbbb'])
    expect(runs[0].y).toBe(0)
    expect(runs[1].y).toBeCloseTo(32 * 1.4, 5)
  })
  it('trailing whitespace at the break is dropped and not measured into the line', () => {
    const el = makeText({ text: 'aaaa  bbbb', width: 45, align: 'center' })
    const spans = normalizeSpans([{ text: 'aaaa', bold: true }, { text: '  ' }, { text: 'bbbb', italic: true }], 'aaaa  bbbb')!
    const runs = layoutRichLines(el, spans, fakeMeasure)
    expect(runs.map((r) => r.text)).toEqual(['aaaa', 'bbbb'])
    // centered: line width 40 in a 45px box → x = 2.5
    expect(runs[0].x).toBeCloseTo(2.5, 5)
    expect(runs[1].x).toBeCloseTo(2.5, 5)
  })
  it('right align pins line ends to the box edge', () => {
    const el = makeText({ text: 'aa bb', width: 30, align: 'right' })
    const spans = normalizeSpans([{ text: 'aa', bold: true }, { text: ' bb' }], 'aa bb')!
    const runs = layoutRichLines(el, spans, fakeMeasure)
    expect(runs[0].x).toBeCloseTo(10, 5) // 30 - 20
    expect(runs[1].x).toBeCloseTo(10, 5)
  })
  it('hard newlines (textarea Enter) are hard breaks — every segment its own line', () => {
    const el = makeText({ text: 'ab\ncd', width: 400 })
    const spans = normalizeSpans([{ text: 'ab', bold: true }, { text: '\ncd' }], 'ab\ncd')!
    const runs = layoutRichLines(el, spans, fakeMeasure)
    expect(runs.map((r) => r.text)).toEqual(['ab', 'cd'])
    expect(runs[0].y).toBe(0)
    expect(runs[1].y).toBeCloseTo(32 * 1.4, 5)
  })

  it('hard-breaks a word wider than the box (at least one glyph per line)', () => {
    const el = makeText({ text: 'aaaaaa', width: 25 })
    const runs = layoutRichLines(el, normalizeSpans([{ text: 'aaaaaa', bold: true }], 'aaaaaa')!, fakeMeasure)
    expect(runs.map((r) => r.text)).toEqual(['aa', 'aa', 'aa'])
    runs.forEach((r) => expect(r.style.bold).toBe(true))
  })
  it('a word split across spans keeps its per-fragment styles and coalesces when equal', () => {
    const el = makeText({ text: 'abcdef', width: 400 })
    const split = normalizeSpans([{ text: 'abc', bold: true }, { text: 'def', bold: true }], 'abcdef')!
    expect(layoutRichLines(el, split, fakeMeasure)).toHaveLength(1) // equal styles coalesce
    const diff = normalizeSpans([{ text: 'abc', bold: true }, { text: 'def' }], 'abcdef')!
    const runs = layoutRichLines(el, diff, fakeMeasure)
    expect(runs).toHaveLength(2)
    expect(runs[0]).toMatchObject({ text: 'abc', x: 0, width: 30 })
    expect(runs[1]).toMatchObject({ text: 'def', x: 30 })
    expect(runs[1].style.bold).toBe(false)
  })
  it('uppercase renders uppercased runs; link runs resolve blue + underlined', () => {
    const el = makeText({ text: 'abc def', uppercase: true, width: 400 })
    const spans = normalizeSpans([{ text: 'abc ' }, { text: 'def', link: 'https://x.dev' }], 'abc def')!
    const runs = layoutRichLines(el, spans, fakeMeasure)
    expect(runs.map((r) => r.text)).toEqual(['ABC ', 'DEF'])
    expect(runs[1].style).toMatchObject({ color: '#1155CC', underline: true, link: 'https://x.dev' })
  })
  it('letterSpacing rides the measure contract (width includes it)', () => {
    const el = makeText({ text: 'ab', width: 400, letterSpacing: 2 })
    const runs = layoutRichLines(el, normalizeSpans([{ text: 'ab', bold: true }], 'ab')!, fakeMeasure)
    expect(runs[0].width).toBe(24) // 2 chars × 10 + 2 × 2
  })
})

// ── resolveLineX ───────────────────────────────────────────────

describe('resolveLineX', () => {
  it('left/justify → 0, center → half the slack, right → the edge', () => {
    expect(resolveLineX('left', 100, 60)).toBe(0)
    expect(resolveLineX('justify', 100, 60)).toBe(0)
    expect(resolveLineX('center', 100, 60)).toBeCloseTo(20, 6)
    expect(resolveLineX('right', 100, 60)).toBeCloseTo(40, 6)
    expect(resolveLineX('center', 50, 100)).toBe(0) // over-wide: clamp, never negative
  })
})
