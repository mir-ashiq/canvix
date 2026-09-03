'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search, Sparkles, Clock, X, Check } from 'lucide-react'
import { TEMPLATES, type TemplateDef } from '@/lib/templates'
import { useEditorStore } from '@/store/editor-store'
import { DesignPreview } from '@/components/design-preview'
import { cn } from '@/lib/utils'
import { TEMPLATE_CATEGORIES } from '@/lib/types'

export function TemplatesPanel() {
  const applyTemplate = useEditorStore((s) => s.applyTemplate)
  const pages = useEditorStore((s) => s.pages)
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<TemplateDef | null>(null)

  // brief skeleton on first open (canva templates load with skeletons)
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 350)
    return () => clearTimeout(t)
  }, [])

  const list = useMemo(
    () =>
      TEMPLATES.filter((t) => {
        const inCat = category === 'all' || t.category === category
        const q = query.trim().toLowerCase()
        const inQuery = !q || t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)
        return inCat && inQuery
      }),
    [category, query]
  )

  const recommended = useMemo(() => TEMPLATES.slice(0, 4), [])

  const designHasContent = pages.some((p) => p.elements.length > 0)

  const use = (t: TemplateDef) => {
    applyTemplate(t)
    setPreview(null)
  }

  return (
    <div className="flex flex-col h-full bg-[#16181D] text-[#EDEEF2]">
      <div className="px-4 pt-4 pb-3 border-b border-white/[0.07] shrink-0">
        <h3 className="font-bold text-sm">Templates</h3>
        <div className="flex items-center gap-2 h-9 rounded-lg bg-white/[0.06] border border-white/10 px-2.5 mt-2.5">
          <Search size={13} className="text-white/40 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="bg-transparent outline-none text-[12px] text-white w-full placeholder:text-white/35"
            placeholder="Search templates"
            aria-label="Search templates"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search" className="text-white/40 hover:text-white">
              <X size={12} />
            </button>
          )}
        </div>
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
        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="cv-skeleton aspect-[4/5] w-full" />
            ))}
          </div>
        ) : !query && category === 'all' ? (
          <>
            <SectionLabel icon={<Sparkles size={11} />}>Recommended for you</SectionLabel>
            <div className="grid grid-cols-2 gap-3 mb-5">
              {recommended.map((t) => (
                <TemplateCard key={t.slug} t={t} onApply={() => use(t)} onPreview={() => setPreview(t)} />
              ))}
            </div>
            <SectionLabel icon={<Clock size={11} />}>All templates</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              {list.slice(4).map((t) => (
                <TemplateCard key={t.slug} t={t} onApply={() => use(t)} onPreview={() => setPreview(t)} />
              ))}
            </div>
          </>
        ) : list.length ? (
          <div className="grid grid-cols-2 gap-3">
            {list.map((t) => (
              <TemplateCard key={t.slug} t={t} onApply={() => use(t)} onPreview={() => setPreview(t)} />
            ))}
          </div>
        ) : (
          <EmptyState label={`No templates match “${query}”`} />
        )}
      </div>

      {/* full-size preview modal */}
      {preview && (
        <>
          <div className="fixed inset-0 z-[75] bg-black/60 backdrop-blur-[2px]" onClick={() => setPreview(null)} />
          <div className="fixed z-[76] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(520px,92vw)] rounded-2xl bg-[#16181D] border border-white/12 shadow-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-bold text-white truncate">{preview.name}</span>
              <button className="text-white/60 hover:text-white" onClick={() => setPreview(null)} aria-label="Close preview">
                <X size={16} />
              </button>
            </div>
            <div className="rounded-xl overflow-hidden border border-white/10 bg-[#0F1015]" style={{ aspectRatio: `${preview.width} / ${preview.height}` }}>
              <DesignPreview page={preview.pages[0]} width={preview.width} height={preview.height} />
            </div>
            <div className="flex items-center justify-between mt-3">
              <span className="text-[11px] text-white/50">
                {preview.width} × {preview.height} px · {preview.pages.length} page{preview.pages.length > 1 ? 's' : ''}
                {designHasContent && ' · replaces current pages'}
              </span>
              <button className="btn-cv h-9 px-4 text-[13px] flex items-center gap-1.5" onClick={() => use(preview)}>
                <Check size={14} /> Use this template
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function TemplateCard({ t, onApply, onPreview }: { t: TemplateDef; onApply: () => void; onPreview: () => void }) {
  return (
    <div
      className="group relative text-left rounded-lg overflow-hidden border border-white/10 hover:border-[#7630D7] transition-all"
      aria-label={`Template ${t.name}`}
    >
      <button className="block w-full" onClick={onPreview} aria-label={`Preview ${t.name}`}>
        <div className="bg-[#0F1015]" style={{ aspectRatio: `${t.width} / ${t.height}` }}>
          <DesignPreview page={t.pages[0]} width={t.width} height={t.height} />
        </div>
      </button>
      <div className="px-2 py-1.5 text-[11px] font-medium truncate bg-[#16181D] text-white/80 flex items-center justify-between">
        <span className="truncate">{t.name}</span>
      </div>
      <div className="absolute inset-x-0 bottom-9 p-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/70 to-transparent">
        <button
          onClick={onApply}
          className="w-full h-8 rounded-lg bg-[#7630D7] hover:bg-[#8b5cf6] text-white text-[11px] font-bold transition-colors"
          aria-label={`Apply ${t.name}`}
        >
          Apply
        </button>
      </div>
    </div>
  )
}

function SectionLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h4 className="flex items-center gap-1.5 text-[11px] font-bold text-white/45 uppercase tracking-wide mb-2.5">
      {icon} {children}
    </h4>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center py-10 text-white/35">
      <Search size={26} strokeWidth={1.4} />
      <p className="text-xs mt-2.5 text-center">{label}</p>
      <p className="text-[11px] mt-1 text-white/25">Try “instagram”, “poster” or “logo”</p>
    </div>
  )
}
