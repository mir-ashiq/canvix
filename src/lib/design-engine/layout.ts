// ─────────────────────────────────────────────────────────────
// Design engine · layout (Phase A).
//
// The block solver: semantic blocks → vertical bands → pixel rects.
// Bands are disjoint BY CONSTRUCTION (stacked, gap-separated, inside
// the margin box), which is what retires fix_overlaps for generated
// designs: the overlap the agent loop repairs after the fact cannot
// occur here. Deliberate artistic layering stays possible through
// the declared two-layer output of the composition builders
// (backdrop elements may sit under content; content never overlaps
// content).
// ─────────────────────────────────────────────────────────────

import { clamp, type BlockNode } from '@/lib/design-spec/types'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface PlacedBlock {
  block: BlockNode
  rect: Rect
}

/** Layout safety defaults (60px margins match the plan-route contract). */
export const LAYOUT_MARGIN = 60
export const LAYOUT_GAP = 32

/** Weights by content role for inside-band stacking (headline-heavy). */
const ROLE_WEIGHT: Record<string, number> = {
  headline: 3,
  subline: 2,
  tagline: 1.8,
  body: 2,
  cta: 1.6,
  label: 1,
}

/**
 * Stack blocks top-to-bottom into disjoint bands. Each block's band
 * height is its weight's share of the available height (minus gaps).
 * Deterministic; total (empty input → empty output).
 */
export function bandLayout(
  blocks: BlockNode[],
  canvas: { width: number; height: number },
  margin = LAYOUT_MARGIN,
  gap = LAYOUT_GAP,
): PlacedBlock[] {
  if (!blocks.length) return []
  const usable = {
    x: margin,
    y: margin,
    width: Math.max(0, canvas.width - margin * 2),
    height: Math.max(0, canvas.height - margin * 2),
  }
  const weights = blocks.map((b) => clamp(b.weight ?? 1, 0.2, 3))
  const totalWeight = weights.reduce((s, w) => s + w, 0)
  const contentHeight = Math.max(0, usable.height - gap * (blocks.length - 1))

  let y = usable.y
  return blocks.map((block, i) => {
    const height = (contentHeight * weights[i]) / totalWeight
    const rect: Rect = { x: usable.x, y, width: usable.width, height }
    y += height + gap
    return { block, rect }
  })
}

/** Split a rect into n cells (≤ columns per row) with gaps.
 * Used by feature-cards / stat-row / timeline rows. */
export function gridInRect(
  rect: Rect,
  count: number,
  opts: { columns?: number; gap?: number; minCellWidth?: number; minCellHeight?: number } = {},
): Rect[] {
  const n = clamp(Math.round(count), 1, 12)
  const gap = clamp(opts.gap ?? 24, 0, 120)
  const maxColumns = clamp(opts.columns ?? 3, 1, 6)
  const minW = opts.minCellWidth ?? 160
  const minH = opts.minCellHeight ?? 110

  let columns = Math.min(n, maxColumns)
  let rows = Math.ceil(n / columns)
  // shrink the column count until cells clear the minimums (or 1 column)
  while (
    columns > 1 &&
    (rect.width - gap * (columns - 1)) / columns < minW
  ) {
    columns -= 1
    rows = Math.ceil(n / columns)
  }
  const cellW = (rect.width - gap * (columns - 1)) / columns
  const cellH = (rect.height - gap * (rows - 1)) / rows
  // if cells still cannot clear the minimum height, the band is too
  // short — return what fits (the compile check will flag it honestly)
  const cells: Rect[] = []
  for (let i = 0; i < n; i++) {
    const col = i % columns
    const row = Math.floor(i / columns)
    cells.push({
      x: rect.x + col * (cellW + gap),
      y: rect.y + row * (cellH + gap),
      width: cellW,
      height: cellH,
    })
  }
  return cells
}

/**
 * Stack content slots vertically inside a band, heights proportional
 * to role weight. Disjoint by construction.
 */
export function stackInRect(rect: Rect, roles: string[], gap = 24): Rect[] {
  const n = roles.length
  if (!n) return []
  const weights = roles.map((r) => ROLE_WEIGHT[r] ?? 1)
  const total = weights.reduce((s, w) => s + w, 0)
  const contentHeight = Math.max(0, rect.height - gap * (n - 1))
  let y = rect.y
  return roles.map((role, i) => {
    const height = (contentHeight * weights[i]) / total
    const out: Rect = { x: rect.x, y, width: rect.width, height }
    y += height + gap
    return out
  })
}

// ── geometry predicates (the compile checks + tests consume these) ──

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width - 1 &&
    b.x < a.x + a.width - 1 &&
    a.y < b.y + b.height - 1 &&
    b.y < a.y + a.height - 1
  )
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width + 1 &&
    inner.y + inner.height <= outer.y + outer.height + 1
  )
}

export function isInCanvas(rect: Rect, canvas: { width: number; height: number }): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.width <= canvas.width + 1 &&
    rect.y + rect.height <= canvas.height + 1
  )
}
