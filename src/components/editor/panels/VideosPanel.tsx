'use client'

// ─────────────────────────────────────────────────────────────
// VideosPanel — the v0.15 R6 stock-video search rail panel.
// The PhotosPanel pattern (debounced live search, gated empty
// states, tile grid with hover preview), one class over: results
// are stock VIDEOS with a durable credit block.
//
// Attribution (the R6 acceptance): the credit rides the toast at
// insert AND the element (VideoElement.credit → properties bar).
// The provider chip on every tile satisfies Pixabay's "show users
// where the videos come from" request; the footer states the
// licenses honestly.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react'
import { Plus, Loader2, Clapperboard, VideoOff } from 'lucide-react'
import { PanelShell } from './panel-shell'
import { addStockVideo } from '../add-element'
import { useStockVideo } from '@/hooks/use-stock-video'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

/** normalized result — the /api/stock-video/search shape */
interface StockVideoTile {
  id: string
  provider: 'pexels' | 'pixabay'
  width: number
  height: number
  duration: number
  mp4: string
  alternates: string[]
  previewVideo: string
  preview: string
  credit: { provider: string; author: string; license: string; url: string }
}

/** why a search came back empty — 'no-provider' shows the operator
 *  hint instead of looking broken (the F2 pattern; defense in depth
 *  under a rail that is already hidden without a key) */
type SearchError = { kind: 'no-provider' } | { kind: 'service'; message: string }

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return ''
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`
}

export function VideosPanel() {
  const { providers } = useStockVideo()
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState<string>('')
  const [results, setResults] = useState<StockVideoTile[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<SearchError | null>(null)
  const [busyTile, setBusyTile] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const lastQuery = useRef('')

  // default connector = the first configured one
  const activeProvider = provider || providers[0] || ''

  useEffect(() => {
    const q = query.trim()
    const run = async () => {
      if (q.length < 2) {
        setResults(null)
        setError(null)
        return
      }
      setBusy(true)
      setError(null)
      try {
        const res = await fetch('/api/stock-video/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, count: 24, provider: activeProvider || undefined }),
        })
        const data = (await res.json().catch(() => ({}))) as {
          results?: StockVideoTile[]
          error?: string
          code?: string
        }
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
      if (q !== lastQuery.current) {
        lastQuery.current = q
        void run()
      }
    }, 600)
    return () => clearTimeout(t)
  }, [query, activeProvider])

  const add = async (tile: StockVideoTile) => {
    if (busyTile) return
    setBusyTile(tile.id)
    try {
      await addStockVideo(tile)
      toast({
        title: 'Video added',
        description: `${tile.credit.provider} · ${tile.credit.author} — ${tile.credit.license}`,
      })
    } catch (err) {
      toast({
        title: 'Could not add the video',
        description: err instanceof Error ? err.message : 'Try again — or pick another result.',
      })
    } finally {
      setBusyTile(null)
    }
  }

  const showResults = query.trim().length >= 2 && (results !== null || busy)

  return (
    <PanelShell
      title="Videos"
      subtitle={providers.length > 0 ? `Search free stock videos from ${providers.map((p) => p[0].toUpperCase() + p.slice(1)).join(' & ')}` : 'Search free stock videos'}
      searchPlaceholder="Search stock videos (e.g. ocean, city, coffee)"
      searchValue={query}
      onSearchValueChange={setQuery}
      onSearch={setQuery}
      belowSearch={
        providers.length > 1 ? (
          <div className="cv-tabscroll -mx-4 mt-2.5 flex gap-1.5 overflow-x-auto px-4">
            {providers.map((p) => (
              <button
                key={p}
                onClick={() => {
                  setProvider(p)
                  setResults(null)
                  setError(null)
                }}
                className={cn(
                  'h-7 shrink-0 whitespace-nowrap rounded-full px-3 text-[11.5px] font-semibold transition-colors border',
                  activeProvider === p
                    ? 'bg-white/[0.16] text-white border-white/25'
                    : 'bg-transparent text-white/65 border-white/10 hover:bg-white/[0.07] hover:text-white',
                )}
                aria-pressed={activeProvider === p}
              >
                {p === 'pexels' ? 'Pexels' : 'Pixabay'}
              </button>
            ))}
          </div>
        ) : undefined
      }
    >
      {showResults ? (
        <div className="mb-2">
          <div className="flex items-center gap-1.5 mb-2">
            <Clapperboard size={12} className="text-[#02C0CC]" />
            <span className="text-[10.5px] font-bold text-white/55 uppercase tracking-wide">
              Stock videos {results ? `(${results.length})` : ''}
            </span>
            {busy && <Loader2 size={11} className="animate-spin text-white/40 ml-1" />}
          </div>

          {error?.kind === 'no-provider' ? (
            <p className="text-[11.5px] text-white/40 py-2 leading-relaxed">
              Stock video search needs a provider key on the server — set{' '}
              <code className="text-white/55">PEXELS_API_KEY</code> or{' '}
              <code className="text-white/55">PIXABAY_API_KEY</code> (free keys; see{' '}
              <code className="text-white/55">docs/STOCK-VIDEO.md</code>).
            </p>
          ) : error?.kind === 'service' ? (
            <p className="text-[11.5px] text-white/40 py-2">{error.message}</p>
          ) : results && results.length === 0 && !busy ? (
            <div className="py-10 text-center">
              <VideoOff size={24} className="mx-auto text-white/25 mb-2" />
              <p className="text-[12.5px] text-white/50 font-medium">No stock videos matched</p>
              <p className="text-[11.5px] text-white/35 mt-1">Try other keywords.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {(results ?? []).map((t) => {
                const aspect = t.width > 0 && t.height > 0 ? `${t.width} / ${t.height}` : '16 / 9'
                const isBusy = busyTile === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => void add(t)}
                    onMouseEnter={() => setHovered(t.id)}
                    onMouseLeave={() => setHovered((h) => (h === t.id ? null : h))}
                    disabled={busyTile !== null}
                    className="group relative rounded-xl overflow-hidden border border-white/10 hover:border-[#7630D7] transition-colors bg-[#0F1015] disabled:opacity-60"
                    style={{ aspectRatio: aspect }}
                    aria-label={`Add stock video by ${t.credit.author}`}
                    title={`${t.credit.provider} · ${t.credit.author} — ${t.credit.license}`}
                  >
                    {hovered === t.id && t.previewVideo ? (
                      <video
                        src={t.previewVideo}
                        muted
                        loop
                        autoPlay
                        playsInline
                        preload="none"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : t.preview ? (
                      <img
                        src={t.preview}
                        alt={`Stock video by ${t.credit.author}`}
                        loading="lazy"
                        className="absolute inset-0 h-full w-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                      />
                    ) : (
                      <span className="absolute inset-0 flex items-center justify-center">
                        <Clapperboard size={20} className="text-white/25" />
                      </span>
                    )}

                    <span className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors" />

                    {/* provider + duration chips */}
                    <span className="absolute top-1.5 left-1.5 h-5 px-1.5 rounded-md bg-black/60 backdrop-blur-sm text-[9.5px] font-bold text-white/90 flex items-center">
                      {t.credit.provider}
                    </span>
                    {t.duration > 0 ? (
                      <span className="absolute top-1.5 right-1.5 h-5 px-1.5 rounded-md bg-black/60 backdrop-blur-sm text-[9.5px] font-semibold text-white/90 flex items-center tabular-nums">
                        {formatDuration(t.duration)}
                      </span>
                    ) : null}

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
                <div key={`sk-${i}`} className="aspect-video rounded-xl cv-skeleton" />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="py-12 text-center">
          <Clapperboard size={26} className="mx-auto text-white/25 mb-3" />
          <p className="text-[13px] text-white/50 font-medium">Search free stock videos</p>
          <p className="text-[11.5px] text-white/35 mt-1 leading-relaxed max-w-[240px] mx-auto">
            Type at least two letters. Every video carries its creator and license —
            shown when you add it and saved with the design.
          </p>
        </div>
      )}

      <p className="text-[10.5px] text-white/30 mt-3 leading-relaxed">
        Stock videos come from {providers.length > 0 ? providers.map((p) => p[0].toUpperCase() + p.slice(1)).join(' and ') : 'the configured provider'} under their
        free licenses (Pexels License / Pixabay Content License). Inserted videos are
        downloaded into your media library — attribution stays on the element.
      </p>
    </PanelShell>
  )
}
