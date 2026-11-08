'use client'

// ─────────────────────────────────────────────────────────────
// PhotosPanel — the Photos rail (v0.16.4 A4 rework of the web
// results section).
//
// Two content sources, honestly labelled:
//   • STOCK SEARCH (typing ≥2 chars) — Pexels / Pixabay via
//     /api/stock-photo/search, the R6 stock-video architecture:
//     provider keys on the server, sanitized results, durable
//     attribution on the inserted element. Until v0.16.4 this
//     rode the AI provider table (the imageSearch slot) — an
//     OpenAI-compatible images/search endpoint almost no vendor
//     serves, which is why photo search 404'd in production.
//   • THE BUNDLED LIBRARY — 42 AI-generated photos that ship
//     with the app and work with zero configuration.
//
// The F2 lessons stay: leaving results mode clears BOTH the
// results and any error; a category click exits search mode;
// an unkeyed server says so instead of looking broken.
// ─────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, ImageDown, Loader2, Camera } from 'lucide-react'
import { PanelShell } from './panel-shell'
import { addImageFromSrc, addStockPhoto } from '../add-element'
import { useStockPhoto } from '@/hooks/use-stock-photo'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

/** stock photo entry — bundled, AI-generated, license-free */
interface StockPhoto {
  file: string
  cat: string
  tags: string[]
}

/** normalized stock-search result — the /api/stock-photo/search shape */
interface StockPhotoTile {
  id: string
  provider: 'pexels' | 'pixabay'
  width: number
  height: number
  preview: string
  download: string
  alternates: string[]
  credit: { provider: string; author: string; license: string; url: string }
}

/** why a search came back empty — 'no-provider' shows the operator
 *  hint instead of looking broken (the F2 pattern; defense in depth
 *  under a section that already renders its unkeyed state) */
type SearchError = { kind: 'no-provider' } | { kind: 'service'; message: string }

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

function providerLabel(p: string): string {
  return p === 'pexels' ? 'Pexels' : p === 'pixabay' ? 'Pixabay' : p
}

export function PhotosPanel() {
  const { available, providers, loaded } = useStockPhoto()
  const [cat, setCat] = useState('all')
  const [query, setQuery] = useState('')
  // resilient to not-yet-bundled photos: broken tiles hide themselves
  const [hidden, setHidden] = useState<Record<string, boolean>>({})

  // stock search (debounced) — only fires on a keyed instance
  const [results, setResults] = useState<StockPhotoTile[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<SearchError | null>(null)
  const [busyTile, setBusyTile] = useState<string | null>(null)
  const [provider, setProvider] = useState('')
  const lastQuery = useRef('')

  // default connector = the first configured one
  const activeProvider = provider || providers[0] || ''
  // a POSITIVE unkeyed answer (not "probe still in flight")
  const noProvider = loaded && !available

  useEffect(() => {
    const q = query.trim()
    const run = async () => {
      // the guards live in the debounce wrapper (the race note below);
      // run() only ever fires for a searcheable query on a keyed server
      setBusy(true)
      setError(null)
      try {
        const res = await fetch('/api/stock-photo/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, count: 24, provider: activeProvider || undefined }),
        })
        const data = (await res.json().catch(() => ({}))) as {
          results?: StockPhotoTile[]
          error?: string
          code?: string
        }
        // 503 NO_PROVIDER means the server lost its keys since the
        // availability probe — say that, not "no photos matched"
        if (res.status === 503 && data.code === 'NO_PROVIDER') {
          setError({ kind: 'no-provider' })
          setResults([])
        } else if (!res.ok) {
          setError(data.error ? { kind: 'service', message: data.error } : null)
          setResults([])
        } else {
          setResults(Array.isArray(data.results) ? data.results : [])
        }
      } catch {
        setResults([])
      } finally {
        setBusy(false)
      }
    }
    const t = setTimeout(() => {
      if (q === lastQuery.current) return
      // RACE GUARD (caught by the acceptance e2e): while availability is
      // still unresolved we must NOT consume the query — otherwise the
      // user types, run() returns early on !available, and when the probe
      // lands the effect re-runs but q === lastQuery forever. Only a real
      // search (or the <2-char clear) may consume it.
      if (q.length < 2 || !available) {
        setResults(null)
        setError(null)
        return
      }
      lastQuery.current = q
      void run()
    }, 600)
    return () => clearTimeout(t)
  }, [query, activeProvider, available])

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

  const addStock = async (tile: StockPhotoTile) => {
    if (busyTile) return
    setBusyTile(tile.id)
    try {
      await addStockPhoto(tile)
      toast({
        title: 'Photo added',
        description: `${tile.credit.provider} · ${tile.credit.author} — ${tile.credit.license}`,
      })
    } catch (err) {
      toast({
        title: 'Could not add the photo',
        description: err instanceof Error ? err.message : 'Try again — or pick another result.',
      })
    } finally {
      setBusyTile(null)
    }
  }

  const typing = query.trim().length >= 2
  const showWeb = typing && (results !== null || busy || noProvider)

  // v0.11.6 (F2): clicking a category tab EXITS results mode — clears the
  // query (and with it the visible search box, now controlled), the stock
  // results and any error. Before, the query kept filtering the bundled
  // grid, so "All photos" showed the stale 6-photo result set instead of
  // the 42-photo library until the panel was closed and reopened.
  function pickCategory(id: string) {
    setCat(id)
    setQuery('')
    setResults(null)
    setError(null)
  }

  // the category row is ALWAYS rendered — it is the exit hatch from
  // results mode (clicking a category returns to browsing; the F2
  // contract). The provider selector lives INSIDE the results section,
  // under its header, so the two never displace each other.
  const belowSearch = (
    <div className="cv-tabscroll -mx-4 mt-2.5 flex gap-1.5 overflow-x-auto px-4">
      {CATEGORIES.map((c) => (
        <button
          key={c.id}
          onClick={() => pickCategory(c.id)}
          className={cn(
            'h-7 shrink-0 whitespace-nowrap rounded-full px-3 text-[11.5px] font-semibold transition-colors border',
            cat === c.id
              ? 'bg-white/[0.16] text-white border-white/25'
              : 'bg-transparent text-white/65 border-white/10 hover:bg-white/[0.07] hover:text-white',
          )}
          aria-pressed={cat === c.id}
        >
          {c.label}
        </button>
      ))}
    </div>
  )

  return (
    <PanelShell
      title="Photos"
      subtitle="Search millions of stock photos or browse the free library"
      searchPlaceholder="Search photos (e.g. mountain, coffee, beach)"
      searchValue={query}
      onSearchValueChange={setQuery}
      onSearch={setQuery}
      belowSearch={belowSearch}
    >
      {/* ── stock search results (the R6 architecture) ── */}
      {showWeb && (
        <div className="mb-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Camera size={12} className="text-[#02C0CC]" />
            <span className="text-[10.5px] font-bold text-white/55 uppercase tracking-wide">
              Stock photos {results ? `(${results.length})` : ''}
            </span>
            {busy && <Loader2 size={11} className="animate-spin text-white/40 ml-1" />}
          </div>
          {providers.length > 1 && (
            <div className="cv-tabscroll -mx-4 mb-2 flex gap-1.5 overflow-x-auto px-4">
              {providers.map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setProvider(p)
                    setResults(null)
                    setError(null)
                  }}
                  className={cn(
                    'h-6 shrink-0 whitespace-nowrap rounded-full px-2.5 text-[11px] font-semibold transition-colors border',
                    activeProvider === p
                      ? 'bg-white/[0.16] text-white border-white/25'
                      : 'bg-transparent text-white/65 border-white/10 hover:bg-white/[0.07] hover:text-white',
                  )}
                  aria-pressed={activeProvider === p}
                >
                  {providerLabel(p)}
                </button>
              ))}
            </div>
          )}
          {noProvider || error?.kind === 'no-provider' ? (
            <p className="text-[11.5px] text-white/40 py-2 leading-relaxed">
              Photo search runs on free stock-provider keys — set{' '}
              <code className="text-white/55">PEXELS_API_KEY</code> or{' '}
              <code className="text-white/55">PIXABAY_API_KEY</code> on the server (the
              same keys as the Videos rail; see{' '}
              <code className="text-white/55">docs/STOCK-PHOTO.md</code>). The free
              library below still works.
            </p>
          ) : error?.kind === 'service' ? (
            <p className="text-[11.5px] text-white/40 py-2">{error.message}</p>
          ) : results && results.length === 0 && !busy ? (
            <p className="text-[11.5px] text-white/40 py-2">No stock photos matched — try other keywords.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {(results ?? []).map((t) => {
                const isBusy = busyTile === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => void addStock(t)}
                    disabled={busyTile !== null}
                    className="group relative aspect-[7/5] rounded-xl overflow-hidden border border-white/10 hover:border-[#7630D7] transition-colors bg-[#0F1015] disabled:opacity-60"
                    aria-label={`Add stock photo by ${t.credit.author}`}
                    title={`${t.credit.provider} · ${t.credit.author} — ${t.credit.license}`}
                  >
                    <img
                      src={t.preview}
                      alt={`Stock photo by ${t.credit.author}`}
                      loading="lazy"
                      className="absolute inset-0 h-full w-full object-cover group-hover:scale-[1.04] transition-transform duration-300"
                    />
                    <span className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors" />

                    {/* provider chip (attribution visibility — the R6 pattern) */}
                    <span className="absolute top-1.5 left-1.5 h-5 px-1.5 rounded-md bg-black/60 backdrop-blur-sm text-[9.5px] font-bold text-white/90 flex items-center">
                      {t.credit.provider}
                    </span>

                    <span className="absolute inset-0 hidden group-hover:flex items-center justify-center">
                      <span className="h-8 px-3 rounded-full bg-[#7630D7] text-white text-[11.5px] font-bold flex items-center gap-1.5 shadow-lg">
                        {isBusy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                        {isBusy ? 'Adding…' : 'Add'}
                      </span>
                    </span>
                  </button>
                )
              })}
              {busy && Array.from({ length: 4 }).map((_, i) => (
                <div key={`sk-${i}`} className="aspect-[7/5] rounded-xl cv-skeleton" />
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
        Stock photos come from {providers.length > 0 ? providers.map(providerLabel).join(' and ') : 'the configured provider'} under
        their free licenses (Pexels License / Pixabay Content License) — inserted photos are downloaded
        into your media library and attribution stays on the element. Bundled photos are AI-generated
        for Canvix.
      </p>
    </PanelShell>
  )
}
