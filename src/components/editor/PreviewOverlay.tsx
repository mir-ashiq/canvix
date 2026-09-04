'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { ChevronLeft, ChevronRight, Pause, Play, X, VolumeX } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { pageHoldDuration } from '@/lib/animations'

const PreviewStage = dynamic(() => import('./canvas/preview-stage'), { ssr: false })

/** page transition CSS — applied to the outgoing/incoming page wrappers */
function transitionClass(kind: string | undefined, phase: 'in' | 'out', direction: string | undefined): string {
  const dir = direction ?? 'left'
  switch (kind) {
    case 'fade':
      return phase === 'out' ? 'opacity-0' : ''
    case 'slide': {
      if (phase === 'out') {
        return dir === 'left' || dir === 'right'
          ? dir === 'left' ? '-translate-x-full' : 'translate-x-full'
          : dir === 'up' ? '-translate-y-full' : 'translate-y-full'
      }
      return ''
    }
    case 'morph':
      return phase === 'out' ? 'opacity-0 scale-110' : 'scale-95'
    default:
      return ''
  }
}

const TRANSITION_MS = (page: { transition?: { duration?: number } }) =>
  Math.round((page.transition?.duration ?? 0.7) * 1000)

/** Canva-style fullscreen Preview — animated pages, transitions, autoplay. */
export function PreviewOverlay() {
  const open = useEditorStore((s) => s.previewOpen)
  const setOpen = useEditorStore((s) => s.setPreviewOpen)
  const pages = useEditorStore((s) => s.pages)
  const width = useEditorStore((s) => s.width)
  const height = useEditorStore((s) => s.height)
  const [index, setIndex] = useState(0)
  /** previous index during a transition (rendered under the new page) */
  const [outgoing, setOutgoing] = useState<number | null>(null)
  const [autoPlay, setAutoPlay] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)
  const [playKey, setPlayKey] = useState(0)
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // clamp when pages shrink — derived at render, no effect needed
  const safeIndex = Math.max(0, Math.min(index, pages.length - 1))

  const goTo = useCallback(
    (nextIdx: number) => {
      setIndex((current) => {
        const target = Math.max(0, Math.min(nextIdx, pages.length - 1))
        if (target === current) return current
        setPlayKey((k) => k + 1)
        setOutgoing(current)
        return target
      })
    },
    [pages.length]
  )

  const next = useCallback(() => goTo(safeIndex + 1), [goTo, safeIndex])
  const prev = useCallback(() => goTo(safeIndex - 1), [goTo, safeIndex])

  // clear the outgoing page once the transition finishes
  useEffect(() => {
    if (outgoing === null) return
    const t = setTimeout(() => setOutgoing(null), TRANSITION_MS(pages[safeIndex]))
    return () => clearTimeout(t)
  }, [outgoing, safeIndex, pages])

  // keyboard
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

  // autoplay: advance after each page's hold duration
  useEffect(() => {
    if (!open || !autoPlay) return
    const page = pages[safeIndex]
    if (!page) return
    const hold = (reduceMotion ? 0 : 1) * pageHoldDuration(page) * 1000 + TRANSITION_MS(page)
    advanceTimer.current = setTimeout(() => {
      if (safeIndex >= pages.length - 1) {
        // loop back to the first page
        goTo(0)
      } else {
        next()
      }
    }, Math.max(400, hold))
    return () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current)
    }
  }, [open, autoPlay, safeIndex, pages, next, goTo, reduceMotion])

  if (!open) return null
  const page = pages[safeIndex]
  const outgoingPage = outgoing !== null ? pages[outgoing] : null
  const transitionKind = page?.transition?.kind ?? 'none'
  const inClass = transitionClass(transitionKind, 'in', page?.transition?.direction)

  return (
    <div className="fixed inset-0 z-[100] bg-[#0F1015] flex flex-col" role="dialog" aria-label="Design preview">
      <div className="h-14 flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-white/90 px-2">
          Preview <span className="text-white/50 font-normal">— page {safeIndex + 1} of {pages.length}</span>
        </div>
        <div className="flex items-center gap-1">
          {pages.length > 1 && (
            <Button
              variant="ghost"
              size="icon"
              className={cn('rounded-full text-white hover:bg-white/15 hover:text-white', autoPlay && 'bg-white/15')}
              onClick={() => setAutoPlay((v) => !v)}
              aria-label={autoPlay ? 'Pause autoplay' : 'Play presentation'}
              title={autoPlay ? 'Pause' : 'Auto-play'}
            >
              {autoPlay ? <Pause size={17} /> : <Play size={17} />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={cn('rounded-full text-white hover:bg-white/15 hover:text-white', reduceMotion && 'bg-white/15 text-[#02C0CC]')}
            onClick={() => setReduceMotion((v) => !v)}
            aria-label="Toggle reduced motion"
            title="Reduce motion (accessibility)"
          >
            <VolumeX size={17} />
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full text-white hover:bg-white/15 hover:text-white" onClick={() => setOpen(false)} aria-label="Close preview">
            <X size={19} />
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative bg-[#0F1015]">
        <div className="absolute inset-0 p-4 pb-16">
          <div className="relative w-full h-full max-w-[min(100%,calc((100vh-10rem)*var(--ar)))] mx-auto" style={{ ['--ar' as string]: `${width / height}` }}>
            {/* outgoing page (during a transition) */}
            {outgoingPage && (
              <div
                key={`out-${outgoing}-${playKey}`}
                className="absolute inset-0 transition-all ease-in-out"
                style={{ transitionDuration: `${TRANSITION_MS(pages[safeIndex] ?? {})}ms` }}
              >
                <div className={cn('w-full h-full transition-all ease-in-out', transitionClass(transitionKind, 'out', page?.transition?.direction))} style={{ transitionDuration: `${TRANSITION_MS(pages[safeIndex] ?? {})}ms` }}>
                  <PreviewStage page={outgoingPage} designWidth={width} designHeight={height} animated={false} />
                </div>
              </div>
            )}
            {/* current page */}
            {page && (
              <div
                key={`in-${page.id}-${playKey}`}
                className={cn('absolute inset-0 transition-all ease-in-out', inClass)}
                style={{ transitionDuration: `${TRANSITION_MS(page)}ms` }}
              >
                <PreviewStage page={page} designWidth={width} designHeight={height} animated playKey={playKey} reduceMotion={reduceMotion} />
              </div>
            )}
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
              disabled={safeIndex === pages.length - 1 && !autoPlay}
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
              onClick={() => goTo(i)}
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
