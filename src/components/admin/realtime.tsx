'use client'

// Live traffic panel (v0.16.2 A2) — polls GET /api/admin/realtime every
// 2 s and renders the in-memory rolling counters: a per-second request
// sparkline (last 60 s), 5-minute request/error/visitor/AI totals, a
// latency ring (p50/p95) and the window's top routes. Pauses itself
// when the tab is hidden (visibilitychange) so an idle dashboard stops
// polling; the panel's own poll is excluded from the counters server-
// side (see observability.ts), so the numbers shown are site traffic,
// not dashboard noise.

import { useEffect, useRef, useState } from 'react'
import { getJson } from './fetch'
import { Card, Chip } from './bits'
import { fmt } from './charts'

interface SecondPoint {
  t: number
  req: number
  err: number
}
interface RealtimeView {
  now: string
  uptimeSec: number
  seconds: SecondPoint[]
  window5m: {
    requests: number
    errors: number
    visitors: number
    p50Ms: number | null
    p95Ms: number | null
    aiCalls: number
    aiOk: number
  }
  topRoutes: { route: string; hits: number }[]
}

const POLL_MS = 2000

function fmtUptime(sec: number): string {
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return `${h}h ${m}m`
}

/** Hand-rolled per-second area sparkline — zero new dependencies. */
function Sparkline({ points }: { points: SecondPoint[] }) {
  const W = 600
  const H = 72
  const max = Math.max(1, ...points.map((p) => p.req))
  const step = W / Math.max(points.length - 1, 1)
  const y = (v: number) => H - 2 - (v / max) * (H - 6)
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(p.req).toFixed(1)}`).join(' ')
  const area = `${line} L${W},${H} L0,${H} Z`
  const errLine = points.some((p) => p.err > 0)
    ? points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(p.err).toFixed(1)}`).join(' ')
    : null
  const last = points[points.length - 1]
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height: H }}
      role="img"
      aria-label="requests per second, last 60 seconds"
    >
      <path d={area} fill="var(--cv-teal)" opacity={0.15} />
      <path d={line} fill="none" stroke="var(--cv-teal)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
      {errLine && (
        <path
          d={errLine}
          fill="none"
          stroke="var(--destructive)"
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
          opacity={0.8}
        />
      )}
      {last && <circle cx={W} cy={y(last.req)} r={2.5} fill="var(--cv-teal)" />}
    </svg>
  )
}

export function AdminRealtime() {
  const [data, setData] = useState<RealtimeView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const [stale, setStale] = useState(false)
  const aliveRef = useRef(true)

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
      try {
        const res = await getJson<RealtimeView>('/api/admin/realtime')
        if (!aliveRef.current) return
        if (res.ok) {
          setData(res.data)
          setError(null)
          setStale(false)
        } else {
          setError(res.data?.error ?? `Request failed (${res.status})`)
          setStale(true)
        }
      } catch {
        if (aliveRef.current) {
          setError('Live endpoint unreachable — retrying.')
          setStale(true)
        }
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

  const reqPerMin = data ? data.seconds.reduce((a, p) => a + p.req, 0) : 0
  const errPerMin = data ? data.seconds.reduce((a, p) => a + p.err, 0) : 0

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          Live traffic
          <span className="relative flex h-2.5 w-2.5" aria-hidden>
            <span
              className={`absolute inline-flex h-full w-full rounded-full ${paused || stale || error ? 'bg-muted-foreground/40' : 'animate-ping bg-emerald-500/60'}`}
            />
            <span
              className={`relative inline-flex h-2.5 w-2.5 rounded-full ${paused || stale || error ? 'bg-muted-foreground/50' : 'bg-emerald-500'}`}
            />
          </span>
        </span>
      }
      right={
        data ? (
          <div className="flex items-center gap-2">
            {paused && <Chip>paused — tab hidden</Chip>}
            {stale && <Chip tone="bad">reconnecting</Chip>}
            <Chip>up {fmtUptime(data.uptimeSec)}</Chip>
          </div>
        ) : undefined
      }
    >
      {error && !data ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : !data ? (
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Requests / min</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums text-card-foreground">{fmt(reqPerMin)}</p>
              <p className="text-xs text-muted-foreground">last 60 s</p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Errors / min</p>
              <p className={`mt-0.5 text-2xl font-semibold tabular-nums ${errPerMin > 0 ? 'text-destructive' : 'text-card-foreground'}`}>
                {fmt(errPerMin)}
              </p>
              <p className="text-xs text-muted-foreground">4xx + 5xx</p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Active visitors</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums text-card-foreground">{fmt(data.window5m.visitors)}</p>
              <p className="text-xs text-muted-foreground">last 5 min</p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Requests (5 min)</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums text-card-foreground">{fmt(data.window5m.requests)}</p>
              <p className="text-xs text-muted-foreground">
                {data.window5m.errors > 0 ? `${fmt(data.window5m.errors)} errors` : 'no errors'}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Latency p50 / p95</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums text-card-foreground">
                {data.window5m.p50Ms !== null ? `${data.window5m.p50Ms}ms` : '—'}
              </p>
              <p className="text-xs text-muted-foreground">
                p95 {data.window5m.p95Ms !== null ? `${data.window5m.p95Ms}ms` : '—'}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">AI calls (5 min)</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums text-card-foreground">{fmt(data.window5m.aiCalls)}</p>
              <p className="text-xs text-muted-foreground">
                {data.window5m.aiCalls > 0
                  ? `${fmt(data.window5m.aiOk)} ok · ${fmt(Math.max(0, data.window5m.aiCalls - data.window5m.aiOk))} failed`
                  : 'recent requests'}
              </p>
            </div>
          </div>

          <div className="mt-4">
            <Sparkline points={data.seconds} />
            <p className="mt-1 text-xs text-muted-foreground">
              requests per second — teal = requests, red = errors (peak {fmt(Math.max(1, ...data.seconds.map((p) => p.req)))}/s)
            </p>
          </div>

          {data.topRoutes.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Top routes — last 5 min</p>
              <ul className="divide-y">
                {data.topRoutes.map((r) => (
                  <li key={r.route} className="flex items-center justify-between gap-4 py-1.5 text-sm">
                    <code className="truncate font-mono text-xs">{r.route}</code>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{fmt(r.hits)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        </>
      )}
    </Card>
  )
}
