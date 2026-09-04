'use client'

import { useEffect, useRef, useState } from 'react'
import type Konva from 'konva'
import { Layer, Rect, Stage } from 'react-konva'
import type { PageData } from '@/lib/types'
import { gradientProps } from '@/lib/editor-utils'
import { animateElementAt, pageAnimationDuration } from '@/lib/animations'
import { PreviewElements } from './element-node'

interface PreviewStageProps {
  page: PageData
  designWidth: number
  designHeight: number
  /** v0.5: play element animations (preview mode) */
  animated?: boolean
  /** reset the timeline (bump = restart) */
  playKey?: number
  /** reduce-motion accessibility — jumps to the final state */
  reduceMotion?: boolean
}

/**
 * Renders one page of a design, scaled to fit its parent box. Non-interactive,
 * clipped to page bounds. When `animated`, runs a rAF timeline that applies
 * entry animations to the element nodes (never mutates the document).
 */
export default function PreviewStage({ page, designWidth, designHeight, animated = true, playKey = 0, reduceMotion = false }: PreviewStageProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<Konva.Layer | null>(null)
  const stageRef = useRef<Konva.Stage | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setSize({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const scale = size.w > 0 && size.h > 0 ? Math.min(size.w / designWidth, size.h / designHeight) : 0
  const offsetX = size.w > 0 ? (size.w - designWidth * scale) / 2 : 0
  const offsetY = size.h > 0 ? (size.h - designHeight * scale) / 2 : 0

  const bg = page.background
  const bgProps =
    bg.type === 'gradient'
      ? gradientProps(bg.from, bg.to, bg.angle, designWidth, designHeight)
      : { fill: bg.color }

  // ── v0.5: element animation playback (rAF timeline over Konva nodes) ──
  const hasAnimations = animated && page.elements.some((e) => e.animation && e.animation.kind !== 'none')
  useEffect(() => {
    const layer = layerRef.current
    const stage = stageRef.current
    if (!layer || !stage) return
    if (!hasAnimations || reduceMotion) {
      // static: ensure all nodes are at base state
      resetNodes(layer, page)
      return
    }

    const animatable = page.elements.filter((e) => e.animation && e.animation.kind !== 'none')
    // capture base attrs once per play
    const bases = new Map<string, { x: number; y: number; opacity: number; rotation: number; scaleX: number; scaleY: number; offsetX: number; offsetY: number }>()
    for (const el of animatable) {
      const node = layer.findOne(`#${el.id}`)
      if (!node) continue
      bases.set(el.id, {
        x: node.x(),
        y: node.y(),
        opacity: node.opacity(),
        rotation: node.rotation(),
        scaleX: node.scaleX(),
        scaleY: node.scaleY(),
        offsetX: node.offsetX(),
        offsetY: node.offsetY(),
      })
    }

    const start = performance.now()
    const total = pageAnimationDuration(page) + 0.1
    let raf = 0
    let stopped = false

    const tick = (now: number) => {
      if (stopped) return
      const t = Math.min((now - start) / 1000, total)
      for (const el of animatable) {
        const node = layer.findOne(`#${el.id}`)
        const base = bases.get(el.id)
        if (!node || !base) continue
        const state = animateElementAt(el, t)
        node.opacity(base.opacity * state.opacity)
        node.x(base.x + state.dx)
        node.y(base.y + state.dy)
        // scale relative to the node center (keep the base offset trick)
        node.scaleX(base.scaleX * state.scaleX)
        node.scaleY(base.scaleY * state.scaleY)
        // wipe: approximate as a horizontal scale from the anchor edge
        if (state.reveal < 1) {
          const reveal = Math.max(0.001, state.reveal)
          node.scaleX(base.scaleX * reveal)
          const dir = el.animation?.direction ?? 'left'
          if (dir === 'left') {
            node.offsetX(base.offsetX)
          } else if (dir === 'right') {
            node.offsetX((el as { width: number }).width)
            node.x(base.x + (el as { width: number }).width)
          }
        } else {
          node.offsetX(base.offsetX)
        }
        if (state.rotation) {
          node.rotation(base.rotation + state.rotation)
        }
      }
      layer.batchDraw()
      if (t < total) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      resetNodes(layer, page, bases)
    }
  }, [page, hasAnimations, reduceMotion, playKey, designWidth, designHeight])

  return (
    <div ref={containerRef} className="w-full h-full overflow-hidden" data-testid="preview-stage">
      {scale > 0 && (
        <Stage ref={stageRef} width={size.w} height={size.h}>
          <Layer listening={false} x={offsetX} y={offsetY} scale={{ x: scale, y: scale }}>
            <Rect width={designWidth} height={designHeight} {...bgProps} />
          </Layer>
          <Layer
            ref={layerRef}
            listening={false}
            x={offsetX}
            y={offsetY}
            scale={{ x: scale, y: scale }}
            clip={{ x: 0, y: 0, width: designWidth, height: designHeight }}
          >
            <PreviewElements elements={page.elements} />
          </Layer>
        </Stage>
      )}
    </div>
  )
}

function resetNodes(layer: Konva.Layer, page: PageData, bases?: Map<string, { x: number; y: number; opacity: number; rotation: number; scaleX: number; scaleY: number; offsetX: number; offsetY: number }>) {
  for (const el of page.elements) {
    if (!el.animation || el.animation.kind === 'none') continue
    const node = layer.findOne(`#${el.id}`)
    const base = bases?.get(el.id)
    if (!node) continue
    if (base) {
      node.opacity(base.opacity)
      node.x(base.x)
      node.y(base.y)
      node.rotation(base.rotation)
      node.scaleX(base.scaleX)
      node.scaleY(base.scaleY)
      node.offsetX(base.offsetX)
      node.offsetY(base.offsetY)
    }
  }
  layer.batchDraw()
}
