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
import { magicRelayoutPages } from '@/lib/magic'
import {
  clearPageAnimations,
  magicAnimatePage,
} from '@/lib/animations'
import type { ElementAnimation, PageTransition } from '@/lib/types'
import type { CollabOp, DesignEventRow } from '@/lib/collab/protocol'
import type { Collaborator, CollabStatus } from '@/lib/collab/protocol'

export type PanelId =
  | 'templates'
  | 'elements'
  | 'text'
  | 'brand'
  | 'uploads'
  | 'photos'
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

// ── v0.5 collaboration: op emission ─────────────────
// The store is the single source of truth for local mutations. After every
// LOCAL mutation it emits an op through the registered emitter (set by
// use-collab). Remote ops flow back through `applyRemoteOp`, which never
// emits — so there is no feedback loop and no re-entry flag needed.

type OpEmitter = (op: CollabOp) => void
let emitOp: OpEmitter | null = null

/** Register (or clear) the collaboration op emitter. */
export function setOpEmitter(fn: OpEmitter | null) {
  emitOp = fn
}

function emit(op: CollabOp) {
  try {
    emitOp?.(op)
  } catch {
    /* collab emission must never break local editing */
  }
}

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

  // v0.3.1: version history (server-backed on Postgres since v0.4; localStorage fallback)
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

  // v0.4: magic translate — batch-update text elements across ALL pages
  translateTexts: (updates: { id: string; text: string }[]) => void

  // v0.5: magic layers — bulk element insertion + page replacement
  addElementsBulk: (els: AnyElement[]) => void
  replaceCurrentPage: (page: PageData) => void
  appendPage: (page: PageData) => void

  // v0.5: collaboration runtime state (not persisted — per-tab)
  collaborators: Collaborator[]
  collabStatus: CollabStatus
  setCollaborators: (list: Collaborator[]) => void
  setCollabStatus: (s: CollabStatus) => void
  /** apply a remote op (never emits, never pushes history) */
  applyRemoteOp: (event: DesignEventRow) => void

  // v0.5: comments mode
  commentsOpen: boolean
  toggleComments: () => void
  setCommentsOpen: (open: boolean) => void

  // v0.5: animations
  setElementAnimation: (ids: string[], animation: ElementAnimation | null) => void
  setPageTransition: (transition: PageTransition | null) => void
  magicAnimateCurrentPage: (speed?: 'slow' | 'medium' | 'fast') => void
  clearPageAnimations: () => void
  animateOpen: boolean
  toggleAnimate: () => void
  setAnimateOpen: (open: boolean) => void

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

  // v0.5: collaboration runtime
  collaborators: [],
  collabStatus: 'offline',
  commentsOpen: false,
  animateOpen: false,

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
    // v0.4: load server-side versions (Postgres); local list is the offline fallback
    const local = loadVersions(d.id)
    set({ versions: local })
    fetch(`/api/designs/${d.id}/versions`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: unknown) => {
        if (Array.isArray(list) && list.length) {
          set({
            versions: list.map((v: Record<string, unknown>) => ({
              id: String(v.id),
              label: String(v.label ?? 'Version'),
              at: Date.parse(String(v.createdAt ?? '')) || Date.now(),
              name: String(v.name ?? d.name),
              width: Number(v.width) || d.width,
              height: Number(v.height) || d.height,
              pages: (v.pages ?? []) as PageData[],
            })),
          })
        }
      })
      .catch(() => { /* offline — keep local list */ })
  },

  rename: (name) => {
    set({ designName: name, dirty: true })
    emit({ kind: 'design:rename', name: name.slice(0, 80) })
  },

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
    // undo restores snapshots — op-level undo replay is out of scope (see
    // COLLABORATION-ARCHITECTURE.md §7), so sync coarse
    emit({ kind: 'pages:replace', pages: prev.pages, width: get().width, height: get().height })
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
    emit({ kind: 'pages:replace', pages: next.pages, width: get().width, height: get().height })
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
    emit({ kind: 'element:add', pageId: next[currentPage].id, element: el })
  },

  updateElementsLive: (ids, patch) => {
    const { pages, currentPage, version } = get()
    const next = clone(pages)
    next[currentPage].elements = next[currentPage].elements.map((e) =>
      ids.includes(e.id) ? ({ ...e, ...patch } as AnyElement) : e
    )
    set({ pages: next, version: version + 1, dirty: true })
    emit({ kind: 'elements:update', pageId: next[currentPage].id, ids: [...ids], patch: { ...patch } })
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
    emit({ kind: 'element:delete', pageId: next[currentPage].id, ids: [...selectedIds] })
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
    emit({ kind: 'elements:add', pageId: next[currentPage].id, elements: clones })
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
    emit({ kind: 'elements:add', pageId: next[currentPage].id, elements: clones })
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
    emit({ kind: 'elements:reorder', pageId: next[currentPage].id, orderedIds: els.map((e) => e.id) })
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
    emit({ kind: 'elements:reorder', pageId: next[currentPage].id, orderedIds: arr.map((e) => e.id) })
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
    emit({ kind: 'page:replace', pageId: next[currentPage].id, page: next[currentPage] })
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
    emit({ kind: 'page:replace', pageId: next[currentPage].id, page: next[currentPage] })
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
    emit({ kind: 'page:replace', pageId: next[currentPage].id, page: next[currentPage] })
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
    emit({ kind: 'page:replace', pageId: next[currentPage].id, page: next[currentPage] })
  },

  addPage: () => {
    get().pushHistory()
    const { pages } = get()
    const page: PageData = { id: uid('page'), background: { type: 'solid', color: '#FFFFFF' }, elements: [] }
    set({ pages: [...clone(pages), page] })
    emit({ kind: 'page:add', page })
  },

  deletePage: (index) => {
    const { pages } = get()
    if (pages.length <= 1) return
    get().pushHistory()
    const removedId = pages[index].id
    const next = clone(pages)
    next.splice(index, 1)
    set({ pages: next, currentPage: Math.min(index, next.length - 1), selectedIds: [] })
    emit({ kind: 'page:delete', pageId: removedId })
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
    emit({ kind: 'page:add', page: copy, afterId: next[index].id })
  },

  setCurrentPage: (index) => set({ currentPage: index, selectedIds: [] }),

  setPageBackground: (bg) => {
    get().pushHistory()
    const { pages, currentPage } = get()
    const next = clone(pages)
    next[currentPage].background = bg
    set({ pages: next })
    emit({ kind: 'page:background', pageId: next[currentPage].id, background: bg })
  },

  applyTemplate: (t) => {
    get().pushHistory()
    const pages = clone(t.pages.map((p) => ({ ...p, id: uid('page') })))
    set({
      pages,
      width: t.width,
      height: t.height,
      currentPage: 0,
      selectedIds: [],
    })
    emit({ kind: 'pages:replace', pages, width: t.width, height: t.height })
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

  // ── v0.3.1: rulers & manual guides (per-page since v0.3.2) ─
  toggleRulers: () => set({ showRulers: !get().showRulers }),
  addManualGuide: (axis, position) => {
    const id = uid('guide')
    const pageId = get().pages[get().currentPage]?.id ?? ''
    set({ manualGuides: [...get().manualGuides, { id, axis, position: Math.round(position), pageId }] })
    return id
  },
  moveManualGuide: (id, position) => {
    set({
      manualGuides: get().manualGuides.map((g) => (g.id === id ? { ...g, position: Math.round(position) } : g)),
    })
  },
  removeManualGuide: (id) => set({ manualGuides: get().manualGuides.filter((g) => g.id !== id) }),
  clearManualGuides: () => {
    // clears only the current page's guides
    const pageId = get().pages[get().currentPage]?.id ?? ''
    set({ manualGuides: get().manualGuides.filter((g) => g.pageId !== pageId) })
  },

  // ── version history (server-backed; localStorage fallback) ─
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
    // server snapshot (best-effort; replaces the optimistic entry on success)
    fetch(`/api/designs/${designId}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: v.label, name: designName, width, height, pages }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((saved: { id?: string } | null) => {
        if (!saved?.id) return
        set({ versions: [{ ...v, id: saved.id }, ...get().versions.filter((x) => x.id !== v.id)].slice(0, 30) })
        persistVersions(designId, get().versions)
      })
      .catch(() => { /* offline — local entry already stored */ })
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
    emit({ kind: 'pages:replace', pages: v.pages, width: v.width, height: v.height })
  },
  deleteVersion: (id) => {
    const { designId, versions } = get()
    const next = versions.filter((v) => v.id !== id)
    set({ versions: next })
    if (designId) persistVersions(designId, next)
    // server snapshots have cuid ids; local ones use the ver_ prefix
    if (!id.startsWith('ver_')) {
      fetch(`/api/versions/${id}`, { method: 'DELETE' }).catch(() => {})
    }
  },

  // v0.3.1: image crop dialog
  openCrop: (id) => set({ cropTargetId: id }),
  closeCrop: () => set({ cropTargetId: null }),

  resizeDesign: (width, height) => {
    get().pushHistory()
    const { pages, width: oldW, height: oldH } = get()
    // v0.4 magic resize: smart re-layout — elements scale & keep their relative
    // position instead of all being dumped in the centre
    const next = magicRelayoutPages(clone(pages), oldW, oldH, width, height)
    set({ width, height, pages: next, selectedIds: [], zoom: 1 })
    emit({ kind: 'pages:replace', pages: next, width, height })
  },

  // ── v0.4: magic translate ────────────────────────────
  translateTexts: (updates) => {
    if (!updates.length) return
    get().pushHistory()
    const { pages, version } = get()
    const map = new Map(updates.map((u) => [u.id, u.text]))
    const applyTexts = (els: AnyElement[]): AnyElement[] =>
      els.map((el) => {
        if (el.type === 'group') return { ...el, children: applyTexts(el.children) }
        return map.has(el.id) ? ({ ...el, text: map.get(el.id)! } as AnyElement) : el
      })
    const next = clone(pages).map((p) => ({ ...p, elements: applyTexts(p.elements) }))
    set({ pages: next, version: version + 1, dirty: true })
    emit({ kind: 'pages:replace', pages: next })
  },

  // ── v0.5: magic layers insertion ────────────────────
  addElementsBulk: (els) => {
    if (!els.length) return
    get().pushHistory()
    const { pages, currentPage } = get()
    const next = clone(pages)
    next[currentPage].elements = [...next[currentPage].elements, ...els.map((e) => clone(e))]
    set({ pages: next, selectedIds: els.map((e) => e.id) })
    emit({ kind: 'elements:add', pageId: next[currentPage].id, elements: els })
  },
  replaceCurrentPage: (page) => {
    get().pushHistory()
    const { pages, currentPage } = get()
    const next = clone(pages)
    next[currentPage] = clone(page)
    set({ pages: next, selectedIds: [] })
    emit({ kind: 'page:replace', pageId: page.id, page })
  },
  appendPage: (page) => {
    get().pushHistory()
    const { pages } = get()
    set({ pages: [...clone(pages), clone(page)], currentPage: pages.length, selectedIds: [] })
    emit({ kind: 'page:add', page })
  },

  setPanel: (p) => set({ panel: get().panel === p ? null : p }),

  // ── v0.5: comments mode ─────────────────
  toggleComments: () => set({ commentsOpen: !get().commentsOpen, panel: null }),
  setCommentsOpen: (open) => set({ commentsOpen: open }),

  // ── v0.5: animations ─────────────────
  toggleAnimate: () => set({ animateOpen: !get().animateOpen }),
  setAnimateOpen: (open) => set({ animateOpen: open }),
  setElementAnimation: (ids, animation) => {
    if (!ids.length) return
    get().pushHistory()
    const { pages, currentPage } = get()
    const next = clone(pages)
    next[currentPage].elements = next[currentPage].elements.map((e) =>
      ids.includes(e.id) ? { ...e, animation: animation ?? undefined } : e
    )
    set({ pages: next })
    emit({
      kind: 'page:replace',
      pageId: next[currentPage].id,
      page: next[currentPage],
    })
  },
  setPageTransition: (transition) => {
    get().pushHistory()
    const { pages, currentPage } = get()
    const next = clone(pages)
    next[currentPage] = { ...next[currentPage], transition: transition ?? undefined }
    set({ pages: next })
    emit({ kind: 'page:replace', pageId: next[currentPage].id, page: next[currentPage] })
  },
  magicAnimateCurrentPage: (speed = 'medium') => {
    get().pushHistory()
    const { pages, currentPage, height } = get()
    const next = clone(pages)
    const animated = magicAnimatePage(next[currentPage], height, speed)
    next[currentPage] = animated
    set({ pages: next })
    emit({ kind: 'page:replace', pageId: animated.id, page: animated })
  },
  clearPageAnimations: () => {
    get().pushHistory()
    const { pages, currentPage } = get()
    const next = clone(pages)
    const cleared = clearPageAnimations(next[currentPage])
    next[currentPage] = cleared
    set({ pages: next })
    emit({ kind: 'page:replace', pageId: cleared.id, page: cleared })
  },

  // ── v0.5: collaboration runtime state ─────────
  setCollaborators: (list) => set({ collaborators: list }),
  setCollabStatus: (s) => set({ collabStatus: s }),
  applyRemoteOp: (event) => {
    const payload = event.payload as Record<string, unknown> | null
    if (!payload) return
    const { pages, version } = get()
    const next = clone(pages)

    const findPage = (pageId: unknown): number =>
      next.findIndex((p) => p.id === pageId)

    const applyToPage = (pageId: unknown, fn: (page: PageData) => PageData): void => {
      const i = findPage(pageId)
      if (i >= 0) next[i] = fn(next[i])
    }

    switch (event.kind) {
      case 'elements:update': {
        const ids = (payload.ids as string[]) ?? []
        const patch = (payload.patch as Record<string, unknown>) ?? {}
        applyToPage(payload.pageId, (page) => ({
          ...page,
          elements: page.elements.map((e) => (ids.includes(e.id) ? ({ ...e, ...patch } as AnyElement) : e)),
        }))
        break
      }
      case 'element:add': {
        const el = payload.element as AnyElement | undefined
        if (el?.id) {
          applyToPage(payload.pageId, (page) =>
            page.elements.some((e) => e.id === el.id) ? page : { ...page, elements: [...page.elements, clone(el)] }
          )
        }
        break
      }
      case 'elements:add': {
        const els = (payload.elements as AnyElement[]) ?? []
        if (els.length) {
          applyToPage(payload.pageId, (page) => {
            const known = new Set(page.elements.map((e) => e.id))
            return { ...page, elements: [...page.elements, ...els.filter((e) => !known.has(e.id)).map((e) => clone(e))] }
          })
        }
        break
      }
      case 'element:delete': {
        const ids = new Set((payload.ids as string[]) ?? [])
        applyToPage(payload.pageId, (page) => ({ ...page, elements: page.elements.filter((e) => !ids.has(e.id)) }))
        break
      }
      case 'elements:reorder': {
        const orderedIds = (payload.orderedIds as string[]) ?? []
        applyToPage(payload.pageId, (page) => {
          const byId = new Map(page.elements.map((e) => [e.id, e]))
          const ordered = orderedIds.map((id) => byId.get(id)).filter((e): e is AnyElement => !!e)
          const rest = page.elements.filter((e) => !orderedIds.includes(e.id))
          return { ...page, elements: [...rest, ...ordered] }
        })
        break
      }
      case 'page:add': {
        const page = clone(payload.page as PageData)
        if (page?.id && !next.some((p) => p.id === page.id)) {
          const afterIdx = payload.afterId ? findPage(payload.afterId) : -1
          next.splice(afterIdx >= 0 ? afterIdx + 1 : next.length, 0, page)
        }
        break
      }
      case 'page:delete': {
        if (next.length > 1) {
          const i = findPage(payload.pageId)
          if (i >= 0) next.splice(i, 1)
        }
        break
      }
      case 'page:background': {
        applyToPage(payload.pageId, (page) => ({ ...page, background: clone(payload.background as Background) }))
        break
      }
      case 'page:replace': {
        const page = clone(payload.page as PageData)
        if (page?.id) {
          const i = findPage(page.id)
          if (i >= 0) next[i] = page
          else next.push(page)
        }
        break
      }
      case 'pages:replace': {
        const replaced = clone((payload.pages as PageData[]) ?? [])
        if (replaced.length) {
          const currentPage = Math.min(get().currentPage, replaced.length - 1)
          set({ pages: replaced, currentPage, selectedIds: [], version: version + 1, dirty: true })
          const w = Number(payload.width)
          const h = Number(payload.height)
          if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) set({ width: w, height: h })
          return
        }
        break
      }
      case 'design:rename': {
        const name = String(payload.name ?? '').slice(0, 80)
        if (name) set({ designName: name, dirty: true })
        return
      }
      default:
        return // unknown op — ignore (forward/backward compatibility)
    }

    const currentPage = Math.min(get().currentPage, next.length - 1)
    set({ pages: next, currentPage, version: version + 1, dirty: true })
  },

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
