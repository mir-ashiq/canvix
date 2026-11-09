'use client'

import { useState } from 'react'
import { Plus, Copy, Trash2, NotebookPen, Scaling, Check, RotateCcw } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { DesignPreview } from '@/components/design-preview'
import { pageSize, PRESET_SIZES } from '@/lib/editor-utils'
import { cn } from '@/lib/utils'
import { NotesAIGenerator } from './NotesAIGenerator'

const THUMB_H = 52

export function PageBar() {
  const pages = useEditorStore((s) => s.pages)
  const currentPage = useEditorStore((s) => s.currentPage)
  const setCurrentPage = useEditorStore((s) => s.setCurrentPage)
  const addPage = useEditorStore((s) => s.addPage)
  const duplicatePage = useEditorStore((s) => s.duplicatePage)
  const deletePage = useEditorStore((s) => s.deletePage)
  const resizePage = useEditorStore((s) => s.resizePage)
  const setPageNotes = useEditorStore((s) => s.setPageNotes)
  const width = useEditorStore((s) => s.width)
  const height = useEditorStore((s) => s.height)

  /** v0.18 (Wave 3): notes + per-page resize popovers (one at a time) */
  const [notesOpen, setNotesOpen] = useState(false)
  const [resizeOpen, setResizeOpen] = useState(false)
  const [sizeDraft, setSizeDraft] = useState<{ w: string; h: string } | null>(null)

  const page = pages[currentPage]
  const current = pageSize(page, width, height)

  const openResize = () => {
    setSizeDraft({ w: String(current.width), h: String(current.height) })
    setResizeOpen(true)
    setNotesOpen(false)
  }

  const applyResize = () => {
    if (!sizeDraft || !page) return
    const w = Math.round(Number(sizeDraft.w))
    const h = Math.round(Number(sizeDraft.h))
    if (Number.isFinite(w) && Number.isFinite(h) && w >= 32 && h >= 32 && w <= 8000 && h <= 8000) {
      resizePage(page.id, w, h)
    }
    setResizeOpen(false)
  }

  const resetPageSize = () => {
    if (!page) return
    resizePage(page.id, width, height)
    setResizeOpen(false)
  }

  return (
    <div className="absolute bottom-3 left-3 z-30 flex items-end gap-2 max-w-[calc(100%-130px)]">
      <div className="flex items-end gap-1.5 overflow-x-auto cv-scroll pb-1">
        {pages.map((p, i) => {
          // v0.18 (Wave 3): thumbnails honour per-page sizes
          const ps = pageSize(p, width, height)
          const thumbW = Math.max(28, THUMB_H * (ps.width / ps.height))
          return (
            <div key={p.id} className="group relative shrink-0">
              <button
                onClick={() => setCurrentPage(i)}
                className={cn(
                  'block rounded-md overflow-hidden border-2 transition-all bg-white shadow-md',
                  i === currentPage ? 'border-[#02C0CC]' : 'border-white/20 hover:border-white/45'
                )}
                style={{ height: THUMB_H, width: thumbW }}
                aria-label={`Go to page ${i + 1}`}
              >
                <div className="w-full h-full">
                  <DesignPreview page={p} width={ps.width} height={ps.height} />
                </div>
              </button>
              <span className="absolute -top-1.5 -left-1.5 h-4 min-w-4 px-0.5 rounded-full bg-[#7630D7] text-white text-[9px] font-bold flex items-center justify-center shadow">
                {i + 1}
              </span>
              {i === currentPage && p.notes ? (
                <span
                  className="absolute -bottom-1.5 -right-1.5 h-4 w-4 rounded-full bg-[#02C0CC] text-white flex items-center justify-center shadow"
                  title="This page has speaker notes"
                >
                  <NotebookPen size={9} />
                </span>
              ) : null}
              {pages.length > 1 && (
                <div className="absolute top-1 right-1 hidden group-hover:flex gap-0.5">
                  <button
                    className="h-5 w-5 rounded bg-black/55 text-white flex items-center justify-center hover:bg-black/80"
                    onClick={() => duplicatePage(i)}
                    title="Duplicate page"
                    aria-label="Duplicate page"
                  >
                    <Copy size={10} />
                  </button>
                  <button
                    className="h-5 w-5 rounded bg-black/55 text-white flex items-center justify-center hover:bg-red-600"
                    onClick={() => deletePage(i)}
                    title="Delete page"
                    aria-label="Delete page"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <button
        onClick={addPage}
        className="h-9 w-9 rounded-lg border-2 border-dashed border-white/25 text-white/60 hover:border-[#02C0CC] hover:text-[#02C0CC] flex items-center justify-center shrink-0 bg-white/[0.06]"
        title="Add page"
        aria-label="Add page"
      >
        <Plus size={16} />
      </button>

      {/* v0.18 (Wave 3): speaker notes for the current page */}
      <div className="relative shrink-0">
        <button
          onClick={() => { setNotesOpen((v) => !v); setResizeOpen(false) }}
          className={cn(
            'h-9 w-9 rounded-lg border text-white/60 hover:border-[#02C0CC] hover:text-[#02C0CC] flex items-center justify-center bg-white/[0.06] transition-colors',
            notesOpen ? 'border-[#02C0CC] text-[#02C0CC]' : 'border-white/15',
            page?.notes ? 'text-[#02C0CC]' : ''
          )}
          title="Speaker notes"
          aria-label="Speaker notes"
          aria-expanded={notesOpen}
        >
          <NotebookPen size={15} />
        </button>
        {notesOpen && page && (
          <div className="absolute bottom-11 left-0 w-72 rounded-xl bg-[#16181D] border border-white/10 shadow-2xl p-3" data-testid="notes-popover">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50 mb-2">
              Notes — page {currentPage + 1}
            </div>
            <textarea
              value={page.notes ?? ''}
              onChange={(e) => setPageNotes(page.id, e.target.value)}
              placeholder="Type speaker notes…"
              data-testid="notes-textarea"
              className="w-full h-28 resize-none rounded-lg bg-black/30 border border-white/10 px-2.5 py-2 text-[13px] text-white/85 placeholder:text-white/30 focus:outline-none focus:border-[#02C0CC]"
            />
            {/* v0.19 (Wave 4): AI notes generation (review gate inside) */}
            <div className="mt-1.5">
              <NotesAIGenerator />
            </div>
            <div className="text-[11px] text-white/40 mt-1.5">
              Shown in presenter view — never on the canvas or in exports.
            </div>
          </div>
        )}
      </div>

      {/* v0.18 (Wave 3): per-page size */}
      <div className="relative shrink-0">
        <button
          onClick={() => (resizeOpen ? setResizeOpen(false) : openResize())}
          className={cn(
            'h-9 px-2.5 rounded-lg border text-white/60 hover:border-[#02C0CC] hover:text-[#02C0CC] flex items-center gap-1.5 bg-white/[0.06] transition-colors',
            resizeOpen ? 'border-[#02C0CC] text-[#02C0CC]' : 'border-white/15'
          )}
          title="Resize this page"
          aria-label="Resize this page"
          aria-expanded={resizeOpen}
          data-testid="page-size-button"
        >
          <Scaling size={14} />
          <span className="text-[11px] tabular-nums">
            {current.width}×{current.height}
          </span>
          {page?.width && page?.height ? <span className="w-1.5 h-1.5 rounded-full bg-[#FFB84C]" title="Custom page size" /> : null}
        </button>
        {resizeOpen && sizeDraft && page && (
          <div className="absolute bottom-11 left-0 w-72 rounded-xl bg-[#16181D] border border-white/10 shadow-2xl p-3" data-testid="page-size-popover">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50 mb-2">
              Page {currentPage + 1} size
            </div>
            <div className="flex items-center gap-2 mb-2">
              <label className="flex items-center gap-1.5 flex-1">
                <span className="text-xs text-white/50">W</span>
                <input
                  inputMode="numeric"
                  value={sizeDraft.w}
                  onChange={(e) => setSizeDraft({ ...sizeDraft, w: e.target.value.replace(/[^0-9]/g, '') })}
                  className="w-full h-8 rounded-lg bg-black/30 border border-white/10 px-2 text-[13px] text-white focus:outline-none focus:border-[#02C0CC]"
                  data-testid="page-size-w"
                />
              </label>
              <span className="text-white/30">×</span>
              <label className="flex items-center gap-1.5 flex-1">
                <span className="text-xs text-white/50">H</span>
                <input
                  inputMode="numeric"
                  value={sizeDraft.h}
                  onChange={(e) => setSizeDraft({ ...sizeDraft, h: e.target.value.replace(/[^0-9]/g, '') })}
                  className="w-full h-8 rounded-lg bg-black/30 border border-white/10 px-2 text-[13px] text-white focus:outline-none focus:border-[#02C0CC]"
                  data-testid="page-size-h"
                />
              </label>
            </div>
            <div className="grid grid-cols-3 gap-1.5 mb-2">
              {PRESET_SIZES.slice(0, 6).map((p) => (
                <button
                  key={p.name}
                  onClick={() => setSizeDraft({ w: String(p.width), h: String(p.height) })}
                  className={cn(
                    'h-7 rounded-lg text-[10.5px] leading-tight border transition-colors',
                    sizeDraft.w === String(p.width) && sizeDraft.h === String(p.height)
                      ? 'border-[#02C0CC] text-[#02C0CC] bg-[#02C0CC]/10'
                      : 'border-white/10 text-white/60 hover:border-white/30'
                  )}
                >
                  {p.name}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={applyResize}
                className="flex-1 h-8 rounded-lg bg-[#02C0CC] text-[#0B0C10] text-xs font-semibold flex items-center justify-center gap-1 hover:bg-[#02C0CC]/85"
                data-testid="page-size-apply"
              >
                <Check size={13} /> Apply
              </button>
              {page.width || page.height ? (
                <button
                  onClick={resetPageSize}
                  className="h-8 px-2.5 rounded-lg border border-white/15 text-white/60 text-xs flex items-center gap-1 hover:border-white/35"
                  title="Back to the design size"
                >
                  <RotateCcw size={12} /> Reset
                </button>
              ) : null}
            </div>
            <div className="text-[11px] text-white/40 mt-1.5">
              Applies to this page only — other pages keep their size.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
