'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, ChevronDown, SlidersHorizontal, Star } from 'lucide-react'
import { FONTS } from '@/lib/editor-utils'
import { cn } from '@/lib/utils'

interface FontDropdownProps {
  value: string
  onChange: (family: string) => void
}

/** canva-style font dropdown: search + category pills + live previews */
export function FontDropdown({ value, onChange }: FontDropdownProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const [cat, setCat] = useState<string>('All')

  const cats = ['All', 'sans', 'serif', 'display', 'handwriting']

  const list = useMemo(
    () =>
      FONTS.filter(
        (f) =>
          (cat === 'All' || f.category === cat) &&
          f.label.toLowerCase().includes(query.toLowerCase())
      ),
    [query, cat]
  )

  const toggle = () => {
    if (!open) {
      const r = ref.current?.getBoundingClientRect()
      if (r) {
        const W = 262
        const x = Math.min(r.left, window.innerWidth - W - 12)
        const y = r.bottom + 6 > window.innerHeight - 340 ? Math.max(8, r.top - 346) : r.bottom + 6
        setPos({ x, y })
      }
    }
    setOpen(!open)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={toggle}
        className="cv-tbtn gap-1.5 !min-w-[112px] !max-w-[132px] !px-2.5"
        aria-label="Toggle font selector"
        title={`Font: ${value}`}
      >
        <span className="truncate text-[13px]" style={{ fontFamily: value }}>{value}</span>
        <ChevronDown size={12} className="opacity-60 shrink-0" />
      </button>

      {open && pos && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} onContextMenu={(e) => { e.preventDefault(); setOpen(false) }} />
          <div className="cv-menu !min-w-[262px] !max-w-[262px] !p-0" style={{ left: pos.x, top: pos.y }}>
            {/* search */}
            <div className="p-2.5 pb-2 border-b border-white/[0.07]">
              <div className="flex items-center gap-2 h-9 rounded-lg bg-white/[0.06] border border-white/10 px-2.5">
                <Search size={13} className="text-white/40 shrink-0" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="bg-transparent outline-none text-[12px] text-white w-full placeholder:text-white/35"
                  placeholder="Try “Pacifico” or “Anton”"
                  aria-label="Search fonts"
                />
                <SlidersHorizontal size={13} className="text-white/40 shrink-0" />
              </div>
              {/* category pills */}
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {cats.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCat(c)}
                    className={cn(
                      'h-6 px-2.5 rounded-full text-[11px] font-medium capitalize border transition-colors',
                      cat === c ? 'bg-white/[0.16] text-white border-white/25' : 'bg-transparent text-white/60 border-white/12 hover:text-white'
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* font rows */}
            <div className="max-h-[280px] overflow-y-auto cv-scroll py-1">
              {list.map((f) => (
                <button
                  key={f.family}
                  onClick={() => { onChange(f.family); setOpen(false) }}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 h-[38px] text-left hover:bg-white/[0.07]',
                    value === f.family && 'bg-white/[0.09]'
                  )}
                  role="option"
                  aria-selected={value === f.family}
                >
                  <Star size={12} className={cn('shrink-0', value === f.family ? 'text-[#FFD166]' : 'text-white/20')} />
                  <span className="text-[12px] text-white/85 truncate w-[86px] shrink-0" style={{ fontFamily: 'Inter' }}>{f.label}</span>
                  <span className="text-[17px] text-white truncate flex-1" style={{ fontFamily: f.family }}>AaBbCc 123</span>
                </button>
              ))}
              {!list.length && (
                <div className="px-3 py-6 text-center text-[12px] text-white/40">No fonts match “{query}”</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
