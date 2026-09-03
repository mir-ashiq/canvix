'use client'

import { create } from 'zustand'
import {
  uid,
  type AnyElement,
  type Background,
  type DesignRecord,
  type PageData,
} from '@/lib/types'
import type { TemplateDef } from '@/lib/templates'

export type PanelId = 'templates' | 'elements' | 'text' | 'uploads' | 'background' | 'layers' | null

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
  pasteClipboard: () => void
  moveLayer: (id: string, dir: 'up' | 'down' | 'front' | 'back') => void
  reorderLayer: (dragId: string, targetIndex: number) => void
  setLock: (ids: string[], locked: boolean) => void
  setVisible: (ids: string[], visible: boolean) => void

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

  loadDesign: (d) =>
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
    }),

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
