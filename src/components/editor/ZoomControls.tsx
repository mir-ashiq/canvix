'use client'

import { ZoomIn, ZoomOut, Maximize } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { canvasBridge } from './canvas/canvas-bridge'

export function ZoomControls() {
  const zoom = useEditorStore((s) => s.zoom)
  const zoomIn = useEditorStore((s) => s.zoomIn)
  const zoomOut = useEditorStore((s) => s.zoomOut)
  const resetZoom = useEditorStore((s) => s.resetZoom)

  const percent = Math.round(zoom * 100)

  return (
    <div className="absolute bottom-3 right-3 z-30 flex items-center gap-0.5 rounded-xl bg-[#1D1F26]/95 backdrop-blur border border-white/10 shadow-xl shadow-black/40 px-1 py-1">
      <button className="h-8 w-8 rounded-lg flex items-center justify-center text-white/75 hover:bg-white/10 hover:text-white" onClick={zoomOut} aria-label="Zoom out" title="Zoom out">
        <ZoomOut size={15} />
      </button>
      <button
        className="h-8 min-w-12 px-1 rounded-lg text-xs font-semibold text-white/85 hover:bg-white/10 hover:text-white"
        onClick={resetZoom}
        aria-label="Reset zoom to 100%"
        title="Reset zoom"
      >
        {percent}%
      </button>
      <button className="h-8 w-8 rounded-lg flex items-center justify-center text-white/75 hover:bg-white/10 hover:text-white" onClick={zoomIn} aria-label="Zoom in" title="Zoom in">
        <ZoomIn size={15} />
      </button>
      <span className="h-5 w-px bg-white/15 mx-0.5" aria-hidden="true" />
      <button
        className="h-8 w-8 rounded-lg flex items-center justify-center text-white/75 hover:bg-white/10 hover:text-white"
        onClick={() => canvasBridge.fitToScreen?.()}
        aria-label="Fit to screen"
        title="Fit to screen"
      >
        <Maximize size={15} />
      </button>
    </div>
  )
}
