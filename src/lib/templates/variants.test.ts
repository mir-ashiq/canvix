// Unit tests for template variants (v0.17 Wave 2) — library growth,
// determinism, structural integrity and actual colour/font movement.

import { describe, it, expect } from 'vitest'
import { TEMPLATES, BASE_TEMPLATES } from './index'
import { templateVariants } from './variants'

const FONT_SWAP_KNOWN = new Set([
  'Inter', 'Poppins', 'Montserrat', 'Playfair Display', 'Caveat', 'Bebas Neue', 'Cinzel',
  'Cormorant Garamond', 'EB Garamond', 'Space Grotesk', 'Oswald', 'Prata', 'Great Vibes',
  'Alex Brush', 'Allura', 'Parisienne', 'Amatic SC', 'Shadows Into Light', 'Indie Flower',
  'Kalam', 'DM Mono', 'JetBrains Mono', 'Space Mono', 'Lora', 'Merriweather', 'Bitter',
  'Abril Fatface', 'Roboto Slab', 'Anton', 'Archivo Black', 'Lobster', 'Pacifico',
  'Sacramento', 'Satisfy', 'Kaushan Script', 'Bodoni Moda', 'DM Serif Display', 'Fraunces',
  'Libre Baskerville', 'Josefin Sans', 'Figtree', 'DM Sans', 'Manrope', 'Outfit',
])
import type { TemplateDef } from './helpers'

const bySlug = new Map(TEMPLATES.map((t) => [t.slug, t]))

describe('template variants (v0.17 Wave 2)', () => {
  it('grows the library past 300 (122 originals + 244 variants)', () => {
    expect(BASE_TEMPLATES.length).toBeGreaterThanOrEqual(120)
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(300)
    expect(TEMPLATES.length).toBe(BASE_TEMPLATES.length * 3)
  })

  it('has unique slugs across the whole library', () => {
    const slugs = TEMPLATES.map((t) => t.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('is deterministic (two runs produce identical output)', () => {
    const a = JSON.stringify(templateVariants(BASE_TEMPLATES))
    const b = JSON.stringify(templateVariants(BASE_TEMPLATES))
    expect(a).toBe(b)
  })

  it('every variant keeps its base structure (pages, elements, categories, fields)', () => {
    for (const base of BASE_TEMPLATES) {
      for (const suffix of ['-aurora', '-ink'] as const) {
        const v = bySlug.get(base.slug + suffix)
        expect(v, `missing ${base.slug}${suffix}`).toBeDefined()
        expect(v!.category).toBe(base.category)
        expect(v!.width).toBe(base.width)
        expect(v!.height).toBe(base.height)
        expect(v!.pages.length).toBe(base.pages.length)
        v!.pages.forEach((page, i) => {
          expect(page.elements.length).toBe(base.pages[i].elements.length)
          expect(page.id).toBe(base.pages[i].id)
        })
        if (base.fields) expect(v!.fields).toEqual(base.fields)
      }
    }
  })

  it('Aurora variants actually change colours (and whites survive)', () => {
    const base = bySlug.get('roastery-badge-logo')!
    const aurora = bySlug.get('roastery-badge-logo-aurora')!
    expect(aurora.accent).not.toBe(base.accent)
    // the navy circle (#78350F brown here) must shift
    const baseFill = (base.pages[0].elements.find((e) => (e as { fill?: string }).fill === '#78350F') as { fill: string } | undefined)?.fill
    const auroraFill = (aurora.pages[0].elements.find((e) => (e as { fill?: string }).fill === '#78350F') as { fill: string } | undefined)?.fill
    expect(auroraFill).toBeUndefined() // old colour replaced
    // a white background page stays white
    const whiteBase = BASE_TEMPLATES.find((t) => (t.pages[0].background as { color?: string })?.color === '#FFFFFF')
    if (whiteBase) {
      const whiteAurora = bySlug.get(whiteBase.slug + '-aurora')!
      expect((whiteAurora.pages[0].background as { color: string }).color.toLowerCase()).toBe('#ffffff')
    }
  })

  it('Ink variants swap fonts on text elements only', () => {
    const base = bySlug.get('roastery-badge-logo')!
    const ink = bySlug.get('roastery-badge-logo-ink')!
    const baseText = base.pages[0].elements.filter((e) => e.type === 'text') as unknown as { fontFamily: string }[]
    const inkText = ink.pages[0].elements.filter((e) => e.type === 'text') as unknown as { fontFamily: string }[]
    const changed = baseText.some((t, i) => t.fontFamily !== inkText[i].fontFamily)
    expect(changed || baseText.every((t) => !FONT_SWAP_KNOWN.has(t.fontFamily))).toBe(true)
    // colours untouched
    const baseFills = base.pages[0].elements.map((e) => (e as { fill?: string }).fill).join()
    const inkFills = ink.pages[0].elements.map((e) => (e as { fill?: string }).fill).join()
    expect(inkFills).toBe(baseFills)
  })

  it('field markers survive both variant transforms', () => {
    const base = bySlug.get('certificate-excellence')!
    expect(base.fields?.length).toBeGreaterThan(0)
    for (const suffix of ['-aurora', '-ink'] as const) {
      const v = bySlug.get('certificate-excellence' + suffix)!
      const texts = v.pages.flatMap((p) => p.elements.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text))
      expect(texts.some((t) => t.includes('{{recipient_name}}'))).toBe(true)
    }
  })
})
