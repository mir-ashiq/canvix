'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type Konva from 'konva'
import { Group, Layer, Line, Rect, Stage, Transformer } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useEditorStore, currentPageData } from '@/store/editor-store'
import { gradientProps, computeSnap, clamp, type GuideLine } from '@/lib/editor-utils'
import { canvasBridge } from './canvas-bridge'
import { ElementNode } from './element-node'
import { Rulers } from './rulers'
import type { TextElement } from '@/lib/types'
import { createStrokeElement } from '@/lib/types'
import { CanvasContextMenu, type ContextMenuState } from './context-menu'
import { CollabOverlay } from './CollabOverlay'
import { CommentPins } from './CommentPins'
import { getActiveCollabSession } from '@/hooks/use-collab'
import { tableGeometry } from '@/lib/v06-geometry'
import {
  applyStyleToRange,
  LINK_COLOR,
  normalizeSpans,
  reconcileSpans,
  styleStateInRange,
  type RangeStyleState,
  type SpanStylePatch,
} from '@/lib/rich-text'
import type { TextSpan } from '@/lib/types'
import { Bold, Check, Italic, Link2, Strikethrough, Underline, X } from 'lucide-react'

/** canva-measured tokens */
const GUIDE_COLOR = '#9954FF' // rgb(153,84,255) — measured 2026-09-03
const SELECTION_COLOR = '#7630D7' // rgb(118,48,215) — measured

export default function CanvasStage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage | null>(null)
  const layerRef = useRef<Konva.Layer | null>(null)
  const trRef = useRef<Konva.Transformer | null>(null)
  const nodesRef = useRef<Map<string, Konva.Node>>(new Map())

  const pages = useEditorStore((s) => s.pages)
  const currentPage = useEditorStore((s) => s.currentPage)
  const width = useEditorStore((s) => s.width)
  const height = useEditorStore((s) => s.height)
  const zoom = useEditorStore((s) => s.zoom)
  const setZoom = useEditorStore((s) => s.setZoom)
  const setViewport = useEditorStore((s) => s.setViewport)
  const clearSelection = useEditorStore((s) => s.clearSelection)
  const setSelection = useEditorStore((s) => s.setSelection)
  const selectToggle = useEditorStore((s) => s.selectToggle)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const tool = useEditorStore((s) => s.tool)
  const drawColor = useEditorStore((s) => s.drawColor)
  const drawSize = useEditorStore((s) => s.drawSize)
  const editingMode = useEditorStore((s) => s.editingMode)
  // v0.3.1: rulers & manual guides (v0.3.2: per-page)
  const showRulers = useEditorStore((s) => s.showRulers)
  const allGuides = useEditorStore((s) => s.manualGuides)
  const currentPageId = useEditorStore((s) => s.pages[s.currentPage]?.id)
  const manualGuides = useMemo(
    () => allGuides.filter((g) => g.pageId === currentPageId),
    [allGuides, currentPageId]
  )
  const addManualGuide = useEditorStore((s) => s.addManualGuide)
  const moveManualGuide = useEditorStore((s) => s.moveManualGuide)
  const removeManualGuide = useEditorStore((s) => s.removeManualGuide)
  // v0.5: collaboration
  const collaborators = useEditorStore((s) => s.collaborators)
  // v0.5: comments mode
  const commentsOpen = useEditorStore((s) => s.commentsOpen)

  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [guides, setGuides] = useState<GuideLine[]>([])
  /** v0.7: mirror of `guides` for cheap equality checks during drag */
  const guidesRef = useRef<GuideLine[]>([])
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  /** v0.6: table cell being edited via the overlay ({ id, row, col }) */
  const [editingCell, setEditingCell] = useState<{ id: string; row: number; col: number } | null>(null)
  const [editValue, setEditValue] = useState('')
  /** v0.15 (R1): rich text — spans for the element being edited (null = flat) */
  const [editSpans, setEditSpans] = useState<TextSpan[] | null>(null)
  /** toolbar chip state for the CURRENT textarea selection */
  const [selState, setSelState] = useState<RangeStyleState | null>(null)
  /** true while the textarea has a NON-collapsed selection (drives the
   *  toolbar buttons' disabled state) */
  const [hasSelRange, setHasSelRange] = useState(false)
  /** link popover */
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkDraft, setLinkDraft] = useState('')
  /** live mirror of {value, spans} — the onChange diff needs the PREVIOUS
   *  value synchronously, and commit must read the freshest spans */
  const textEditRef = useRef<{ value: string; spans: TextSpan[] | null }>({ value: '', spans: null })
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
  /** freehand draft: [x0,y0,x1,y1,…] in page coords */
  const [draft, setDraft] = useState<number[] | null>(null)
  /** marquee draft in PAGE coords */
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null)
  /** v0.3.1: guide being pulled out of a ruler (page coords) */
  const [draftGuide, setDraftGuide] = useState<{ axis: 'x' | 'y'; position: number } | null>(null)
  const drawingRef = useRef(false)
  const marqueeRef = useRef(false)
  /** v0.11.7 (F5): latest marquee rect for the window-level gesture
   * listeners — lets mouseup select OUTSIDE any setState updater.
   * (Store writes inside updaters run during render and trigger React's
   * "Cannot update a component while rendering a different component".) */
  const marqueeShapeRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const spaceRef = useRef(false)

  const interactive = editingMode === 'editing' && tool === 'select' && !commentsOpen

  const userZoomedRef = useRef(false)
  const prevZoomRef = useRef(zoom)
  const prevPanRef = useRef(pan)
  const panGestureRef = useRef<{ active: boolean; startX: number; startY: number; baseX: number; baseY: number } | null>(null)
  const pinchRef = useRef<{ dist: number; zoom: number; mid: { x: number; y: number }; pan: { x: number; y: number } } | null>(null)

  const page = currentPageData({ pages, currentPage })

  // ── container size ─────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setContainerSize({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // report viewport size to the store (zoom menu "Fit")
  useEffect(() => {
    setViewport({ width: containerSize.w, height: containerSize.h })
  }, [containerSize, setViewport])

  // ── space key tracking (space+drag = pan) ──────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
        spaceRef.current = true
        containerRef.current?.style.setProperty('cursor', 'grab')
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceRef.current = false
        if (!panGestureRef.current?.active) containerRef.current?.style.setProperty('cursor', 'default')
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // ── fit to screen ──────────────────────────────────────────
  const fitToScreen = useCallback(() => {
    if (containerSize.w < 50 || containerSize.h < 50) return
    const pad = showRulers ? 128 : 100
    const z = Math.min((containerSize.w - pad) / width, (containerSize.h - pad) / height, 1.5)
    const clamped = Math.max(0.05, z)
    setZoom(clamped)
    prevZoomRef.current = clamped
    const centered = {
      x: (containerSize.w - width * clamped) / 2,
      y: (containerSize.h - height * clamped) / 2,
    }
    prevPanRef.current = centered
    setPan(centered)
    userZoomedRef.current = false
  }, [containerSize, width, height, setZoom, showRulers])

  // fit on mount & on design size change & on resize (if user hasn't zoomed)
  useEffect(() => {
    if (containerSize.w < 50) return
    if (userZoomedRef.current) return
    const raf = requestAnimationFrame(() => fitToScreen())
    return () => cancelAnimationFrame(raf)
  }, [containerSize.w, containerSize.h, width, height, fitToScreen])

  // ── bridge registration ────────────────────────────────────
  useEffect(() => {
    canvasBridge.stage = stageRef.current
    canvasBridge.layer = layerRef.current
    canvasBridge.pageWidth = width
    canvasBridge.pageHeight = height
    canvasBridge.fitToScreen = fitToScreen
    return () => {
      canvasBridge.stage = null
      canvasBridge.layer = null
      canvasBridge.fitToScreen = null
    }
  }, [width, height, fitToScreen])

  // keep bridge pan/zoom fresh
  useEffect(() => {
    canvasBridge.zoom = zoom
    canvasBridge.pan = pan
  }, [zoom, pan])

  // ── zoom change anchoring (buttons / keyboard) ─────────────
  useEffect(() => {
    const prevZoom = prevZoomRef.current
    const prevPan = prevPanRef.current
    prevZoomRef.current = zoom
    prevPanRef.current = pan
    if (prevZoom === zoom) return
    if (containerSize.w < 50) return
    // keep the page point under the viewport center stationary
    const cx = containerSize.w / 2
    const cy = containerSize.h / 2
    const pagePt = { x: (cx - prevPan.x) / prevZoom, y: (cy - prevPan.y) / prevZoom }
    const next = { x: cx - pagePt.x * zoom, y: cy - pagePt.y * zoom }
    setPan(next)
    canvasBridge.pan = next
  }, [zoom])

  // ── transformer sync ───────────────────────────────────────
  const refreshTransformer = useCallback(() => {
    const tr = trRef.current
    if (!tr) return
    const nodes = selectedIds.map((id) => nodesRef.current.get(id)).filter((n): n is Konva.Node => !!n)
    const unlocked = nodes.filter((n) => {
      const el = page.elements.find((e) => e.id === n.id())
      return el ? !el.locked : true
    })
    tr.nodes(unlocked)
    tr.getLayer()?.batchDraw()
  }, [selectedIds, page])

  useEffect(() => {
    refreshTransformer()
    canvasBridge.refreshTransformer = refreshTransformer
    return () => {
      canvasBridge.refreshTransformer = null
    }
  }, [refreshTransformer])

  // ── node registry ──────────────────────────────────────────
  const registerNode = useCallback((id: string, node: Konva.Node | null) => {
    if (node) nodesRef.current.set(id, node)
    else nodesRef.current.delete(id)
  }, [])

  // ── snapping during element drag ───────────────────────────
  const handleDragMoveNode = useCallback((id: string, node: Konva.Node) => {
    const state = useEditorStore.getState()
    const p = currentPageData(state)
    const el = p.elements.find((e) => e.id === id)
    if (!el) return
    const rect =
      el.type === 'ellipse' || el.type === 'star'
        ? { x: node.x() - el.width / 2, y: node.y() - el.height / 2, width: el.width, height: el.height, rotation: el.rotation }
        : { x: node.x(), y: node.y(), width: el.width, height: el.height, rotation: el.rotation }
    const others = p.elements
      .filter((e) => e.id !== id && e.visible)
      .map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height, rotation: e.rotation }))
    // v0.3.1: manual guides act as snap targets (zero-size virtual edges)
    if (state.showRulers) {
      const pageId = p.id
      for (const g of state.manualGuides.filter((gg) => gg.pageId === pageId)) {
        others.push(
          g.axis === 'x'
            ? { x: g.position, y: 0, width: 0, height: 0, rotation: 0 }
            : { x: 0, y: g.position, width: 0, height: 0, rotation: 0 }
        )
      }
    }
    const { dx, dy, guides: g } = computeSnap(rect, others, { width: state.width, height: state.height })
    if (dx !== 0 || dy !== 0) {
      node.x(node.x() + dx)
      node.y(node.y() + dy)
    }
    // v0.7: only re-render when the visible guides actually changed — a new
    // array with identical values used to re-render the whole canvas per frame.
    const prev = guidesRef.current
    const same =
      prev.length === g.length &&
      prev.every((pg, i) => pg.axis === g[i].axis && pg.position === g[i].position)
    if (!same) {
      guidesRef.current = g
      setGuides(g)
    }
  }, [])

  // v0.7: stable callback passed to the memoized ElementNodes — an inline
  // closure here would defeat React.memo on every canvas re-render.
  const handleDragEndNode = useCallback(() => {
    guidesRef.current = []
    setGuides([])
  }, [])

  // ── text editing ───────────────────────────────────────────
  const startEditText = useCallback((id: string, cell?: { row: number; col: number }) => {
    const state = useEditorStore.getState()
    const p = currentPageData(state)
    const el = p.elements.find((e) => e.id === id)
    if (!el || el.locked) return
    if (cell && el.type === 'table') {
      // v0.6: table cell editing
      state.pushHistory()
      setEditingCell({ id, row: cell.row, col: cell.col })
      const tb = el as import('@/lib/types').TableElement
      setEditValue(tb.cells[cell.row * tb.cols + cell.col]?.text ?? '')
      return
    }
    if (el.type !== 'text') return
    // if the text lives inside a group, edit via double-click is disabled for simplicity
    state.pushHistory()
    setEditingTextId(id)
    const startText = (el as TextElement).text
    const startSpans = normalizeSpans((el as TextElement).spans ?? null, startText)
    setEditValue(startText)
    setEditSpans(startSpans)
    textEditRef.current = { value: startText, spans: startSpans }
    setSelState(null)
    setHasSelRange(false)
    setLinkOpen(false)
  }, [])

  const commitEditText = useCallback(async () => {
    const cellRef = editingCell
    const id = editingTextId
    const text = editValue
    if (cellRef) {
      const { id: tid, row, col } = cellRef
      setEditingCell(null)
      const state = useEditorStore.getState()
      const p = currentPageData(state)
      const el = p.elements.find((e) => e.id === tid) as import('@/lib/types').TableElement | undefined
      if (el && el.type === 'table') {
        const cells = el.cells.map((c, i) => (i === row * el.cols + col ? { ...c, text } : c))
        state.updateElementsLive([tid], { cells })
      }
      return
    }
    if (!id) return
    setEditingTextId(null)
    setEditSpans(null)
    setSelState(null)
    setHasSelRange(false)
    setLinkOpen(false)
    const final = textEditRef.current
    useEditorStore.getState().updateElementsLive([id], { text: final.value, spans: final.spans })
    // sync measured height after the Konva text re-renders
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const node = nodesRef.current.get(id)
        if (node) {
          useEditorStore.getState().updateElementsLive([id], { height: node.height() })
        }
      })
    )
  }, [editingTextId, editingCell, editValue])

  // ── v0.5: local cursor broadcast (throttled inside the session) ─
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return
      const px = (e.clientX - rect.left - pan.x) / zoom
      const py = (e.clientY - rect.top - pan.y) / zoom
      if (!Number.isFinite(px) || !Number.isFinite(py)) return
      const session = getActiveCollabSession()
      session?.sendCursor({
        page: useEditorStore.getState().currentPage,
        x: Math.max(-500, Math.min(px, 100000)),
        y: Math.max(-500, Math.min(py, 100000)),
        selection: useEditorStore.getState().selectedIds.slice(0, 50),
      })
    }
    container.addEventListener('mousemove', onMove)
    return () => container.removeEventListener('mousemove', onMove)
  }, [pan, zoom])

  // ── empty-area pan (space+drag / middle-mouse / touch) ─────
  const beginPan = (clientX: number, clientY: number) => {
    panGestureRef.current = { active: true, startX: clientX, startY: clientY, baseX: pan.x, baseY: pan.y }
    containerRef.current?.style.setProperty('cursor', 'grabbing')
  }
  const movePan = (clientX: number, clientY: number) => {
    const g = panGestureRef.current
    if (!g?.active) return
    const next = { x: g.baseX + (clientX - g.startX), y: g.baseY + (clientY - g.startY) }
    setPan(next)
    canvasBridge.pan = next
  }
  const endPan = () => {
    panGestureRef.current = null
    containerRef.current?.style.setProperty('cursor', 'default')
  }

  // ── marquee helpers (page coords) ──────────────────────────
  const pagePoint = (clientX: number, clientY: number) => {
    const container = containerRef.current?.getBoundingClientRect()
    if (!container) return null
    return {
      x: (clientX - container.left - pan.x) / zoom,
      y: (clientY - container.top - pan.y) / zoom,
    }
  }

  const selectInMarquee = (a: { x0: number; y0: number; x1: number; y1: number }) => {
    const x = Math.min(a.x0, a.x1), y = Math.min(a.y0, a.y1)
    const w = Math.abs(a.x1 - a.x0), h = Math.abs(a.y1 - a.y0)
    if (w < 4 && h < 4) {
      // v0.11.7 (F1): a bare click on empty canvas deselects — Canva parity.
      // (Touches already did this in handleStageTouchStart; Escape always could.)
      clearSelection()
      return
    }
    const hits = page.elements
      .filter((e) => e.visible && !e.locked)
      .filter((e) => e.x < x + w && e.x + e.width > x && e.y < y + h && e.y + e.height > y)
      .map((e) => e.id)
    if (hits.length) setSelection(hits)
    else clearSelection()
  }

  // ── v0.3.1: pull a guide out of a ruler ──────────────────
  const guideDragging = draftGuide !== null
  useEffect(() => {
    if (!guideDragging) return
    // v0.11.7 (F5): the guide's axis is fixed for the whole drag; the
    // position is tracked locally so mouseup can commit the guide at EVENT
    // time — outside any setState updater (updaters run during render).
    const axis = draftGuide?.axis ?? 'x'
    let position = draftGuide?.position ?? 0
    const onMove = (e: MouseEvent) => {
      const pt = pagePoint(e.clientX, e.clientY)
      if (!pt) return
      position = axis === 'x' ? pt.x : pt.y
      setDraftGuide((d) => (d ? { ...d, position } : d))
    }
    const onUp = () => {
      setDraftGuide(null)
      const limit = axis === 'x' ? width : height
      if (position > -30 && position < limit + 30) addManualGuide(axis, position)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDraftGuide(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [guideDragging, pan, zoom, width, height, addManualGuide])

  const beginGuideFromRuler = (axis: 'x' | 'y', pagePos: number) => {
    if (editingMode !== 'editing' || tool === 'draw') return
    clearSelection()
    setDraftGuide({ axis, position: pagePos })
  }

  /** commit / delete a manually-dragged guide line */
  const commitGuideDrag = (g: { id: string; axis: 'x' | 'y'; position: number }, node: Konva.Node) => {
    if (g.axis === 'x') {
      const nx = node.x()
      node.x(g.position) // restore; state drives the final position
      if (nx < -40 || nx > width + 40) removeManualGuide(g.id)
      else moveManualGuide(g.id, nx)
    } else {
      const ny = node.y()
      node.y(g.position)
      if (ny < -40 || ny > height + 40) removeManualGuide(g.id)
      else moveManualGuide(g.id, ny)
    }
  }

  const handleStageMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    if (editingMode !== 'editing') return
    // v0.5: comments mode — clicking the canvas drops a comment pin
    // (clicking an element anchors the pin to that element — canva behaviour)
    if (commentsOpen) {
      if (e.evt.button === 0) {
        const pt = pagePoint(e.evt.clientX, e.evt.clientY)
        if (pt) {
          // resolve the top-level element under the click (walk up from the target)
          let elementId: string | null = null
          let node: Konva.Node | null = e.target
          while (node && node.parent && node.parent !== layerRef.current) node = node.parent
          if (node && node !== stageRef.current && node.id()) elementId = node.id()
          window.dispatchEvent(new CustomEvent('canvix:comment-drop', { detail: { ...pt, elementId } }))
        }
      }
      return
    }
    if (tool === 'draw') {
      const stage = stageRef.current
      const pointer = stage?.getPointerPosition()
      if (!pointer) return
      const px = (pointer.x - pan.x) / zoom
      const py = (pointer.y - pan.y) / zoom
      drawingRef.current = true
      setDraft([px, py, px, py])
      return
    }
    const target = e.target
    const onEmpty = target === e.target.getStage() || target.name() === 'page-bg'
    if (!onEmpty) return

    const middleButton = e.evt.button === 1
    if (middleButton || spaceRef.current) {
      clearSelection()
      beginPan(e.evt.clientX, e.evt.clientY)
      e.evt.preventDefault()
      return
    }

    if (e.evt.button === 0) {
      // left button on empty area → marquee selection (canva behaviour)
      const pt = pagePoint(e.evt.clientX, e.evt.clientY)
      if (!pt) return
      marqueeRef.current = true
      const m = { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y }
      marqueeShapeRef.current = m
      setMarquee(m)
    }
  }

  const handleStageTouchStart = (e: KonvaEventObject<TouchEvent>) => {
    if (editingMode !== 'editing' || tool === 'draw') return
    if (e.evt.touches.length === 2) {
      const [a, b] = [e.evt.touches[0], e.evt.touches[1]]
      const container = containerRef.current?.getBoundingClientRect()
      if (!container) return
      pinchRef.current = {
        dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        zoom,
        mid: { x: (a.clientX + b.clientX) / 2 - container.left, y: (a.clientY + b.clientY) / 2 - container.top },
        pan,
      }
      panGestureRef.current = null
      return
    }
    const target = e.target
    if (target === e.target.getStage() || target.name() === 'page-bg') {
      clearSelection()
      if (e.evt.touches[0]) beginPan(e.evt.touches[0].clientX, e.evt.touches[0].clientY)
    }
  }

  // window-level gesture listeners (pan + pinch + marquee)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (marqueeRef.current) {
        const pt = pagePoint(e.clientX, e.clientY)
        if (pt) {
          const prev = marqueeShapeRef.current
          if (prev) {
            const next = { ...prev, x1: pt.x, y1: pt.y }
            marqueeShapeRef.current = next
            setMarquee(next)
          }
        }
        return
      }
      movePan(e.clientX, e.clientY)
    }
    const onUp = () => {
      if (marqueeRef.current) {
        marqueeRef.current = false
        // v0.11.7 (F5): select at event time, NOT inside the setMarquee
        // updater — updaters run during render, and the store write would
        // re-render other components mid-render (the F5 warning)
        const m = marqueeShapeRef.current
        marqueeShapeRef.current = null
        setMarquee(null)
        if (m) selectInMarquee(m)
        return
      }
      endPan()
    }
    const onTouchMove = (e: TouchEvent) => {
      const pinch = pinchRef.current
      if (pinch && e.touches.length === 2) {
        const [a, b] = [e.touches[0], e.touches[1]]
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
        const container = containerRef.current?.getBoundingClientRect()
        if (!container || pinch.dist <= 0) return
        const factor = dist / pinch.dist
        const nextZoom = clamp(pinch.zoom * factor, 0.05, 8)
        const pagePt = { x: (pinch.mid.x - pinch.pan.x) / pinch.zoom, y: (pinch.mid.y - pinch.pan.y) / pinch.zoom }
        const nextPan = { x: pinch.mid.x - pagePt.x * nextZoom, y: pinch.mid.y - pagePt.y * nextZoom }
        userZoomedRef.current = true
        prevZoomRef.current = nextZoom
        prevPanRef.current = nextPan
        setZoom(nextZoom)
        setPan(nextPan)
        if (e.cancelable) e.preventDefault()
        return
      }
      if (e.touches.length === 1) {
        movePan(e.touches[0].clientX, e.touches[0].clientY)
      }
    }
    const onTouchEnd = (e: TouchEvent) => {
      if (pinchRef.current && e.touches.length < 2) pinchRef.current = null
      if (e.touches.length === 0) endPan()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd)
    window.addEventListener('touchcancel', onTouchEnd)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [pan, zoom, page])

  // ── right-click context menu ───────────────────────────────
  const handleContextMenu = (e: KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault()
    if (editingMode !== 'editing') return
    const target = e.target
    const isElement = target.name() === 'cv-element'
    if (isElement) {
      const id = target.id()
      if (id && !selectedIds.includes(id)) setSelection([id])
      setCtxMenu({ x: e.evt.clientX, y: e.evt.clientY, kind: 'element' })
    } else {
      clearSelection()
      setCtxMenu({ x: e.evt.clientX, y: e.evt.clientY, kind: 'page' })
    }
  }

  // ── wheel: ctrl/cmd = zoom, plain = pan ────────────────────
  const handleWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return
    if (e.evt.ctrlKey || e.evt.metaKey) {
      const pointer = stage.getPointerPosition()
      if (!pointer) return
      const factor = e.evt.deltaY > 0 ? 0.95 : 1.05
      const nextZoom = clamp(zoom * factor, 0.05, 8)
      const pagePt = { x: (pointer.x - pan.x) / zoom, y: (pointer.y - pan.y) / zoom }
      const nextPan = { x: pointer.x - pagePt.x * nextZoom, y: pointer.y - pagePt.y * nextZoom }
      userZoomedRef.current = true
      prevZoomRef.current = nextZoom
      prevPanRef.current = nextPan
      setZoom(nextZoom)
      setPan(nextPan)
    } else {
      const nextPan = { x: pan.x - e.evt.deltaX, y: pan.y - e.evt.deltaY }
      userZoomedRef.current = true
      prevPanRef.current = nextPan
      setPan(nextPan)
    }
  }

  // ── freehand drawing (window-level so strokes continue off-element) ────
  useEffect(() => {
    if (!drawingRef.current && draft === null) return
    // v0.11.7 (F5): local mirror of the stroke-so-far — mouseup commits the
    // element from it at event time, OUTSIDE the setDraft updater (updaters
    // run during render; the store write re-rendered other components
    // mid-render → "Cannot update a component while rendering …").
    let points = draft
    const onMove = (e: MouseEvent) => {
      if (!drawingRef.current) return
      const stage = stageRef.current
      const container = containerRef.current?.getBoundingClientRect()
      if (!stage || !container) return
      const px = (e.clientX - container.left - pan.x) / zoom
      const py = (e.clientY - container.top - pan.y) / zoom
      points = points ? [...points, px, py] : [px, py, px, py]
      setDraft(points)
    }
    const commit = () => {
      if (!drawingRef.current) return
      drawingRef.current = false
      const d = points
      setDraft(null)
      if (d && d.length >= 6) {
        const minX = Math.min(...d.filter((_, i) => i % 2 === 0))
        const minY = Math.min(...d.filter((_, i) => i % 2 === 1))
        const rel = d.map((v, i) => (i % 2 === 0 ? v - minX : v - minY))
        useEditorStore.getState().addElement(
          createStrokeElement({
            x: Math.round(minX),
            y: Math.round(minY),
            points: rel.map((v) => Math.round(v)),
            stroke: drawColor,
            strokeWidth: drawSize,
          })
        )
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', commit)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', commit)
    }
  }, [draft, pan, zoom, drawColor, drawSize])

  // ── render ─────────────────────────────────────────────────
  const bg = page.background
  const bgProps =
    bg.type === 'gradient' ? gradientProps(bg.from, bg.to, bg.angle, width, height) : { fill: bg.color }

  const editingText = editingTextId ? (page.elements.find((e) => e.id === editingTextId) as TextElement | undefined) : undefined

  /** v0.15 (R1): apply a rich-text style patch to the CURRENT textarea
   *  selection (one live element patch — the editing session already owns
   *  a single history entry from beginEditText, so undo stays one step). */
  const applyRichStyle = useCallback(
    (patch: SpanStylePatch) => {
      const ta = textAreaRef.current
      if (!ta || !editingTextId) return
      const start = ta.selectionStart
      const end = ta.selectionEnd
      if (start === end) return
      const cur = textEditRef.current
      const next = applyStyleToRange(cur.spans, cur.value, start, end, patch)
      textEditRef.current = { value: cur.value, spans: next }
      setEditSpans(next)
      useEditorStore.getState().updateElementsLive([editingTextId], { spans: next })
      setSelState(styleStateInRange(next, cur.value, start, end))
      setHasSelRange(start !== end)
    },
    [editingTextId],
  )

  // v0.6: table cell overlay geometry
  const editingTable = editingCell ? (page.elements.find((e) => e.id === editingCell.id) as import('@/lib/types').TableElement | undefined) : undefined
  const cellStyle: React.CSSProperties | null = editingTable && editingCell
    ? (() => {
        const geo = tableGeometry(editingTable)
        const cell = editingTable.cells[editingCell.row * editingTable.cols + editingCell.col]
        const isHeader = editingCell.row === 0
        return {
          left: pan.x + (editingTable.x + geo.colX[editingCell.col]) * zoom,
          top: pan.y + (editingTable.y + editingCell.row * geo.rowH) * zoom,
          width: Math.max(24, (geo.colW[editingCell.col] - 20) * zoom),
          height: geo.rowH * zoom,
          transform: `rotate(${editingTable.rotation}deg)`,
          fontSize: editingTable.fontSize * zoom,
          fontFamily: editingTable.fontFamily,
          fontWeight: cell?.bold || isHeader ? 700 : 400,
          color: isHeader ? (editingTable.headerTextColor ?? '#FFFFFF') : editingTable.textColor,
          background: (cell?.fill ?? (isHeader ? editingTable.headerFill : editingTable.fill)) === 'transparent' ? 'rgba(255,255,255,0.06)' : (cell?.fill ?? (isHeader ? editingTable.headerFill : '#FFFFFF')),
          textAlign: 'left' as const,
          lineHeight: 1.2,
          padding: '0 10px',
          borderRadius: 4,
        }
      })()
    : null

  const textareaStyle: React.CSSProperties | null = editingText
    ? {
        left: pan.x + editingText.x * zoom,
        top: pan.y + editingText.y * zoom,
        width: editingText.width * zoom,
        minHeight: Math.max(24, editingText.fontSize * editingText.lineHeight * zoom),
        transform: `rotate(${editingText.rotation}deg)`,
        fontSize: editingText.fontSize * zoom,
        fontFamily: editingText.fontFamily,
        fontWeight: editingText.bold ? 700 : 400,
        fontStyle: editingText.italic ? 'italic' : 'normal',
        textDecoration:
          [editingText.underline ? 'underline' : '', editingText.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none',
        lineHeight: `${editingText.lineHeight}`,
        letterSpacing: `${editingText.letterSpacing * zoom}px`,
        color: editingText.fill,
        textAlign: editingText.align === 'justify' ? 'left' : editingText.align,
      }
    : null

  /** canva-style circle anchors on the transformer */
  const anchorStyleFunc = useCallback((anchor: Konva.Shape) => {
    const a = anchor as Konva.Rect
    a.cornerRadius(a.width() / 2)
    a.strokeWidth(0)
  }, [])

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden"
      style={{ touchAction: 'none', cursor: tool === 'draw' && editingMode === 'editing' ? 'crosshair' : editingMode === 'viewing' ? 'default' : undefined }}
    >
      {containerSize.w > 0 && (
        <Stage
          ref={stageRef}
          width={containerSize.w}
          height={containerSize.h}
          onMouseDown={handleStageMouseDown}
          onTouchStart={handleStageTouchStart}
          onContextMenu={handleContextMenu}
          onWheel={handleWheel}
        >
          <Layer ref={layerRef}>
            <Rect x={pan.x} y={pan.y} width={width * zoom} height={height * zoom} {...bgProps} name="page-bg" />
            <Group x={pan.x} y={pan.y} scaleX={zoom} scaleY={zoom}>
              {page.elements.map((el) => (
                <ElementNode
                  key={el.id}
                  element={el}
                  interactive={interactive}
                  registerNode={registerNode}
                  onDragMoveNode={handleDragMoveNode}
                  onDragEndNode={handleDragEndNode}
                  onDoubleClick={startEditText}
                  hiding={editingTextId === el.id}
                  hideCell={editingCell && editingCell.id === el.id ? { row: editingCell.row, col: editingCell.col } : null}
                />
              ))}
            </Group>
          </Layer>
          {/* v0.7 rendering performance: interaction chrome lives in its own
              layer (its own <canvas>) — guide/marquee/transformer updates no
              longer re-draw the content layer, and vice versa. */}
          <Layer>
            <Group x={pan.x} y={pan.y} scaleX={zoom} scaleY={zoom}>
              <Transformer
                ref={trRef}
                keepRatio
                rotateEnabled
                flipEnabled={false}
                boundBoxFunc={(oldBox, newBox) => (newBox.width < 8 || newBox.height < 8 ? oldBox : newBox)}
                // canva-measured selection chrome: #7630D7 2px border + white circle handles
                borderStroke={SELECTION_COLOR}
                borderStrokeWidth={2 / zoom}
                borderDash={undefined}
                anchorStroke={SELECTION_COLOR}
                anchorFill="#FFFFFF"
                anchorSize={10 / zoom}
                anchorCornerRadius={5 / zoom}
                anchorStyleFunc={anchorStyleFunc}
                anchorStrokeWidth={0}
                rotateAnchorOffset={26 / zoom}
                rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
                rotationSnapTolerance={4}
                padding={2 / zoom}
                useSingleNodeRotation
              />
              {/* snapping guides — canva #9954FF 2px */}
              {guides.map((g, i) =>
                g.axis === 'x' ? (
                  <Rect key={i} x={g.position} y={0} width={2 / zoom} height={height} fill={GUIDE_COLOR} listening={false} />
                ) : (
                  <Rect key={i} x={0} y={g.position} width={width} height={2 / zoom} fill={GUIDE_COLOR} listening={false} />
                )
              )}
              {/* v0.3.1: manual ruler guides — draggable; double-click or drag off-page to delete */}
              {showRulers && manualGuides.map((g) =>
                g.axis === 'x' ? (
                  <Line
                    key={g.id}
                    x={g.position}
                    y={0}
                    points={[0, -40, 0, height + 40]}
                    stroke={GUIDE_COLOR}
                    strokeWidth={1 / zoom}
                    hitStrokeWidth={10 / zoom}
                    draggable
                    onDragMove={(e) => e.target.y(0)}
                    onDragEnd={(e) => commitGuideDrag(g, e.target)}
                    onDblClick={() => removeManualGuide(g.id)}
                    onDblTap={() => removeManualGuide(g.id)}
                  />
                ) : (
                  <Line
                    key={g.id}
                    x={0}
                    y={g.position}
                    points={[-40, 0, width + 40, 0]}
                    stroke={GUIDE_COLOR}
                    strokeWidth={1 / zoom}
                    hitStrokeWidth={10 / zoom}
                    draggable
                    onDragMove={(e) => e.target.x(0)}
                    onDragEnd={(e) => commitGuideDrag(g, e.target)}
                    onDblClick={() => removeManualGuide(g.id)}
                    onDblTap={() => removeManualGuide(g.id)}
                  />
                )
              )}
              {/* v0.3.1: guide currently being pulled from a ruler */}
              {draftGuide &&
                (draftGuide.axis === 'x' ? (
                  <Line
                    points={[draftGuide.position, -40, draftGuide.position, height + 40]}
                    stroke={GUIDE_COLOR}
                    strokeWidth={1 / zoom}
                    dash={[6 / zoom, 4 / zoom]}
                    opacity={0.85}
                    listening={false}
                  />
                ) : (
                  <Line
                    points={[-40, draftGuide.position, width + 40, draftGuide.position]}
                    stroke={GUIDE_COLOR}
                    strokeWidth={1 / zoom}
                    dash={[6 / zoom, 4 / zoom]}
                    opacity={0.85}
                    listening={false}
                  />
                ))}
              {/* marquee selection rect (canva: #7630D7 border, translucent fill) */}
              {marquee && (
                <Rect
                  x={Math.min(marquee.x0, marquee.x1)}
                  y={Math.min(marquee.y0, marquee.y1)}
                  width={Math.abs(marquee.x1 - marquee.x0)}
                  height={Math.abs(marquee.y1 - marquee.y0)}
                  fill="rgba(118,48,215,0.08)"
                  stroke={SELECTION_COLOR}
                  strokeWidth={1.5 / zoom}
                  dash={[4 / zoom, 3 / zoom]}
                  listening={false}
                />
              )}
              {/* freehand draft */}
              {draft && draft.length >= 4 && (
                <Line
                  points={draft}
                  stroke={drawColor}
                  strokeWidth={drawSize}
                  lineCap="round"
                  lineJoin="round"
                  tension={0.25}
                  listening={false}
                />
              )}
            </Group>
          </Layer>
        </Stage>
      )}

      {/* v0.5: remote collaborator cursors + selections (DOM overlay, never blocks input) */}
      {collaborators.length > 0 && (
        <CollabOverlay collaborators={collaborators} currentPage={currentPage} pan={pan} zoom={zoom} elements={page.elements} />
      )}

      {/* v0.5: comment pins (comments mode) */}
      {commentsOpen && <CommentPins pan={pan} zoom={zoom} />}

      {/* v0.3.1: rulers overlay (desktop) */}
      {showRulers && containerSize.w > 0 && (
        <Rulers
          width={width}
          height={height}
          zoom={zoom}
          pan={pan}
          containerW={containerSize.w}
          containerH={containerSize.h}
          onGuideStart={beginGuideFromRuler}
        />
      )}

      {/* canva-style right-click context menu */}
      {ctxMenu && (
        <CanvasContextMenu
          state={ctxMenu}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* v0.15 (R1): rich-text editing — floating selection toolbar */}
      {editingText && textareaStyle && (editingText.curve ?? 0) === 0 && (
        <div
          className="cv-rich-toolbar"
          role="toolbar"
          aria-label="Rich text formatting"
          data-testid="rich-toolbar"
          style={{
            left: Math.max(8, pan.x + editingText.x * zoom),
            top: Math.max(8, pan.y + editingText.y * zoom - 46),
          }}
          onMouseDown={(e) => {
            // keep the textarea's selection & focus — but never block the
            // native colour picker's own activation
            if (!(e.target as HTMLElement).closest('input')) e.preventDefault()
          }}
        >
          <button className="cv-tbtn" title="Bold" aria-label="Bold selection" data-active={selState?.bold === 'all' ? 'true' : undefined} disabled={!hasSelRange} onClick={() => applyRichStyle({ bold: selState?.bold !== 'all' })}>
            <Bold size={14} />
          </button>
          <button className="cv-tbtn" title="Italic" aria-label="Italic selection" data-active={selState?.italic === 'all' ? 'true' : undefined} disabled={!hasSelRange} onClick={() => applyRichStyle({ italic: selState?.italic !== 'all' })}>
            <Italic size={14} />
          </button>
          <button className="cv-tbtn" title="Underline" aria-label="Underline selection" data-active={selState?.underline === 'all' ? 'true' : undefined} disabled={!hasSelRange} onClick={() => applyRichStyle({ underline: selState?.underline !== 'all' })}>
            <Underline size={14} />
          </button>
          <button className="cv-tbtn" title="Strikethrough" aria-label="Strikethrough selection" data-active={selState?.strike === 'all' ? 'true' : undefined} disabled={!hasSelRange} onClick={() => applyRichStyle({ strike: selState?.strike !== 'all' })}>
            <Strikethrough size={14} />
          </button>
          <label className="cv-tbtn" title="Colour" aria-label="Colour selection" style={{ position: 'relative', overflow: 'hidden' }}>
            <input
              type="color"
              className="cv-rich-color-input"
              aria-label="Rich text colour"
              value={typeof selState?.color === 'string' ? selState.color : '#FFFFFF'}
              onChange={(e) => applyRichStyle({ color: e.target.value })}
            />
          </label>
          <button className="cv-tbtn" title="Link" aria-label="Link selection" data-active={selState?.link ? 'true' : undefined} onClick={() => { setLinkDraft(typeof selState?.link === 'string' ? selState.link : ''); setLinkOpen((o) => !o) }}>
            <Link2 size={14} />
          </button>
          <button className="cv-tbtn" title="Clear styling" aria-label="Clear styling" disabled={!hasSelRange} onClick={() => applyRichStyle({ bold: false, italic: false, underline: false, strike: false, color: null, link: null })}>
            <X size={14} />
          </button>
          {linkOpen && (
            <span className="cv-rich-link-pop" role="dialog" aria-label="Link editor">
              <input
                aria-label="Link URL"
                placeholder="https://…"
                value={linkDraft}
                onChange={(e) => setLinkDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    applyRichStyle({ link: linkDraft })
                    setLinkOpen(false)
                  }
                  e.stopPropagation()
                }}
              />
              <button className="cv-tbtn" title="Apply link" aria-label="Apply link" onClick={() => { applyRichStyle({ link: linkDraft }); setLinkOpen(false) }}>
                <Check size={14} />
              </button>
              <button className="cv-tbtn" title="Remove link" aria-label="Remove link" disabled={selState?.link == null} onClick={() => { applyRichStyle({ link: null }); setLinkOpen(false) }}>
                <X size={14} />
              </button>
            </span>
          )}
        </div>
      )}

      {/* text editing overlay */}
      {editingText && textareaStyle && (
        <>
          {editSpans && (
            <div
              className="cv-rich-mirror"
              aria-hidden="true"
              data-testid="rich-mirror"
              style={{ ...textareaStyle, outline: 'none', color: editingText.fill }}
            >
              {editSpans.map((s, i) => {
                let node: React.ReactNode = s.text
                if (s.bold) node = <strong>{node}</strong>
                if (s.italic) node = <em>{node}</em>
                const color = s.color ?? (s.link ? LINK_COLOR : undefined)
                const decor = [s.underline ? 'underline' : '', s.strike ? 'line-through' : ''].filter(Boolean).join(' ')
                if (color || decor || s.link) {
                  node = (
                    <span style={{ color, textDecoration: decor || (s.link ? 'underline' : undefined) }}>
                      {node}
                    </span>
                  )
                }
                return <span key={i}>{node}</span>
              })}
            </div>
          )}
          <textarea
            ref={textAreaRef}
            className={`cv-textarea-overlay${editSpans ? ' cv-rich-editing' : ''}`}
            style={editSpans ? { ...textareaStyle, color: 'transparent', caretColor: editingText.fill } : textareaStyle}
            value={editValue}
            autoFocus
            onChange={(e) => {
              const v = e.target.value
              const prev = textEditRef.current
              const nextSpans = reconcileSpans(prev.spans, prev.value, v)
              textEditRef.current = { value: v, spans: nextSpans }
              setEditValue(v)
              setEditSpans(nextSpans)
              useEditorStore.getState().updateElementsLive([editingText.id], { text: v, spans: nextSpans })
            }}
            onSelect={(e) => {
              const ta = e.currentTarget
              setHasSelRange(ta.selectionStart !== ta.selectionEnd)
              setSelState(styleStateInRange(textEditRef.current.spans, textEditRef.current.value, ta.selectionStart, ta.selectionEnd))
            }}
            onBlur={(e) => {
              // v0.15 (R1): focus moving INTO the floating toolbar (colour
              // picker, link popover input) is not an editing-session exit
              // — only a blur outside the whole overlay commits
              const related = e.relatedTarget as HTMLElement | null
              if (related && related.closest('.cv-rich-toolbar')) return
              void commitEditText()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                void commitEditText()
              }
              e.stopPropagation()
            }}
            onFocus={(e) => {
              const len = e.target.value.length
              e.target.setSelectionRange(len, len)
            }}
            aria-label="Edit text"
          />
        </>
      )}

      {/* v0.6: table cell editing overlay */}
      {editingTable && editingCell && cellStyle && (
        <textarea
          className="cv-textarea-overlay"
          style={cellStyle}
          value={editValue}
          autoFocus
          onChange={(e) => {
            setEditValue(e.target.value)
            // live-update the cell so the rest of the table reflects typing
            const tb = editingTable
            const { row, col } = editingCell
            const cells = tb.cells.map((c, i) => (i === row * tb.cols + col ? { ...c, text: e.target.value } : c))
            useEditorStore.getState().updateElementsLive([tb.id], { cells })
          }}
          onBlur={() => void commitEditText()}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void commitEditText()
            }
            e.stopPropagation()
          }}
          onFocus={(e) => {
            const len = e.target.value.length
            e.target.setSelectionRange(len, len)
          }}
          aria-label="Edit table cell"
        />
      )}
    </div>
  )
}
