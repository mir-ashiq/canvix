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

export interface AgentElementCtx {
  id: string
  type: string
  x?: number
  y?: number
  width?: number
  height?: number
  text?: string
  fill?: string
  fontSize?: number
  bold?: boolean
  fontFamily?: string
  name?: string
  locked?: boolean
}

export interface AgentDesignCtx {
  name?: string
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
   *  omit it and the audit falls back to the dominant in-use color. */
  background?: string
}

/** Element summary line — compact but geometry-complete. */
function elementLine(e: AgentElementCtx, selected: boolean): string {
  const parts: string[] = [`${e.type}#${e.id}`]
  if (e.name) parts.push(`"${e.name.slice(0, 24)}"`)
  if (selected) parts.push('[SELECTED]')
  if (e.text) parts.push(`text="${e.text.slice(0, 60).replace(/\n/g, ' ')}"`)
  if (e.fill) parts.push(e.fill)
  if (e.fontSize) parts.push(`${Math.round(e.fontSize)}px`)
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
  if (d.otherPages?.length) lines.push(`Other pages: ${d.otherPages.join(' | ')}`)
  return lines.join('\n')
}

/** The ids the sanitizer should accept (flat, groups included). */
export function contextValidIds(d: AgentDesignCtx): Set<string> {
  return new Set((d.elements ?? []).map((e) => e.id))
}
