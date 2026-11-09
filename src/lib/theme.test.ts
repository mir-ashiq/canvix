// Wave 4 — lib/theme.ts unit tests.
import { describe, expect, it } from 'vitest'
import { applyTheme, contrast, normalizeTheme, themeSystemPrompt, THEME_ROLES, type Theme } from './theme'
import type { PageData } from './types'

const FONTS = ['Poppins', 'Inter', 'Montserrat', 'Playfair Display']

function page(elements: unknown[]): PageData {
  return { id: 'p1', background: { type: 'solid', color: '#FFFFFF' }, elements } as unknown as PageData
}

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    expect(Math.round(contrast('#000000', '#FFFFFF'))).toBe(21)
    expect(contrast('#FFFFFF', '#FFFFFF')).toBe(1)
    expect(contrast('junk', '#FFFFFF')).toBe(0)
  })
})

describe('normalizeTheme', () => {
  it('normalizes a well-formed theme', () => {
    const t = normalizeTheme(
      {
        name: 'Nordic calm',
        mood: 'cool editorial',
        palette: [
          { hex: '#0B1220', role: 'background' },
          { hex: '#16233A', role: 'surface' },
          { hex: '#F5F7FA', role: 'ink' },
          { hex: '#C3CCDA', role: 'inkSoft' },
          { hex: '#5B8DEF', role: 'accent' },
          { hex: '#9BB8F5', role: 'accentSoft' },
        ],
        fonts: { heading: 'Playfair Display', body: 'Inter' },
      },
      FONTS,
    )
    expect(t.name).toBe('Nordic calm')
    expect(t.palette).toHaveLength(6)
    expect(new Set(t.palette.map((c) => c.role))).toEqual(new Set(THEME_ROLES))
    expect(t.fonts.heading).toBe('Playfair Display')
    // dark bg + light ink = high contrast, guard must not fire
    expect(contrast(t.palette[2].hex, t.palette[0].hex)).toBeGreaterThan(3)
  })

  it('fills missing roles and rejects junk', () => {
    const t = normalizeTheme(
      {
        palette: [
          { hex: 'nope', role: 'background' },
          { hex: '#123456' },
          { hex: '#ABCDEF', role: 'madeup-role' },
        ],
        fonts: { heading: 'Comic Sans', body: 42 },
      },
      FONTS,
    )
    expect(t.palette).toHaveLength(6)
    // junk hex dropped; unroled hex used as a leftover fill
    expect(t.palette.some((c) => c.hex === '#123456' || c.hex === '#ABCDEF')).toBe(true)
    expect(t.fonts.heading).toBe('Poppins') // unknown font → default
    expect(t.fonts.body).toBe('Inter')
    expect(t.name).toBe('AI theme')
  })

  it('contrast guard swaps unreadable ink', () => {
    // model ships light-on-light: white bg, near-white ink
    const t = normalizeTheme(
      {
        palette: [
          { hex: '#FAFAFA', role: 'background' },
          { hex: '#F0F0F0', role: 'ink' },
          { hex: '#111111', role: 'inkSoft' },
        ],
      },
      FONTS,
    )
    const bg = t.palette.find((c) => c.role === 'background')!.hex
    const ink = t.palette.find((c) => c.role === 'ink')!.hex
    expect(contrast(ink, bg)).toBeGreaterThanOrEqual(3)
  })

  it('survives garbage input', () => {
    expect(() => normalizeTheme(null, FONTS)).not.toThrow()
    expect(normalizeTheme('junk', FONTS).palette).toHaveLength(6)
  })
})

describe('applyTheme', () => {
  const theme: Theme = normalizeTheme(
    {
      palette: [
        { hex: '#0B1220', role: 'background' },
        { hex: '#16233A', role: 'surface' },
        { hex: '#F5F7FA', role: 'ink' },
        { hex: '#C3CCDA', role: 'inkSoft' },
        { hex: '#5B8DEF', role: 'accent' },
        { hex: '#9BB8F5', role: 'accentSoft' },
      ],
      fonts: { heading: 'Montserrat', body: 'Inter' },
    },
    FONTS,
  )

  it('recolors backgrounds, text, shapes and lines; leaves media alone', () => {
    const src = page([
      { type: 'text', text: 'Big', fontSize: 80, fill: '#111111', fontFamily: 'Poppins' },
      { type: 'text', text: 'small', fontSize: 20, fill: '#333333', fontFamily: 'Poppins' },
      { type: 'rect', x: 0, y: 0, width: 10, height: 10, fill: '#7630D7', stroke: 'transparent', strokeWidth: 0 },
      { type: 'line', x: 0, y: 0, stroke: '#999999', strokeWidth: 2 },
      { type: 'image', src: 'data:x', fill: '#123456' },
      { type: 'chart', fill: '#654321' },
      { type: 'sticker', char: '🎉', fill: '#ABCABC' },
    ])
    const [out] = applyTheme([src], theme)
    expect(out.background).toEqual({ type: 'solid', color: '#0B1220' })
    const [big, small, rect, line, image, chart, sticker] = out.elements as unknown as Record<string, unknown>[]
    expect(big.fill).toBe('#F5F7FA') // heading ink
    expect(big.fontFamily).toBe('Montserrat')
    expect(small.fill).toBe('#C3CCDA') // body inkSoft
    expect(small.fontFamily).toBe('Inter')
    expect(rect.fill).toBe('#5B8DEF') // accent
    expect(line.stroke).toBe('#5B8DEF')
    expect(image.fill).toBe('#123456') // untouched
    expect(chart.fill).toBe('#654321')
    expect(sticker.fill).toBe('#ABCABC')
  })

  it('gradient backgrounds map to accent→accentSoft preserving the angle', () => {
    const src: PageData = {
      id: 'p',
      background: { type: 'gradient', from: '#111111', to: '#222222', angle: 45 },
      elements: [],
    } as unknown as PageData
    const [out] = applyTheme([src], theme)
    expect(out.background).toEqual({ type: 'gradient', from: '#5B8DEF', to: '#9BB8F5', angle: 45 })
  })

  it('neutral shape fills become surface, loud ones accent', () => {
    const src = page([
      { type: 'rect', fill: '#FFFFFF', stroke: 'transparent', strokeWidth: 0 },
      { type: 'ellipse', fill: '#FF00AA' },
    ])
    const [out] = applyTheme([src], theme)
    expect((out.elements[0] as unknown as Record<string, unknown>).fill).toBe('#16233A') // surface
    expect((out.elements[1] as unknown as Record<string, unknown>).fill).toBe('#5B8DEF') // accent
  })

  it('never strands low-contrast text on the new background', () => {
    // light theme onto a design whose text was already light — the
    // guard must flip body text to ink when inkSoft would vanish
    const lightTheme = normalizeTheme(
      {
        palette: [
          { hex: '#F8FAFC', role: 'background' },
          { hex: '#EEEEEE', role: 'surface' },
          { hex: '#0F172A', role: 'ink' },
          { hex: '#E2E8F0', role: 'inkSoft' }, // low contrast on bg
        ],
      },
      FONTS,
    )
    const src = page([{ type: 'text', text: 'body', fontSize: 18, fill: '#000000' }])
    const [out] = applyTheme([src], lightTheme)
    const body = out.elements[0] as unknown as { fill: string }
    expect(contrast(body.fill, '#F8FAFC')).toBeGreaterThanOrEqual(3)
  })

  it('is pure — the input pages are not mutated', () => {
    const src = page([{ type: 'text', text: 'x', fontSize: 20, fill: '#123123' }])
    const before = JSON.stringify(src)
    applyTheme([src], theme)
    expect(JSON.stringify(src)).toBe(before)
  })
})

describe('themeSystemPrompt', () => {
  it('pins the roles, fonts and JSON contract', () => {
    const s = themeSystemPrompt(FONTS)
    expect(s).toContain(THEME_ROLES.join(', '))
    expect(s).toContain('Playfair Display')
    expect(s).toContain('{"name"')
  })
})
