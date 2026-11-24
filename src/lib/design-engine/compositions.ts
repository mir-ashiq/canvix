// ─────────────────────────────────────────────────────────────
// Design engine · compositions (Phase A).
//
// Deterministic block builders. The inversion the architecture
// analysis proposes: the brief validator's structural definitions,
// read as constructors. A feature-card is "N semi-transparent card
// rects with one to three texts each" — buildFeatureCards EMITS
// exactly that, correct by construction instead of checked after
// the fact.
//
// Every builder returns two layers: backdrops (may sit under
// content — the intentional-overlap channel) and content (mutually
// disjoint, individually in-canvas). Text is placed with the
// plan-route width estimate (~0.62 × fontSize per char) and
// shrink-to-fit; user-required copy is NEVER truncated — when it
// cannot fit even at the floor size, the compile check fails
// honestly instead.
// ─────────────────────────────────────────────────────────────

import {
  createShapeElement,
  createTextElement,
  type AnyElement,
} from '@/lib/types'
import type { BlockNode, ContentRole, ContentSlot } from '@/lib/design-spec/types'
import type { ExpandedPalette } from './palette'
import { onColor } from './palette'
import type { AssignedTypography } from './typography'
import { gridInRect, stackInRect, type Rect } from './layout'

export interface BuildContext {
  rect: Rect
  palette: ExpandedPalette
  type: AssignedTypography
  canvas: { width: number; height: number }
}

export interface ComposedElements {
  /** decorative layers — under content, may overlap it intentionally */
  backdrops: AnyElement[]
  /** the real content — mutually disjoint by construction */
  content: AnyElement[]
  /** local, non-fatal notes for the compile report */
  warnings: string[]
}

/** Plan-route text estimate convention (conservative). */
export function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * 0.62 * fontSize
}

/** Shrink-to-fit: largest size ≤ start that fits maxW, floored at
 * minSize. Never touches the text itself. */
export function fitFontSize(text: string, maxW: number, start: number, minSize: number): number {
  let size = Math.max(minSize, Math.round(start))
  while (size > minSize && estimateTextWidth(text, size) > maxW) size -= 2
  return size
}

const ROLE_STACK_ORDER: ContentRole[] = ['headline', 'subline', 'cta', 'tagline', 'body', 'label']

function stackOrder(slot: ContentSlot): number {
  const i = ROLE_STACK_ORDER.indexOf(slot.role)
  return i === -1 ? ROLE_STACK_ORDER.length : i
}

/** Hero: headline + subline + CTA chip, stacked in the band.
 * Emits an accent underline (backdrop) between headline and subline. */
export function buildHero(block: BlockNode, ctx: BuildContext): ComposedElements {
  const { palette, type, canvas } = ctx
  const slots = [...block.content].sort((a, b) => stackOrder(a) - stackOrder(b))
  const warnings: string[] = []
  const backdrops: AnyElement[] = []
  const content: AnyElement[] = []

  const subRects = stackInRect(ctx.rect, slots.map((s) => s.role))
  const headlineBoost = Math.round(canvas.height * 0.075)

  slots.forEach((slot, i) => {
    const rect = subRects[i]
    if (slot.role === 'cta') {
      // CTA chip: accent pill + centered text with guarded contrast
      const start = Math.max(type.sizes.cta, 24)
      const size = fitFontSize(slot.text, rect.width * 0.82, start, 20)
      const textW = Math.min(rect.width, estimateTextWidth(slot.text, size) + size * 0.8)
      const chipH = Math.max(44, Math.round(size * 2.1))
      const chipW = Math.min(rect.width, textW + chipH * 0.7)
      const chipX = rect.x + (rect.width - chipW) / 2
      const chipY = rect.y + (rect.height - chipH) / 2
      const chipFill = palette.roles.accent
      const chipText = onColor(chipFill)
      // chip = container (backdrop layer, sits UNDER its text — the
      // intentional-overlap channel); the text stays content
      backdrops.push(
        createShapeElement('rect', {
          x: Math.round(chipX),
          y: Math.round(chipY),
          width: Math.round(chipW),
          height: Math.round(chipH),
          fill: chipFill,
          cornerRadius: Math.round(chipH / 2),
        }),
      )
      content.push(
        createTextElement({
          text: slot.text,
          x: Math.round(chipX),
          y: Math.round(chipY + (chipH - size * 1.3) / 2),
          width: Math.round(chipW),
          height: Math.round(size * 1.3),
          fontSize: size,
          fontFamily: type.families.body,
          bold: true,
          fill: chipText,
          align: 'center',
        }),
      )
      return
    }

    const isHeadline = slot.role === 'headline' || slot.role === 'tagline'
    const startSize = isHeadline ? Math.max(type.sizes.headline, headlineBoost) : type.sizes[slot.role] ?? type.sizes.body
    const size = fitFontSize(slot.text, rect.width, startSize, isHeadline ? 28 : 18)
    const fill = isHeadline ? palette.roles.ink : palette.roles.inkSoft
    const h = Math.round(size * 1.3)
    content.push(
      createTextElement({
        text: slot.text,
        x: Math.round(rect.x),
        y: Math.round(rect.y + (rect.height - h) / 2),
        width: Math.round(rect.width),
        height: h,
        fontSize: size,
        fontFamily: isHeadline ? type.families.heading : type.families.body,
        bold: isHeadline,
        fill,
        align: 'center',
        ...(isHeadline ? { lineHeight: 1.15 } : {}),
      }),
    )

    if (isHeadline && i === 0 && subRects.length > 1) {
      // accent underline in the band gap — decorative backdrop
      const gapY = rect.y + rect.height
      const nextY = subRects[i + 1].y
      if (nextY - gapY >= 14) {
        backdrops.push(
          createShapeElement('rect', {
            x: Math.round(rect.x + rect.width * 0.28),
            y: Math.round(gapY + 8),
            width: Math.round(rect.width * 0.44),
            height: 6,
            fill: palette.roles.accentSoft,
            cornerRadius: 3,
          }),
        )
      }
    }
  })

  if (slots.length > ROLE_STACK_ORDER.length) warnings.push('hero band is dense — consider fewer slots')
  return { backdrops, content, warnings }
}

/** Feature cards: N semi-transparent card rects, one to three texts
 * each — emitted exactly in the brief validator's shape. */
export function buildFeatureCards(block: BlockNode, ctx: BuildContext): ComposedElements {
  const { palette, type } = ctx
  const warnings: string[] = []
  const backdrops: AnyElement[] = []
  const content: AnyElement[] = []

  const count = Math.max(1, Math.min(6, block.count ?? Math.max(1, block.content.length)))
  const cells = gridInRect(ctx.rect, count, { columns: 3, gap: 28, minCellWidth: 160, minCellHeight: 110 })
  if (cells.some((c) => c.width < 160 || c.height < 110)) {
    warnings.push(`feature-cards band too small for ${count} cards — minimum 160x110 not met`)
  }

  const cardFill = palette.roles.surface
  const cardText = onColor(cardFill)
  cells.forEach((cell, i) => {
    const slot = block.content[i]
    const label = slot?.text ?? `Feature ${i + 1}`
    backdrops.push(
      createShapeElement('rect', {
        x: Math.round(cell.x),
        y: Math.round(cell.y),
        width: Math.round(cell.width),
        height: Math.round(cell.height),
        fill: cardFill,
        cornerRadius: 20,
        opacity: 0.92,
      }),
    )
    const pad = Math.round(cell.width * 0.1)
    const boxW = cell.width - pad * 2
    const size = fitFontSize(label, boxW, type.sizes.body, 16)
    const h = Math.round(size * 1.3)
    content.push(
      createTextElement({
        text: label,
        x: Math.round(cell.x + pad),
        y: Math.round(cell.y + (cell.height - h) / 2),
        width: Math.round(boxW),
        height: h,
        fontSize: size,
        fontFamily: type.families.body,
        bold: true,
        fill: cardText,
        align: 'center',
      }),
    )
  })

  return { backdrops, content, warnings }
}

/** Dispatch: hero + feature-cards have dedicated builders today;
 * other kinds compile through the generic hero stack with a warning
 * (Phase C gives each kind its own builder). */
export function buildBlock(block: BlockNode, ctx: BuildContext): ComposedElements {
  if (block.kind === 'feature-cards') return buildFeatureCards(block, ctx)
  if (block.kind !== 'hero') {
    const composed = buildHero(block, ctx)
    return { ...composed, warnings: [...composed.warnings, `kind '${block.kind}' compiled with the generic stack — dedicated builder pending Phase C`] }
  }
  return buildHero(block, ctx)
}
