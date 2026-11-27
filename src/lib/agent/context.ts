// ─────────────────────────────────────────────────────────────
// Agent context (v0.27) — tiered design-state serialization.
//
// tldraw's three-tier pattern (FocusedShape / BlurryShape /
// PeripheralShapeCluster) adapted to Canvix's page model:
//   · selection + the acting surface = full properties
//   · other elements on the current page = {id, type, bbox, text, fill}
//   · other pages = one-line summaries
// Plus the v0.26 spatial analysis (overlaps, off-canvas) computed on
// the client where the live document lives, passed up with the request
// and re-attached after every mutation via the get_page_state tool.
//
// The shapes here mirror the client-side builder in AssistantApp; the
// server treats them as opaque-but-typed data.
// ─────────────────────────────────────────────────────────────

import type { DesignBrief } from './brief'
import { freeVerticalBands, freeRegions2D, hierarchyLines, spatialMap } from './spatial'

export interface AgentElementCtx {
  id: string
  type: string
  x?: number
  y?: number
  width?: number
  height?: number
  text?: string
  fill?: string
  /** v0.29.3: border color (glassmorphism/feature-card validation) */
  stroke?: string
  /** v0.33: the native-effects surface — the feature contract
   *  (gradients / text effects / shadows) validates against these;
   *  the audit's visibility checks read them too. */
  hasGradient?: boolean
  hasShadow?: boolean
  textEffect?: string
  fontSize?: number
  bold?: boolean
  fontFamily?: string
  name?: string
  locked?: boolean
  /** v0.32.7: rotation in degrees — the spatial map expands the
   *  AABB so rotated elements occupy their true footprint. */
  rotation?: number
  /** v0.29.3: client-measured rendered text width in px (canvas
   *  measureText — the same metrics the renderer uses). Present when
   *  a v0.29.3+ panel built the context; the audit's overflow check
   *  uses it instead of the glyph-average estimate. */
  measuredWidth?: number
}

export interface AgentDesignCtx {
  name?: string
  /** v0.32.1: the open design's id — lets the route read the
   *  AUTHORITATIVE stored brief from the database (server-verified
   *  provenance) instead of trusting the client-posted copy. */
  designId?: string | null
  width?: number
  height?: number
  templateType?: string
  pageCount?: number
  currentPageIndex?: number
  selectedIds?: string[]
  elements?: AgentElementCtx[]
  colorsInUse?: string[]
  fontsInUse?: string[]
  /** v0.27: brand kit (if the user set one) — colors + fonts the agent
   *  should respect before inventing its own (Canva Brand Intelligence). */
  brand?: { colors?: string[]; headingFont?: string; bodyFont?: string } | null
  /** v0.27: computed client-side and refreshed after edits */
  overlaps?: string[]
  offCanvas?: string[]
  /** one-line summaries of the OTHER pages */
  otherPages?: string[]
  /** v0.29: page background hex (solid backgrounds) — enables the
   *  contrast part of the quality audit; optional, older clients simply
   *  omit it and the audit falls back to per-text backdrops only.
   *  v0.29.3: NEVER guessed — the audit uses only this real field. */
  background?: string
  /** v0.32 (Unified Canvix AI): the design's STORED brief contract —
   *  provenance persisted when an autonomous generation was applied to
   *  this design. The client sends it with every request so a
   *  refinement run (even in edit mode) is gated on the requirements
   *  the original run was verified against. Optional: designs without
   *  AI provenance behave exactly as before. */
  aiBrief?: DesignBrief | null
}

/** Element summary line — compact but geometry-complete. */
function elementLine(e: AgentElementCtx, selected: boolean): string {
  const parts: string[] = [`${e.type}#${e.id}`]
  if (e.name) parts.push(`"${e.name.slice(0, 24)}"`)
  if (selected) parts.push('[SELECTED]')
  if (e.text) parts.push(`text="${e.text.slice(0, 60).replace(/\n/g, ' ')}"`)
  if (e.fill) parts.push(e.fill)
  if (e.stroke) parts.push(`border:${e.stroke}`)
  // v0.33: the effects on each element — the model sees (and can
  // verify) gradients, text effects and shadows in the page state.
  if (e.hasGradient) parts.push('gradient')
  if (e.textEffect) parts.push(`effect:${e.textEffect}`)
  if (e.hasShadow) parts.push('shadow')
  if (e.fontSize) parts.push(`${Math.round(e.fontSize)}px`)
  if (e.measuredWidth && e.text) parts.push(`measured:${Math.round(e.measuredWidth)}px`)
  if (e.bold) parts.push('bold')
  if (e.fontFamily) parts.push(e.fontFamily)
  if (Number.isFinite(e.x) && Number.isFinite(e.y)) {
    parts.push(`@(${Math.round(e.x!)},${Math.round(e.y!)}) ${Math.round(e.width ?? 0)}x${Math.round(e.height ?? 0)}`)
  }
  if (e.locked) parts.push('locked')
  return parts.join(' ')
}

/** Serialize the design context into the system-prompt block. Pure. */
export function serializeDesignContext(d: AgentDesignCtx): string {
  const els = d.elements ?? []
  const selected = new Set(d.selectedIds ?? [])
  const lines: string[] = [
    `Design: "${d.name ?? 'Untitled'}" — ${d.width ?? '?'}x${d.height ?? '?'}px (${d.templateType ?? 'custom'}), ${d.pageCount ?? 1} page(s), editing page ${(d.currentPageIndex ?? 0) + 1}.`,
    `Page background: ${d.background ?? '(not solid — not reported)'}. Elements are listed bottom-to-top (later = in front).`,
    `Selection: ${selected.size ? [...selected].join(', ') : 'none'}.`,
  ]
  if (d.brand && ((d.brand.colors?.length ?? 0) > 0 || d.brand.headingFont)) {
    const b = d.brand
    lines.push(
      `BRAND KIT (respect these before inventing your own): colors ${(b.colors ?? []).slice(0, 8).join(' ') || '(none)'}${b.headingFont ? `, heading font ${b.headingFont}` : ''}${b.bodyFont ? `, body font ${b.bodyFont}` : ''}.`,
    )
  }
  lines.push(`Elements on the current page (${els.length}):`)
  lines.push(els.map((e) => elementLine(e, selected.has(e.id))).join('\n') || '(empty page)')
  lines.push(`Colors in use: ${(d.colorsInUse ?? []).slice(0, 12).join(', ') || 'none'}`)
  lines.push(`Fonts in use: ${(d.fontsInUse ?? []).slice(0, 8).join(', ') || 'none'}`)
  lines.push(`Overlapping pairs: ${d.overlaps?.length ? d.overlaps.join('; ') : 'none detected'}`)
  lines.push(`Off-canvas elements: ${d.offCanvas?.length ? d.offCanvas.join('; ') : 'none detected'}`)
  // v0.32.7 · the 2D SPATIAL MAP — z-order, intentional layering,
  // free space and hierarchy, computed deterministically (spatial.ts)
  if (els.length) {
    const map = spatialMap(d)
    if (map.intentional.length) {
      lines.push(`Intentional layering (NOT defects): ${map.intentional.slice(0, 6).map((p) => `${p.front.type}#${p.front.id} on its ${p.kind} ${p.back.type}#${p.back.id}`).join('; ')}`)
    }
    if (map.partials.length) {
      lines.push(`Small elements to plan around horizontally: ${map.partials.slice(0, 4).join('; ')}`)
    }
    const regions = freeRegions2D(d, 5)
    if (regions.length) {
      lines.push(`Largest free regions (x,y w×h): ${regions.map((r) => `(${r.x},${r.y}) ${r.w}×${r.h}`).join(' | ')}`)
    }
    lines.push(...hierarchyLines(d))
  }
  if (d.otherPages?.length) lines.push(`Other pages: ${d.otherPages.join(' | ')}`)
  return lines.join('\n')
}

/** The ids the sanitizer should accept (flat, groups included). */
export function contextValidIds(d: AgentDesignCtx): Set<string> {
  return new Set((d.elements ?? []).map((e) => e.id))
}

/** v0.32.6 · the CANVAS MAP → v0.32.7: TRUE 2D. The vertical bands
 *  the plan solver eats now come from spatial.ts (rotation-aware
 *  AABBs, z-order, section-scale blocking, partial-occupancy
 *  disclosures) instead of a naive every-element merge. */
export function canvasMap(d: AgentDesignCtx): { y: number; h: number; label?: string }[] {
  return freeVerticalBands(d).occupied
}
