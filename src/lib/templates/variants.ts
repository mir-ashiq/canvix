// ─────────────────────────────────────────────────────────────
// Canvix template variants (v0.17 Wave 2) — grows the library from
// 122 hand-authored designs to 360+ without shipping extra bytes:
// every base template gets two deterministic computed variants
// (generated at module load, seeded identically into the DB):
//
//   · Aurora — colourway shift (hue rotation + tuned sat/light)
//   · Ink    — typography swap (same-category font exchange)
//
// Pure transforms: no randomness, stable slugs (`-aurora` / `-ink`),
// idempotent across reloads and re-seeds. White/near-white and
// black/near-black survive (low-sat colours barely move), emoji
// stickers and structure are untouched, and {{field}} markers pass
// through untouched so variants of smart templates stay smart.
// ─────────────────────────────────────────────────────────────

import type { TemplateDef } from './helpers'
import type { PageData, AnyElement } from '../types'

// ── colour math ───────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(h)) return null
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
}

function rgbToHex(r: number, g: number, b: number): string {
  const f = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${f(r)}${f(g)}${f(b)}`
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h * 360, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const seg = Math.floor(h / 60) % 6
  const table: [number, number, number][] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ]
  const [r, g, b] = table[seg]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

/** one colourway step: rotate hue, tune saturation & lightness */
function recolor(hex: string, hueShift: number, satMul: number, lightPush: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const [h, s, l] = rgbToHsl(...rgb)
  // near-neutral colours stay neutral — whites stay white, ink stays ink
  if (s < 0.08) {
    const l2 = Math.max(0, Math.min(1, l + lightPush * 0.25))
    return rgbToHex(...hslToRgb(h, s, l2))
  }
  const h2 = h + hueShift
  const s2 = Math.max(0.15, Math.min(0.95, s * satMul))
  const l2 = Math.max(0.12, Math.min(0.92, l + lightPush * (l > 0.5 ? -1 : 1) * 0.5 + lightPush * 0.5))
  return rgbToHex(...hslToRgb(h2, s2, l2))
}

// ── typography swap ───────────────────────────────────────────

/** curated same-category exchanges for the Ink variant */
const FONT_SWAP: Record<string, string> = {
  // sans
  Inter: 'Manrope', Poppins: 'Nunito', Montserrat: 'Raleway', 'Space Grotesk': 'Sora',
  Oswald: 'Archivo', Raleway: 'Karla', Lato: 'Mulish', 'Open Sans': 'Heebo',
  Nunito: 'Poppins', Quicksand: 'Comfortaa', Rubik: 'Jost', 'Work Sans': 'Figtree',
  'DM Sans': 'Outfit', 'Josefin Sans': 'Urbanist', Barlow: 'Overpass', Manrope: 'Epilogue',
  Outfit: 'DM Sans', Figtree: 'Work Sans',
  // serif
  'Playfair Display': 'Cormorant Garamond', 'Abril Fatface': 'Bodoni Moda', 'Roboto Slab': 'Zilla Slab',
  Lora: 'Merriweather', Merriweather: 'Lora', 'Libre Baskerville': 'Bitter', 'EB Garamond': 'Cormorant Garamond',
  'Cormorant Garamond': 'EB Garamond', 'DM Serif Display': 'Playfair Display', Prata: 'Marcellus',
  Bitter: 'Libre Baskerville', Fraunces: 'Bodoni Moda', 'Bodoni Moda': 'Fraunces', Cinzel: 'Marcellus SC',
  // display
  'Bebas Neue': 'Anton', Anton: 'Bebas Neue', 'Archivo Black': 'Archivo Black', Lobster: 'Righteous',
  'Alfa Slab One': 'Ultra', Bungee: 'Rye', Righteous: 'Lobster', Ultra: 'Alfa Slab One',
  'Passion One': 'Titan One', Monoton: 'Rye', Rye: 'Monoton', 'Titan One': 'Passion One',
  'Luckiest Guy': 'Titan One', 'Permanent Marker': 'Caveat',
  // handwriting
  Pacifico: 'Dancing Script', Caveat: 'Kalam', 'Dancing Script': 'Pacifico', 'Great Vibes': 'Allura',
  Sacramento: 'Parisienne', Satisfy: 'Yellowtail', 'Kaushan Script': 'Great Vibes', 'Alex Brush': 'Sacramento',
  Allura: 'Parisienne', Parisienne: 'Allura', 'Amatic SC': 'Caveat', 'Shadows Into Light': 'Indie Flower',
  'Indie Flower': 'Shadows Into Light', Kalam: 'Caveat',
  // mono
  'DM Mono': 'Space Mono', 'JetBrains Mono': 'Fira Code', 'Space Mono': 'DM Mono',
}

function swapFont(family: string | undefined): string | undefined {
  if (!family) return family
  return FONT_SWAP[family] ?? family
}

// ── element transforms ────────────────────────────────────────

function recolorElement(el: AnyElement, hueShift: number, satMul: number, lightPush: number): AnyElement {
  const out: Record<string, unknown> = { ...el }
  if (typeof out.fill === 'string' && out.fill !== 'transparent') out.fill = recolor(out.fill, hueShift, satMul, lightPush)
  if (typeof out.stroke === 'string' && out.stroke !== 'transparent') out.stroke = recolor(out.stroke, hueShift, satMul, lightPush)
  if (typeof out.effectBackground === 'string') out.effectBackground = recolor(out.effectBackground, hueShift, satMul, lightPush)
  const grad = out.fillGradient as { colorStops?: unknown[] } | undefined
  if (grad && Array.isArray(grad.colorStops)) {
    out.fillGradient = {
      ...grad,
      colorStops: grad.colorStops.map((stop) =>
        typeof stop === 'string' && stop.startsWith('#') ? recolor(stop, hueShift, satMul, lightPush) : stop
      ),
    }
  }
  return out as unknown as AnyElement
}

function refontElement(el: AnyElement): AnyElement {
  if (typeof (el as { fontFamily?: string }).fontFamily !== 'string') return el
  const swapped = swapFont((el as { fontFamily?: string }).fontFamily)
  if (!swapped || swapped === (el as { fontFamily?: string }).fontFamily) return el
  return { ...el, fontFamily: swapped } as unknown as AnyElement
}

function recolorPage(page: PageData, hueShift: number, satMul: number, lightPush: number): PageData {
  const bg = page.background
  const nextBg: PageData['background'] =
    bg.type === 'solid' && bg.color !== 'transparent'
      ? { type: 'solid', color: recolor(bg.color, hueShift, satMul, lightPush) }
      : bg.type === 'gradient'
        ? { type: 'gradient', from: recolor(bg.from, hueShift, satMul, lightPush), to: recolor(bg.to, hueShift, satMul, lightPush), angle: bg.angle }
        : bg
  return {
    ...page,
    background: nextBg,
    elements: page.elements.map((el) => recolorElement(el, hueShift, satMul, lightPush)),
  }
}

// ── variant generation ────────────────────────────────────────

/** Aurora — bold colourway rotation */
function auroraVariant(t: TemplateDef): TemplateDef {
  return {
    ...t,
    slug: `${t.slug}-aurora`,
    name: `${t.name} · Aurora`,
    accent: recolor(t.accent, 150, 1.1, 0.04),
    badge: undefined,
    pages: t.pages.map((p) => recolorPage(p, 150, 1.12, 0.05)),
  }
}

/** Ink — typography exchange (colours untouched) */
function inkVariant(t: TemplateDef): TemplateDef {
  return {
    ...t,
    slug: `${t.slug}-ink`,
    name: `${t.name} · Ink`,
    accent: t.accent,
    badge: undefined,
    pages: t.pages.map((p) => ({ ...p, elements: p.elements.map(refontElement) })),
  }
}

/** every base template × 2 variants — deterministic, pure */
export function templateVariants(bases: TemplateDef[]): TemplateDef[] {
  const out: TemplateDef[] = []
  for (const base of bases) {
    out.push(auroraVariant(base), inkVariant(base))
  }
  return out
}
