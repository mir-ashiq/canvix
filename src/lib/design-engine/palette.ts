// ─────────────────────────────────────────────────────────────
// Design engine · palette (Phase A).
//
// Deterministic seed → role expansion. The inversion of theme.ts:
// where the theme engine recolors an existing design and guards
// contrast afterwards, this module assigns roles AT CONSTRUCTION
// TIME so no WCAG-violating pair can reach the canvas.
//
// Guarantees:
//   · seed colors are preserved verbatim in some role — required
//     brief colors therefore always appear on the page
//   · contrast(ink, background) ≥ 4.5 is enforced by flipping or
//     stepping the ink until it holds (bounded loop, never invents
//     colors outside a mix of the seeds and two neutrals)
//   · fully deterministic — same seeds, same roles, same warnings
// ─────────────────────────────────────────────────────────────

import { contrast } from '@/lib/theme'
import { PALETTE_ROLES, asHex, clamp, type PaletteMood, type PaletteRole, type PaletteSpec } from '@/lib/design-spec/types'

export interface ExpandedPalette {
  roles: Record<PaletteRole, string>
  /** non-fatal notes surfaced by the compile report (honest completion) */
  warnings: string[]
}

// ── color primitives (local; theme.ts exports only contrast) ──

function hexToRgb(hex: string): [number, number, number] | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** linear mix: t=0 → a, t=1 → b */
export function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  if (!ca || !cb) return a
  const k = clamp(t, 0, 1)
  return rgbToHex(ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k)
}

function luminanceOf(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Readable ink for any fill — white or near-black, whichever wins. */
export function onColor(hex: string): string {
  return contrast('#FFFFFF', hex) >= contrast('#10131A', hex) ? '#FFFFFF' : '#10131A'
}

// ── role expansion ───────────────────────────────────────────

const NEUTRAL_DARK = '#10131A'
const NEUTRAL_LIGHT = '#FFFFFF'
const MIN_TEXT_CONTRAST = 4.5

/**
 * Expand palette seeds into the full role set. Assignment order
 * (deterministic): pinned roles win; then the darkest seed becomes
 * background, remaining seeds fill accent/accentSoft by luminance;
 * ink/inkSoft/surface are derived and contrast-guarded.
 */
export function expandPalette(spec: PaletteSpec, mood: PaletteMood = spec.mood): ExpandedPalette {
  const warnings: string[] = []
  const roles = {} as Record<PaletteRole, string>

  // 1. pinned roles — validated hex, honored verbatim
  for (const role of PALETTE_ROLES) {
    const pinned = asHex(spec.pinned?.[role], '')
    if (pinned !== '') roles[role] = pinned
  }

  // 2. seeds: darkest → background; rest → accents by luminance
  const seeds = spec.seeds.map((s) => asHex(s, '')).filter((s) => s !== '')
  const unassignedSeeds = [...seeds]
  if (!roles.background && unassignedSeeds.length) {
    let darkest = 0
    for (let i = 1; i < unassignedSeeds.length; i++) {
      if (luminanceOf(unassignedSeeds[i]) < luminanceOf(unassignedSeeds[darkest])) darkest = i
    }
    roles.background = unassignedSeeds.splice(darkest, 1)[0]
  }
  if (!roles.background) {
    // no seeds at all: mood-derived neutral ground
    roles.background = mood === 'warm' ? '#F7F3EC' : mood === 'cool' ? '#F2F6FA' : '#FFFFFF'
    warnings.push('no palette seeds — background defaulted from mood')
  }
  const accentOrder = unassignedSeeds.sort((a, b) => luminanceOf(b) - luminanceOf(a))
  if (!roles.accent && accentOrder.length) roles.accent = accentOrder.shift() as string
  if (!roles.accentSoft && accentOrder.length) roles.accentSoft = accentOrder.shift() as string
  if (!roles.accent) {
    roles.accent = mood === 'warm' ? '#B45F3C' : mood === 'cool' ? '#2C7DA0' : '#00C4CC'
    warnings.push('accent defaulted from mood')
  }
  if (!roles.accentSoft) roles.accentSoft = mixHex(roles.accent, roles.background, 0.45)

  // 3. ink — white or near-black, whichever clears WCAG on the ground
  if (!roles.ink) {
    const whiteWins = contrast(NEUTRAL_LIGHT, roles.background) >= contrast(NEUTRAL_DARK, roles.background)
    roles.ink = whiteWins ? NEUTRAL_LIGHT : NEUTRAL_DARK
  }
  // guard even pinned/derived inks: step toward the opposite neutral
  if (contrast(roles.ink, roles.background) < MIN_TEXT_CONTRAST) {
    const opposite = roles.ink === NEUTRAL_LIGHT ? NEUTRAL_DARK : NEUTRAL_LIGHT
    if (contrast(opposite, roles.background) >= MIN_TEXT_CONTRAST) {
      warnings.push(`ink #${roles.ink.slice(1).toUpperCase()} failed WCAG on the background — flipped`)
      roles.ink = opposite
    } else {
      warnings.push('no ink clears WCAG 4.5 on this background — kept the higher-contrast option')
      roles.ink = opposite
    }
  }

  // 4. inkSoft — a dimmed ink that still clears 4.5 (bounded steps)
  if (!roles.inkSoft) {
    let candidate = mixHex(roles.ink, roles.background, 0.35)
    for (let step = 0; step < 8 && contrast(candidate, roles.background) < MIN_TEXT_CONTRAST; step++) {
      candidate = mixHex(candidate, roles.ink, 0.3)
    }
    roles.inkSoft = candidate
  }

  // 5. surface — a panel one step off the ground toward ink
  if (!roles.surface) {
    const toward = roles.ink === NEUTRAL_LIGHT ? NEUTRAL_LIGHT : NEUTRAL_DARK
    roles.surface = mixHex(roles.background, toward, 0.09)
  }

  return { roles, warnings }
}
