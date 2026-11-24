// design-engine/compile.ts — the compile proof.
//
// Case 1 is the v0.29.3 failed production run (harness.test.ts line
// 441): the CANVIX poster brief that motivated the agent-correctness
// work. The pipeline must compile it end to end — brief extraction
// (zero model calls) → spec → deterministic engine → real editor
// pages — with EXACT text, EXACT colors, no clipping, no unintended
// overlap, WCAG-cleared contrast, and fully editable native output.
//
// The scripted-planner pattern: no live model is needed because the
// required copy and colors come from the brief itself — exactly
// what a planner would emit for this prompt.
import { describe, expect, it } from 'vitest'
import { extractBrief } from '@/lib/agent/brief'
import { specFromBrief } from '@/lib/design-spec/from-brief'
import { parseSpecResponse } from '@/lib/design-spec/parse'
import { compileSpec, exactEquals } from './compile'
import { fitFontSize } from './compositions'
import type { AnyElement, TextElement } from '@/lib/types'
import type { DesignSpec } from '@/lib/design-spec/types'

const V0293_POSTER_PROMPT =
  'Make a 1080x1080 poster with navy #090B1A background, purple #8B5CF6 and cyan #22D3EE accents, saying "Design Beyond Limits", "Create Smarter. Design Faster." and "Try Canvix Free"'

function textElements(els: AnyElement[]): TextElement[] {
  return els.filter((el): el is TextElement => el.type === 'text')
}

describe('the v0.29.3 poster brief, compiled end to end', () => {
  const brief = extractBrief(V0293_POSTER_PROMPT)
  const spec = specFromBrief(brief)
  const result = compileSpec(spec)
  const page = result.pages[0]

  it('all compile checks pass — no silent degradation', () => {
    expect(result.checks.passed).toBe(true)
    expect(result.checks.failures).toEqual([])
  })

  it('EXACT text: character-for-character, not case-insensitive substring', () => {
    const texts = textElements(page.elements).map((el) => el.text)
    expect(texts).toContain('Design Beyond Limits')
    expect(texts).toContain('Create Smarter. Design Faster.')
    expect(texts).toContain('Try Canvix Free')
    // the hardened contract: case/whitespace variants FAIL (the old
    // brief checker would accept 'DESIGN BEYOND LIMITS — really')
    expect(exactEquals('Design Beyond Limits', 'DESIGN BEYOND LIMITS')).toBe(false)
    expect(exactEquals('a\u0301', 'á')).toBe(true) // NFC equivalence holds
    expect(exactEquals('Try Canvix Free', 'Try Canvix  Free')).toBe(false)
    for (const c of result.checks.exactTexts) expect(c.found).toBe(true)
  })

  it('EXACT colors: all three required hexes on the page', () => {
    expect(page.background).toEqual({ type: 'solid', color: '#090b1a' })
    const fills = page.elements
      .map((el) => ('fill' in el && typeof el.fill === 'string' ? el.fill.toLowerCase() : ''))
      .filter(Boolean)
    expect(fills).toContain('#8b5cf6')
    expect(fills).toContain('#22d3ee')
    for (const c of result.checks.colors) expect(c.found).toBe(true)
  })

  it('geometry: everything in-canvas, content mutually disjoint, text fits', () => {
    expect(result.checks.inCanvas).toBe(true)
    expect(result.checks.noUnintendedOverlap).toBe(true)
    expect(result.checks.textFits).toBe(true)
  })

  it('contrast: WCAG ≥ 4.5 on every checked pair', () => {
    for (const c of result.checks.contrast) {
      expect(c.ok, `${c.pair} = ${c.ratio}`).toBe(true)
    }
  })

  it('native, editable output: real factory elements with catalog fonts', () => {
    expect(page.elements.length).toBeGreaterThanOrEqual(5) // headline, subline, chip, chip text, underline
    for (const el of page.elements) {
      expect(el.id).toMatch(/^spec_\d+$/)
      expect(el.width).toBeGreaterThan(0)
    }
    for (const el of textElements(page.elements)) {
      expect(['Poppins', 'Inter', 'Montserrat', 'Work Sans', 'Space Grotesk', 'Oswald', 'Lato', 'Raleway', 'Open Sans']).toContain(el.fontFamily)
    }
  })

  it('deterministic: the same spec compiles byte-identically', () => {
    const again = compileSpec(specFromBrief(extractBrief(V0293_POSTER_PROMPT)))
    expect(JSON.stringify(again.pages)).toBe(JSON.stringify(result.pages))
  })
})

describe('feature-cards: the validator definition, inverted into a builder', () => {
  const r = parseSpecResponse(
    JSON.stringify({
      version: 'v2',
      format: { width: 1280, height: 720 },
      palette: { seeds: ['#101418'], mood: 'cool' },
      typography: { scale: 1.25 },
      blocks: [
        {
          kind: 'feature-cards',
          count: 3,
          content: [
            { role: 'label', source: 'model', text: 'Fast' },
            { role: 'label', source: 'model', text: 'Private' },
            { role: 'label', source: 'model', text: 'Yours' },
          ],
        },
      ],
    }),
  )
  const result = r.ok ? compileSpec(r.spec) : null

  it('emits N semi-transparent card rects, one to three texts each', () => {
    expect(r.ok).toBe(true)
    expect(result).not.toBeNull()
    if (!result) return
    expect(result.checks.passed).toBe(true)
    const cards = result.pages[0].elements.filter(
      (el) => el.type === 'rect' && 'opacity' in el && (el as { opacity: number }).opacity < 1,
    )
    expect(cards).toHaveLength(3)
    const texts = textElements(result.pages[0].elements)
    expect(texts).toHaveLength(3)
    // each text sits inside a card (the validator's structural check)
    for (const t of texts) {
      const host = cards.some((c) =>
        t.x >= c.x - 1 && t.y >= c.y - 1 && t.x + t.width <= c.x + c.width + 1 && t.y + t.height <= c.y + c.height + 1,
      )
      expect(host).toBe(true)
    }
  })
})

describe('required copy: wraps to fit, and fails honestly when even wrapping cannot save it', () => {
  const long = 'This required headline is intentionally far too long to fit a one-thousand-eighty pixel band even at the minimum floor size'
  const r = parseSpecResponse(
    JSON.stringify({
      format: { width: 1080, height: 1080 },
      blocks: [
        {
          kind: 'hero',
          content: [
            { role: 'headline', source: 'user-required', text: long },
            { role: 'cta', source: 'user-required', text: 'Go' },
          ],
        },
      ],
    }),
  )
  const result = r.ok ? compileSpec(r.spec) : null

  it('a long required headline WRAPS inside its band instead of failing or being cut', () => {
    expect(r.ok).toBe(true)
    if (!result) return
    // the text survived INTACT as one element — wrapping never splits it
    const texts = textElements(result.pages[0].elements).map((el) => el.text)
    expect(texts).toContain(long)
    expect(result.checks.textFits).toBe(true)
    expect(result.checks.passed).toBe(true)
    // the box grew to the wrapped height (multi-line), within the band
    const headline = textElements(result.pages[0].elements).find((el) => el.text === long)
    expect(headline?.height).toBeGreaterThan((headline?.fontSize ?? 0) * 1.15)
  })

  it('an unfixable required text (tiny canvas, already wrapped) still fails instead of being cut', () => {
    const tiny = parseSpecResponse(
      JSON.stringify({
        format: { width: 200, height: 200 },
        blocks: [
          {
            kind: 'hero',
            content: [
              { role: 'headline', source: 'user-required', text: long },
              { role: 'cta', source: 'user-required', text: 'Go' },
            ],
          },
        ],
      }),
    )
    expect(tiny.ok).toBe(true)
    if (!tiny.ok) return
    const res = compileSpec(tiny.spec)
    // intact — the failure is reported, never a truncation
    const texts = textElements(res.pages[0].elements).map((el) => el.text)
    expect(texts).toContain(long)
    expect(res.checks.textFits).toBe(false)
    expect(res.checks.passed).toBe(false)
    expect(res.checks.failures.some((f) => f.includes('never truncated'))).toBe(true)
  })
})

describe('fitFontSize', () => {
  it('shrinks toward the floor but never below it', () => {
    expect(fitFontSize('Short', 500, 96, 28)).toBe(96)
    const size = fitFontSize('A '.repeat(60), 500, 96, 28)
    expect(size).toBeGreaterThanOrEqual(28)
    expect(size).toBeLessThan(96)
  })
})

describe('seed guarantee: required colors reach the page without accent-using compositions', () => {
  // Found by the real-model acceptance run (a planner spec with two
  // seeds and a hero carrying no CTA slot): the accent seed was
  // assigned a role but never drawn, and the color check failed. The
  // palette contract — required colors always appear — must hold for
  // every composition mix, so the compiler emits a fallback band.
  const spec: DesignSpec = {
    version: 'v2',
    name: 'seed guarantee',
    format: { width: 1080, height: 1350 },
    palette: { seeds: ['#1B5E20', '#F9A825'], mood: 'warm' },
    typography: {},
    blocks: [
      {
        kind: 'hero',
        weight: 1,
        content: [{ role: 'headline', source: 'user-required', text: 'Seed Guarantee' }],
        overlap: 'none',
      },
    ],
  }
  const result = compileSpec(spec)
  const page = result.pages[0]

  it('both required seeds appear on the page', () => {
    for (const c of result.checks.colors) expect(c.found, c.hex).toBe(true)
    // darkest seed → page background (not an element fill; case preserved)
    expect(page.background).toEqual({ type: 'solid', color: '#1B5E20' })
    const fills = page.elements
      .map((el) => ('fill' in el && typeof el.fill === 'string' ? el.fill.toLowerCase() : ''))
      .filter(Boolean)
    expect(fills).toContain('#f9a825') // fallback band
  })

  it('the fallback band is a backdrop: in-canvas, overlap-safe, deterministic, disclosed', () => {
    expect(result.checks.inCanvas).toBe(true)
    expect(result.checks.noUnintendedOverlap).toBe(true)
    expect(result.warnings.join(' ')).toMatch(/seed guarantee/)
    const again = compileSpec(spec)
    expect(JSON.stringify(again.pages)).toBe(JSON.stringify(result.pages))
  })
})

describe('seed guarantee placement: semantic before decorative', () => {
  // The band is the LAST resort. When the hero emits its accent
  // underline (a real headline-emphasis device), a missing required
  // seed is placed there first — semantic assignment, not a bolt-on
  // bar. Only compositions with no underline fall back to the band.
  const spec: DesignSpec = {
    version: 'v2',
    name: 'semantic placement',
    format: { width: 1080, height: 1350 },
    palette: { seeds: ['#1B5E20', '#F9A825'], mood: 'warm' },
    typography: {},
    blocks: [
      {
        kind: 'hero',
        weight: 1,
        content: [
          { role: 'headline', source: 'user-required', text: 'Headline For Emphasis' },
          { role: 'subline', source: 'user-required', text: 'A subline below the headline' },
        ],
        overlap: 'none',
      },
    ],
  }
  const result = compileSpec(spec)
  const page = result.pages[0]

  it('the missing seed recolors the headline underline, not a band', () => {
    expect(page.background).toEqual({ type: 'solid', color: '#1B5E20' })
    const amberEls = page.elements.filter(
      (el) => 'fill' in el && typeof el.fill === 'string' && el.fill.toLowerCase() === '#f9a825',
    )
    expect(amberEls.length).toBeGreaterThanOrEqual(1)
    // an underline is a slim emphasis rect (≤ 8px); a band would be 12-48px
    for (const el of amberEls) expect(el.height).toBeLessThanOrEqual(8)
    expect(result.warnings.join(' ')).toMatch(/headline emphasis/)
    for (const c of result.checks.colors) expect(c.found, c.hex).toBe(true)
  })

  it('the recolored underline stays a backdrop: in-canvas, overlap-safe, deterministic', () => {
    expect(result.checks.inCanvas).toBe(true)
    expect(result.checks.noUnintendedOverlap).toBe(true)
    const again = compileSpec(spec)
    expect(JSON.stringify(again.pages)).toBe(JSON.stringify(result.pages))
  })
})
