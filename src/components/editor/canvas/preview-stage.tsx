'use client'

import { useEffect, useRef, useState } from 'react'
import { Layer, Rect, Stage } from 'react-konva'
import type { PageData } from '@/lib/types'
import { gradientProps } from '@/lib/editor-utils'
import { PreviewElements } from './element-node'

interface PreviewStageProps {
  page: PageData
  designWidth: number
  designHeight: number
}

/** Renders one page of a design, scaled to fit its parent box. Non-interactive, clipped to page bounds. */
export default function PreviewStage({ page, designWidth, designHeight }: PreviewStageProps) {
  const containerRef = useRef<HTMLDivElement>(null)
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

  return (
    <div ref={containerRef} className="w-full h-full overflow-hidden">
      {scale > 0 && (
        <Stage width={size.w} height={size.h}>
          <Layer listening={false} x={offsetX} y={offsetY} scale={{ x: scale, y: scale }}>
            <Rect width={designWidth} height={designHeight} {...bgProps} />
          </Layer>
          <Layer
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
