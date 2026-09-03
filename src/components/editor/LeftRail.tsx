'use client'

import { LayoutTemplate, Shapes, Type, Upload, Palette, Layers } from 'lucide-react'
import { useEditorStore, type PanelId } from '@/store/editor-store'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'

const PANELS: { id: Exclude<PanelId, null>; label: string; icon: typeof LayoutTemplate }[] = [
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { id: 'elements', label: 'Elements', icon: Shapes },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'uploads', label: 'Uploads', icon: Upload },
  { id: 'background', label: 'Background', icon: Palette },
  { id: 'layers', label: 'Layers', icon: Layers },
]

export function LeftRail({ vertical = true }: { vertical?: boolean }) {
  const panel = useEditorStore((s) => s.panel)
  const setPanel = useEditorStore((s) => s.setPanel)
  void useIsMobile()

  return (
    <nav
      className={cn(
        'bg-[#17181D] shrink-0 z-30',
        vertical ? 'w-[72px] flex flex-col items-center pt-3 gap-1' : 'flex items-center justify-around px-2 h-14 overflow-x-auto cv-scroll-dark'
      )}
      aria-label="Editor tools"
    >
      {PANELS.map((p) => {
        const active = panel === p.id
        return (
          <button
            key={p.id}
            onClick={() => setPanel(p.id)}
            className={cn(
              'flex flex-col items-center justify-center gap-1 rounded-xl transition-colors text-white/60 hover:text-white',
              vertical ? 'w-14 py-2.5' : 'w-16 h-11 shrink-0',
              active && 'bg-[#26272E] text-white'
            )}
            aria-label={p.label}
            aria-pressed={active}
            title={p.label}
          >
            <p.icon size={19} />
            <span className="text-[9px] font-medium leading-none">{p.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
