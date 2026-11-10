'use client'

// ─────────────────────────────────────────────────────────────
// AudioPanel — the Sound wave's rail: everything that puts sound
// into a design, in one place.
//
//   1. Sound library — the 16-sound offline pack (original
//      synthesized CC0). Click = audition, plus = insert as a
//      native audio element (full analysis baked in — beat sync
//      works on day one).
//   2. Freesound search — the fourth stock connector, CC0 by
//      default, the PhotosPanel gated pattern (debounced live
//      search, F2b unkeyed hint, durable credit on insert).
//   3. Record voiceover — MediaRecorder into the chunked media
//      store through the same audio insert path. Mic denials are
//      handled honestly (permission toast, no broken UI).
//   4. Upload — audio files ride the Uploads panel (audio/* is
//      already accepted there); a hint points the way.
// ─────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from 'react'
import { AudioLines, Info, Loader2, Mic, Plus, Search, Square, Volume2 } from 'lucide-react'
import { PanelShell } from './panel-shell'
import { addSfxToCanvas, addStockSound } from '../add-element'
import { SFX_CATEGORIES, SFX_PACK, sfxUrl, type SfxCategory } from '@/lib/assets/sfx-pack'
import { playSfx } from '@/lib/sfx'
import { useStockSound } from '@/hooks/use-stock-sound'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

/** normalized result — the /api/stock-sound/search shape */
interface StockSoundTile {
  id: string
  name: string
  duration: number
  preview: string
  tags: string[]
  credit: { provider: string; author: string; license: string; url: string }
}

type SearchError = { kind: 'no-provider' } | { kind: 'service'; message: string }

/** hard stop at 5 minutes — voiceovers are page narration, not podcasts */
const MAX_VOICEOVER_MS = 5 * 60 * 1000

export function AudioPanel() {
  const { available, loaded } = useStockSound()
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState<SfxCategory | 'all'>('all')
  const [results, setResults] = useState<StockSoundTile[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<SearchError | null>(null)
  const [busyTile, setBusyTile] = useState<string | null>(null)
  const [insertingSfx, setInsertingSfx] = useState<string | null>(null)

  // ── voiceover state ──
  const [recording, setRecording] = useState(false)
  const [recordMs, setRecordMs] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const tickRef = useRef<number | null>(null)

  const lastQuery = useRef('')
  // a POSITIVE unkeyed answer (not "probe still in flight")
  const noProvider = loaded && !available

  // debounced live search (600 ms — the PhotosPanel cadence)
  useEffect(() => {
    const q = query.trim()
    const run = async () => {
      setBusy(true)
      setError(null)
      try {
        const res = await fetch('/api/stock-sound/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, count: 24 }),
        })
        const data = (await res.json().catch(() => ({}))) as { results?: StockSoundTile[]; error?: string; code?: string }
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
      // RACE GUARD (the A4 lesson): never consume the query while
      // availability is unresolved — the probe's landing re-runs this
      // effect, and a consumed query searches never again.
      if (q.length < 2 || !available) {
        setResults(null)
        setError(null)
        return
      }
      lastQuery.current = q
      void run()
    }, 600)
    return () => clearTimeout(t)
  }, [query, available])

  const pack = useMemo(() => SFX_PACK.filter((s) => cat === 'all' || s.category === cat), [cat])

  const insertSfx = async (id: string) => {
    if (insertingSfx) return
    setInsertingSfx(id)
    try {
      await addSfxToCanvas(id)
      toast({ title: 'Sound added', description: 'Plays in Preview and Present — autoplay it on the page for video export.' })
    } catch (err) {
      toast({ title: 'Could not add the sound', description: err instanceof Error ? err.message : 'Try again.' })
    } finally {
      setInsertingSfx(null)
    }
  }

  const insertStock = async (tile: StockSoundTile) => {
    if (busyTile) return
    setBusyTile(tile.id)
    try {
      await addStockSound(tile)
      toast({
        title: 'Sound added',
        description: `${tile.credit.provider} · ${tile.credit.author} — ${tile.credit.license}`,
      })
    } catch (err) {
      toast({
        title: 'Could not add the sound',
        description: err instanceof Error ? err.message : 'Try again — or pick another result.',
      })
    } finally {
      setBusyTile(null)
    }
  }

  // ── voiceover: MediaRecorder → chunked media store ──
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // codec ladder: opus/webm everywhere modern, mp4 for Safari
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : ''
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        void saveVoiceover(blob)
      }
      recorderRef.current = rec
      rec.start(250)
      setRecording(true)
      setRecordMs(0)
      const started = performance.now()
      tickRef.current = window.setInterval(() => {
        const ms = performance.now() - started
        setRecordMs(ms)
        if (ms >= MAX_VOICEOVER_MS) stopRecording()
      }, 200)
    } catch {
      toast({
        title: 'Microphone unavailable',
        description: 'The browser denied mic access, or no mic is connected — check the site permissions and try again.',
      })
    }
  }

  const stopRecording = () => {
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
    setRecording(false)
    recorderRef.current = null
  }

  const saveVoiceover = async (blob: Blob) => {
    if (blob.size < 512) {
      toast({ title: 'Recording too short', description: 'Hold the button a moment longer and try again.' })
      return
    }
    try {
      const { addVoiceoverRecording } = await import('../add-element')
      await addVoiceoverRecording(blob)
      toast({ title: 'Voiceover added', description: 'A waveform card landed on the page — play it in Preview.' })
    } catch (err) {
      toast({ title: 'Could not save the voiceover', description: err instanceof Error ? err.message : 'Try again.' })
    }
  }

  useEffect(() => () => stopRecording(), [])

  return (
    <PanelShell title="Audio" subtitle="Sound library, Freesound search and voiceover">
      <div className="space-y-5 p-3">
        {/* ── 1. offline pack ── */}
        <section aria-label="Sound library">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-white/50">Sound library</h4>
            <span className="text-[10px] text-white/40">16 CC0 sounds · works offline</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {(['all', 'transitions', 'impacts', 'ui', 'musical'] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                  cat === c ? 'bg-[#7630D7] text-white' : 'bg-white/5 text-white/60 hover:bg-white/10',
                )}
                aria-pressed={cat === c}
              >
                {c === 'all' ? 'All' : SFX_CATEGORIES[c]}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5" data-testid="sfx-grid">
            {pack.map((s) => (
              <div
                key={s.id}
                className="group flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2 hover:border-[#7630D7]/60"
              >
                <button
                  onClick={() => playSfx(s.id)}
                  title={`Play ${s.label}`}
                  aria-label={`Play ${s.label}`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-white/70 transition-colors hover:bg-[#7630D7]/40 hover:text-white"
                >
                  <Volume2 size={14} />
                </button>
                <button
                  onClick={() => void insertSfx(s.id)}
                  disabled={insertingSfx === s.id}
                  title={`${s.hint} — add to the page`}
                  className="flex min-w-0 flex-1 flex-col items-start text-left disabled:opacity-50"
                >
                  <span className="w-full truncate text-[12px] font-medium text-white/85">{s.label}</span>
                  <span className="w-full truncate text-[10px] text-white/40">{s.seconds}s · {s.hint}</span>
                </button>
                {insertingSfx === s.id && <Loader2 size={13} className="shrink-0 animate-spin text-white/50" />}
              </div>
            ))}
          </div>
        </section>

        {/* ── 2. Freesound search ── */}
        <section aria-label="Freesound search">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-white/50">Freesound</h4>
            <span className="text-[10px] text-white/40">CC0 by default</span>
          </div>
          <div className="mt-2 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
            <Search size={14} className="shrink-0 text-white/40" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={available ? 'Search sounds — rain, whoosh, click…' : 'Search sounds (needs the Freesound key)'}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-white/85 outline-none placeholder:text-white/35"
              aria-label="Search Freesound"
              data-testid="sound-search-input"
            />
            {busy && <Loader2 size={14} className="shrink-0 animate-spin text-white/40" />}
          </div>

          {noProvider && (
            <div className="mt-2 rounded-xl border border-amber-400/25 bg-amber-400/10 p-2.5 text-[11px] leading-relaxed text-amber-200/90" data-testid="sound-unkeyed-hint">
              <span className="flex items-start gap-1.5">
                <Info size={13} className="mt-0.5 shrink-0" />
                <span>
                  Sound search is off on this server — the operator sets a free{' '}
                  <strong>Freesound</strong> key on the admin AI &amp; models page (or{' '}
                  <code className="rounded bg-black/20 px-1">FREESOUND_API_KEY</code>). Results are
                  Creative Commons 0 by default. The Sound library above works without any key.
                </span>
              </span>
            </div>
          )}

          {error?.kind === 'service' && (
            <p className="mt-2 rounded-xl border border-red-400/25 bg-red-400/10 p-2.5 text-[11px] text-red-200/90">{error.message}</p>
          )}

          {results !== null && results.length === 0 && !error && (
            <p className="mt-2 text-[11px] text-white/40">No sounds matched — try a broader term.</p>
          )}

          {results && results.length > 0 && (
            <div className="mt-2 space-y-1.5" data-testid="sound-results">
              {results.map((tile) => (
                <div
                  key={tile.id}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2 hover:border-[#7630D7]/60"
                >
                  <button
                    onClick={() => {
                      const a = new Audio(tile.preview)
                      void a.play().catch(() => toast({ title: 'Could not play the preview' }))
                    }}
                    title={`Play ${tile.name}`}
                    aria-label={`Play ${tile.name}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-white/70 transition-colors hover:bg-[#7630D7]/40 hover:text-white"
                  >
                    <Volume2 size={14} />
                  </button>
                  <button
                    onClick={() => void insertStock(tile)}
                    disabled={busyTile === tile.id}
                    className="flex min-w-0 flex-1 flex-col items-start text-left disabled:opacity-50"
                  >
                    <span className="w-full truncate text-[12px] font-medium text-white/85">{tile.name}</span>
                    <span className="w-full truncate text-[10px] text-white/40">
                      {tile.duration.toFixed(1)}s · {tile.credit.provider} · {tile.credit.author} — {tile.credit.license}
                    </span>
                  </button>
                  {busyTile === tile.id ? (
                    <Loader2 size={13} className="shrink-0 animate-spin text-white/50" />
                  ) : (
                    <Plus size={14} className="shrink-0 text-white/30" />
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── 3. voiceover ── */}
        <section aria-label="Voiceover">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-white/50">Voiceover</h4>
          <p className="mt-1 text-[11px] leading-relaxed text-white/40">
            Record page narration with your mic — it lands as a waveform card, autoplayed in Preview and Present.
          </p>
          <button
            onClick={() => (recording ? stopRecording() : void startRecording())}
            className={cn(
              'mt-2 flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-[13px] font-semibold transition-colors',
              recording
                ? 'border-red-400/40 bg-red-500/20 text-red-200 hover:bg-red-500/30'
                : 'border-white/10 bg-white/[0.03] text-white/80 hover:border-[#7630D7]/60 hover:bg-[#7630D7]/15',
            )}
            data-testid="voiceover-button"
            aria-pressed={recording}
          >
            {recording ? <Square size={14} /> : <Mic size={14} />}
            {recording
              ? `Stop — ${(recordMs / 1000).toFixed(1)}s (max 5 min)`
              : 'Record voiceover'}
          </button>
        </section>

        {/* ── 4. uploads hint ── */}
        <section aria-label="Upload audio">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-white/50">Your audio files</h4>
          <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-white/40">
            <AudioLines size={13} className="mt-0.5 shrink-0" />
            <span>
              Music and audio files upload from the Uploads panel (MP3, WAV, OGG…) — waveform, BPM and beat
              grid bake in automatically.
            </span>
          </p>
        </section>
      </div>
    </PanelShell>
  )
}
