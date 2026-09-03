'use client'

import { Plus, Copy, Trash2 } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { DesignPreview } from '@/components/design-preview'
import { cn } from '@/lib/utils'

const THUMB_H = 52

export function PageBar() {
  const pages = useEditorStore((s) => s.pages)
  const currentPage = useEditorStore((s) => s.currentPage)
  const setCurrentPage = useEditorStore((s) => s.setCurrentPage)
  const addPage = useEditorStore((s) => s.addPage)
  const duplicatePage = useEditorStore((s) => s.duplicatePage)
  const deletePage = useEditorStore((s) => s.deletePage)
  const width = useEditorStore((s) => s.width)
  const height = useEditorStore((s) => s.height)

  const thumbW = Math.max(28, THUMB_H * (width / height))

  return (
    <div className="absolute bottom-3 left-3 z-30 flex items-end gap-2 max-w-[calc(100%-130px)]">
      <div className="flex items-end gap-1.5 overflow-x-auto cv-scroll pb-1">
        {pages.map((p, i) => (
          <div key={p.id} className="group relative shrink-0">
            <button
              onClick={() => setCurrentPage(i)}
              className={cn(
                'block rounded-md overflow-hidden border-2 transition-all bg-white shadow-sm',
                i === currentPage ? 'border-[#00C4CC]' : 'border-black/10 hover:border-black/30'
              )}
              style={{ height: THUMB_H, width: thumbW }}
              aria-label={`Go to page ${i + 1}`}
            >
              <div className="w-full h-full">
                <DesignPreview page={p} width={width} height={height} />
              </div>
            </button>
            <span className="absolute -top-1.5 -left-1.5 h-4 min-w-4 px-0.5 rounded-full bg-[#1F2226] text-white text-[9px] font-bold flex items-center justify-center">
              {i + 1}
            </span>
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
        ))}
      </div>
      <button
        onClick={addPage}
        className="h-9 w-9 rounded-lg border-2 border-dashed border-black/25 text-muted-foreground hover:border-[#00C4CC] hover:text-[#0A8F96] flex items-center justify-center shrink-0 bg-white/70"
        title="Add page"
        aria-label="Add page"
      >
        <Plus size={16} />
      </button>
    </div>
  )
}
