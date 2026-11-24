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
// disjoint, individually in-canvas). Text wraps at the box width
// under the plan-route estimate (~0.62 × fontSize per char) and
// shrinks until the wrapped line count fits the band; user-required
// copy is NEVER truncated — the element carries the full string, and
// when it cannot fit even wrapped at the floor size, the compile
// check fails honestly instead.
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

/** Greedy word-wrap under the plan-route estimate. Splits on spaces
 * only — the text itself is never altered (the exact-text contract:
 * the element keeps the FULL string; the renderer wraps it). A word
 * wider than the box stays on its own line and fails honestly. */
export function wrapLines(text: string, width: number, fontSize: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w
    if (!line || estimateTextWidth(candidate, fontSize) <= width) line = candidate
    else {
      lines.push(line)
      line = w
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

/** Shrink-to-fit: largest size ≤ start that fits maxW, floored at
 * minSize. Never touches the text itself. */
export function fitFontSize(text: string, maxW: number, start: number, minSize: number): number {
  let size = Math.max(minSize, Math.round(start))
  while (size > minSize && estimateTextWidth(text, size) > maxW) size -= 2
  return size
}

/** Wrap-to-fit: the size whose wrapped line count fits maxH, between
 * start and floor. Returns the size and its line count. */
function wrapFontSize(
  text: string,
  maxW: number,
  maxH: number,
  start: number,
  floor: number,
  lineHeight: number,
): { size: number; lines: string[] } {
  let size = Math.max(floor, Math.round(start))
  let lines = wrapLines(text, maxW, size)
  while (size > floor && lines.length * Math.round(size * lineHeight) > maxH) {
    size -= 2
    lines = wrapLines(text, maxW, size)
  }
  return { size, lines }
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
    const lineHeight = isHeadline ? 1.15 : 1.3
    const startSize = isHeadline ? Math.max(type.sizes.headline, headlineBoost) : type.sizes[slot.role] ?? type.sizes.body
    // wrap-to-fit: shrink while the wrapped line count exceeds the
    // band height; the element keeps the FULL text (exact-text
    // contract) and its box grows to the wrapped height, capped at
    // the band — an impossible fit still fails the textFits check
    const { size, lines } = wrapFontSize(
      slot.text,
      rect.width,
      rect.height,
      startSize,
      isHeadline ? 28 : 18,
      lineHeight,
    )
    const fill = isHeadline ? palette.roles.ink : palette.roles.inkSoft
    const h = Math.min(rect.height, Math.round(lines.length * size * lineHeight))
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
    const boxH = cell.height - pad * 2
    const { size, lines } = wrapFontSize(label, boxW, boxH, type.sizes.body, 16, 1.3)
    const h = Math.min(boxH, Math.round(lines.length * size * 1.3))
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

/** Stat row: N big-number/label pairs in a grid — the numbers band
 * of a professional poster (impact metrics, dates, prices). Slots
 * arrive as alternating value/caption pairs: role 'headline' is the
 * value, role 'label' its caption; a trailing bare value is
 * tolerated. Each value carries a small accent underline — the
 * emphasis device the seed-guarantee machinery prefers. */
export function buildStatRow(block: BlockNode, ctx: BuildContext): ComposedElements {
  const { palette, type } = ctx
  const warnings: string[] = []
  const backdrops: AnyElement[] = []
  const content: AnyElement[] = []

  const slots = block.content
  const count = Math.max(1, Math.min(6, block.count ?? Math.ceil(slots.length / 2)))
  const cells = gridInRect(ctx.rect, count, { columns: 3, gap: 24, minCellWidth: 150, minCellHeight: 96 })
  if (cells.some((c) => c.width < 150 || c.height < 96)) {
    warnings.push(`stat-row band too small for ${count} stats — minimum 150x96 not met`)
  }

  // pass 1: fit each value; pass 2 places them on a shared baseline
  const fitted: { cell: Rect; valueText: string; captionText?: string; size: number; lines: string[] }[] = []

  cells.forEach((cell, i) => {
    const value = slots[2 * i]
    const caption = slots[2 * i + 1]
    const valueText = value?.text ?? `${(i + 1) * 25}+`
    const captionText = caption?.text

    // value: big, bold, ink — wrap-aware, shrunk to fit the cell
    const { size, lines } = wrapFontSize(valueText, cell.width, cell.height * 0.6, Math.max(type.sizes.headline, 48), 24, 1.15)
    fitted.push({ cell, valueText, captionText, size, lines })
  })

  // uniform value block across the row (found by the VLM critique of
  // the acceptance run: a wrapping value shifted its underline below
  // the one-line values' — every cell now reserves the max line
  // count, so underlines and captions share one baseline)
  const uniformLineH = Math.max(...fitted.map((f) => Math.round(f.size * 1.15)))
  const uniformValueH = Math.max(...fitted.map((f) => f.lines.length)) * uniformLineH

  for (const { cell, valueText, captionText, size, lines } of fitted) {
    const valueY = cell.y + Math.round(cell.height * 0.12)
    const valueH = Math.min(Math.round(cell.height * 0.6), Math.round(lines.length * size * 1.15))
    content.push(
      createTextElement({
        text: valueText,
        x: Math.round(cell.x),
        y: valueY,
        width: Math.round(cell.width),
        height: valueH,
        fontSize: size,
        fontFamily: type.families.heading,
        bold: true,
        fill: palette.roles.ink,
        align: 'center',
        lineHeight: 1.15,
      }),
    )

    // accent underline under the value — at the UNIFORM baseline
    const underlineY = valueY + uniformValueH + 6
    if (underlineY + 4 <= cell.y + cell.height) {
      backdrops.push(
        createShapeElement('rect', {
          x: Math.round(cell.x + cell.width * 0.36),
          y: underlineY,
          width: Math.round(cell.width * 0.28),
          height: 4,
          fill: palette.roles.accentSoft,
          cornerRadius: 2,
        }),
      )
    }

    if (captionText) {
      const capStart = type.sizes.label ?? type.sizes.body
      const cap = wrapFontSize(captionText, cell.width, Math.round(cell.height * 0.28), capStart, 14, 1.3)
      const capH = Math.min(Math.round(cell.height * 0.28), Math.round(cap.lines.length * cap.size * 1.3))
      content.push(
        createTextElement({
          text: captionText,
          x: Math.round(cell.x),
          y: Math.round(cell.y + cell.height - capH - Math.round(cell.height * 0.06)),
          width: Math.round(cell.width),
          height: capH,
          fontSize: cap.size,
          fontFamily: type.families.body,
          fill: palette.roles.inkSoft,
          align: 'center',
        }),
      )
    }
  }

  return { backdrops, content, warnings }
}

/** Mockup: a centered rounded visual frame — the deterministic
 * stand-in a real image/asset fills at the app layer (image sourcing
 * is an app-layer tool, not engine math). A thin accent frame sits
 * behind a surface card, and an optional caption slot renders under
 * the frame. The frame keeps a 4:3 aspect within the band. */
export function buildMockup(block: BlockNode, ctx: BuildContext): ComposedElements {
  const { palette, type } = ctx
  const warnings: string[] = []
  const backdrops: AnyElement[] = []
  const content: AnyElement[] = []

  const band = ctx.rect
  const captionSlot = block.content.find((s) => s.role === 'label' || s.role === 'body')
  const captionH = captionSlot ? Math.round(band.height * 0.18) : 0
  const frameMaxH = band.height - captionH - Math.round(band.height * 0.08)
  const frameW = Math.min(band.width * 0.72, Math.round(frameMaxH * (4 / 3)))
  const frameH = Math.round(frameW * 0.75)
  const frameX = Math.round(band.x + (band.width - frameW) / 2)
  const frameY = Math.round(band.y + (band.height - captionH - frameH) / 2)
  if (frameW < 180 || frameH < 120) warnings.push('mockup band too small for a 4:3 frame — consider more weight')

  // thin accent frame behind, surface card in front (two-rect border)
  backdrops.push(
    createShapeElement('rect', {
      x: frameX - 6,
      y: frameY - 6,
      width: frameW + 12,
      height: frameH + 12,
      fill: palette.roles.accentSoft,
      cornerRadius: 26,
      opacity: 0.6,
    }),
  )
  backdrops.push(
    createShapeElement('rect', {
      x: frameX,
      y: frameY,
      width: frameW,
      height: frameH,
      fill: palette.roles.surface,
      cornerRadius: 20,
      opacity: 0.95,
    }),
  )
  // the placeholder mark: a slim centered glyph bar (deterministic)
  backdrops.push(
    createShapeElement('rect', {
      x: Math.round(frameX + frameW * 0.44),
      y: Math.round(frameY + frameH / 2 - 14),
      width: Math.round(frameW * 0.12),
      height: 28,
      fill: palette.roles.accentSoft,
      cornerRadius: 4,
    }),
  )

  if (captionSlot && captionH > 0) {
    const cap = wrapFontSize(captionSlot.text, frameW, captionH, type.sizes.label ?? type.sizes.body, 14, 1.3)
    const h = Math.min(captionH, Math.round(cap.lines.length * cap.size * 1.3))
    content.push(
      createTextElement({
        text: captionSlot.text,
        x: frameX,
        y: Math.round(frameY + frameH + 12),
        width: frameW,
        height: h,
        fontSize: cap.size,
        fontFamily: type.families.body,
        fill: palette.roles.inkSoft,
        align: 'center',
      }),
    )
  }

  return { backdrops, content, warnings }
}

/** Dispatch: hero, feature-cards, stat-row and mockup have dedicated
 * builders; other kinds compile through the generic hero stack with a
 * warning (Phase C gives each kind its own builder). */
export function buildBlock(block: BlockNode, ctx: BuildContext): ComposedElements {
  if (block.kind === 'feature-cards') return buildFeatureCards(block, ctx)
  if (block.kind === 'stat-row') return buildStatRow(block, ctx)
  if (block.kind === 'mockup') return buildMockup(block, ctx)
  if (block.kind !== 'hero') {
    const composed = buildHero(block, ctx)
    return { ...composed, warnings: [...composed.warnings, `kind '${block.kind}' compiled with the generic stack — dedicated builder pending Phase C`] }
  }
  return buildHero(block, ctx)
}
