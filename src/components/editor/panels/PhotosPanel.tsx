'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, ImageDown, Loader2, Globe } from 'lucide-react'
import { PanelShell } from './panel-shell'
import { addImageFromSrc } from '../add-element'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

/** stock photo entry — bundled, AI-generated, license-free */
interface StockPhoto {
  file: string
  cat: string
  tags: string[]
}

/** web search result — real photos from the z-ai image search service */
interface WebPhoto {
  url: string
  caption: string
  source: string
  width: number
  height: number
}

const CATEGORIES = [
  { id: 'all', label: 'All photos' },
  { id: 'nature', label: 'Nature' },
  { id: 'business', label: 'Business' },
  { id: 'people', label: 'People' },
  { id: 'food', label: 'Food' },
  { id: 'travel', label: 'Travel' },
  { id: 'texture', label: 'Textures' },
  { id: 'abstract', label: 'Abstract' },
]

const TAGS: Record<string, string[]> = {
  nature: ['mountain', 'landscape', 'forest', 'lake', 'sunset', 'outdoor', 'green', 'mist'],
  business: ['office', 'work', 'laptop', 'desk', 'startup', 'meeting', 'coffee', 'minimal'],
  people: ['team', 'portrait', 'collaboration', 'creative', 'diverse', 'lifestyle'],
  food: ['flat lay', 'healthy', 'fresh', 'colorful', 'vegetables', 'meal'],
  travel: ['beach', 'ocean', 'tropical', 'palm', 'summer', 'vacation', 'sunset'],
  texture: ['paper', 'macro', 'pastel', 'tactile', 'material', 'background'],
  abstract: ['gradient', 'color', 'modern', 'wallpaper', 'purple', 'teal'],
}

const PHOTOS: StockPhoto[] = []
for (const cat of Object.keys(TAGS)) {
  for (let n = 1; n <= 6; n++) {
    PHOTOS.push({ file: `/photos/${cat}-${n}.jpg`, cat, tags: TAGS[cat] })
  }
}

export function PhotosPanel() {
  const [cat, setCat] = useState('all')
  const [query, setQuery] = useState('')
  // resilient to not-yet-bundled photos: broken tiles hide themselves
  const [hidden, setHidden] = useState<Record<string, boolean>>({})

  // v0.4: live web search (debounced)
  const [webResults, setWebResults] = useState<WebPhoto[] | null>(null)
  const [webBusy, setWebBusy] = useState(false)
  const lastQuery = useRef('')

  useEffect(() => {
    const q = query.trim()
    const run = async () => {
      if (q.length < 2) {
        setWebResults(null)
        return
      }
      setWebBusy(true)
      try {
        const res = await fetch('/api/photos/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, count: 24 }),
        })
        const data = (await res.json()) as { results?: WebPhoto[] }
        setWebResults(res.ok && Array.isArray(data.results) ? data.results : [])
      } catch {
        setWebResults([])
      } finally {
        setWebBusy(false)
      }
    }
    const t = setTimeout(() => {
      if (q !== lastQuery.current) {
        lastQuery.current = q
        void run()
      }
    }, 600)
    return () => clearTimeout(t)
  }, [query])

  const photos = useMemo(() => {
    const q = query.trim().toLowerCase()
    return PHOTOS.filter((p) => {
      if (hidden[p.file]) return false
      if (cat !== 'all' && p.cat !== cat) return false
      if (!q) return true
      const label = CATEGORIES.find((c) => c.id === p.cat)?.label ?? p.cat
      return p.cat.includes(q) || label.toLowerCase().includes(q) || p.tags.some((t) => t.includes(q))
    })
  }, [cat, query, hidden])

  const add = (p: StockPhoto) => {
    // bundled photos are 900 × ~514 (1344×768 originals downscaled)
    addImageFromSrc(p.file, 900, 514)
    toast({ title: 'Photo added' })
  }

  const addWeb = (p: WebPhoto) => {
    const w = p.width || 1200
    const h = p.height || 800
    addImageFromSrc(p.url, w, h)
    toast({ title: 'Photo added', description: p.source ? `From ${p.source}` : undefined })
  }

  const showWeb = query.trim().length >= 2 && (webResults !== null || webBusy)

  return (
    <PanelShell
      title="Photos"
      subtitle="Search millions of photos or browse the free library"
      searchPlaceholder="Search photos (e.g. mountain, coffee, beach)"
      onSearch={setQuery}
      belowSearch={
        <div className="flex gap-1.5 flex-wrap mt-2.5">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              className={cn(
                'h-7 px-3 rounded-full text-[11.5px] font-semibold transition-colors border',
                cat === c.id
                  ? 'bg-white/[0.16] text-white border-white/25'
                  : 'bg-transparent text-white/65 border-white/10 hover:bg-white/[0.07] hover:text-white'
              )}
              aria-pressed={cat === c.id}
            >
              {c.label}
            </button>
          ))}
        </div>
      }
    >
      {/* ── live web results (canva-style photo search) ── */}
      {showWeb && (
        <div className="mb-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Globe size={12} className="text-[#02C0CC]" />
            <span className="text-[10.5px] font-bold text-white/55 uppercase tracking-wide">
              Web results {webResults ? `(${webResults.length})` : ''}
            </span>
            {webBusy && <Loader2 size={11} className="animate-spin text-white/40 ml-1" />}
          </div>
          {webResults && webResults.length === 0 && !webBusy ? (
            <p className="text-[11.5px] text-white/40 py-2">No web photos matched — try other keywords.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {(webResults ?? []).map((p) => (
                <button
                  key={p.url}
                  onClick={() => addWeb(p)}
                  className="group relative aspect-[7/5] rounded-xl overflow-hidden border border-white/10 hover:border-[#7630D7] transition-colors bg-[#0F1015]"
                  aria-label={`Add web photo ${p.caption || 'result'}`}
                  title={p.caption}
                >
                  { }
                  <img
                    src={p.url}
                    alt={p.caption || 'web photo'}
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover group-hover:scale-[1.04] transition-transform duration-300"
                  />
                  <span className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors" />
                  <span className="absolute inset-0 hidden group-hover:flex items-center justify-center">
                    <span className="h-8 px-3 rounded-full bg-[#7630D7] text-white text-[11.5px] font-bold flex items-center gap-1.5 shadow-lg">
                      <Plus size={12} /> Add
                    </span>
                  </span>
                </button>
              ))}
              {webBusy && Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="aspect-[7/5] rounded-xl cv-skeleton" />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── bundled library ── */}
      {photos.length > 0 && (
        <div className="grid grid-cols-2 gap-2.5">
          {photos.map((p) => (
            <button
              key={p.file}
              onClick={() => add(p)}
              className={cn(
                'group relative aspect-[7/5] rounded-xl overflow-hidden border border-white/10',
                'hover:border-[#7630D7] transition-colors'
              )}
              aria-label={`Add photo ${p.cat}`}
            >
              <img
                src={p.file}
                alt={`${p.cat} stock photo`}
                loading="lazy"
                onError={() => setHidden((h) => ({ ...h, [p.file]: true }))}
                className="absolute inset-0 h-full w-full object-cover group-hover:scale-[1.04] transition-transform duration-300"
              />
              <span className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors" />
              <span className="absolute inset-0 hidden group-hover:flex items-center justify-center">
                <span className="h-8 px-3 rounded-full bg-[#7630D7] text-white text-[11.5px] font-bold flex items-center gap-1.5 shadow-lg">
                  <Plus size={12} /> Add
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {photos.length === 0 && !showWeb && (
        <div className="py-16 text-center">
          <ImageDown size={28} className="mx-auto text-white/25 mb-3" />
          <p className="text-[13px] text-white/50 font-medium">No photos match “{query}”</p>
          <p className="text-[11.5px] text-white/35 mt-1">Try a different keyword or category.</p>
        </div>
      )}

      <p className="text-[10.5px] text-white/30 mt-3 leading-relaxed">
        Web results come from a live image search; bundled photos are AI-generated for Canvix. Check
        photo licenses before commercial use of web results.
      </p>
    </PanelShell>
  )
}
