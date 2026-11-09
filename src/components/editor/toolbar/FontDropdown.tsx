'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, ChevronDown, SlidersHorizontal, Star, Upload, Trash2 } from 'lucide-react'
import { FONTS } from '@/lib/editor-utils'
import { ensureFontLoaded, loadCustomFonts, type CustomFont } from '@/lib/fonts/loader'
import { cn } from '@/lib/utils'

interface FontDropdownProps {
  value: string
  onChange: (family: string) => void
}

/** canva-style font dropdown: search + category pills + live previews.
 *  v0.17 (Wave 2): 369-family catalog with lazy per-family loading,
 *  custom uploaded fonts, and an upload button. */
export function FontDropdown({ value, onChange }: FontDropdownProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const [cat, setCat] = useState<string>('All')
  const [custom, setCustom] = useState<CustomFont[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const cats = useMemo(() => (custom.length ? ['All', 'custom', 'sans', 'serif', 'display', 'handwriting', 'mono'] : ['All', 'sans', 'serif', 'display', 'handwriting', 'mono']), [custom.length])

  // the selected family must render in its own typeface
  useEffect(() => {
    ensureFontLoaded(value)
  }, [value])

  const customEntries = useMemo(
    () => custom.map((f) => ({ family: f.family, label: f.family, weights: '400,700', category: 'custom' as const })),
    [custom]
  )
  const allFonts = useMemo(() => [...customEntries, ...FONTS], [customEntries])

  const list = useMemo(
    () =>
      allFonts.filter(
        (f) =>
          (cat === 'All' || f.category === cat) &&
          f.label.toLowerCase().includes(query.toLowerCase())
      ),
    [query, cat, allFonts]
  )

  const refreshCustom = async () => {
    const fonts = await loadCustomFonts()
    setCustom(fonts)
  }

  const toggle = () => {
    if (!open) {
      const r = ref.current?.getBoundingClientRect()
      if (r) {
        const W = 262
        const x = Math.min(r.left, window.innerWidth - W - 12)
        const y = r.bottom + 6 > window.innerHeight - 340 ? Math.max(8, r.top - 346) : r.bottom + 6
        setPos({ x, y })
      }
      void refreshCustom()
      ensureFontLoaded(value)
    }
    setOpen(!open)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const upload = async (file: File) => {
    const ext = (file.name.split('.').pop() ?? '').toLowerCase()
    const family = file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Custom font'
    try {
      const res = await fetch(`/api/fonts/custom?family=${encodeURIComponent(family)}&ext=${encodeURIComponent(ext)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: await file.arrayBuffer(),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'Upload failed')
      }
      const font = (await res.json()) as CustomFont
      setCustom((c) => [font, ...c.filter((f) => f.id !== font.id)])
      onChange(font.family)
      setOpen(false)
    } catch (err) {
      console.error('font upload failed', err)
      alert(err instanceof Error ? err.message : 'Font upload failed')
    }
  }

  const removeCustom = async (id: string) => {
    const res = await fetch(`/api/fonts/custom?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (res.ok) setCustom((c) => c.filter((f) => f.id !== id))
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <input
        ref={fileRef}
        type="file"
        accept=".ttf,.otf,.woff,.woff2"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void upload(f)
          e.target.value = ''
        }}
        aria-label="Upload font file"
      />
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
                  placeholder="Search 369 fonts…"
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
              {list.map((f) => {
                const isCustom = f.category === 'custom'
                const customFont = isCustom ? custom.find((c) => c.family === f.family) : null
                return (
                  <div
                    key={f.family}
                    className={cn(
                      'group w-full flex items-center gap-2.5 px-3 h-[38px] text-left hover:bg-white/[0.07]',
                      value === f.family && 'bg-white/[0.09]'
                    )}
                    role="option"
                    aria-selected={value === f.family}
                    onMouseEnter={() => ensureFontLoaded(f.family)}
                  >
                    <button
                      onClick={() => { onChange(f.family); ensureFontLoaded(f.family); setOpen(false) }}
                      className="flex items-center gap-2.5 flex-1 min-w-0 h-full"
                    >
                      <Star size={12} className={cn('shrink-0', value === f.family ? 'text-[#FFD166]' : 'text-white/20')} />
                      <span className="text-[12px] text-white/85 truncate w-[86px] shrink-0" style={{ fontFamily: 'Inter' }}>{f.label}</span>
                      <span className="text-[17px] text-white truncate flex-1" style={{ fontFamily: f.family }}>AaBbCc 123</span>
                    </button>
                    {customFont && (
                      <button
                        onClick={() => void removeCustom(customFont.id)}
                        className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-red-400 shrink-0"
                        aria-label={`Delete font ${f.label}`}
                        title="Delete uploaded font"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                )
              })}
              {!list.length && (
                <div className="px-3 py-6 text-center text-[12px] text-white/40">No fonts match “{query}”</div>
              )}
            </div>

            {/* upload */}
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full flex items-center justify-center gap-1.5 h-10 border-t border-white/[0.07] text-[12px] text-white/60 hover:text-white hover:bg-white/[0.05] transition-colors"
              aria-label="Upload a custom font"
            >
              <Upload size={13} /> Upload a font (.ttf .otf .woff .woff2)
            </button>
          </div>
        </>
      )}
    </div>
  )
}
