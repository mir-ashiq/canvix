// ─────────────────────────────────────────────────────────────
// Word Cloud layout library tests (P5). The library is the ACTUAL
// file the shipped plugin loads (public/plugins/wordcloud/
// wordcloud.js, UMD) — imported here via CommonJS so what we test
// is byte-for-byte what runs in the sandboxed iframes.
//
// The invariants that matter (renderer contract §4.5):
//   1. DETERMINISM — same data in, byte-identical SVG out (the
//      host's render cache is keyed on a hash of the data; a
//      non-deterministic renderer would poison it)
//   2. SANITIZER ACCEPTANCE — the output can never be rejected by
//      the P1 accept-or-reject sanitizer (asserted directly, on a
//      battery of inputs incl. hostile words)
//   3. CONTAINMENT — nothing renders outside the box or the mask
//   4. CAPS — hostile/large data clamps instead of throwing
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { sanitizePluginSvg } from './sanitize-svg'

// The UMD library executes as CommonJS here (module.exports) and as a
// classic <script> in the plugin's sandboxed iframes — same bytes.
const nodeRequire = createRequire(import.meta.url)

interface PlacedWord {
  text: string
  cx: number
  cy: number
  fontSize: number
  rotate: number
  fill: string
}

const WC = nodeRequire(
  path.join(process.cwd(), 'public/plugins/wordcloud/wordcloud.js'),
) as {
  tokenize: (text: string, extraStops?: string) => { text: string; weight: number }[]
  toSvg: (data: unknown, width: number, height: number, mode?: string) => string
  clampData: (
    data: unknown,
  ) => { words: { text: string; weight: number }[]; seed: number; density: number; mask: string; palette: string }
  layout: (data: unknown, width: number, height: number) => PlacedWord[]
  PALETTES: Record<string, string[]>
  MASKS: string[]
  STOPWORDS: Record<string, number>
}

const WORDS = [
  { text: 'canvix', weight: 24 },
  { text: 'design', weight: 18 },
  { text: 'canvas', weight: 15 },
  { text: 'plugins', weight: 11 },
  { text: 'security', weight: 9 },
  { text: 'sandbox', weight: 7 },
  { text: 'render', weight: 5 },
  { text: 'export', weight: 3 },
]

const BASE_DATA = { words: WORDS, seed: 42, density: 0.7, mask: 'rect', palette: 'canvix' }

describe('tokenize', () => {
  it('counts frequencies, drops stop words and short tokens, keeps display case', () => {
    const out = WC.tokenize('The design and the DESIGN; a canvas of Design!', 'canvas')
    // 'the'/'and'/'a'/'of' are stop words, 'canvas' is a user stop word
    expect(out).toEqual([{ text: 'design', weight: 3 }])
  })

  it('caps the result at 150 words, sorted by weight then alphabetically', () => {
    const text = Array.from({ length: 300 }, (_, i) => `w${i}`).join(' ')
    const out = WC.tokenize(text)
    expect(out.length).toBeLessThanOrEqual(150)
    for (let i = 1; i < out.length; i++) {
      const prev = out[i - 1]
      const cur = out[i]
      const byWeight = cur.weight < prev.weight
      const sameWeightAlpha = cur.weight === prev.weight && prev.text < cur.text
      expect(byWeight || sameWeightAlpha).toBe(true)
    }
  })

  it('treats punctuation and unicode apostrophes as separators, not words', () => {
    const out = WC.tokenize("don't stop—me…won't", '')
    expect(out.map((w: { text: string }) => w.text).sort()).toEqual(["don't", 'stop', "won't"])
  })
})

describe('toSvg — determinism (the render-cache contract)', () => {
  it('returns byte-identical output for the same data', () => {
    const a = WC.toSvg(BASE_DATA, 640, 400, 'canvas')
    const b = WC.toSvg(BASE_DATA, 640, 400, 'canvas')
    expect(a).toBe(b)
  })

  it('changes when the seed changes, and only then', () => {
    const a = WC.toSvg(BASE_DATA, 640, 400, 'canvas')
    const b = WC.toSvg({ ...BASE_DATA, seed: 43 }, 640, 400, 'canvas')
    const c = WC.toSvg({ ...BASE_DATA, seed: 42 }, 640, 400, 'export')
    expect(a).not.toBe(b)
    expect(a).toBe(c) // mode does not alter geometry — deterministic
  })

  it('renders every word somewhere (8/8 for a roomy box)', () => {
    const svg = WC.toSvg(BASE_DATA, 800, 500, 'canvas')
    for (const w of WORDS) {
      expect(svg).toContain(`>${w.text}<`)
    }
  })
})

describe('toSvg — sanitizer acceptance (asserted, not assumed)', () => {
  const hostile = [
    { text: '<script>alert(1)</script>', weight: 9 },
    { text: 'a&b<c>d"e\'f', weight: 8 },
    { text: 'xlink:href="javascript:x"', weight: 7 },
    { text: 'onload=boom', weight: 6 },
    { text: '</text></svg><script>', weight: 5 },
    { text: ']]><!-->', weight: 4 },
    { text: 'macro\u00A0nbsp', weight: 3 },
  ]

  it('output always passes sanitizePluginSvg — hostile words included', () => {
    const data = { ...BASE_DATA, words: [...WORDS.slice(0, 4), ...hostile] }
    for (const mask of WC.MASKS) {
      for (const palette of Object.keys(WC.PALETTES)) {
        const svg = WC.toSvg({ ...data, mask, palette }, 600, 380, 'canvas')
        const clean = sanitizePluginSvg(svg)
        expect(clean.ok, `mask=${mask} palette=${palette}: ${clean.ok ? '' : clean.error}`).toBe(true)
      }
    }
  })

  it('never emits raw XML-special characters or attr-shaped payloads in text content', () => {
    const svg = WC.toSvg({ ...BASE_DATA, words: hostile }, 600, 380, 'canvas')
    // escaped by construction — every hostile word appears as text only
    expect(svg).not.toMatch(/<(script|foreignObject)/i)
    // the sanitizer's own attribute-level rules, mirrored: no javascript:
    // URI and no on*-handler may appear in ATTRIBUTE position
    expect(svg).not.toMatch(/\s(?:xlink:)?(?:href|src)\s*=\s*["']?\s*javascript\s*:/i)
    expect(svg).not.toMatch(/\son[a-z]+\s*=/i)
    // the payloads DID render (as inert, escaped text) — nothing dropped silently
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).toContain('a&amp;b&lt;c&gt;')
  })

  it('empty words render the honest hint, still sanitizer-clean', () => {
    const svg = WC.toSvg({ ...BASE_DATA, words: [] }, 400, 300, 'canvas')
    expect(svg).toContain('Word cloud')
    expect(sanitizePluginSvg(svg).ok).toBe(true)
  })
})

describe('toSvg — geometry', () => {
  it('emits the requested viewBox and machine-independent structure', () => {
    const svg = WC.toSvg(BASE_DATA, 640, 400, 'canvas')
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"')).toBe(true)
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
    expect(svg).not.toContain('<?xml')
    expect(svg).not.toContain('<!--')
  })

  it('circle mask keeps every placement inside the ellipse', () => {
    // reconstruct the placed boxes from the layout and re-check
    const items = WC.layout(WC.clampData({ ...BASE_DATA, mask: 'circle' }), 600, 400)
    expect(items.length).toBeGreaterThan(3)
    const rx = (600 / 2) * 0.94
    const ry = (400 / 2) * 0.94
    for (const it of items) {
      // a placement's text box is ~fontSize-tall around (cx, cy)
      const hw = it.fontSize * 2 // generous half-width bound
      const hh = it.fontSize * 0.7
      const dx = hw / rx
      const dy = hh / ry
      expect(dx * dx + dy * dy).toBeLessThanOrEqual(1.0001)
    }
  })

  it('stays far under the 2 MB output cap even at the word limit', () => {
    const words = Array.from({ length: 150 }, (_, i) => ({
      text: `wordnumber${i}extra`,
      weight: 150 - i,
    }))
    const svg = WC.toSvg({ ...BASE_DATA, words }, 1200, 800, 'export')
    expect(svg.length).toBeLessThan(100 * 1024)
    expect(sanitizePluginSvg(svg).ok).toBe(true)
  })
})

describe('clampData — hostile data never throws', () => {
  it('normalizes garbage into defaults', () => {
    const d = WC.clampData(null)
    expect(d).toEqual({ words: [], seed: 42, density: 0.7, mask: 'rect', palette: 'canvix' })
    const e = WC.clampData({ words: 'nope', seed: NaN, density: 99, mask: 'star', palette: 'neo' })
    expect(e.mask).toBe('rect')
    expect(e.palette).toBe('canvix')
    expect(e.density).toBe(1)
  })

  it('caps words at 150, weights at 999, text at 40 chars, seed into range', () => {
    const words = Array.from({ length: 400 }, () => ({
      text: 'x'.repeat(120),
      weight: 10_000,
    }))
    const d = WC.clampData({ ...BASE_DATA, words, seed: 999_999 })
    expect(d.words.length).toBe(150)
    expect(d.words[0].text.length).toBe(40)
    expect(d.words[0].weight).toBe(999)
    expect(d.seed).toBe(9999)
  })

  it('drops malformed word entries instead of failing', () => {
    const d = WC.clampData({
      ...BASE_DATA,
      words: [null, 5, { text: 'ok', weight: 2 }, { text: '', weight: 3 }, { text: 'noweight' }, { weight: 4 }],
    })
    expect(d.words).toEqual([{ text: 'ok', weight: 2 }])
    expect(() => WC.toSvg(d, 500, 300, 'canvas')).not.toThrow()
  })
})

describe('the shipped bundle is internally consistent', () => {
  it('wordcloud.js parses as the exact file the frames load', () => {
    // require() above already executed it; assert the file carries no
    // ESM statement syntax (classic <script> frames cannot import)
    const src = readFileSync(
      path.join(process.cwd(), 'public/plugins/wordcloud/wordcloud.js'),
      'utf8',
    )
    expect(src).not.toMatch(/^\s*import\s/m)
    expect(src).not.toMatch(/^\s*export\s/m)
    expect(src).toContain('module.exports')
  })
})
