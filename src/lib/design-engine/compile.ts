// ─────────────────────────────────────────────────────────────
// Design engine · compile (Phase A).
//
// DesignSpec → real editor pages. Pure, deterministic (ids are
// compile-scoped counters — same spec in, byte-identical pages
// out), and honest: the compile result carries a CHECK REPORT with
// the same discipline the v0.29.4 agent loop ships — every user
// requirement is verified and every failure is named, never
// silently degraded.
//
// Checks:
//   exactTexts   user-required slots appear character-for-character
//                (NFC-normalized equality — NOT case-insensitive
//                substring; the hardening over the brief checker)
//   colors       every seed/pinned hex appears on the page
//   inCanvas     every element rect inside the canvas
//   overlap      content elements are mutually disjoint (backdrops
//                may sit under content — the declared channel)
//   textFits     every text element fits its box at the plan-route
//                width estimate; required copy is never truncated
//                to achieve this — an unfit required text FAILS
//   contrast     WCAG ≥ 4.5 for ink/inkSoft on the background, CTA
//                text on its chip, card text on the card surface
// ─────────────────────────────────────────────────────────────

import type { AnyElement, PageData } from '@/lib/types'
import type { DesignSpec } from '@/lib/design-spec/types'
import { expandPalette, onColor, type ExpandedPalette } from './palette'
import { assignTypeScale, type AssignedTypography } from './typography'
import { bandLayout, isInCanvas, rectsOverlap, type Rect } from './layout'
import { buildBlock, estimateTextWidth } from './compositions'
import { contrast } from '@/lib/theme'

const MIN_TEXT_CONTRAST = 4.5

export interface ExactTextCheck {
  text: string
  found: boolean
}
export interface ColorCheck {
  hex: string
  found: boolean
}
export interface ContrastCheck {
  pair: string
  ratio: number
  ok: boolean
}

export interface CompileChecks {
  exactTexts: ExactTextCheck[]
  colors: ColorCheck[]
  inCanvas: boolean
  noUnintendedOverlap: boolean
  textFits: boolean
  contrast: ContrastCheck[]
  passed: boolean
  failures: string[]
}

export interface CompileResult {
  pages: PageData[]
  checks: CompileChecks
  /** non-fatal notes (palette defaults, pending builders, density) */
  warnings: string[]
  palette: ExpandedPalette
  typography: AssignedTypography
}

/** NFKC-free exact comparison: NFC normalization both sides, then
 * strict equality. Case/whitespace differences are FAILURES here.
 * Exported for the test matrix — this is the hardened contract the
 * agent brief checker's case-insensitive substring does not give. */
export function exactEquals(a: string, b: string): boolean {
  return a.normalize('NFC') === b.normalize('NFC')
}

function eqHex(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function elementRect(el: AnyElement): Rect {
  return { x: el.x, y: el.y, width: el.width, height: el.height }
}

/**
 * Compile a spec into pages. Always returns a result — a failed
 * check set is part of the result, not an exception (the caller
 * decides whether to ship, fix, or disclose).
 */
export function compileSpec(spec: DesignSpec): CompileResult {
  const warnings: string[] = []
  const palette = expandPalette(spec.palette)
  warnings.push(...palette.warnings)
  const typography = assignTypeScale(spec.typography, spec.palette.mood, spec.format.width)
  if (typography.warning) warnings.push(typography.warning)

  const backdrops: AnyElement[] = []
  const content: AnyElement[] = []
  let id = 0
  const nextId = () => `spec_${++id}`

  for (const placed of bandLayout(spec.blocks, spec.format)) {
    const composed = buildBlock(placed.block, {
      rect: placed.rect,
      palette,
      type: typography,
      canvas: spec.format,
    })
    warnings.push(...composed.warnings)
    backdrops.push(...composed.backdrops)
    content.push(...composed.content)
  }

  // z-order: backdrops first, content above — array order IS z-order
  const elements = [...backdrops, ...content].map((el) => ({ ...el, id: nextId() }))
  const page: PageData = {
    id: 'spec_page_1',
    background: { type: 'solid', color: palette.roles.background },
    elements,
  }

  // ── the check report ──
  const failures: string[] = []
  const textEls = elements.filter((el): el is AnyElement & { text: string; fontSize: number } => el.type === 'text')

  const exactTexts = spec.blocks
    .flatMap((b) => b.content)
    .filter((s) => s.source === 'user-required')
    .map((slot) => {
      const found = textEls.some((el) => exactEquals(el.text, slot.text))
      if (!found) failures.push(`required text missing or altered: "${slot.text}"`)
      return { text: slot.text, found }
    })

  const requiredHexes = [...spec.palette.seeds, ...Object.values(spec.palette.pinned ?? {})]
  const colors = [...new Set(requiredHexes)].map((hex) => {
    const found =
      eqHex(palette.roles.background, hex) ||
      elements.some((el) => 'fill' in el && typeof el.fill === 'string' && eqHex(el.fill, hex))
    if (!found) failures.push(`required color #${hex.slice(1).toUpperCase()} not used anywhere on the page`)
    return { hex, found }
  })

  const inCanvas = elements.every((el) => isInCanvas(elementRect(el), spec.format))
  if (!inCanvas) failures.push('an element sits outside the canvas')

  const noUnintendedOverlap = content
    .map(elementRect)
    .every((a, i, list) => list.every((b, j) => i === j || !rectsOverlap(a, b)))
  if (!noUnintendedOverlap) failures.push('content elements overlap (unintended)')

  const textFits = textEls.every((el) => estimateTextWidth(el.text, el.fontSize) <= el.width + 1)
  if (!textFits) {
    const offender = textEls.find((el) => estimateTextWidth(el.text, el.fontSize) > el.width + 1)
    failures.push(`text does not fit its box: "${offender?.text.slice(0, 40)}" (required copy is never truncated — fix by reflow)`)
  }

  const contrastPairs: { pair: string; ratio: number }[] = [
    { pair: `ink on background`, ratio: contrast(palette.roles.ink, palette.roles.background) },
    { pair: `inkSoft on background`, ratio: contrast(palette.roles.inkSoft, palette.roles.background) },
  ]
  if (elements.some((el) => el.type === 'rect' && el.fill === palette.roles.accent && 'cornerRadius' in el)) {
    contrastPairs.push({ pair: 'cta text on accent chip', ratio: contrast(onColor(palette.roles.accent), palette.roles.accent) })
  }
  if (elements.some((el) => el.type === 'rect' && el.fill === palette.roles.surface)) {
    contrastPairs.push({ pair: 'card text on surface', ratio: contrast(onColor(palette.roles.surface), palette.roles.surface) })
  }
  const contrastChecks = contrastPairs.map((p) => ({
    ...p,
    ok: p.ratio >= MIN_TEXT_CONTRAST,
  }))
  for (const c of contrastChecks) {
    if (!c.ok) failures.push(`contrast ${c.pair} = ${c.ratio.toFixed(2)} (< ${MIN_TEXT_CONTRAST})`)
  }

  return {
    pages: [page],
    checks: {
      exactTexts,
      colors,
      inCanvas,
      noUnintendedOverlap,
      textFits,
      contrast: contrastChecks,
      passed: failures.length === 0,
      failures,
    },
    warnings,
    palette,
    typography,
  }
}
