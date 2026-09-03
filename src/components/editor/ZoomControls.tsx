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
    <div className="absolute bottom-3 right-3 z-30 flex items-center gap-0.5 rounded-xl bg-white/95 backdrop-blur border border-black/10 shadow-md px-1 py-1">
      <button className="h-8 w-8 rounded-lg flex items-center justify-center text-[#3D3F47] hover:bg-black/[0.06]" onClick={zoomOut} aria-label="Zoom out" title="Zoom out">
        <ZoomOut size={15} />
      </button>
      <button
        className="h-8 min-w-12 px-1 rounded-lg text-xs font-semibold text-[#3D3F47] hover:bg-black/[0.06]"
        onClick={resetZoom}
        aria-label="Reset zoom to 100%"
        title="Reset zoom"
      >
        {percent}%
      </button>
      <button className="h-8 w-8 rounded-lg flex items-center justify-center text-[#3D3F47] hover:bg-black/[0.06]" onClick={zoomIn} aria-label="Zoom in" title="Zoom in">
        <ZoomIn size={15} />
      </button>
      <span className="h-5 w-px bg-black/10 mx-0.5" aria-hidden="true" />
      <button
        className="h-8 w-8 rounded-lg flex items-center justify-center text-[#3D3F47] hover:bg-black/[0.06]"
        onClick={() => canvasBridge.fitToScreen?.()}
        aria-label="Fit to screen"
        title="Fit to screen"
      >
        <Maximize size={15} />
      </button>
    </div>
  )
}
