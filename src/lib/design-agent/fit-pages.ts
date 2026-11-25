// ─────────────────────────────────────────────────────────────
// fit-pages (v0.31, DesignAgent panel) — deterministic canvas fit.
//
// The autonomous pipeline compiles pages for the format the brief
// demanded (e.g. 1080×1350 Instagram portrait). The editor's design
// has ONE canvas size, so pages compiled for a different format are
// uniformly rescaled + centered before appendPages — a pure
// geometric transform: every coordinate, box and font size rides the
// SAME factor, so wrap points, layering and relative layout are
// exactly preserved (a design that fit at 1080×1350 still fits at
// 4:5-of-the-target). No reflow, no re-interpretation — the checked
// design stays the checked design.
// ─────────────────────────────────────────────────────────────

import type { AnyElement, PageData, TextElement } from '@/lib/types'

export interface PageFormat {
  width: number
  height: number
}

export interface PageFitResult {
  pages: PageData[]
  /** applied uniform factor (1 = identity — no rescale happened) */
  scale: number
  /** letterbox centering offsets applied to every element */
  offsetX: number
  offsetY: number
}

function isGroup(el: AnyElement): el is AnyElement & { children: AnyElement[] } {
  return el.type === 'group' && Array.isArray((el as { children?: unknown }).children)
}

function scaleElement(el: AnyElement, scale: number, ox: number, oy: number): AnyElement {
  const base = {
    ...el,
    x: (el.x ?? 0) * scale + ox,
    y: (el.y ?? 0) * scale + oy,
    width: (el.width ?? 0) * scale,
    height: (el.height ?? 0) * scale,
  }
  if (el.type === 'text') {
    const t = el as TextElement
    return {
      ...base,
      fontSize: Math.max(4, t.fontSize * scale),
      // letterSpacing is px; lineHeight is a fontSize multiplier and
      // needs no change. curve is an arc angle, not a length.
      ...(t.letterSpacing ? { letterSpacing: t.letterSpacing * scale } : {}),
    } as AnyElement
  }
  if (isGroup(el)) {
    return { ...base, children: el.children.map((c) => scaleElement(c, scale, ox, oy)) } as AnyElement
  }
  return base as AnyElement
}

/**
 * Fit compiled pages onto the target canvas. Identity (same pages
 * back, scale 1) when the formats already match or no source format
 * is known — never throws, never drops elements.
 */
export function fitPagesToCanvas(pages: PageData[], from: PageFormat, to: PageFormat): PageFitResult {
  const sane = (f: PageFormat) => Number.isFinite(f.width) && Number.isFinite(f.height) && f.width >= 1 && f.height >= 1
  if (!pages.length || !sane(from) || !sane(to)) return { pages, scale: 1, offsetX: 0, offsetY: 0 }

  const scale = Math.min(to.width / from.width, to.height / from.height)
  if (Math.abs(scale - 1) < 0.001) return { pages, scale: 1, offsetX: 0, offsetY: 0 }

  const offsetX = Math.round(((to.width - from.width * scale) / 2) * 10) / 10
  const offsetY = Math.round(((to.height - from.height * scale) / 2) * 10) / 10
  const fitted = pages.map((p) => ({
    ...p,
    elements: p.elements.map((el) => scaleElement(el, scale, offsetX, offsetY)),
  }))
  return { pages: fitted, scale, offsetX, offsetY }
}
