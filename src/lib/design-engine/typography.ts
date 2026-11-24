// ─────────────────────────────────────────────────────────────
// Design engine · typography (Phase A).
//
// Font pairing from the live catalog's category/weight metadata —
// the data the 370-family catalog already carries and nothing in
// the AI stack consumes today — plus a modular type scale. Pure
// and deterministic: same spec in, same sizes out.
// ─────────────────────────────────────────────────────────────

import { FONTS } from '@/lib/editor-utils'
import {
  asString,
  clamp,
  type ContentRole,
  type PaletteMood,
  type TypographySpec,
} from '@/lib/design-spec/types'

/** Vetted pairings — families from the preloaded catalog core. The
 * catalog check at selection time keeps this honest if the list
 * evolves: unknown families fall back to the default pair. */
export interface FontPairing {
  id: string
  heading: string
  body: string
  moods: PaletteMood[]
}

export const PAIRINGS: FontPairing[] = [
  { id: 'poppins-inter', heading: 'Poppins', body: 'Inter', moods: ['neutral', 'vibrant'] },
  { id: 'montserrat-work', heading: 'Montserrat', body: 'Work Sans', moods: ['vibrant', 'cool'] },
  { id: 'space-grotesk-inter', heading: 'Space Grotesk', body: 'Inter', moods: ['cool', 'minimal'] },
  { id: 'oswald-lato', heading: 'Oswald', body: 'Lato', moods: ['vibrant', 'warm'] },
  { id: 'raleway-opensans', heading: 'Raleway', body: 'Open Sans', moods: ['warm', 'minimal'] },
]

const DEFAULT_PAIRING = PAIRINGS[0]

function inCatalog(family: string): boolean {
  return FONTS.some((f) => f.family === family)
}

export interface AssignedTypography {
  pairing: FontPairing
  families: { heading: string; body: string }
  /** px sizes per content role, derived from canvas width × scale */
  sizes: Record<ContentRole, number>
  scale: number
  /** non-fatal note for the compile report */
  warning?: string
}

/** Modular exponents per role (body = 0). */
const ROLE_EXPONENT: Record<ContentRole, number> = {
  headline: 3,
  subline: 1.35,
  tagline: 1.15,
  body: 0,
  cta: 0.55,
  label: -0.85,
}

/** Pick the pairing: explicit families win (validated), else the
 * first pairing whose moods include the brief mood, else default. */
export function selectPairing(spec: TypographySpec, mood: PaletteMood): { pairing: FontPairing; warning?: string } {
  const heading = asString(spec.heading)
  const body = asString(spec.body)
  if (heading && body && inCatalog(heading) && inCatalog(body)) {
    return { pairing: { id: 'pinned', heading, body, moods: [mood] } }
  }
  const byMood = PAIRINGS.find((p) => p.moods.includes(mood))
  const pairing = byMood ?? DEFAULT_PAIRING
  if (!byMood) return { pairing, warning: `no pairing for mood '${mood}' — defaulted to ${pairing.id}` }
  return { pairing }
}

/**
 * Assign per-role sizes from the modular scale. Base is proportional
 * to the canvas width (≈ 24px body at 1080) so formats scale together;
 * builders use these as starting points for shrink-to-fit, never as
 * hard requirements.
 */
export function assignTypeScale(
  spec: TypographySpec,
  mood: PaletteMood,
  width: number,
): AssignedTypography {
  const { pairing, warning } = selectPairing(spec, mood)
  const scale = clamp(spec.scale ?? 1.333, 1.05, 1.8)
  const base = clamp(Math.round(width * 0.022), 14, 44)
  const sizes = {} as Record<ContentRole, number>
  for (const role of Object.keys(ROLE_EXPONENT) as ContentRole[]) {
    sizes[role] = Math.max(10, Math.round(base * scale ** ROLE_EXPONENT[role]))
  }
  return {
    pairing,
    families: { heading: pairing.heading, body: pairing.body },
    sizes,
    scale,
    ...(warning ? { warning } : {}),
  }
}
