'use client'

import { ChevronUp, ChevronDown, ChevronsUp, ChevronsDown, Lock, LockOpen, Eye, EyeOff, Trash2, Type, Image as ImageIcon, Square, Minus, Smile, PenTool } from 'lucide-react'
import { useEditorStore, currentPageData } from '@/store/editor-store'
import { cn } from '@/lib/utils'
import type { AnyElement } from '@/lib/types'

function elementIcon(el: AnyElement) {
  switch (el.type) {
    case 'text': return Type
    case 'image': return ImageIcon
    case 'line': return Minus
    case 'sticker': return Smile
    case 'path': return PenTool
    default: return Square
  }
}

function elementLabel(el: AnyElement): string {
  if (el.type === 'text') return (el.text || 'Text').slice(0, 26) || 'Text'
  if (el.type === 'sticker') return `Sticker ${el.char}`
  if (el.type === 'image') return 'Image'
  if (el.type === 'line') return 'Line'
  if (el.type === 'path') return 'Graphic'
  return el.type.charAt(0).toUpperCase() + el.type.slice(1)
}

export function LayersPanel() {
  const pages = useEditorStore((s) => s.pages)
  const currentPage = useEditorStore((s) => s.currentPage)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const setSelection = useEditorStore((s) => s.setSelection)
  const moveLayer = useEditorStore((s) => s.moveLayer)
  const setLock = useEditorStore((s) => s.setLock)
  const setVisible = useEditorStore((s) => s.setVisible)
  const deleteSelection = useEditorStore((s) => s.deleteSelection)

  const page = currentPageData({ pages, currentPage })
  // render top layer first
  const ordered = [...page.elements].reverse()

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-3 border-b border-black/5">
        <h3 className="font-bold text-sm">Layers</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Top of the list is the front-most element.</p>
      </div>
      <div className="flex-1 overflow-y-auto cv-scroll p-2">
        {ordered.length === 0 && (
          <div className="text-center text-xs text-muted-foreground pt-10">Nothing on this page yet.<br />Add text, shapes or images.</div>
        )}
        {ordered.map((el) => {
          const Icon = elementIcon(el)
          const selected = selectedIds.includes(el.id)
          return (
            <div
              key={el.id}
              className={cn(
                'group flex items-center gap-2 rounded-lg px-2 py-2 cursor-pointer text-sm',
                selected ? 'bg-[#E6FAFB] text-[#0A8F96]' : 'hover:bg-black/[0.04]'
              )}
              onClick={() => setSelection([el.id])}
            >
              <Icon size={15} className="shrink-0" />
              <span className={cn('flex-1 truncate', !el.visible && 'opacity-40')}>{elementLabel(el)}</span>

              <div className="hidden group-hover:flex items-center gap-0.5">
                <button className="h-6 w-6 flex items-center justify-center rounded hover:bg-black/10" title="Bring to front" aria-label="Bring to front" onClick={(e) => { e.stopPropagation(); moveLayer(el.id, 'front') }}>
                  <ChevronsUp size={13} />
                </button>
                <button className="h-6 w-6 flex items-center justify-center rounded hover:bg-black/10" title="Move up" aria-label="Move up" onClick={(e) => { e.stopPropagation(); moveLayer(el.id, 'up') }}>
                  <ChevronUp size={13} />
                </button>
                <button className="h-6 w-6 flex items-center justify-center rounded hover:bg-black/10" title="Move down" aria-label="Move down" onClick={(e) => { e.stopPropagation(); moveLayer(el.id, 'down') }}>
                  <ChevronDown size={13} />
                </button>
                <button className="h-6 w-6 flex items-center justify-center rounded hover:bg-black/10" title="Send to back" aria-label="Send to back" onClick={(e) => { e.stopPropagation(); moveLayer(el.id, 'back') }}>
                  <ChevronsDown size={13} />
                </button>
                <button className="h-6 w-6 flex items-center justify-center rounded hover:bg-red-50 hover:text-red-600" title="Delete" aria-label="Delete layer" onClick={(e) => { e.stopPropagation(); setSelection([el.id]); deleteSelection() }}>
                  <Trash2 size={13} />
                </button>
              </div>

              <button
                className={cn('h-6 w-6 flex items-center justify-center rounded hover:bg-black/10 shrink-0', !el.locked && 'opacity-0 group-hover:opacity-100', el.locked && 'opacity-100')}
                title={el.locked ? 'Unlock' : 'Lock'}
                aria-label={el.locked ? 'Unlock layer' : 'Lock layer'}
                onClick={(e) => { e.stopPropagation(); setLock([el.id], !el.locked) }}
              >
                {el.locked ? <Lock size={12} /> : <LockOpen size={12} />}
              </button>
              <button
                className={cn('h-6 w-6 flex items-center justify-center rounded hover:bg-black/10 shrink-0', el.visible && 'opacity-0 group-hover:opacity-100', !el.visible && 'opacity-100')}
                title={el.visible ? 'Hide' : 'Show'}
                aria-label={el.visible ? 'Hide layer' : 'Show layer'}
                onClick={(e) => { e.stopPropagation(); setVisible([el.id], !el.visible) }}
              >
                {el.visible ? <Eye size={13} /> : <EyeOff size={13} />}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
