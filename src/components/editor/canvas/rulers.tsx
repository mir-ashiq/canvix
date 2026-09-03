'use client'

import { useEffect, useRef } from 'react'

/**
 * Canva-style rulers: a 22px strip along the top and left edges of the canvas
 * workspace. Drag from a ruler to pull out a manual guide; the small triangles
 * track the pointer position like Canva does.
 */

const RULER_BG = '#17181D'
const RULER_BORDER = 'rgba(255,255,255,0.10)'
const TICK_COLOR = 'rgba(255,255,255,0.38)'
const TICK_MINOR = 'rgba(255,255,255,0.16)'
const LABEL_COLOR = 'rgba(255,255,255,0.55)'
const MARKER_COLOR = '#9954FF'

/** choose a "nice" major-tick step so ticks land 60–140 screen px apart */
function niceStep(targetScreenPx: number): number {
  const raw = Math.max(1, targetScreenPx)
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  for (const m of [1, 2, 5, 10]) {
    if (pow * m >= raw) return pow * m
  }
  return pow * 10
}

interface RulersProps {
  width: number // page width (px)
  height: number // page height (px)
  zoom: number
  pan: { x: number; y: number }
  containerW: number
  containerH: number
  /** ruler drag began — parent runs the guide-creation gesture */
  onGuideStart: (axis: 'x' | 'y', pagePos: number) => void
}

export function Rulers({ width, height, zoom, pan, containerW, containerH, onGuideStart }: RulersProps) {
  const topRef = useRef<HTMLCanvasElement>(null)
  const leftRef = useRef<HTMLCanvasElement>(null)
  const topMarkerRef = useRef<HTMLDivElement>(null)
  const leftMarkerRef = useRef<HTMLDivElement>(null)

  // ── draw the tick ladders ──────────────────────────────────
  useEffect(() => {
    const draw = (
      canvas: HTMLCanvasElement | null,
      size: number,
      horizontal: boolean
    ) => {
      if (!canvas) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const px = Math.round(size * dpr)
      const thick = 22
      if (horizontal) {
        if (canvas.width !== px || canvas.height !== Math.round(thick * dpr)) {
          canvas.width = px
          canvas.height = Math.round(thick * dpr)
        }
      } else if (canvas.width !== Math.round(thick * dpr) || canvas.height !== px) {
        canvas.width = Math.round(thick * dpr)
        canvas.height = px
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, horizontal ? size : thick, horizontal ? thick : size)

      // background
      ctx.fillStyle = RULER_BG
      if (horizontal) ctx.fillRect(0, 0, size, thick)
      else ctx.fillRect(0, 0, thick, size)

      // page-range shading (outside the page the ruler reads slightly darker)
      const pageStart = horizontal ? pan.x : pan.y
      const pageLen = (horizontal ? width : height) * zoom
      ctx.fillStyle = 'rgba(255,255,255,0.03)'
      if (horizontal) {
        ctx.fillRect(0, 0, Math.max(0, pageStart), thick)
        ctx.fillRect(pageStart + pageLen, 0, Math.max(0, size - pageStart - pageLen), thick)
      } else {
        ctx.fillRect(0, 0, thick, Math.max(0, pageStart))
        ctx.fillRect(0, pageStart + pageLen, thick, Math.max(0, size - pageStart - pageLen))
      }

      // border line
      ctx.strokeStyle = RULER_BORDER
      ctx.lineWidth = 1
      ctx.beginPath()
      if (horizontal) {
        ctx.moveTo(0, thick - 0.5)
        ctx.lineTo(size, thick - 0.5)
      } else {
        ctx.moveTo(thick - 0.5, 0)
        ctx.lineTo(thick - 0.5, size)
      }
      ctx.stroke()

      // ticks
      const step = niceStep(72 / zoom)
      const minor = step / 5
      const pageOrigin = horizontal ? pan.x : pan.y
      const first = Math.ceil((-pageOrigin / zoom) / step) * step
      const last = ((size - pageOrigin) / zoom)

      // minor ticks
      ctx.strokeStyle = TICK_MINOR
      ctx.beginPath()
      for (let p = Math.ceil((-pageOrigin / zoom) / minor) * minor; p <= last; p += minor) {
        const s = pageOrigin + p * zoom
        if (horizontal) {
          ctx.moveTo(Math.round(s) + 0.5, thick - 4)
          ctx.lineTo(Math.round(s) + 0.5, thick)
        } else {
          ctx.moveTo(thick - 4, Math.round(s) + 0.5)
          ctx.lineTo(thick, Math.round(s) + 0.5)
        }
      }
      ctx.stroke()

      // major ticks + labels
      ctx.strokeStyle = TICK_COLOR
      ctx.fillStyle = LABEL_COLOR
      ctx.font = '9px Inter, system-ui, sans-serif'
      ctx.textBaseline = 'top'
      ctx.beginPath()
      for (let p = first; p <= last; p += step) {
        const s = pageOrigin + p * zoom
        if (s < -20 || s > size + 20) continue
        if (horizontal) {
          ctx.moveTo(Math.round(s) + 0.5, 6)
          ctx.lineTo(Math.round(s) + 0.5, thick)
        } else {
          ctx.moveTo(6, Math.round(s) + 0.5)
          ctx.lineTo(thick, Math.round(s) + 0.5)
        }
      }
      ctx.stroke()
      for (let p = first; p <= last; p += step) {
        const s = pageOrigin + p * zoom
        if (s < 14 || s > size - 14) continue
        const label = String(Math.round(p))
        if (horizontal) {
          ctx.fillText(label, s + 3, 3)
        } else {
          ctx.save()
          ctx.translate(4, s + 3)
          ctx.fillText(label, 0, 0)
          ctx.restore()
        }
      }
    }

    draw(topRef.current, containerW, true)
    draw(leftRef.current, containerH, false)
  }, [width, height, zoom, pan, containerW, containerH])

  // ── pointer-follow markers (little canva triangles) ─────────
  useEffect(() => {
    const container = topRef.current?.parentElement
    if (!container) return
    const onMove = (e: MouseEvent) => {
      const r = container.getBoundingClientRect()
      const t = topMarkerRef.current
      const l = leftMarkerRef.current
      if (t) {
        t.style.opacity = e.clientX - r.left >= 22 ? '1' : '0'
        t.style.transform = `translateX(${e.clientX - r.left - 5}px)`
      }
      if (l) {
        l.style.opacity = e.clientY - r.top >= 22 ? '1' : '0'
        l.style.transform = `translateY(${e.clientY - r.top - 5}px)`
      }
    }
    const onLeave = () => {
      if (topMarkerRef.current) topMarkerRef.current.style.opacity = '0'
      if (leftMarkerRef.current) leftMarkerRef.current.style.opacity = '0'
    }
    window.addEventListener('mousemove', onMove)
    container.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      container.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  const beginGuide = (axis: 'x' | 'y', e: React.MouseEvent<HTMLCanvasElement>) => {
    const container = (e.currentTarget.parentElement as HTMLElement)?.getBoundingClientRect()
    if (!container) return
    const pagePos =
      axis === 'y'
        ? (e.clientX - container.left - pan.x) / zoom // horizontal guide from the TOP ruler
        : (e.clientY - container.top - pan.y) / zoom // vertical guide from the LEFT ruler
    onGuideStart(axis, pagePos)
  }

  return (
    <div className="absolute inset-0 z-20 pointer-events-none" aria-hidden={false}>
      {/* corner */}
      <div
        className="absolute top-0 left-0 pointer-events-auto"
        style={{ width: 22, height: 22, background: RULER_BG, borderRight: `1px solid ${RULER_BORDER}`, borderBottom: `1px solid ${RULER_BORDER}` }}
      />
      {/* top ruler — pulls horizontal guides */}
      <canvas
        ref={topRef}
        className="absolute top-0 pointer-events-auto cursor-row-resize hidden md:block"
        style={{ left: 22, width: containerW - 22, height: 22 }}
        onMouseDown={(e) => beginGuide('y', e)}
        aria-label="Horizontal ruler — drag to create a guide"
        role="toolbar"
      />
      {/* left ruler — pulls vertical guides */}
      <canvas
        ref={leftRef}
        className="absolute left-0 pointer-events-auto cursor-col-resize hidden md:block"
        style={{ top: 22, width: 22, height: containerH - 22 }}
        onMouseDown={(e) => beginGuide('x', e)}
        aria-label="Vertical ruler — drag to create a guide"
        role="toolbar"
      />
      {/* pointer markers */}
      <div ref={topMarkerRef} className="absolute top-[15px] left-[27px] pointer-events-none transition-opacity" style={{ opacity: 0 }}>
        <div style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: `6px solid ${MARKER_COLOR}` }} />
      </div>
      <div ref={leftMarkerRef} className="absolute top-[27px] left-[15px] pointer-events-none transition-opacity" style={{ opacity: 0 }}>
        <div style={{ width: 0, height: 0, borderTop: '5px solid transparent', borderBottom: '5px solid transparent', borderLeft: `6px solid ${MARKER_COLOR}` }} />
      </div>
    </div>
  )
}
