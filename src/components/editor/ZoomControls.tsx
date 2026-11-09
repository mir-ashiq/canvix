'use client'

import { useState } from 'react'
import { ZoomIn, ZoomOut, Maximize, Check, ChevronsUpDown, Scan, Grid3x3, Magnet } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { canvasBridge } from './canvas/canvas-bridge'
import { cn } from '@/lib/utils'

const PRESETS = [300, 200, 125, 100, 75, 50, 25, 10]

/** canva-style zoom bar: −  [percent ▾]  +  fit — dropdown = 128px listbox, 40px items */
export function ZoomControls() {
  const zoom = useEditorStore((s) => s.zoom)
  const zoomIn = useEditorStore((s) => s.zoomIn)
  const zoomOut = useEditorStore((s) => s.zoomOut)
  const setZoom = useEditorStore((s) => s.setZoom)
  const fitToScreen = useEditorStore((s) => s.fitToScreen)
  // v0.18 (Wave 3): grid overlay + snap-to-grid
  const showGrid = useEditorStore((s) => s.showGrid)
  const setShowGrid = useEditorStore((s) => s.setShowGrid)
  const snapToGrid = useEditorStore((s) => s.snapToGrid)
  const setSnapToGrid = useEditorStore((s) => s.setSnapToGrid)
  const gridSize = useEditorStore((s) => s.gridSize)
  const setGridSize = useEditorStore((s) => s.setGridSize)

  const [open, setOpen] = useState(false)
  const percent = Math.round(zoom * 100)
  const isFit = Math.abs(zoom - 1) < 0.001 || percent === 100

  const applyPreset = (p: number) => {
    setZoom(p / 100)
    setOpen(false)
  }

  const doFill = () => {
    // Fill = zoom page to cover the viewport height
    const vp = useEditorStore.getState().viewport
    const { width, height } = useEditorStore.getState()
    if (vp.height > 50) {
      setZoom(Math.max(0.05, (vp.height - 60) / height))
    } else {
      setZoom(1)
    }
    void width
    setOpen(false)
  }

  return (
    <div className="absolute bottom-3 right-3 z-30 flex items-center gap-0.5 rounded-xl bg-[#1D1F26]/95 backdrop-blur border border-white/10 shadow-xl shadow-black/40 px-1 py-1">
      <button className="h-10 w-10 rounded-xl flex items-center justify-center text-white/75 hover:bg-white/10 hover:text-white" onClick={zoomOut} aria-label="Zoom out" title="Zoom out">
        <ZoomOut size={16} />
      </button>
      <button
        className="h-10 min-w-[64px] px-2 rounded-xl text-[13px] font-semibold text-white/90 hover:bg-white/10 flex items-center justify-center gap-1"
        onClick={() => setOpen(!open)}
        aria-label="Zoom options"
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Zoom options"
      >
        {percent}% <ChevronsUpDown size={11} className="opacity-50" />
      </button>
      <button className="h-10 w-10 rounded-xl flex items-center justify-center text-white/75 hover:bg-white/10 hover:text-white" onClick={zoomIn} aria-label="Zoom in" title="Zoom in">
        <ZoomIn size={16} />
      </button>
      <span className="h-5 w-px bg-white/15 mx-0.5" aria-hidden="true" />
      <button
        className="h-10 w-10 rounded-xl flex items-center justify-center text-white/75 hover:bg-white/10 hover:text-white"
        onClick={() => {
          if (canvasBridge.fitToScreen) canvasBridge.fitToScreen()
          else fitToScreen()
        }}
        aria-label="Fit to screen"
        title="Fit to screen"
      >
        <Maximize size={16} />
      </button>
      {/* v0.18 (Wave 3): grid overlay toggle */}
      <button
        className={cn(
          'h-10 w-10 rounded-xl flex items-center justify-center hover:bg-white/10 hover:text-white',
          showGrid ? 'text-[#02C0CC] bg-white/10' : 'text-white/75'
        )}
        onClick={() => setShowGrid(!showGrid)}
        aria-label="Toggle grid"
        aria-pressed={showGrid}
        title="Grid overlay"
        data-testid="grid-toggle"
      >
        <Grid3x3 size={16} />
      </button>
      {/* v0.18 (Wave 3): snap to grid (visible when grid is on) */}
      {showGrid && (
        <button
          className={cn(
            'h-10 w-10 rounded-xl flex items-center justify-center hover:bg-white/10 hover:text-white',
            snapToGrid ? 'text-[#02C0CC] bg-white/10' : 'text-white/75'
          )}
          onClick={() => setSnapToGrid(!snapToGrid)}
          aria-label="Snap to grid"
          aria-pressed={snapToGrid}
          title="Snap to grid"
          data-testid="snap-toggle"
        >
          <Magnet size={15} />
        </button>
      )}
      {showGrid && (
        <select
          value={gridSize}
          onChange={(e) => setGridSize(Number(e.target.value))}
          className="h-8 rounded-lg bg-black/30 border border-white/10 text-[12px] text-white/80 px-1.5 focus:outline-none focus:border-[#02C0CC]"
          aria-label="Grid size"
          title="Grid size"
          data-testid="grid-size"
        >
          {[10, 20, 40, 80, 120].map((g) => (
            <option key={g} value={g}>
              {g}px
            </option>
          ))}
        </select>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} onContextMenu={(e) => { e.preventDefault(); setOpen(false) }} />
          <div
            className="cv-menu !min-w-[128px] !max-w-[128px] !p-1.5"
            role="listbox"
            aria-label="Zoom level"
            style={{ right: 12, bottom: 56, left: 'auto', top: 'auto' }}
          >
            {PRESETS.map((p) => (
              <button
                key={p}
                role="option"
                aria-selected={percent === p}
                className={cn('cv-menu-item !h-10 !justify-between', percent === p && 'bg-white/[0.08]')}
                onClick={() => applyPreset(p)}
              >
                {p}%
                {percent === p && <Check size={13} className="text-white/80" />}
              </button>
            ))}
            <div className="cv-menu-sep" />
            <button
              role="option"
              aria-selected={isFit}
              className="cv-menu-item !h-10 !justify-between"
              onClick={() => {
          if (canvasBridge.fitToScreen) canvasBridge.fitToScreen()
          else fitToScreen()
          setOpen(false)
        }}
            >
              <span className="flex items-center gap-2"><Scan size={13} /> Fit</span>
              {isFit && <Check size={13} className="text-white/80" />}
            </button>
            <button role="option" aria-selected={false} className="cv-menu-item !h-10" onClick={doFill}>
              Fill
            </button>
          </div>
        </>
      )}
    </div>
  )
}
