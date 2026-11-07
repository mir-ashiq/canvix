'use client'

// Logs view (v0.16.3 A3) — the "why did the AI feature fail" page.
//
// Two surfaces:
//   Slot status — what each of the five AI capability slots resolves
//   to right now (provider, model, config source). A slot wired to a
//   chat-only provider is the classic silent breakage: text features
//   work, image generation 404s. The strip makes the wiring visible
//   before anything is even tried.
//
//   Request log — one row per AI request (AIUsage via
//   /api/admin/logs): feature, provider, model, outcome status,
//   round-trip duration and — the point of the page — the scrubbed
//   error reason, the same string the client's 502 body carries.
//   Live tail (5 s, pauses when the tab hides), window / feature /
//   outcome filters, and per-feature call/error counters.

import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { getJson } from './fetch'
import { Card, Chip } from './bits'

interface AiLogRow {
  id: string
  createdAt: string
  feature: string
  provider: string
  model: string | null
  ok: boolean
  status: number | null
  durationMs: number | null
  error: string | null
}
interface AiLogCounts {
  total: number
  errors: number
  byFeature: Record<string, { calls: number; errors: number }>
}
interface SlotView {
  slot: string
  configured: boolean
  providerId?: string | null
  label?: string | null
  baseUrl?: string
  model?: string | null
  source?: string
}
interface LogsView {
  log: { window: string; rows: AiLogRow[]; counts: AiLogCounts }
  slots: SlotView[]
}

const POLL_MS = 5000

const SLOT_LABEL: Record<string, string> = {
  text: 'Text',
  vision: 'Vision',
  image: 'Image generation',
  imageEdit: 'Image editing',
  imageSearch: 'Photo search',
}
const SLOT_FEATURES: Record<string, string> = {
  text: 'Magic Write · Translate · Assistant',
  vision: 'Magic Layers',
  image: 'Photos panel → Generate',
  imageEdit: 'Magic Eraser · Enhance · BG remove',
  imageSearch: 'Photos panel → Search',
}
const SOURCE_LABEL: Record<string, string> = {
  multi: 'providers table',
  db: 'legacy override',
  env: 'environment variables',
  file: '.z-ai-config file',
}
const WINDOWS = ['15m', '1h', '6h', '24h', '7d'] as const
const FEATURES = ['assistant', 'write', 'translate', 'image', 'image-edit', 'magic-layers', 'search'] as const

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
function fmtDay(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
function fmtMs(ms: number | null): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

/** Status chip: 2xx green, 4xx amber, 5xx/none red for AI rows. */
function StatusChip({ ok, status }: { ok: boolean; status: number | null }) {
  if (ok) return <Chip tone="good">{status ?? 'ok'}</Chip>
  if (status === 429) return <Chip tone="bad">429 · rate limit</Chip>
  if (status === 403) return <Chip tone="bad">403 · rejected</Chip>
  if (status === 503) return <Chip tone="bad">503 · unconfigured</Chip>
  return <Chip tone="bad">{status ?? 'failed'}</Chip>
}

export function AdminLogs() {
  const [data, setData] = useState<LogsView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [paused, setPaused] = useState(false)
  const [live, setLive] = useState(true)
  const [busy, setBusy] = useState(false)

  const [window, setWindow] = useState<(typeof WINDOWS)[number]>('24h')
  const [feature, setFeature] = useState<string>('')
  const [outcome, setOutcome] = useState<'all' | 'errors' | 'ok'>('all')

  const liveRef = useRef(true)
  const aliveRef = useRef(true)

  async function fetchOnce(): Promise<boolean> {
    const params = new URLSearchParams({ window, outcome, limit: '150' })
    if (feature) params.set('feature', feature)
    const res = await getJson<LogsView>(`/api/admin/logs?${params.toString()}`)
    if (!aliveRef.current) return false
    if (res.ok) {
      setData(res.data)
      setError(null)
      setStale(false)
      return true
    }
    setError(res.data?.error ?? `Request failed (${res.status})`)
    setStale(true)
    return false
  }

  // refetch on filter change (silently — the live loop keeps the data warm;
  // deferred a tick so no setState runs synchronously inside the effect)
  useEffect(() => {
    aliveRef.current = true
    liveRef.current = live
    const t = setTimeout(() => void fetchOnce(), 0)
    return () => {
      aliveRef.current = false
      clearTimeout(t)
    }
  }, [window, feature, outcome])

  // live tail loop
  useEffect(() => {
    aliveRef.current = true
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      if (!aliveRef.current) return
      if (typeof document !== 'undefined' && document.hidden) {
        setPaused(true)
        timer = setTimeout(tick, POLL_MS)
        return
      }
      setPaused(false)
      if (liveRef.current) {
        await fetchOnce()
      }
      if (aliveRef.current) timer = setTimeout(tick, POLL_MS)
    }
    void tick()
    const onVisibility = () => {
      /* next tick picks the state up */
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      aliveRef.current = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  async function refreshNow() {
    setBusy(true)
    await fetchOnce()
    setBusy(false)
  }

  const counts = data?.log.counts
  const rows = data?.log.rows ?? []
  const errorRate = counts && counts.total > 0 ? Math.round((counts.errors / counts.total) * 100) : 0

  return (
    <>
      {/* ── slot status ── */}
      <Card
        title="AI slot status"
        right={<Chip tone={data && data.slots.some((s) => s.configured) ? 'good' : 'bad'}>{data ? `${data.slots.filter((s) => s.configured).length}/5 wired` : '…'}</Chip>}
      >
        <p className="mb-4 text-sm text-muted-foreground">
          What each AI capability resolves to right now. A slot on a provider that does not serve its endpoint is the
          usual reason a feature &ldquo;silently&rdquo; fails — text can work on a chat-only provider while image
          generation 404s on the very same key. Configure providers and slots on the{' '}
          <a href="/admin/ai" className="underline underline-offset-2">
            AI &amp; models
          </a>{' '}
          page.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(data?.slots ?? []).map((s) => (
            <div key={s.slot} className="rounded-xl border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{SLOT_LABEL[s.slot] ?? s.slot}</p>
                {s.configured ? <Chip tone="good">wired</Chip> : <Chip tone="bad">not configured</Chip>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{SLOT_FEATURES[s.slot] ?? ''}</p>
              {s.configured ? (
                <p className="mt-2 break-all font-mono text-xs">
                  {s.label ?? s.baseUrl}
                  <br />
                  <span className="text-muted-foreground">
                    {s.model ?? 'provider default'} · {SOURCE_LABEL[s.source ?? ''] ?? s.source}
                  </span>
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">feature reports unavailable</p>
              )}
            </div>
          ))}
          {!data && <div className="h-20 animate-pulse rounded-xl bg-muted" />}
        </div>
      </Card>

      {/* ── request log ── */}
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            AI request log
            {live && (
              <span className="relative flex h-2.5 w-2.5" aria-hidden>
                <span
                  className={`absolute inline-flex h-full w-full rounded-full ${paused || stale || error ? 'bg-muted-foreground/40' : 'animate-ping bg-emerald-500/60'}`}
                />
                <span
                  className={`relative inline-flex h-2.5 w-2.5 rounded-full ${paused || stale || error ? 'bg-muted-foreground/50' : 'bg-emerald-500'}`}
                />
              </span>
            )}
          </span>
        }
        right={
          counts ? (
            <div className="flex flex-wrap items-center gap-2">
              <Chip>{counts.total} calls</Chip>
              <Chip tone={counts.errors > 0 ? 'bad' : 'good'}>
                {counts.errors} errors · {errorRate}%
              </Chip>
            </div>
          ) : undefined
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className="text-xs">
            <span className="sr-only">Window</span>
            <select
              value={window}
              onChange={(e) => setWindow(e.target.value as (typeof WINDOWS)[number])}
              className="h-9 rounded-lg border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              {WINDOWS.map((w) => (
                <option key={w} value={w}>
                  last {w}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="sr-only">Feature</span>
            <select
              value={feature}
              onChange={(e) => setFeature(e.target.value)}
              className="h-9 rounded-lg border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">all features</option>
              {FEATURES.map((f) => (
                <option key={f} value={f}>
                  {f} {counts && counts.byFeature[f] ? `(${counts.byFeature[f].calls})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="sr-only">Outcome</span>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as 'all' | 'errors' | 'ok')}
              className="h-9 rounded-lg border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="all">all outcomes</option>
              <option value="errors">errors only</option>
              <option value="ok">successes only</option>
            </select>
          </label>
          <button
            onClick={() => setLive((v) => !v)}
            className={`h-9 rounded-lg border px-3 text-sm font-medium transition-colors ${live ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
            aria-pressed={live}
          >
            {live ? 'Live · 5s' : 'Live off'}
          </button>
          <button
            onClick={() => void refreshNow()}
            disabled={busy}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Refresh
          </button>
          {paused && <Chip>paused — tab hidden</Chip>}
          {stale && <Chip tone="bad">reconnecting</Chip>}
        </div>

        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">When</th>
                <th className="py-2 pr-3 font-medium">Feature</th>
                <th className="py-2 pr-3 font-medium">Provider · model</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Took</th>
                <th className="py-2 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b align-top last:border-0">
                  <td className="whitespace-nowrap py-2 pr-3 text-xs tabular-nums text-muted-foreground">
                    {fmtDay(r.createdAt)} {fmtTime(r.createdAt)}
                  </td>
                  <td className="py-2 pr-3 font-medium">{r.feature}</td>
                  <td className="max-w-[220px] break-all py-2 pr-3 font-mono text-xs">
                    {r.provider}
                    {r.model ? <span className="text-muted-foreground"> · {r.model}</span> : null}
                  </td>
                  <td className="py-2 pr-3">
                    <StatusChip ok={r.ok} status={r.status} />
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-xs tabular-nums text-muted-foreground">
                    {fmtMs(r.durationMs)}
                  </td>
                  <td className="py-2 text-xs">
                    {r.error ? (
                      <span className="text-destructive" title={r.error}>
                        {r.error}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{r.ok ? '—' : '(no reason recorded)'}</span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                    {data ? 'No AI requests in this window yet.' : 'Loading…'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {data && rows.length >= 150 && (
          <p className="mt-2 text-xs text-muted-foreground">Showing the newest 150 — narrow the window or filters for older rows.</p>
        )}
      </Card>
    </>
  )
}
