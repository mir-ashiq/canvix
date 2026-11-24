// ─────────────────────────────────────────────────────────────
// Canvix DesignSpec v2 (Phase A — one-prompt design generation).
//
// The single intermediate representation every generation path will
// emit and every consumer will validate. The model (planner) chooses
// SEMANTICS only — blocks, copy slots, palette seeds, typography
// hints; the deterministic design engine (src/lib/design-engine/)
// owns geometry, color math and type scale. Nothing in this module
// does model I/O: it is pure data plus coercion.
//
// The exact-text contract (hardened over the agent brief checker):
// a ContentSlot with source 'user-required' is IMMUTABLE. The
// compiler preserves it character-for-character (NFC-normalized
// equality), and fitting adjusts font size, box or reflow — never
// the text. Length budgets apply to 'model' slots only.
// ─────────────────────────────────────────────────────────────

import { THEME_ROLES, type ThemeRole } from '@/lib/theme'

/** One palette vocabulary across theme.ts (post-hoc recolor) and the
 * design engine (construction time). Import, don't duplicate. */
export type PaletteRole = ThemeRole
export const PALETTE_ROLES: readonly PaletteRole[] = THEME_ROLES

export type PaletteMood = 'warm' | 'cool' | 'neutral' | 'vibrant' | 'minimal'

/** Copy roles the engine knows how to size and place. */
export type ContentRole = 'headline' | 'subline' | 'tagline' | 'body' | 'cta' | 'label'

/** Where the copy came from — decides immutability. */
export type ContentSource = 'user-required' | 'model'

export interface ContentSlot {
  role: ContentRole
  /** 'user-required' text is preserved exactly — never truncated,
   * case-folded or paraphrased by the engine. */
  source: ContentSource
  text: string
  /** Model slots only: soft length budget (a warning, not a cut). */
  maxWords?: number
}

export type BlockKind =
  | 'hero'
  | 'feature-cards'
  | 'mockup'
  | 'timeline'
  | 'stat-row'
  | 'gallery'
  | 'footer'

/**
 * A semantic layout block. `weight` is relative vertical importance
 * (band height share). `overlap: 'over-backdrop'` is the intentional-
 * overlap channel: the block's decorative layers may sit under its
 * content — never hiding it — and text contrast is verified against
 * the composited backdrop, mirroring the shipped audit's semantics.
 */
export interface BlockNode {
  kind: BlockKind
  weight?: number
  content: ContentSlot[]
  overlap?: 'none' | 'over-backdrop'
  /** feature-cards / stat-row / timeline: how many units. */
  count?: number
}

export interface PaletteSpec {
  /** 1-3 hex seeds (from the brief or the planner). Preserved
   * verbatim in the compiled palette — required colors must appear. */
  seeds: string[]
  mood: PaletteMood
  /** Planner-pinned role colors (validated hex); engine fills the rest. */
  pinned?: Partial<Record<PaletteRole, string>>
}

export interface TypographySpec {
  /** Font families; validated against the catalog, defaulted by mood. */
  heading?: string
  body?: string
  /** Modular scale; one of 1.2 / 1.25 / 1.333 / 1.618. */
  scale?: number
}

export interface DesignSpec {
  version: 'v2'
  name: string
  format: { width: number; height: number; preset?: string }
  palette: PaletteSpec
  typography: TypographySpec
  /** Ordered top-to-bottom semantic blocks. */
  blocks: BlockNode[]
}

/** parseSpecResponse()'s result — an explicit, honest failure object
 * (never a silently-emptied spec). */
export type ParseSpecResult =
  | { ok: true; spec: DesignSpec }
  | { ok: false; error: string }

// ── coercion helpers (same semantics as design-plan.ts) ──────

export function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}
export function asNumber(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : fallback
}
export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
export function asHex(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim() : fallback
}
export function asEnum<T extends readonly string[]>(v: unknown, options: T, fallback: T[number]): T[number] {
  return typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T[number]) : fallback
}
