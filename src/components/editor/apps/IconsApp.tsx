'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Shapes, Search, Globe, HardDriveDownload, Loader2 } from 'lucide-react'
import { searchIcons, type IconDef } from '@/lib/assets/icon-pack'
import { addIconPath, addSvgAsImage } from '../add-element'
import { AppHeader, type AppPanelProps } from './registry'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 48

/**
 * v0.17 (Wave 2): the icon library. Two sources:
 *  · Offline — 562 stroke icons bundled with the app (work without
 *    network); inserted as editable vector paths.
 *  · Online — the Iconify universe (200k+ icons) via /api/icons,
 *    inserted as image elements with full colour fidelity.
 */
export function IconsApp({ onClose }: AppPanelProps) {
  const [query, setQuery] = useState('')
  const [fill, setFill] = useState('#7630D7')
  const [source, setSource] = useState<'offline' | 'online'>('offline')
  const [shown, setShown] = useState(PAGE_SIZE)
  const [online, setOnline] = useState<string[]>([])
  const [onlineLoading, setOnlineLoading] = useState(false)
  const [onlineError, setOnlineError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const offlineIcons = useMemo(() => searchIcons(query, 400), [query])

  // debounced online search
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onQueryChange = (value: string) => {
    setQuery(value)
    setShown(PAGE_SIZE)
    if (source !== 'online') return
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => void searchOnline(value), 500)
  }

  const searchOnline = async (value: string) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    if (!value.trim()) {
      setOnline([])
      setOnlineError(null)
      return
    }
    setOnlineLoading(true)
    setOnlineError(null)
    try {
      const res = await fetch(`/api/icons?q=${encodeURIComponent(value.trim())}`, { signal: ctrl.signal })
      if (!res.ok) throw new Error('search failed')
      const body = (await res.json()) as { icons?: string[] }
      setOnline(body.icons ?? [])
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setOnlineError('Online search unavailable — the offline pack still works.')
      setOnline([])
    } finally {
      if (abortRef.current === ctrl) setOnlineLoading(false)
    }
  }

  const insertOnline = async (ref: string) => {
    try {
      const res = await fetch(`/api/icons?svg=${encodeURIComponent(ref)}&color=${encodeURIComponent(fill)}`)
      if (!res.ok) throw new Error('fetch failed')
      const svg = await res.text()
      addSvgAsImage(svg)
    } catch {
      // network hiccup — the proxy caches hard, retry rarely helps
      setOnlineError('Could not load that icon — try again.')
    }
  }

  const switchSource = (next: 'offline' | 'online') => {
    setSource(next)
    setShown(PAGE_SIZE)
    if (next === 'online' && query.trim() && !online.length && !onlineLoading) {
      void searchOnline(query)
    }
  }

  return (
    <div>
      <AppHeader icon={Shapes} title="Icons" onClose={onClose} />
      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center gap-2 h-9 rounded-lg bg-white/[0.06] border border-white/10 px-2.5 flex-1">
          <Search size={12} className="text-white/40 shrink-0" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className="bg-transparent outline-none text-[12px] text-white w-full placeholder:text-white/35"
            placeholder={source === 'offline' ? 'Search 562 icons…' : 'Search all of Iconify…'}
            aria-label="Search icons"
          />
          {onlineLoading && <Loader2 size={12} className="text-white/40 animate-spin shrink-0" />}
        </div>
        <input
          type="color"
          value={fill}
          onChange={(e) => setFill(e.target.value)}
          className="h-9 w-9 rounded-lg border border-white/15 cursor-pointer bg-transparent"
          title="Icon colour"
          aria-label="Icon colour"
        />
      </div>

      {/* source toggle */}
      <div className="flex gap-1.5 mb-3">
        <button
          onClick={() => switchSource('offline')}
          className={cn(
            'flex-1 h-8 rounded-lg text-[11px] font-semibold border transition-colors flex items-center justify-center gap-1.5',
            source === 'offline'
              ? 'bg-[#7630D7] text-white border-transparent'
              : 'border-white/12 text-white/60 hover:text-white'
          )}
          aria-pressed={source === 'offline'}
        >
          <HardDriveDownload size={12} /> Offline · 562
        </button>
        <button
          onClick={() => switchSource('online')}
          className={cn(
            'flex-1 h-8 rounded-lg text-[11px] font-semibold border transition-colors flex items-center justify-center gap-1.5',
            source === 'online'
              ? 'bg-[#7630D7] text-white border-transparent'
              : 'border-white/12 text-white/60 hover:text-white'
          )}
          aria-pressed={source === 'online'}
        >
          <Globe size={12} /> Online · Iconify
        </button>
      </div>

      {source === 'offline' ? (
        <>
          <div className="grid grid-cols-4 gap-2">
            {offlineIcons.slice(0, shown).map((icon: IconDef) => (
              <button
                key={icon.id}
                onClick={() => addIconPath(icon.d, fill)}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-3 h-[80px]',
                  'hover:border-[#7630D7] hover:bg-[#7630D7]/10 transition-all'
                )}
                aria-label={`Add icon ${icon.name}`}
                title={`${icon.name} — vector, recolourable`}
              >
                <svg viewBox="0 0 100 100" className="h-7 w-7" fill="none" stroke={fill} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={icon.d} />
                </svg>
                <span className="text-[10px] text-white/55 truncate w-full text-center">{icon.name}</span>
              </button>
            ))}
          </div>
          {shown < offlineIcons.length && (
            <button
              onClick={() => setShown((s) => s + PAGE_SIZE * 2)}
              className="w-full h-9 mt-3 rounded-xl border border-white/12 hover:bg-white/[0.06] text-white/70 text-[12px] font-semibold transition-colors"
            >
              Show more ({offlineIcons.length - shown} left)
            </button>
          )}
          {!offlineIcons.length && (
            <p className="text-center text-[12px] text-white/40 py-6">
              No icons match “{query}” — try the <button className="text-[#02C0CC] underline" onClick={() => switchSource('online')}>online search</button>
            </p>
          )}
        </>
      ) : (
        <>
          {onlineError && <p className="text-[11px] text-amber-300/80 mb-2">{onlineError}</p>}
          {!query.trim() ? (
            <p className="text-center text-[12px] text-white/40 py-6">
              Type to search the full Iconify universe — 200,000+ icons from 150+ sets (Tabler, Material, Phosphor…).
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {online.map((ref) => (
                <button
                  key={ref}
                  onClick={() => void insertOnline(ref)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-3 h-[80px]',
                    'hover:border-[#7630D7] hover:bg-[#7630D7]/10 transition-all'
                  )}
                  aria-label={`Add icon ${ref}`}
                  title={`${ref} — image insert`}
                >
                  <IconThumb icon={ref} color={fill} />
                  <span className="text-[10px] text-white/55 truncate w-full text-center">{ref.split(':')[1]}</span>
                </button>
              ))}
            </div>
          )}
          {!onlineLoading && query.trim() && !online.length && !onlineError && (
            <p className="text-center text-[12px] text-white/40 py-6">No icons match “{query}”</p>
          )}
        </>
      )}
    </div>
  )
}

/** lazy thumbnail: fetch the svg when the tile mounts / inputs change */
function IconThumb({ icon, color }: { icon: string; color: string }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let latest = false
    void (async () => {
      // reset synchronously via the render key below; states flip when
      // the fetch settles (or fails) — never a cascading sync setState
      try {
        const res = await fetch(`/api/icons?svg=${encodeURIComponent(icon)}&color=${encodeURIComponent(color)}`)
        if (cancelled) return
        if (res.ok) setSvg(await res.text())
        else setFailed(true)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      latest = true
    }
  }, [icon, color])

  if (svg) return <div className="h-7 w-7 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} aria-hidden="true" />
  if (failed) return <div className="h-7 w-7 rounded bg-white/[0.06] flex items-center justify-center text-[9px] text-white/30">n/a</div>
  return <div className="h-7 w-7 rounded bg-white/[0.06] animate-pulse" />
}
