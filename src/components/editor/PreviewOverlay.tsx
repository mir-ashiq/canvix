'use client'

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { ChevronLeft, ChevronRight, X, Play } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const PreviewStage = dynamic(() => import('./canvas/preview-stage'), { ssr: false })

/** Canva-style fullscreen Preview — presents pages, arrow-key navigation. */
export function PreviewOverlay() {
  const open = useEditorStore((s) => s.previewOpen)
  const setOpen = useEditorStore((s) => s.setPreviewOpen)
  const pages = useEditorStore((s) => s.pages)
  const width = useEditorStore((s) => s.width)
  const height = useEditorStore((s) => s.height)
  const [index, setIndex] = useState(0)

  // clamp when pages shrink — derived at render, no effect needed
  const safeIndex = Math.max(0, Math.min(index, pages.length - 1))

  const next = useCallback(() => setIndex((i) => Math.min(i + 1, pages.length - 1)), [pages.length])
  const prev = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next() }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, next, prev, setOpen])

  if (!open) return null
  const page = pages[safeIndex]

  return (
    <div className="fixed inset-0 z-[100] bg-[#0F1015] flex flex-col" role="dialog" aria-label="Design preview">
      <div className="h-14 flex items-center justify-between px-3 shrink-0">
        <span className="text-sm font-semibold text-white/90 px-2">
          Preview <span className="text-white/50 font-normal">— page {safeIndex + 1} of {pages.length}</span>
        </span>
        <Button variant="ghost" size="icon" className="rounded-full text-white hover:bg-white/15 hover:text-white" onClick={() => setOpen(false)} aria-label="Close preview">
          <X size={19} />
        </Button>
      </div>

      <div className="flex-1 min-h-0 relative bg-[#0F1015]">
        <div className="absolute inset-0 p-4 pb-16">
          <div className="w-full h-full max-w-[min(100%,calc((100vh-10rem)*var(--ar)))] mx-auto" style={{ ['--ar' as string]: `${width / height}` }}>
            {page && <PreviewStage page={page} designWidth={width} designHeight={height} />}
          </div>
        </div>

        {pages.length > 1 && (
          <>
            <button
              onClick={prev}
              disabled={safeIndex === 0}
              className={cn('absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-[#16171D]/90 text-white flex items-center justify-center hover:bg-[#7630D7] transition-colors disabled:opacity-30 disabled:hover:bg-[#16171D]/90')}
              aria-label="Previous page"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              onClick={next}
              disabled={safeIndex === pages.length - 1}
              className={cn('absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-[#16171D]/90 text-white flex items-center justify-center hover:bg-[#7630D7] transition-colors disabled:opacity-30 disabled:hover:bg-[#16171D]/90')}
              aria-label="Next page"
            >
              <ChevronRight size={22} />
            </button>
          </>
        )}
      </div>

      {pages.length > 1 && (
        <div className="h-14 flex items-center justify-center gap-2 shrink-0">
          {pages.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              className={cn('h-2 rounded-full transition-all', i === safeIndex ? 'w-7 bg-[#02C0CC]' : 'w-2 bg-white/25 hover:bg-white/50')}
              aria-label={`Go to page ${i + 1}`}
              aria-current={i === index}
            />
          ))}
        </div>
      )}
    </div>
  )
}

void Play
