'use client'

import { useMemo } from 'react'
import { LayoutTemplate, Shapes, Type, Upload, Palette, Layers, Wrench, FolderOpen, LayoutGrid, BookMarked, Image, Video, الصوتLines } from 'lucide-react'
import { useEditorStore, type PanelId } from '@/store/editor-store'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { useStockVideo } from '@/hooks/use-stock-video'
import { Tip } from './tooltip'

/** Canva-2026 rail: up to 10 tabs (72×72), 72px wide — القوالب / العناصر / النص / الهوية / الملفات المرفوعة / الصور / الفيديو / الأدوات / المشاريع / التطبيقات.
 *  الفيديو (v0.15 R6) is provider-gated: the tab is rendered only when
 *  /api/stock-video/available says the instance has a stock-video key —
 *  no provider = feature hidden, everything else works (the F2b pattern). */
const PANELS: { id: Exclude<PanelId, null>; label: string; icon: typeof LayoutTemplate }[] = [
  { id: 'templates', label: 'القوالب', icon: LayoutTemplate },
  { id: 'elements', label: 'العناصر', icon: Shapes },
  { id: 'text', label: 'النص', icon: Type },
  { id: 'brand', label: 'الهوية', icon: BookMarked },
  { id: 'uploads', label: 'الملفات المرفوعة', icon: Upload },
  { id: 'photos', label: 'الصور', icon: Image },
  { id: 'videos', label: 'الفيديو', icon: Video },
  { id: 'audio', label: 'الصوت', icon: الصوتLines },
  { id: 'tools', label: 'الأدوات', icon: Wrench },
  { id: 'projects', label: 'المشاريع', icon: FolderOpen },
  { id: 'apps', label: 'التطبيقات', icon: LayoutGrid },
]

export function LeftRail({ vertical = true }: { vertical?: boolean }) {
  const panel = useEditorStore((s) => s.panel)
  const setPanel = useEditorStore((s) => s.setPanel)
  void useIsMobile()

  // v0.15 (R6): fail-closed visibility — the probe starts false, so an
  // unkeyed instance never flashes the tab; a keyed instance reveals it
  // once the (cached, module-level) answer lands
  const stockVideo = useStockVideo()
  const panels = useMemo(
    () => (stockVideo.available ? PANELS : PANELS.filter((p) => p.id !== 'videos')),
    [stockVideo.available],
  )

  return (
    <nav
      className={cn(
        'bg-[#1D1F26] shrink-0 z-30 border-r border-white/[0.06]',
        vertical ? 'w-[72px] flex flex-col items-center pt-1 gap-0.5' : 'flex items-center justify-around px-2 h-14 overflow-x-auto cv-scroll-dark'
      )}
      aria-label="أدوات المحرر"
    >
      {panels.map((p) => {
        const active = panel === p.id
        return (
          <Tip key={p.id} label={p.label} side={vertical ? 'right' : 'top'}>
            <button
              onClick={() => setPanel(p.id)}
              className={cn(
                'flex flex-col items-center justify-center gap-1 transition-colors text-white/60 hover:text-white',
                vertical ? 'w-[72px] h-[72px] rounded-2xl' : 'w-16 h-11 shrink-0 rounded-xl',
                active && 'bg-[#2A2C35] text-white'
              )}
              aria-label={p.label}
              aria-pressed={active}
            >
              <p.icon size={22} strokeWidth={active ? 2.2 : 1.9} />
              <span className="text-[10px] font-medium leading-none">{p.label}</span>
            </button>
          </Tip>
        )
      })}
    </nav>
  )
}

void Palette
void Layers
