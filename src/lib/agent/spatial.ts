/**
 * v0.32.7 · TRUE 2D SPATIAL INTELLIGENCE — the canvas map, grown up.
 *
 * v0.32.6 mapped the canvas as vertical bands only. Real designs are
 * 2D: elements have x-extent, rotation, z-order and INTENT (a card
 * behind its text is layering, not a collision). This module turns
 * the agent's design context into a real spatial model — pure,
 * deterministic, no model arithmetic:
 *
 *   · elementBox()    AABB incl. rotation (rect rotated about its
 *                     center → axis-aligned bounds)
 *   · intentionalOverlaps()  containers, backgrounds, backing
 *                     cards — layering that is CORRECT, not a defect
 *   · freeVerticalBands()    what the plan solver eats: y-ranges
 *                     blocked by section-scale elements (≥40% page
 *                     width), with partial-occupancy disclosures
 *   · freeRegions2D()  the largest free rectangles (where new
 *                     content can actually go)
 *   · hierarchyLines() the text scale ordering (headline → body)
 *
 * Everything is derived from AgentDesignCtx — the client's own
 * numbers, never a guess.
 */

import type { AgentDesignCtx, AgentElementCtx } from './context'

/** ── boxes ──────────────────────────────────────────────────── */

export interface SpatialBox {
  id: string
  type: string
  /** axis-aligned bounds (rotation-expanded) */
  x: number
  y: number
  w: number
  h: number
  /** 0 = bottom … n = top (element list order IS z-order) */
  z: number
  label?: string
  /** the element's own (unrotated) width in px */
  ownW: number
  fontSize?: number
  fill?: string
}

/** AABB of a possibly-rotated rect: rotate about the center, then
 *  take the axis-aligned covering box (w·|cosθ| + h·|sinθ| etc.). */
export function aabb(x: number, y: number, w: number, h: number, rotationDeg?: number): { x: number; y: number; w: number; h: number } {
  if (!rotationDeg || Math.abs(rotationDeg) < 0.5) return { x, y, w, h }
  const t = (Math.abs(rotationDeg) * Math.PI) / 180
  const c = Math.abs(Math.cos(t))
  const s = Math.abs(Math.sin(t))
  const bw = w * c + h * s
  const bh = w * s + h * c
  return { x: x + (w - bw) / 2, y: y + (h - bh) / 2, w: bw, h: bh }
}

/** The design's elements as z-ordered spatial boxes (skipping the
 *  geometry-less). `partial` marks small elements that do not block
 *  a full-width section band. */
export function elementBoxes(d: AgentDesignCtx): SpatialBox[] {
  return (d.elements ?? [])
    .map((e, z) => boxOf(e, z))
    .filter((b): b is SpatialBox => b !== null)
}

function boxOf(e: AgentElementCtx, z: number): SpatialBox | null {
  if (typeof e.x !== 'number' || typeof e.y !== 'number') return null
  const w = typeof e.width === 'number' ? e.width : typeof e.fontSize === 'number' ? e.fontSize * 6 : 0
  const h = typeof e.height === 'number' ? e.height : typeof e.fontSize === 'number' ? e.fontSize * 1.3 : 0
  if (w <= 0 || h <= 0) return null
  const rot = typeof (e as { rotation?: unknown }).rotation === 'number' ? (e as { rotation: number }).rotation : undefined
  const b = aabb(e.x, e.y, w, h, rot)
  return {
    id: e.id,
    type: e.type,
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
    z,
    label: typeof e.text === 'string' && e.text.trim() ? e.text.trim().slice(0, 24) : e.name?.slice(0, 24),
    ownW: w,
    fontSize: typeof e.fontSize === 'number' ? e.fontSize : undefined,
    fill: e.fill,
  }
}

/** ── intentional overlaps ───────────────────────────────────── */

export interface IntentionalPair {
  /** the behind element (container/backdrop) */
  back: SpatialBox
  /** the in-front element (the contained content) */
  front: SpatialBox
  kind: 'container' | 'backdrop' | 'backing-card'
}

function contains(outer: SpatialBox, inner: SpatialBox, frac = 0.8): boolean {
  const ix = Math.max(0, Math.min(outer.x + outer.w, inner.x + inner.w) - Math.max(outer.x, inner.x))
  const iy = Math.max(0, Math.min(outer.y + outer.h, inner.y + inner.h) - Math.max(outer.y, inner.y))
  const innerArea = inner.w * inner.h
  return innerArea > 0 && (ix * iy) / innerArea >= frac
}

export function overlapArea(a: SpatialBox, b: SpatialBox): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return ix * iy
}

/**
 * Pairs whose overlap is CORRECT design layering — never a finding:
 *   · container:  front sits ≥80% inside a LARGER non-text element
 *                that is behind it (cards, frames, mockup bodies)
 *   · backdrop:  a near-page-size element behind everything
 *                (≥75% of the canvas area, low z)
 *   · backing-card: a text ≥70% on a plain shape behind it
 */
export function intentionalOverlaps(boxes: SpatialBox[], pageW: number, pageH: number): IntentionalPair[] {
  const out: IntentionalPair[] = []
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i] // earlier in list = BEHIND
      const b = boxes[j] // later = IN FRONT
      if (overlapArea(a, b) <= 0) continue
      // backdrop: behind covers most of the page
      if (a.w * a.h >= 0.75 * pageW * pageH && a.z <= 3) {
        out.push({ back: a, front: b, kind: 'backdrop' })
        continue
      }
      // container: front ≥80% inside a larger non-text behind element
      const backIsSurface = a.type !== 'text' && a.w * a.h > b.w * b.h * 1.1
      if (backIsSurface && contains(a, b, 0.8)) {
        out.push({ back: a, front: b, kind: b.type === 'text' ? 'backing-card' : 'container' })
      }
    }
  }
  return out
}

/** Is this (behind, front) pair an intentional overlap? */
export function isIntentional(pairs: IntentionalPair[], backId: string, frontId: string): boolean {
  return pairs.some((p) => (p.back.id === backId && p.front.id === frontId) || (p.back.id === frontId && p.front.id === backId))
}

/** ── vertical bands for the plan solver ─────────────────────── */

export interface OccupiedBand {
  y: number
  h: number
  label?: string
}

/**
 * Y-ranges genuinely blocked for full-width section planning: only
 * elements at section scale (own width ≥ 40% of the page width and
 * ≥24px tall) block a band. Smaller elements become `partials` —
 * disclosed in the map so the model plans AROUND them horizontally
 * inside its band.
 */
export function freeVerticalBands(
  d: AgentDesignCtx,
): { occupied: OccupiedBand[]; partials: string[]; pageHeight: number } {
  const pageW = d.width ?? 1080
  const pageH = d.height ?? 1080
  const boxes = elementBoxes(d)
  const sectionScale = (b: SpatialBox) => b.ownW >= 0.4 * pageW && b.h >= 24
  const blocking = boxes.filter(sectionScale)
  const partial = boxes.filter((b) => !sectionScale(b))

  // merge blocking extents into disjoint bands (a <40px gap cannot
  // host a new section, so close gaps merge — same rule as the
  // plan solver's minGap)
  const bands: OccupiedBand[] = []
  for (const b of [...blocking].sort((p, q) => p.y - q.y)) {
    const last = bands[bands.length - 1]
    if (last && b.y - (last.y + last.h) < 40) {
      const end = Math.max(last.y + last.h, b.y + b.h)
      last.h = end - last.y
      if (!last.label && b.label) last.label = b.label
    } else {
      bands.push({ y: Math.max(0, Math.round(b.y)), h: Math.round(b.h), label: b.label })
    }
  }
  const partials = partial
    .slice(0, 8)
    .sort((p, q) => q.w * q.h - p.w * p.h)
    .map((p) => `${Math.round(p.ownW)}x${Math.round(p.h)} ${p.type}${p.label ? ` "${p.label}"` : ''} at (${Math.round(p.x)},${Math.round(p.y)})`)
  return { occupied: bands, partials, pageHeight: pageH }
}

/** ── 2D free regions ───────────────────────────────────────── */

export interface FreeRegion {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The largest free rectangles in the safe area (6% margins): for
 * each horizontal slab bounded by element y-edges, the free x-spans
 * of that slab. Bounded, deterministic, no model arithmetic.
 */
export function freeRegions2D(d: AgentDesignCtx, limit = 8): FreeRegion[] {
  const pageW = d.width ?? 1080
  const pageH = d.height ?? 1080
  const top = Math.round(pageH * 0.06)
  const bottom = Math.round(pageH * 0.94)
  const left = Math.round(pageW * 0.06)
  const right = Math.round(pageW * 0.94)
  const boxes = elementBoxes(d)
    .map((b) => ({ x0: Math.max(left, b.x), y0: Math.max(top, b.y), x1: Math.min(right, b.x + b.w), y1: Math.min(bottom, b.y + b.h) }))
    .filter((b) => b.x1 > b.x0 && b.y1 > b.y0)

  const ys = [...new Set([top, bottom, ...boxes.flatMap((b) => [b.y0, b.y1])])].filter((y) => y >= top && y <= bottom).sort((a, b) => a - b)
  const regions: FreeRegion[] = []
  for (let i = 0; i < ys.length - 1; i++) {
    const y0 = ys[i]
    const y1 = ys[i + 1]
    if (y1 - y0 < 40) continue
    // boxes crossing this slab horizontally
    const spans = boxes.filter((b) => b.y0 < y1 && b.y1 > y0).map((b) => [b.x0, b.x1] as const).sort((a, b) => a[0] - b[0])
    // free x-spans between the covered spans
    let cursor = left
    const freeSpans: [number, number][] = []
    for (const [x0, x1] of spans) {
      if (x0 > cursor) freeSpans.push([cursor, x0])
      cursor = Math.max(cursor, x1)
    }
    if (right > cursor) freeSpans.push([cursor, right])
    for (const [fx0, fx1] of freeSpans) {
      if (fx1 - fx0 >= 80) regions.push({ x: Math.round(fx0), y: Math.round(y0), w: Math.round(fx1 - fx0), h: Math.round(y1 - y0) })
    }
  }
  // collapse vertically-adjacent same-x regions (keep it simple:
  // sort by area, return the largest)
  return regions.sort((a, b) => b.w * b.h - a.w * a.h).slice(0, limit)
}

/** ── visual hierarchy ───────────────────────────────────────── */

/**
 * The text scale ordering — what the eye reads first. Returns the
 * descending font-size ladder plus an advisory when the hierarchy is
 * flat (largest text < 1.3× the body median).
 */
export function hierarchyLines(d: AgentDesignCtx): string[] {
  const texts = (d.elements ?? []).filter((e): e is AgentElementCtx & { fontSize: number; text: string } => typeof e.fontSize === 'number' && e.fontSize > 0 && typeof e.text === 'string' && e.text.trim().length > 0)
  if (texts.length < 2) return []
  const sorted = [...texts].sort((a, b) => b.fontSize - a.fontSize)
  const ladder = sorted.slice(0, 5).map((t) => `${Math.round(t.fontSize)}px "${t.text.trim().slice(0, 20)}"`)
  const lines = [`Text hierarchy (descending): ${ladder.join(' → ')}`]
  const body = sorted.slice(1)
  const median = body.length ? body[Math.floor(body.length / 2)].fontSize : 0
  if (median > 0 && sorted[0].fontSize < 1.3 * median) {
    lines.push(`ADVISORY: flat hierarchy — the largest text (${Math.round(sorted[0].fontSize)}px) is under 1.3× the body median (${Math.round(median)}px); make the headline clearly bigger`)
  }
  return lines
}

/** ── the full map ───────────────────────────────────────────── */

export interface SpatialMap {
  boxes: SpatialBox[]
  intentional: IntentionalPair[]
  occupied: OccupiedBand[]
  partials: string[]
  freeRegions: FreeRegion[]
  hierarchy: string[]
}

export function spatialMap(d: AgentDesignCtx): SpatialMap {
  const pageW = d.width ?? 1080
  const pageH = d.height ?? 1080
  const boxes = elementBoxes(d)
  const bands = freeVerticalBands(d)
  return {
    boxes,
    intentional: intentionalOverlaps(boxes, pageW, pageH),
    occupied: bands.occupied,
    partials: bands.partials,
    freeRegions: freeRegions2D(d),
    hierarchy: hierarchyLines(d),
  }
}

/** The ToolContext's spatial slice (v0.32.7): occupied bands,
 *  partials and free regions, structurally typed for ToolContext. */
export function spatialCtx(d: AgentDesignCtx): { occupied: { y: number; h: number; label?: string }[]; partials: string[]; freeRegions: { x: number; y: number; w: number; h: number }[] } {
  const bands = freeVerticalBands(d)
  return { occupied: bands.occupied, partials: bands.partials, freeRegions: freeRegions2D(d, 6) }
}
