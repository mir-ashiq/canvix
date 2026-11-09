'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { ChevronLeft, ChevronRight, Maximize2, NotebookPen, Timer, X } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { pageSize } from '@/lib/editor-utils'

const PreviewStage = dynamic(() => import('./canvas/preview-stage'), { ssr: false })

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/**
 * v0.18 (Wave 3) — Canva-style "Present with notes": the current page
 * large, the next page as a thumbnail, speaker notes editable live,
 * and an elapsed timer. Pure presentation chrome — the notes never
 * render on the canvas or in exports (PageData.notes).
 *
 * The outer component only gates on `presentOpen`; the inner one mounts
 * fresh per session so the page index + timer start clean with no
 * reset effects.
 */
export function PresenterOverlay() {
  const open = useEditorStore((s) => s.presentOpen)
  if (!open) return null
  return <PresenterOverlayInner key="presenter" />
}

function PresenterOverlayInner() {
  const setOpen = useEditorStore((s) => s.setPresentOpen)
  const pages = useEditorStore((s) => s.pages)
  const width = useEditorStore((s) => s.width)
  const height = useEditorStore((s) => s.height)
  const readOnly = useEditorStore((s) => s.readOnly)
  const [index, setIndex] = useState(0)
  const [notesOpen, setNotesOpen] = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const [running, setRunning] = useState(true)
  const startedAt = useRef<number>(Date.now())

  const safeIndex = Math.max(0, Math.min(index, pages.length - 1))
  const page = pages[safeIndex]
  const nextPage = pages[safeIndex + 1]
  const { width: pw, height: ph } = useMemo(
    () => pageSize(page, width, height),
    [page, width, height]
  )

  const goTo = useCallback(
    (next: number) => setIndex(Math.max(0, Math.min(next, pages.length - 1))),
    [pages.length]
  )
  const next = useCallback(() => goTo(safeIndex + 1), [goTo, safeIndex])
  const prev = useCallback(() => goTo(safeIndex - 1), [goTo, safeIndex])

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next() }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
      if (e.key.toLowerCase() === 'n') setNotesOpen((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev, setOpen])

  // elapsed timer (pausable — setState lives in the interval callback)
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setElapsed(Date.now() - startedAt.current), 500)
    return () => clearInterval(t)
  }, [running])

  const notes = page?.notes ?? ''
  const onNotesChange = (value: string) => {
    if (readOnly || !page) return
    useEditorStore.getState().setPageNotes(page.id, value)
  }

  return (
    <div className="fixed inset-0 z-[100] bg-[#0B0C10] flex flex-col" role="dialog" aria-label="Presenter view">
      {/* top bar */}
      <div className="h-12 flex items-center justify-between px-3 shrink-0 border-b border-white/10">
        <div className="flex items-center gap-2 text-sm font-semibold text-white/90 px-2">
          <NotebookPen size={15} className="text-[#02C0CC]" />
          Presenter
          <span className="text-white/50 font-normal">
            — page {safeIndex + 1} of {pages.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setRunning((r) => !r)}
            className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs text-white/70 hover:bg-white/10 hover:text-white transition-colors"
            title={running ? 'Pause timer' : 'Resume timer'}
          >
            <Timer size={14} />
            <span className="tabular-nums">{running ? formatElapsed(elapsed) : formatElapsed(elapsed) + ' ⏸'}</span>
          </button>
          <Button
            variant="ghost"
            size="icon"
            className={cn('rounded-full text-white hover:bg-white/15 hover:text-white', notesOpen && 'bg-white/15 text-[#02C0CC]')}
            onClick={() => setNotesOpen((v) => !v)}
            aria-label="Toggle notes"
            title="Notes (N)"
          >
            <NotebookPen size={17} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full text-white hover:bg-white/15 hover:text-white"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen()
              else void document.documentElement.requestFullscreen()
            }}
            aria-label="Fullscreen"
            title="Fullscreen"
          >
            <Maximize2 size={17} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full text-white hover:bg-white/15 hover:text-white"
            onClick={() => setOpen(false)}
            aria-label="Close presenter view"
          >
            <X size={19} />
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* stage */}
        <div className="flex-1 min-w-0 relative p-4">
          <div className="relative w-full h-full max-w-[min(100%,calc((100vh-8rem)*var(--ar)))] mx-auto" style={{ ['--ar' as string]: `${pw / ph}` }}>
            {page && <PreviewStage page={page} designWidth={width} designHeight={height} animated reduceMotion={false} />}
          </div>
          {pages.length > 1 && (
            <>
              <button
                onClick={prev}
                disabled={safeIndex === 0}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-[#16171D]/90 text-white flex items-center justify-center hover:bg-[#7630D7] transition-colors disabled:opacity-30"
                aria-label="Previous page"
              >
                <ChevronLeft size={22} />
              </button>
              <button
                onClick={next}
                disabled={safeIndex === pages.length - 1}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-[#16171D]/90 text-white flex items-center justify-center hover:bg-[#7630D7] transition-colors disabled:opacity-30"
                aria-label="Next page"
              >
                <ChevronRight size={22} />
              </button>
            </>
          )}
        </div>

        {/* notes sidebar */}
        {notesOpen && (
          <aside className="w-[340px] shrink-0 border-l border-white/10 flex flex-col bg-[#0F1015]">
            <div className="px-4 pt-4 pb-2 text-xs font-semibold uppercase tracking-wide text-white/50">
              Speaker notes
            </div>
            <textarea
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              readOnly={readOnly}
              placeholder={readOnly ? 'View-only design — notes are read-only.' : 'Type notes for this page…'}
              data-testid="presenter-notes"
              className="flex-1 min-h-0 resize-none bg-transparent px-4 pb-4 text-sm leading-relaxed text-white/85 placeholder:text-white/30 focus:outline-none"
            />
            {nextPage && (
              <div className="p-3 border-t border-white/10">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-white/45 mb-2">
                  Next up
                </div>
                <button
                  onClick={() => goTo(safeIndex + 1)}
                  className="block w-full rounded-lg overflow-hidden ring-1 ring-white/15 hover:ring-[#02C0CC] transition-all"
                  aria-label="Jump to next page"
                >
                  <div
                    className="relative bg-white"
                    style={{ aspectRatio: `${pageSize(nextPage, width, height).width} / ${pageSize(nextPage, width, height).height}` }}
                  >
                    <PreviewStage page={nextPage} designWidth={width} designHeight={height} animated={false} />
                  </div>
                </button>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
