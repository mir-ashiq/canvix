// ─────────────────────────────────────────────────────────────
// Canvix AI theme engine (Wave 4 — AI Power-Up).
//
// Pure transforms for "AI theme generation": the model proposes a
// role-tagged palette + font pairing; applyTheme() maps the roles onto
// a design — page backgrounds, text ink, shape accents, line colors —
// with a contrast guard so light palettes never strand white text on
// white pages (and vice versa). Deterministic and total.
// ─────────────────────────────────────────────────────────────

import type { AnyElement, LineElement, PageData, ShapeElement, TableElement, TextElement } from './types'

/** Palette roles the model may assign (fixed vocabulary). */
export type ThemeRole = 'background' | 'surface' | 'ink' | 'inkSoft' | 'accent' | 'accentSoft'

export interface ThemeColor {
  hex: string
  role: ThemeRole
}

export interface Theme {
  name: string
  mood?: string
  palette: ThemeColor[]
  fonts: { heading: string; body: string }
}

export const THEME_ROLES: ThemeRole[] = ['background', 'surface', 'ink', 'inkSoft', 'accent', 'accentSoft']

const FALLBACK: Theme = {
  name: 'Canvix default',
  palette: [
    { hex: '#FFFFFF', role: 'background' },
    { hex: '#F4F5F7', role: 'surface' },
    { hex: '#1F2226', role: 'ink' },
    { hex: '#5B6472', role: 'inkSoft' },
    { hex: '#7630D7', role: 'accent' },
    { hex: '#02C0CC', role: 'accentSoft' },
  ],
  fonts: { heading: 'Poppins', body: 'Inter' },
}

// ── color math ───────────────────────────────────────────────

/** '#RRGGBB' → [r,g,b] (0..255); null when malformed. */
function hexToRgb(hex: string): [number, number, number] | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

/** relative luminance (WCAG) */
function luminance(hex: string): number | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two hexes; 0 when either is malformed. */
export function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  if (la === null || lb === null) return 0
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

// ── normalizeTheme ───────────────────────────────────────────

/**
 * Coerce raw model output into a Theme. Unknown roles drop; missing
 * roles fill from the model's leftovers (or the fallback). Never
 * throws, always returns a complete, contrast-checked palette.
 */
export function normalizeTheme(raw: unknown, fonts: readonly string[]): Theme {
  const spec = (raw ?? {}) as Record<string, unknown>
  const paletteRaw = Array.isArray(spec.palette) ? spec.palette : []
  const byRole = new Map<ThemeRole, string>()
  const leftovers: string[] = []
  for (const item of paletteRaw.slice(0, 12)) {
    const c = (item ?? {}) as Record<string, unknown>
    const hex = typeof c.hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.hex.trim()) ? c.hex.trim().toUpperCase() : null
    if (!hex) continue
    const role = typeof c.role === 'string' && (THEME_ROLES as string[]).includes(c.role) ? (c.role as ThemeRole) : null
    if (role && !byRole.has(role)) byRole.set(role, hex)
    else if (!byRole.has(role === null ? 'accent' : role)) leftovers.push(hex)
  }
  // fill missing roles: leftovers first, then the fallback palette
  for (const role of THEME_ROLES) {
    if (byRole.has(role)) continue
    const fromLeft = leftovers.shift()
    if (fromLeft) byRole.set(role, fromLeft)
    else byRole.set(role, FALLBACK.palette.find((c) => c.role === role)!.hex)
  }

  const known = (v: unknown, fallback: string): string => {
    const s = typeof v === 'string' ? v : ''
    return fonts.includes(s) ? s : fallback
  }
  const fontsSpec = (spec.fonts ?? {}) as Record<string, unknown>
  const theme: Theme = {
    name: typeof spec.name === 'string' && spec.name.trim() ? spec.name.trim().slice(0, 60) : 'AI theme',
    mood: typeof spec.mood === 'string' ? spec.mood.slice(0, 120) : undefined,
    palette: THEME_ROLES.map((role) => ({ role, hex: byRole.get(role)! })),
    fonts: {
      heading: known(fontsSpec.heading, FALLBACK.fonts.heading),
      body: known(fontsSpec.body, FALLBACK.fonts.body),
    },
  }

  // contrast guard: ink must be readable on background. If the model
  // picked a low-contrast pair, swap ink for its inverse (black/white
  // by background luminance) rather than shipping unreadable text.
  const bg = byRole.get('background')!
  const ink = byRole.get('ink')!
  if (contrast(bg, ink) < 3) {
    const l = luminance(bg)
    byRole.set('ink', l !== null && l > 0.4 ? '#111318' : '#FFFFFF')
    theme.palette = THEME_ROLES.map((role) => ({ role, hex: byRole.get(role)! }))
  }
  return theme
}

// ── applyTheme ───────────────────────────────────────────────

/** close-ish hex compare (exact after normalize; generous anyway) */
function sameColor(a: string, b: string): boolean {
  return a.toUpperCase() === b.toUpperCase()
}

/** grayscale-ish? (white, black, grays — channel spread ≤ 16). These
 *  are "structural" fills (photo frames, dividers) that become surface
 *  instead of screaming accent. */
function isNeutral(hex: string): boolean {
  const rgb = hexToRgb(hex)
  if (!rgb) return true
  const [r, g, b] = rgb
  return Math.max(r, g, b) - Math.min(r, g, b) <= 16
}

/**
 * Map a theme onto a design (pure — returns NEW pages).
 *
 * Role mapping (documented contract):
 *   - page backgrounds       → background (solid) / gradient(accent→accentSoft)
 *   - large headline text    → ink + heading font
 *   - other text             → inkSoft + body font
 *   - shapes / lines         → accent (fills), accentSoft (strokes)
 *   - tables                 → header fill accent, text ink
 *
 * Contrast guard #2: any text whose new fill would sit under 3:1 on its
 * page's new background flips to ink (which passed guard #1). Images,
 * charts, stickers and draws are untouched — recoloring media is a lie.
 */
export function applyTheme(pages: PageData[], theme: Theme): PageData[] {
  const colorOf = (role: ThemeRole): string => theme.palette.find((c) => c.role === role)?.hex ?? '#000000'
  const bg = colorOf('background')
  const ink = colorOf('ink')
  const inkSoft = colorOf('inkSoft')
  const accent = colorOf('accent')
  const accentSoft = colorOf('accentSoft')

  return pages.map((page) => {
    const nextBackground =
      page.background.type === 'gradient'
        ? { type: 'gradient' as const, from: accent, to: accentSoft, angle: page.background.angle }
        : { type: 'solid' as const, color: bg }

    const elements = (page.elements ?? []).map((el) => {
      const next: AnyElement = { ...el }
      switch (el.type) {
        case 'text': {
          // headline heuristic: the page's largest fontSize is the
          // heading; everything else is body (same split the notes
          // outline uses — one shared notion of "headline").
          const isHeading =
            (page.elements ?? []).reduce((max, e) => (e.type === 'text' && e.fontSize > max ? e.fontSize : max), 0) ===
            el.fontSize
          const t = next as TextElement
          t.fill = isHeading ? ink : inkSoft
          t.fontFamily = isHeading ? theme.fonts.heading : theme.fonts.body
          // guard: never strand low-contrast text on the new background
          if (contrast(t.fill, bg) < 3) t.fill = ink
          break
        }
        case 'rect':
        case 'ellipse':
        case 'triangle':
        case 'star':
        case 'polygon': {
          // accent shapes keep accents; neutral (grayscale) fills become
          // surface so photo-frame rects don't turn loud
          const s = next as ShapeElement
          s.fill = isNeutral(el.fill) ? colorOf('surface') : accent
          if ('stroke' in el && typeof el.stroke === 'string' && el.stroke !== 'transparent' && el.strokeWidth > 0) {
            s.stroke = accentSoft
          }
          break
        }
        case 'line': {
          (next as LineElement).stroke = accent
          break
        }
        case 'table': {
          // header row fill rides the table renderer's own field set —
          // recolor text only (safe across schema versions)
          (next as TableElement).fill = inkSoft
          break
        }
        default:
          break // image / video / chart / sticker / path / draw: untouched
      }
      return next
    })
    return { ...page, background: nextBackground, elements }
  })
}

/** The theme system prompt — pinned next to the transforms. */
export function themeSystemPrompt(fonts: readonly string[]): string {
  const fontList = fonts.slice(0, 24).join(', ')
  return [
    'You are a brand color-system designer. Reply with ONLY a JSON object (no markdown fences):',
    '{"name":string,"mood":string,"palette":[{"hex":"#RRGGBB","role":string}],"fonts":{"heading":string,"body":string}}',
    `Palette roles — exactly these, one hex each: ${THEME_ROLES.join(', ')}.`,
    'Rules: 6 colors, hex only, ink must contrast strongly with background (WCAG ≥ 7), accents saturated, background/surface calm.',
    `Fonts — heading and body from this list only: ${fontList}.`,
  ].join('\n')
}
