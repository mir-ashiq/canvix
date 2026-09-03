'use client'

import { create } from 'zustand'
import {
  uid,
  type AnyElement,
  type Background,
  type BrandKit,
  createGroupElement,
  DEFAULT_BRAND,
  type DesignRecord,
  type DesignVersion,
  type ManualGuide,
  type PageData,
} from '@/lib/types'
import type { TemplateDef } from '@/lib/templates'

export type PanelId =
  | 'templates'
  | 'elements'
  | 'text'
  | 'brand'
  | 'uploads'
  | 'tools'
  | 'projects'
  | 'apps'
  | 'background'
  | 'layers'
  | null

interface HistoryEntry {
  pages: PageData[]
  currentPage: number
}

// module-level clipboard (not reactive)
let clipboard: AnyElement[] = []

interface EditorState {
  designId: string | null
  designName: string
  width: number
  height: number
  pages: PageData[]
  currentPage: number
  selectedIds: string[]
  zoom: number
  panel: PanelId
  past: HistoryEntry[]
  future: HistoryEntry[]
  dirty: boolean
  savedAt: number | null
  saving: boolean
  /** increments on every content mutation — used by autosave */
  version: number

  // canva-2026 chrome
  editingMode: 'editing' | 'viewing'
  previewOpen: boolean
  /** freehand draw tool */
  tool: 'select' | 'draw'
  drawColor: string
  drawSize: number
  brand: BrandKit

  // v0.3.1: rulers & manual guides
  showRulers: boolean
  manualGuides: ManualGuide[]
  toggleRulers: () => void
  addManualGuide: (axis: 'x' | 'y', position: number) => string
  moveManualGuide: (id: string, position: number) => void
  removeManualGuide: (id: string) => void
  clearManualGuides: () => void

  // v0.3.1: version history (per design, localStorage-persisted)
  versions: DesignVersion[]
  saveVersion: (label?: string) => void
  restoreVersion: (id: string) => void
  deleteVersion: (id: string) => void

  // v0.3.1: image crop dialog target (set from context menu / toolbar)
  cropTargetId: string | null
  openCrop: (id: string) => void
  closeCrop: () => void

  // lifecycle
  loadDesign: (d: DesignRecord) => void
  rename: (name: string) => void

  // history
  pushHistory: () => void
  undo: () => void
  redo: () => void

  // selection
  setSelection: (ids: string[]) => void
  selectToggle: (id: string) => void
  clearSelection: () => void

  // element ops — live (no history) vs committed (history)
  addElement: (el: AnyElement) => void
  updateElementsLive: (ids: string[], patch: Partial<Record<string, unknown>>) => void
  updateElements: (ids: string[], patch: Partial<Record<string, unknown>>) => void
  deleteSelection: () => void
  duplicateSelection: () => void
  copySelection: () => void
  cutSelection: () => void
  pasteClipboard: () => void
  moveLayer: (id: string, dir: 'up' | 'down' | 'front' | 'back') => void
  reorderLayer: (dragId: string, targetIndex: number) => void
  setLock: (ids: string[], locked: boolean) => void
  setVisible: (ids: string[], visible: boolean) => void
  groupSelection: () => void
  ungroupSelection: () => void
  alignElements: (ids: string[], mode: 'left' | 'cx' | 'right' | 'top' | 'cy' | 'bottom') => void
  flipSelection: (axis: 'h' | 'v') => void

  // page ops
  addPage: () => void
  deletePage: (index: number) => void
  duplicatePage: (index: number) => void
  setCurrentPage: (index: number) => void
  setPageBackground: (bg: Background) => void
  applyTemplate: (t: TemplateDef) => void

  // zoom
  setZoom: (z: number) => void
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
  fitToScreen: () => void
  /** workspace viewport size (set by CanvasStage for fit-to-screen) */
  viewport: { width: number; height: number }
  setViewport: (v: { width: number; height: number }) => void

  // canva-2026 chrome
  setEditingMode: (m: 'editing' | 'viewing') => void
  setPreviewOpen: (open: boolean) => void
  setTool: (t: 'select' | 'draw') => void
  setDrawColor: (c: string) => void
  setDrawSize: (n: number) => void
  setBrand: (b: BrandKit) => void
  resizeDesign: (width: number, height: number) => void

  // panels & save
  setPanel: (p: PanelId) => void
  markSaving: () => void
  markSaved: () => void
}

const clone = <T,>(v: T): T => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)))

const ZOOM_MIN = 0.05
const ZOOM_MAX = 8
const HISTORY_LIMIT = 60

export const useEditorStore = create<EditorState>((set, get) => ({
  designId: null,
  designName: 'Untitled design',
  width: 1080,
  height: 1080,
  pages: [{ id: uid('page'), background: { type: 'solid', color: '#FFFFFF' }, elements: [] }],
  currentPage: 0,
  selectedIds: [],
  zoom: 1,
  panel: null,
  past: [],
  future: [],
  dirty: false,
  savedAt: null,
  saving: false,
  version: 0,

  editingMode: 'editing',
  previewOpen: false,
  tool: 'select',
  drawColor: '#FFFFFF',
  drawSize: 6,
  brand: DEFAULT_BRAND,

  showRulers: false,
  manualGuides: [],
  versions: [],
  cropTargetId: null,

  loadDesign: (d) => {
    set({
      designId: d.id,
      designName: d.name,
      width: d.width,
      height: d.height,
      pages: d.pages.length ? d.pages : [{ id: uid('page'), background: { type: 'solid', color: '#FFFFFF' }, elements: [] }],
      currentPage: 0,
      selectedIds: [],
      zoom: 1,
      past: [],
      future: [],
      dirty: false,
      savedAt: Date.now(),
      saving: false,
      previewOpen: false,
      tool: 'select',
      cropTargetId: null,
    })
    // v0.3.1: load any locally-persisted versions for this design
    set({ versions: loadVersions(d.id) })
  },

  rename: (name) => set({ designName: name, dirty: true }),

  pushHistory: () => {
    const { pages, currentPage, past, version } = get()
    set({
      past: [...past.slice(-HISTORY_LIMIT + 1), { pages: clone(pages), currentPage }],
      future: [],
      dirty: true,
      version: version + 1,
    })
  },

  undo: () => {
    const { past, future, pages, currentPage, version } = get()
    if (!past.length) return
    const prev = past[past.length - 1]
    set({
      pages: prev.pages,
      currentPage: Math.min(prev.currentPage, prev.pages.length - 1),
      past: past.slice(0, -1),
      future: [...future, { pages: clone(pages), currentPage }],
      selectedIds: [],
      dirty: true,
      version: version + 1,
    })
  },

  redo: () => {
    const { past, future, pages, currentPage, version } = get()
    if (!future.length) return
    const next = future[future.length - 1]
    set({
      pages: next.pages,
      currentPage: Math.min(next.currentPage, next.pages.length - 1),
      future: future.slice(0, -1),
      past: [...past, { pages: clone(pages), currentPage }],
      selectedIds: [],
      dirty: true,
      version: version + 1,
    })
  },

  setSelection: (ids) => set({ selectedIds: ids }),
  selectToggle: (id) => {
    const { selectedIds } = get()
    set({
      selectedIds: selectedIds.includes(id) ? selectedIds.filter((i) => i !== id) : [...selectedIds, id],
    })
  },
  clearSelection: () => set({ selectedIds: [] }),

  addElement: (el) => {
    get().pushHistory()
    const { pages, currentPage } = get()
    const next = clone(pages)
    next[currentPage].elements.push(el)
    set({ pages: next, selectedIds: [el.id] })
  },

  updateElementsLive: (ids, patch) => {
    const { pages, currentPage, version } = get()
    const next = clone(pages)
    next[currentPage].elements = next[currentPage].elements.map((e) =>
      ids.includes(e.id) ? ({ ...e, ...patch } as AnyElement) : e
    )
    set({ pages: next, version: version + 1, dirty: true })
  },

  updateElements: (ids, patch) => {
    get().pushHistory()
    get().updateElementsLive(ids, patch)
  },

  deleteSelection: () => {
    const { selectedIds } = get()
    if (!selectedIds.length) return
    get().pushHistory()
    const { pages, currentPage } = get()
    const next = clone(pages)
    next[currentPage].elements = next[currentPage].elements.filter((e) => !selectedIds.includes(e.id))
    set({ pages: next, selectedIds: [] })
  },

  duplicateSelection: () => {
    const { selectedIds, pages, currentPage } = get()
    if (!selectedIds.length) return
    get().pushHistory()
    const page = pages[currentPage]
    const clones = page.elements
      .filter((e) => selectedIds.includes(e.id))
      .map((e) => ({ ...clone(e), id: uid(e.type), x: e.x + 32, y: e.y + 32 }))
    const next = clone(pages)
    next[currentPage].elements = [...next[currentPage].elements, ...clones]
    set({ pages: next, selectedIds: clones.map((c) => c.id) })
  },

  copySelection: () => {
    const { selectedIds, pages, currentPage } = get()
    clipboard = clone(pages[currentPage].elements.filter((e) => selectedIds.includes(e.id)))
  },

  cutSelection: () => {
    const { selectedIds, pages, currentPage } = get()
    if (!selectedIds.length) return
    clipboard = clone(pages[currentPage].elements.filter((e) => selectedIds.includes(e.id)))
    get().deleteSelection()
  },

  pasteClipboard: () => {
    if (!clipboard.length) return
    get().pushHistory()
    const clones = clipboard.map((e) => ({ ...clone(e), id: uid(e.type), x: e.x + 32, y: e.y + 32 }))
    const { pages, currentPage } = get()
    const next = clone(pages)
    next[currentPage].elements = [...next[currentPage].elements, ...clones]
    set({ pages: next, selectedIds: clones.map((c) => c.id) })
  },

  moveLayer: (id, dir) => {
    get().pushHistory()
    const { pages, currentPage } = get()
    const next = clone(pages)
    const els = next[currentPage].elements
    const i = els.findIndex((e) => e.id === id)
    if (i === -1) return
    let j = i
    if (dir === 'up') j = Math.min(els.length - 1, i + 1)
    if (dir === 'down') j = Math.max(0, i - 1)
    if (dir === 'front') j = els.length - 1
    if (dir === 'back') j = 0
    els.splice(j, 0, ...els.splice(i, 1))
    set({ pages: next })
  },

  reorderLayer: (dragId, targetIndex) => {
    const { pages, currentPage } = get()
    const els = pages[currentPage].elements
    const i = els.findIndex((e) => e.id === dragId)
    if (i === -1) return
    if (i === targetIndex) return
    get().pushHistory()
    const next = clone(pages)
    const arr = next[currentPage].elements
    arr.splice(targetIndex, 0, ...arr.splice(i, 1))
    set({ pages: next })
  },

  setLock: (ids, locked) => get().updateElements(ids, { locked }),
  setVisible: (ids, visible) => get().updateElements(ids, { visible }),

  groupSelection: () => {
    const { selectedIds, pages, currentPage } = get()
    const page = pages[currentPage]
    const children = page.elements.filter((e) => selectedIds.includes(e.id) && !e.locked)
    if (children.length < 2) return
    get().pushHistory()
    const group = createGroupElement(children)
    const next = clone(pages)
    next[currentPage].elements = [...next[currentPage].elements.filter((e) => !selectedIds.includes(e.id)), group]
    set({ pages: next, selectedIds: [group.id] })
  },

  ungroupSelection: () => {
    const { selectedIds, pages, currentPage } = get()
    const page = pages[currentPage]
    const groups = page.elements.filter((e) => selectedIds.includes(e.id) && e.type === 'group')
    if (!groups.length) return
    get().pushHistory()
    const next = clone(pages)
    let released: string[] = []
    for (const g of groups) {
      if (g.type !== 'group') continue
      next[currentPage].elements = next[currentPage].elements.filter((e) => e.id !== g.id)
      // v0.3.1: children live in the group's local (unrotated) space — when the
      // group has a rotation, orbit each child around the group origin and pass
      // the rotation on, so nothing jumps on ungroup.
      const rad = ((g.rotation || 0) * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      const releasedEls = g.children.map((c) => {
        if (!rad) return { ...clone(c) }
        const cx = c.x + c.width / 2 - g.x
        const cy = c.y + c.height / 2 - g.y
        const nx = g.x + cx * cos - cy * sin - c.width / 2
        const ny = g.y + cx * sin + cy * cos - c.height / 2
        return {
          ...clone(c),
          x: Math.round(nx),
          y: Math.round(ny),
          rotation: (c.rotation + (g.rotation || 0)) % 360,
        }
      })
      next[currentPage].elements.push(...releasedEls)
      released = [...released, ...releasedEls.map((c) => c.id)]
    }
    set({ pages: next, selectedIds: released })
  },

  alignElements: (ids, mode) => {
    if (!ids.length) return
    get().pushHistory()
    const { pages, currentPage, width, height } = get()
    const next = clone(pages)
    next[currentPage].elements = next[currentPage].elements.map((el) => {
      if (!ids.includes(el.id)) return el
      switch (mode) {
        case 'left': return { ...el, x: 0 }
        case 'cx': return { ...el, x: Math.round((width - el.width) / 2) }
        case 'right': return { ...el, x: width - el.width }
        case 'top': return { ...el, y: 0 }
        case 'cy': return { ...el, y: Math.round((height - el.height) / 2) }
        case 'bottom': return { ...el, y: height - el.height }
      }
    })
    set({ pages: next })
  },

  flipSelection: (axis) => {
    const { selectedIds, pages, currentPage } = get()
    if (!selectedIds.length) return
    get().pushHistory()
    const next = clone(pages)
    next[currentPage].elements = next[currentPage].elements.map((el) => {
      if (!selectedIds.includes(el.id)) return el
      if (el.type === 'image') return { ...el, flipH: axis === 'h' ? !el.flipH : el.flipH, flipV: axis === 'v' ? !el.flipV : el.flipV }
      // shapes/text: mirror via negative scale is not in the model; rotate 180 for symmetric flip feel
      return { ...el, rotation: (el.rotation + (axis === 'h' ? 0 : 180)) % 360 }
    })
    set({ pages: next })
  },

  addPage: () => {
    get().pushHistory()
    const { pages } = get()
    set({ pages: [...clone(pages), { id: uid('page'), background: { type: 'solid', color: '#FFFFFF' }, elements: [] }] })
  },

  deletePage: (index) => {
    const { pages } = get()
    if (pages.length <= 1) return
    get().pushHistory()
    const next = clone(pages)
    next.splice(index, 1)
    set({ pages: next, currentPage: Math.min(index, next.length - 1), selectedIds: [] })
  },

  duplicatePage: (index) => {
    get().pushHistory()
    const { pages } = get()
    const next = clone(pages)
    const copy = clone(next[index])
    copy.id = uid('page')
    copy.elements = copy.elements.map((e) => ({ ...e, id: uid(e.type) }))
    next.splice(index + 1, 0, copy)
    set({ pages: next, currentPage: index + 1, selectedIds: [] })
  },

  setCurrentPage: (index) => set({ currentPage: index, selectedIds: [] }),

  setPageBackground: (bg) => {
    get().pushHistory()
    const { pages, currentPage } = get()
    const next = clone(pages)
    next[currentPage].background = bg
    set({ pages: next })
  },

  applyTemplate: (t) => {
    get().pushHistory()
    set({
      pages: clone(t.pages.map((p) => ({ ...p, id: uid('page') }))),
      width: t.width,
      height: t.height,
      currentPage: 0,
      selectedIds: [],
    })
  },

  setZoom: (z) => set({ zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) }),
  zoomIn: () => set({ zoom: Math.min(ZOOM_MAX, get().zoom * 1.2) }),
  zoomOut: () => set({ zoom: Math.max(ZOOM_MIN, get().zoom / 1.2) }),
  resetZoom: () => set({ zoom: 1 }),
  fitToScreen: () => {
    const { width, height, viewport } = get()
    if (!viewport.width || !viewport.height) { set({ zoom: 1 }); return }
    const z = Math.min((viewport.width - 96) / width, (viewport.height - 96) / height)
    set({ zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) })
  },
  viewport: { width: 0, height: 0 },
  setViewport: (v) => set({ viewport: v }),

  setEditingMode: (m) => set({ editingMode: m }),
  setPreviewOpen: (open) => set({ previewOpen: open }),
  setTool: (t) => set({ tool: t, selectedIds: [] }),
  setDrawColor: (c) => set({ drawColor: c }),
  setDrawSize: (n) => set({ drawSize: Math.min(64, Math.max(1, n)) }),
  setBrand: (b) => set({ brand: b }),

  // ── v0.3.1: rulers & manual guides ─────────────────────
  toggleRulers: () => set({ showRulers: !get().showRulers }),
  addManualGuide: (axis, position) => {
    const id = uid('guide')
    set({ manualGuides: [...get().manualGuides, { id, axis, position: Math.round(position) }] })
    return id
  },
  moveManualGuide: (id, position) => {
    set({
      manualGuides: get().manualGuides.map((g) => (g.id === id ? { ...g, position: Math.round(position) } : g)),
    })
  },
  removeManualGuide: (id) => set({ manualGuides: get().manualGuides.filter((g) => g.id !== id) }),
  clearManualGuides: () => set({ manualGuides: [] }),

  // ── v0.3.1: version history ────────────────────────────
  saveVersion: (label) => {
    const { designId, designName, width, height, pages, versions } = get()
    if (!designId) return
    const v: DesignVersion = {
      id: uid('ver'),
      label: label?.trim() || `Version ${versions.length + 1}`,
      at: Date.now(),
      name: designName,
      width,
      height,
      pages: clone(pages),
    }
    const next = [v, ...versions].slice(0, 30) // keep the 30 most recent
    set({ versions: next })
    persistVersions(designId, next)
  },
  restoreVersion: (id) => {
    const v = get().versions.find((x) => x.id === id)
    if (!v) return
    get().pushHistory()
    set({
      pages: clone(v.pages),
      width: v.width,
      height: v.height,
      designName: v.name,
      currentPage: 0,
      selectedIds: [],
      dirty: true,
    })
  },
  deleteVersion: (id) => {
    const { designId, versions } = get()
    const next = versions.filter((v) => v.id !== id)
    set({ versions: next })
    if (designId) persistVersions(designId, next)
  },

  // v0.3.1: image crop dialog
  openCrop: (id) => set({ cropTargetId: id }),
  closeCrop: () => set({ cropTargetId: null }),

  resizeDesign: (width, height) => {
    get().pushHistory()
    const { pages } = get()
    const next = clone(pages)
    // keep elements centered when canvas size changes
    for (const page of next) {
      for (const el of page.elements) {
        el.x = Math.round((width - el.width) / 2)
        el.y = Math.round((height - el.height) / 2)
      }
    }
    set({ width, height, pages: next, selectedIds: [], zoom: 1 })
  },

  setPanel: (p) => set({ panel: get().panel === p ? null : p }),

  markSaving: () => set({ saving: true }),
  markSaved: () => set({ saving: false, dirty: false, savedAt: Date.now() }),
}))

// ── selectors ────────────────────────────────────────────────

export function currentPageData(s: Pick<EditorState, 'pages' | 'currentPage'>): PageData {
  return s.pages[Math.min(s.currentPage, s.pages.length - 1)] ?? s.pages[0]
}

export function selectedElements(s: Pick<EditorState, 'pages' | 'currentPage' | 'selectedIds'>): AnyElement[] {
  return currentPageData(s).elements.filter((e) => s.selectedIds.includes(e.id))
}

// ── v0.3.1: version persistence (localStorage, per design) ──

const VERSIONS_KEY = (designId: string) => `canvix-versions-${designId}`
const VERSIONS_LIMIT_JSON = 4.5 * 1024 * 1024 // ~4.5 MB safety budget

function loadVersions(designId: string): DesignVersion[] {
  try {
    const raw = localStorage.getItem(VERSIONS_KEY(designId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as DesignVersion[]) : []
  } catch {
    return []
  }
}

function persistVersions(designId: string, versions: DesignVersion[]) {
  try {
    // guard against quota errors: drop oldest versions until we fit
    let list = versions
    while (list.length > 1) {
      try {
        localStorage.setItem(VERSIONS_KEY(designId), JSON.stringify(list))
        return
      } catch {
        list = list.slice(0, -1)
      }
    }
    localStorage.setItem(VERSIONS_KEY(designId), JSON.stringify(list))
  } catch {
    /* localStorage unavailable (private mode) — versions stay in memory */
  }
}

/** drop stored versions above the size budget (called after big saves) */
export function pruneVersionsIfNeeded(designId: string) {
  try {
    const raw = localStorage.getItem(VERSIONS_KEY(designId))
    if (raw && raw.length > VERSIONS_LIMIT_JSON) {
      const list = (JSON.parse(raw) as DesignVersion[]).slice(0, -1)
      persistVersions(designId, list)
    }
  } catch {
    /* ignore */
  }
}
