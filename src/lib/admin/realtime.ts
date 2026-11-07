// ─────────────────────────────────────────────────────────────
// Real-time traffic (v0.16.2 A2) — the live counters behind the
// console's "Live traffic" panel (GET /api/admin/realtime).
//
// In-memory rolling windows over the same withLogging wrapper every
// API route already uses:
//   • per-second request/error buckets — last 120 s
//   • per-route per-minute hits — last 5 min
//   • per-visitor (hashed, per-boot salt) last-seen — 5 min window
//   • recent latency ring — last 720 requests (p50/p95)
//   • AI calls per minute (ok + failed) — last 5 min
//
// CONTRACT (same as src/lib/observability.ts):
//   • ZERO imports — stdlib-only, no Prisma, no db. This module is
//     statically imported by observability.ts, so it must stay safe
//     for every runtime Canvix supports (Node, Bun, workerd/edge).
//   • Bounded memory: every structure has a hard cap and is swept
//     lazily on write and on read.
//   • Process-local: counters reset on restart. The TrafficStat /
//     AIUsage tables remain the durable record (docs/ADMIN.md).
//   • CANVIX_TRAFFIC=0 — the documented opt-out for traffic
//     counting — disables live recording too (checked inline: this
//     module deliberately imports nothing).
//   • Privacy: visitors are counted through a salted, non-cryptographic
//     hash of the client IP (see liveVisitorKey in observability.ts —
//     per-boot salt, never the IP itself). Counts only, never ids,
//     never query strings — the same stance as /api/health?v=2.
// ─────────────────────────────────────────────────────────────

/** Rolling window for routes / visitors / AI minutes. */
const WINDOW_MS = 5 * 60_000
/** Per-second buckets kept (snapshot shows the newest 60). */
const SECONDS_KEPT = 120
/** Hard cap on distinct route keys (misbehaving wrapper names). */
const ROUTES_MAX = 128
/** Hard cap on distinct visitor keys — far above any real audience. */
const VISITORS_MAX = 4096
/** Latency ring size (p50/p95 over the most recent requests). */
const LATENCY_RING = 720

interface SecondBucket {
  req: number
  err: number
}
interface AiMinute {
  calls: number
  ok: number
}

const bootAt = Date.now()

// module state (single-process by design — see header)
const seconds = new Map<number, SecondBucket>()
const minuteTotals = new Map<number, SecondBucket>() // 5-minute window totals
const routes = new Map<string, Map<number, number>>() // "METHOD /route" → minute → hits
const visitors = new Map<string, number>() // hash → last-seen ms
const latencies: number[] = []
const aiMinutes = new Map<number, AiMinute>()
let sweepTick = 0

function disabled(): boolean {
  return process.env.CANVIX_TRAFFIC === '0'
}

/** Drop everything outside the windows. Cheap, called on write + read. */
function sweep(now: number): void {
  const secondCutoff = Math.floor(now / 1000) - SECONDS_KEPT
  for (const key of seconds.keys()) {
    if (key <= secondCutoff) seconds.delete(key)
  }
  const minuteCutoff = Math.floor(now / 60_000) - Math.floor(WINDOW_MS / 60_000)
  for (const key of minuteTotals.keys()) {
    if (key <= minuteCutoff) minuteTotals.delete(key)
  }
  for (const [route, minutes] of routes) {
    for (const m of minutes.keys()) {
      if (m <= minuteCutoff) minutes.delete(m)
    }
    if (!minutes.size) routes.delete(route)
  }
  const msCutoff = now - WINDOW_MS
  for (const [visitor, seen] of visitors) {
    if (seen < msCutoff) visitors.delete(visitor)
  }
  for (const m of aiMinutes.keys()) {
    if (m <= minuteCutoff) aiMinutes.delete(m)
  }
}

/**
 * Record one API request (called from withLogging — fire-and-forget,
 * synchronous, cannot throw). `routeKey` is the wrapper name
 * ("METHOD /route"), `visitor` the hashed client key or null.
 */
export function recordLiveRequest(
  routeKey: string,
  status: number,
  durationMs: number,
  visitor: string | null,
  now: number = Date.now()
): void {
  if (disabled()) return
  // amortize the sweep — every 16th hit is enough at any real rps
  if ((sweepTick = (sweepTick + 1) & 15) === 0) sweep(now)
  const sec = Math.floor(now / 1000)
  let bucket = seconds.get(sec)
  if (!bucket) {
    bucket = { req: 0, err: 0 }
    seconds.set(sec, bucket)
  }
  bucket.req++
  if (status >= 400) bucket.err++
  const minute = Math.floor(now / 60_000)
  let totals = minuteTotals.get(minute)
  if (!totals) {
    totals = { req: 0, err: 0 }
    minuteTotals.set(minute, totals)
  }
  totals.req++
  if (status >= 400) totals.err++
  const route = routeKey.slice(0, 160)
  let minutes = routes.get(route)
  if (!minutes) {
    if (routes.size >= ROUTES_MAX) {
      // evict the route with the fewest total hits — bounded, keeps the hot ones
      let victim: string | null = null
      let victimHits = Number.POSITIVE_INFINITY
      for (const [r, m] of routes) {
        let total = 0
        for (const v of m.values()) total += v
        if (total < victimHits) {
          victimHits = total
          victim = r
        }
      }
      if (victim) routes.delete(victim)
    }
    minutes = new Map()
    routes.set(route, minutes)
  }
  minutes.set(minute, (minutes.get(minute) ?? 0) + 1)
  if (visitor) {
    if (visitors.size >= VISITORS_MAX && !visitors.has(visitor)) {
      // drop the stalest entry — the sweep will regenerate it if still active
      let victim: string | null = null
      let victimSeen = Number.POSITIVE_INFINITY
      for (const [v, seen] of visitors) {
        if (seen < victimSeen) {
          victimSeen = seen
          victim = v
        }
      }
      if (victim) visitors.delete(victim)
    }
    visitors.set(visitor, now)
  }
  if (latencies.length >= LATENCY_RING) latencies.shift()
  latencies.push(Math.max(0, Math.round(durationMs)))
}

/** Record one AI call outcome (called from recordUsage — sync, safe). */
export function recordLiveAi(feature: string, ok: boolean, now: number = Date.now()): void {
  if (disabled()) return
  const minute = Math.floor(now / 60_000)
  let bucket = aiMinutes.get(minute)
  if (!bucket) {
    bucket = { calls: 0, ok: 0 }
    aiMinutes.set(minute, bucket)
  }
  bucket.calls++
  if (ok) bucket.ok++
  void feature // feature-level live split is a future knob; totals for now
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))
  return sorted[idx]
}

/** Snapshot shape returned by GET /api/admin/realtime. */
export interface LiveSnapshot {
  now: string
  uptimeSec: number
  /** Newest-last per-second buckets, gap-filled to exactly 60 entries. */
  seconds: { t: number; req: number; err: number }[]
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

/**
 * The console's live view. Reads are cheap; the sweep keeps every map
 * bounded even on a burst of reads without writes.
 */
export function liveSnapshot(now: number = Date.now()): LiveSnapshot {
  sweep(now)
  // 60 gap-filled per-second buckets, oldest first
  const currentSec = Math.floor(now / 1000)
  const secondsOut: { t: number; req: number; err: number }[] = []
  for (let i = 59; i >= 0; i--) {
    const t = currentSec - i
    const b = seconds.get(t)
    secondsOut.push({ t, req: b?.req ?? 0, err: b?.err ?? 0 })
  }
  const minuteCutoff = Math.floor(now / 60_000) - Math.floor(WINDOW_MS / 60_000)
  let requests5m = 0
  let errors5m = 0
  for (const [m, b] of minuteTotals) {
    if (m <= minuteCutoff) continue
    requests5m += b.req
    errors5m += b.err
  }
  let aiCalls = 0
  let aiOk = 0
  for (const [m, b] of aiMinutes) {
    if (m <= minuteCutoff) continue
    aiCalls += b.calls
    aiOk += b.ok
  }
  const sorted = [...latencies].sort((a, b) => a - b)
  const topRoutes = [...routes.entries()]
    .map(([route, minutes]) => {
      let hits = 0
      for (const [m, n] of minutes) {
        if (m > minuteCutoff) hits += n
      }
      return { route, hits }
    })
    .filter((r) => r.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 8)
  return {
    now: new Date(now).toISOString(),
    uptimeSec: Math.floor((now - bootAt) / 1000),
    seconds: secondsOut,
    window5m: {
      requests: requests5m,
      errors: errors5m,
      visitors: visitors.size,
      p50Ms: percentile(sorted, 0.5),
      p95Ms: percentile(sorted, 0.95),
      aiCalls,
      aiOk,
    },
    topRoutes,
  }
}

/** Test hook — wipe every counter. */
export function resetRealtime(): void {
  seconds.clear()
  minuteTotals.clear()
  routes.clear()
  visitors.clear()
  latencies.length = 0
  aiMinutes.clear()
}
