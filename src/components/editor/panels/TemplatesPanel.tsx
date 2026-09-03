'use client'

import { useMemo, useState } from 'react'
import { TEMPLATES } from '@/lib/templates'
import { useEditorStore } from '@/store/editor-store'
import { DesignPreview } from '@/components/design-preview'
import { cn } from '@/lib/utils'
import { TEMPLATE_CATEGORIES } from '@/lib/types'

export function TemplatesPanel() {
  const applyTemplate = useEditorStore((s) => s.applyTemplate)
  const [category, setCategory] = useState('all')

  const list = useMemo(() => TEMPLATES.filter((t) => category === 'all' || t.category === category), [category])

  return (
    <div className="flex flex-col h-full bg-[#16181D] text-[#EDEEF2]">
      <div className="px-4 pt-4 pb-3 border-b border-white/[0.07]">
        <h3 className="font-bold text-sm">Templates</h3>
        <p className="text-xs text-white/50 mt-0.5">Applying a template replaces this design&apos;s pages.</p>
        <div className="mt-3 flex gap-1.5 flex-wrap">
          {[{ id: 'all', label: 'All' }, ...TEMPLATE_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))].map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                category === c.id ? 'bg-[#7630D7] text-white border-transparent' : 'border-white/12 text-white/60 hover:border-white/30 hover:text-white'
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto cv-scroll-dark p-4">
        <div className="grid grid-cols-2 gap-3">
          {list.map((t) => (
            <button
              key={t.slug}
              onClick={() => applyTemplate(t)}
              className="group text-left rounded-lg overflow-hidden border border-white/10 hover:border-[#7630D7] transition-all"
              aria-label={`Apply template ${t.name}`}
            >
              <div className="bg-[#0F1015]" style={{ aspectRatio: `${t.width} / ${t.height}` }}>
                <DesignPreview page={t.pages[0]} width={t.width} height={t.height} />
              </div>
              <div className="px-2 py-1.5 text-[11px] font-medium truncate bg-[#16181D] text-white/80">{t.name}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
