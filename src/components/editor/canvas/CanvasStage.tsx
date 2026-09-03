'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type Konva from 'konva'
import { Group, Layer, Line, Rect, Stage, Transformer } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useEditorStore, currentPageData } from '@/store/editor-store'
import { gradientProps, computeSnap, clamp, type GuideLine } from '@/lib/editor-utils'
import { canvasBridge } from './canvas-bridge'
import { ElementNode } from './element-node'
import type { TextElement } from '@/lib/types'
import { createStrokeElement } from '@/lib/types'

const GUIDE_COLOR = '#FF33AA'

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
  const clearSelection = useEditorStore((s) => s.clearSelection)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const tool = useEditorStore((s) => s.tool)
  const drawColor = useEditorStore((s) => s.drawColor)
  const drawSize = useEditorStore((s) => s.drawSize)
  const editingMode = useEditorStore((s) => s.editingMode)

  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [guides, setGuides] = useState<GuideLine[]>([])
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  /** freehand draft: [x0,y0,x1,y1,…] in page coords */
  const [draft, setDraft] = useState<number[] | null>(null)
  const drawingRef = useRef(false)

  const interactive = editingMode === 'editing' && tool === 'select'

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

  // ── fit to screen ──────────────────────────────────────────
  const fitToScreen = useCallback(() => {
    if (containerSize.w < 50 || containerSize.h < 50) return
    const z = Math.min((containerSize.w - 100) / width, (containerSize.h - 100) / height, 1.5)
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
  }, [containerSize, width, height, setZoom])

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

  // transformer visual scale compensation
  useEffect(() => {
    const tr = trRef.current
    if (!tr) return
    tr.setAttrs({
      anchorSize: 11 / zoom,
      anchorStrokeWidth: 1.5 / zoom,
      anchorCornerRadius: 12 / zoom,
      rotateAnchorOffset: 28 / zoom,
      borderWidth: 1.5 / zoom,
      padding: 5 / zoom,
      anchorStroke: '#00C4CC',
      anchorFill: '#FFFFFF',
      borderStroke: '#00C4CC',
      rotateEnabled: true,
      keepRatio: true,
      flipEnabled: false,
    })
    tr.forceUpdate()
  }, [zoom, selectedIds, pages])

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
    const { dx, dy, guides: g } = computeSnap(rect, others, { width: state.width, height: state.height })
    if (dx !== 0 || dy !== 0) {
      node.x(node.x() + dx)
      node.y(node.y() + dy)
    }
    setGuides(g)
  }, [])

  // ── text editing ───────────────────────────────────────────
  const startEditText = useCallback((id: string) => {
    const state = useEditorStore.getState()
    const p = currentPageData(state)
    const el = p.elements.find((e) => e.id === id)
    if (!el || el.type !== 'text' || el.locked) return
    state.pushHistory()
    setEditingTextId(id)
    setEditValue((el as TextElement).text)
  }, [])

  const commitEditText = useCallback(async () => {
    const id = editingTextId
    if (!id) return
    const text = editValue
    setEditingTextId(null)
    useEditorStore.getState().updateElementsLive([id], { text })
    // sync measured height after the Konva text re-renders
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const node = nodesRef.current.get(id)
        if (node) {
          useEditorStore.getState().updateElementsLive([id], { height: node.height() })
        }
      })
    )
  }, [editingTextId, editValue])

  // ── empty-area pan (mouse + single touch) ──────────────────
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

  const handleStageMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    if (editingMode !== 'editing') return
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
    if (target === e.target.getStage() || target.name() === 'page-bg') {
      clearSelection()
      beginPan(e.evt.clientX, e.evt.clientY)
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

  // window-level gesture listeners (pan + pinch)
  useEffect(() => {
    const onMove = (e: MouseEvent) => movePan(e.clientX, e.clientY)
    const onUp = () => endPan()
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
  }, [pan, zoom])

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
    const onMove = (e: MouseEvent) => {
      if (!drawingRef.current) return
      const stage = stageRef.current
      const container = containerRef.current?.getBoundingClientRect()
      if (!stage || !container) return
      const px = (e.clientX - container.left - pan.x) / zoom
      const py = (e.clientY - container.top - pan.y) / zoom
      setDraft((d) => (d ? [...d, px, py] : [px, py, px, py]))
    }
    const commit = () => {
      if (!drawingRef.current) return
      drawingRef.current = false
      setDraft((d) => {
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
        return null
      })
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
        textAlign: editingText.align,
      }
    : null

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
                  onDragEndNode={() => setGuides([])}
                  onDoubleClick={startEditText}
                  hiding={editingTextId === el.id}
                />
              ))}
              <Transformer
                ref={trRef}
                keepRatio
                boundBoxFunc={(oldBox, newBox) => (newBox.width < 8 || newBox.height < 8 ? oldBox : newBox)}
              />
              {/* snapping guides */}
              {guides.map((g, i) =>
                g.axis === 'x' ? (
                  <Rect key={i} x={g.position} y={0} width={1 / zoom} height={height} fill={GUIDE_COLOR} listening={false} />
                ) : (
                  <Rect key={i} x={0} y={g.position} width={width} height={1 / zoom} fill={GUIDE_COLOR} listening={false} />
                )
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

      {/* text editing overlay */}
      {editingText && textareaStyle && (
        <textarea
          className="cv-textarea-overlay"
          style={textareaStyle}
          value={editValue}
          autoFocus
          onChange={(e) => {
            setEditValue(e.target.value)
            useEditorStore.getState().updateElementsLive([editingText.id], { text: e.target.value })
          }}
          onBlur={() => void commitEditText()}
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
      )}
    </div>
  )
}
