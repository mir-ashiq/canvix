// ─────────────────────────────────────────────────────────────
// Design snapshot projection — what `design.getSnapshot()` hands
// a plugin (research PLUGIN-SYSTEM.md §4.3): "current design:
// pages, elements (ids/types/geometry/own data), background —
// capped, read-only view".
//
// The projection is deliberately LOSSY, and that is the feature:
//   · heavy fields (image dataURLs) are omitted, not truncated —
//     a generator plugin needs geometry + text, never bytes
//   · internal bookkeeping (`_m` HLC stamps, `magicLayer`
//     provenance) never crosses the boundary
//   · the result is checked against the RPC payload cap so an
//     enormous design fails loudly (E_PAYLOAD) instead of
//     silently stalling the iframe
// ─────────────────────────────────────────────────────────────

import type { AnyElement, PageData } from '@/lib/types'
import { checkCloneSafe } from './data-caps'

/** Strings longer than this are dropped (image dataURLs etc.). */
export const SNAPSHOT_FIELD_CHAR_CAP = 1024

/** Fields every element view carries. */
export interface PluginElementView {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  visible: boolean
  name?: string
  /** element types with children (groups) keep the tree */
  children?: PluginElementView[]
  /** names of omitted oversized fields, e.g. ["src"] */
  omitted?: string[]
  /** type-specific own data survives verbatim when small */
  [key: string]: unknown
}

export interface PluginPageView {
  id: string
  background: unknown
  elements: PluginElementView[]
}

export interface PluginDesignSnapshot {
  pages: PluginPageView[]
  currentPage: number
}

/** Fields that are host-internal — never exposed to plugins. */
const INTERNAL_FIELDS = new Set(['_m', 'magicLayer', 'shadow', 'animation', 'beatPulse'])

/** Fields whose values are commonly megabyte dataURLs. */
const HEAVY_FIELDS = new Set(['src', 'poster', 'audio', 'thumb'])

function isPlainSmall(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null ||
    value === undefined
  )
}

function projectElement(el: AnyElement): PluginElementView {
  const view: PluginElementView = {
    id: el.id,
    type: el.type,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    rotation: el.rotation,
    opacity: el.opacity,
    visible: el.visible,
  }
  if (el.name !== undefined) view.name = el.name

  const omitted: string[] = []
  for (const [key, value] of Object.entries(el)) {
    if (INTERNAL_FIELDS.has(key)) continue
    if (key === 'id' || key === 'type' || key === 'x' || key === 'y' || key === 'width' || key === 'height') continue
    if (key === 'rotation' || key === 'opacity' || key === 'visible' || key === 'name') continue

    if (key === 'children') {
      // groups keep a projected tree
      if (Array.isArray(value)) {
        view.children = value.map((c) => projectElement(c as AnyElement))
      }
      continue
    }
    // plugin elements: `data` is the owning plugin's own output —
    // it wrote those bytes through the capped addPluginElement /
    // updatePluginElementData actions, so it gets them back whole
    // (arrays and nesting included). A foreign plugin reading the
    // snapshot sees the same copy — capped, read-only, its own to
    // interpret or ignore.
    if (el.type === 'plugin' && key === 'data') {
      if (checkCloneSafe(value) === null) view.data = value
      else omitted.push('data')
      continue
    }
    if (HEAVY_FIELDS.has(key)) {
      // short refs (e.g. "/api/media/abc") survive; dataURLs never do
      if (typeof value === 'string' && value.length <= SNAPSHOT_FIELD_CHAR_CAP) {
        view[key] = value
      } else {
        omitted.push(key)
      }
      continue
    }
    if (isPlainSmall(value)) {
      if (typeof value === 'string' && value.length > SNAPSHOT_FIELD_CHAR_CAP) {
        omitted.push(key)
        continue
      }
      if (value !== undefined) view[key] = value
      continue
    }
    // nested plain objects (fillGradient, effect…) — shallow-keep
    // only small scalar leaves; drop anything exotic
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const nested: Record<string, unknown> = {}
      let small = true
      for (const [nk, nv] of Object.entries(value as Record<string, unknown>)) {
        if (!isPlainSmall(nv)) {
          small = false
          break
        }
        if (typeof nv === 'string' && nv.length > SNAPSHOT_FIELD_CHAR_CAP) {
          small = false
          break
        }
        nested[nk] = nv
      }
      if (small) view[key] = nested
      else omitted.push(key)
    }
  }
  if (omitted.length) view.omitted = omitted
  return view
}

/**
 * Build the read-only plugin view of a design.
 * `state` is the editor-store slice (or any compatible shape).
 */
export function pluginSnapshot(state: {
  pages: PageData[]
  currentPage: number
}): PluginDesignSnapshot {
  const pages: PluginPageView[] = state.pages.map((p) => ({
    id: p.id,
    background: p.background,
    elements: (p.elements ?? []).map(projectElement),
  }))
  return { pages, currentPage: state.currentPage }
}
