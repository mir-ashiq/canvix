'use client'

import { useState } from 'react'
import { ChevronUp, ChevronDown, ChevronsUp, ChevronsDown, Lock, LockOpen, Eye, EyeOff, Trash2, Type, Image as ImageIcon, Square, Minus, Smile, PenTool, Group as GroupIcon, Table2, Frame as FrameIcon, ExternalLink, BarChart3 } from 'lucide-react'
import { useEditorStore, currentPageData } from '@/store/editor-store'
import { cn } from '@/lib/utils'
import type { AnyElement } from '@/lib/types'
import { CHART_KIND_LABELS } from '@/lib/types'

function elementIcon(el: AnyElement) {
  switch (el.type) {
    case 'text': return Type
    case 'image': return ImageIcon
    case 'line': return Minus
    case 'stroke': return PenTool
    case 'sticker': return Smile
    case 'path': return PenTool
    case 'group': return GroupIcon
    case 'table': return Table2
    case 'frame': return FrameIcon
    case 'embed': return ExternalLink
    case 'chart': return BarChart3
    default: return Square
  }
}

function elementLabel(el: AnyElement): string {
  if (el.name) return el.name
  if (el.type === 'text') return (el.text || 'نص').slice(0, 26) || 'نص'
  if (el.type === 'sticker') return `Sticker ${el.char}`
  if (el.type === 'image') return 'صورة'
  if (el.type === 'line') return 'خط'
  if (el.type === 'stroke') return 'رسم حر'
  if (el.type === 'path') return 'عنصر رسومي'
  if (el.type === 'group') return 'مجموعة'
  if (el.type === 'table') return 'جدول'
  if (el.type === 'frame') return el.src ? 'إطار' : 'إطار فارغ'
  if (el.type === 'embed') return 'بطاقة مضمنة'
  if (el.type === 'chart') return CHART_KIND_LABELS[el.kind] ?? 'مخطط'
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
  const updateElements = useEditorStore((s) => s.updateElements)

  /** v0.3.1: inline rename — double-click a layer name to edit it */
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)

  const commitRename = () => {
    if (!renaming) return
    const value = renaming.value.trim()
    // an empty name falls back to the auto label (undefined)
    updateElements([renaming.id], { name: value || undefined })
    setRenaming(null)
  }

  const page = currentPageData({ pages, currentPage })
  // render top layer first
  const ordered = [...page.elements].reverse()

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-3 border-b border-white/[0.07]">
        <h3 className="font-bold text-sm">الطبقات</h3>
        <p className="text-xs text-white/50 mt-0.5">العنصر في أعلى القائمة يظهر في المقدمة.</p>
      </div>
      <div className="flex-1 overflow-y-auto cv-scroll-dark p-2">
        {ordered.length === 0 && (
          <div className="text-center text-xs text-white/40 pt-10">لا توجد عناصر في هذه الصفحة بعد.<br />أضف نصاً أو أشكالاً أو صوراً.</div>
        )}
        {ordered.map((el) => {
          const Icon = elementIcon(el)
          const selected = selectedIds.includes(el.id)
          return (
            <div
              key={el.id}
              className={cn(
                'group flex items-center gap-2 rounded-lg px-2 py-2 cursor-pointer text-sm',
                selected ? 'bg-[#7630D7]/25 text-white' : 'text-white/75 hover:bg-white/[0.06]'
              )}
              onClick={() => setSelection([el.id])}
            >
              <Icon size={15} className="shrink-0" />
              {renaming?.id === el.id ? (
                <input
                  autoFocus
                  value={renaming.value}
                  onChange={(e) => setRenaming((r) => (r ? { ...r, value: e.target.value } : r))}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                  className="flex-1 min-w-0 bg-white/10 border border-[#7630D7] rounded-md px-1.5 py-0.5 text-[13px] outline-none"
                  aria-label="اسم الطبقة"
                  maxLength={60}
                />
              ) : (
                <span
                  className={cn('flex-1 truncate', !el.visible && 'opacity-40')}
                  title="انقر نقراً مزدوجاً لإعادة التسمية"
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    setRenaming({ id: el.id, value: el.name ?? elementLabel(el) })
                  }}
                >
                  {elementLabel(el)}
                </span>
              )}

              <div className="hidden group-hover:flex items-center gap-0.5">
                <button className="h-6 w-6 flex items-center justify-center rounded hover:bg-white/10" title="إحضار إلى المقدمة" aria-label="إحضار إلى المقدمة" onClick={(e) => { e.stopPropagation(); moveLayer(el.id, 'front') }}>
                  <ChevronsUp size={13} />
                </button>
                <button className="h-6 w-6 flex items-center justify-center rounded hover:bg-white/10" title="تحريك للأعلى" aria-label="تحريك للأعلى" onClick={(e) => { e.stopPropagation(); moveLayer(el.id, 'up') }}>
                  <ChevronUp size={13} />
                </button>
                <button className="h-6 w-6 flex items-center justify-center rounded hover:bg-white/10" title="تحريك للأسفل" aria-label="تحريك للأسفل" onClick={(e) => { e.stopPropagation(); moveLayer(el.id, 'down') }}>
                  <ChevronDown size={13} />
                </button>
                <button className="h-6 w-6 flex items-center justify-center rounded hover:bg-white/10" title="إرسال إلى الخلف" aria-label="إرسال إلى الخلف" onClick={(e) => { e.stopPropagation(); moveLayer(el.id, 'back') }}>
                  <ChevronsDown size={13} />
                </button>
                <button className="h-6 w-6 flex items-center justify-center rounded hover:bg-red-500/20 hover:text-red-400" title="حذف" aria-label="حذف الطبقة" onClick={(e) => { e.stopPropagation(); setSelection([el.id]); deleteSelection() }}>
                  <Trash2 size={13} />
                </button>
              </div>

              <button
                className={cn('h-6 w-6 flex items-center justify-center rounded hover:bg-white/10 shrink-0', !el.locked && 'opacity-0 group-hover:opacity-100', el.locked && 'opacity-100')}
                title={el.locked ? 'إلغاء القفل' : 'قفل'}
                aria-label={el.locked ? 'إلغاء قفل الطبقة' : 'قفل الطبقة'}
                onClick={(e) => { e.stopPropagation(); setLock([el.id], !el.locked) }}
              >
                {el.locked ? <Lock size={12} /> : <LockOpen size={12} />}
              </button>
              <button
                className={cn('h-6 w-6 flex items-center justify-center rounded hover:bg-white/10 shrink-0', el.visible && 'opacity-0 group-hover:opacity-100', !el.visible && 'opacity-100')}
                title={el.visible ? 'إخفاء' : 'إظهار'}
                aria-label={el.visible ? 'إخفاء الطبقة' : 'إظهار الطبقة'}
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
