// ─────────────────────────────────────────────────────────────
// Per-IP rate limits + SSE connection caps (v0.12.3, roadmap H5 —
// research/V0118-ROADMAP-RESEARCH.md §5.1).
//
// Scope (the epic's list): designs CRUD, collab events/presence,
// comment creation and media upload init get per-IP request
// limits; the SSE stream gets a per-IP concurrent-connection cap.
// The MCP route already carries its own 120 req/min/IP limiter.
//
// Semantics, stated honestly (README → “Rate limiting”):
//   - fixed-window counters, IN MEMORY, PER SERVER INSTANCE. A
//     multi-instance fleet (or serverless platform spawning many
//     isolates) enforces each cap per instance, not per deployment
//     — the shared-store upgrade is deliberately post-1.0 (debt
//     #12) and documented as such.
//   - the client IP is taken from x-forwarded-for / x-real-ip —
//     the headers every reverse proxy and hosting platform sets.
//     A bare `next start` with no proxy in front exposes no
//     client address to route handlers, so such deployments fall
//     back to the shared “unknown” bucket (localhost is trusted
//     anyway; the caps still stop runaway loops).
//   - limits are generous enough for real editing (autosave fires
//     at most ~37/min after its 1.6 s debounce; collab flushes at
//     2.5/min idle / 150/min active) — they exist to stop abuse
//     and runaway loops, never to throttle a working editor.
//
// Turn everything off with CANVIX_RATE_LIMITS=off (self-hosters
// behind their own throttle, or load tests).
// ─────────────────────────────────────────────────────────────

import type { NextRequest } from 'next/server'

export type RateLimitBucket =
  | 'designs:create'
  | 'designs:update'
  | 'designs:delete'
  | 'collab:events'
  | 'collab:presence'
  | 'comments:create'
  | 'media:init'
  | 'plugins:install'
  | 'plugins:serve'

export interface RateLimitConfig {
  /** window length in milliseconds */
  windowMs: number
  /** allowed requests per window per IP */
  max: number
}

/** The defaults — override per bucket in tests via RATE_LIMITS. */
export const RATE_LIMITS: Record<RateLimitBucket, RateLimitConfig> = {
  'designs:create': { windowMs: 60_000, max: 30 },
  // autosave: 1.6 s debounce → ≤ 37/min per client; 300/min leaves
  // room for multi-tab + collaboration saves before it ever bites
  'designs:update': { windowMs: 60_000, max: 300 },
  'designs:delete': { windowMs: 60_000, max: 60 },
  // collab flush cadence is 400 ms per active client → 150/min
  'collab:events': { windowMs: 60_000, max: 600 },
  // presence heartbeats every 15 s → 4/min per client
  'collab:presence': { windowMs: 60_000, max: 120 },
  'comments:create': { windowMs: 60_000, max: 60 },
  'media:init': { windowMs: 60_000, max: 30 },
  // installs are rare and heavy (server-side fetch fan-out) — a
  // generous ceiling that still blocks scripted bulk installs
  'plugins:install': { windowMs: 60_000, max: 10 },
  // one panel mount loads ~5–10 assets; 600/min covers a session
  // of panel open/close without inviting scrape-the-DB abuse
  'plugins:serve': { windowMs: 60_000, max: 600 },
}

export function rateLimitsDisabled(): boolean {
  return process.env.CANVIX_RATE_LIMITS === 'off'
}

/**
 * Best-effort client IP for rate keying. x-forwarded-for (first
 * hop, left-most) wins, then x-real-ip; otherwise the shared
 * “unknown” bucket. Never trusted for AUTHORIZATION — only for
 * throttling, where a spoofed header at worst merges buckets.
 */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  const real = req.headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}

// ── fixed-window counters ─────────────────────────────────────

interface WindowState {
  count: number
  resetAt: number
}

const windows = new Map<string, WindowState>()
/** injectable clock — tests control the window rollover */
let now: () => number = () => Date.now()

const MAX_TRACKED_KEYS = 10_000

function sweep(nowMs: number): void {
  if (windows.size <= MAX_TRACKED_KEYS) return
  for (const [key, state] of windows) {
    if (state.resetAt <= nowMs) windows.delete(key)
  }
  // still oversized (an attacker spraying keys)? drop the oldest
  // half wholesale — availability of the map beats precision
  if (windows.size > MAX_TRACKED_KEYS) {
    const entries = [...windows.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt)
    for (const [key] of entries.slice(0, Math.floor(entries.length / 2))) {
      windows.delete(key)
    }
  }
}

export interface RateLimitResult {
  ok: boolean
  /** seconds until the window resets (0 when allowed) */
  retryAfterSec: number
}

/**
 * Consume one request from the bucket for this client. Pure bookkeeping —
 * call once per request, on the hot path, before any DB work.
 */
export function checkRateLimit(
  req: NextRequest,
  bucket: RateLimitBucket,
): RateLimitResult {
  if (rateLimitsDisabled()) return { ok: true, retryAfterSec: 0 }
  const config = RATE_LIMITS[bucket]
  const nowMs = now()
  const key = `${bucket}:${clientIp(req)}`
  const state = windows.get(key)
  if (!state || state.resetAt <= nowMs) {
    windows.set(key, { count: 1, resetAt: nowMs + config.windowMs })
    sweep(nowMs)
    return { ok: true, retryAfterSec: 0 }
  }
  if (state.count < config.max) {
    state.count += 1
    return { ok: true, retryAfterSec: 0 }
  }
  return {
    ok: false,
    retryAfterSec: Math.max(1, Math.ceil((state.resetAt - nowMs) / 1000)),
  }
}

/** Standard 429 body + Retry-After header for a rejected request. */
export function rateLimitResponse(result: RateLimitResult): Response {
  return Response.json(
    {
      error: 'Too many requests — slow down.',
      code: 'RATE_LIMITED',
      retryAfterSec: result.retryAfterSec,
    },
    {
      status: 429,
      headers: { 'Retry-After': String(result.retryAfterSec) },
    },
  )
}

// ── SSE concurrent-connection cap ────────────────────────────

const streamCounts = new Map<string, number>()

export function maxStreamsPerIp(): number {
  return Math.max(1, Number(process.env.CANVIX_SSE_MAX_PER_IP ?? 6))
}

/**
 * Reserve one SSE slot for this IP. Returns true when the
 * connection may proceed; always pair with releaseStreamSlot()
 * in the stream's cleanup path.
 */
export function acquireStreamSlot(ip: string): boolean {
  if (rateLimitsDisabled()) return true
  const current = streamCounts.get(ip) ?? 0
  if (current >= maxStreamsPerIp()) return false
  streamCounts.set(ip, current + 1)
  return true
}

export function releaseStreamSlot(ip: string): void {
  const current = streamCounts.get(ip)
  if (current === undefined) return
  if (current <= 1) streamCounts.delete(ip)
  else streamCounts.set(ip, current - 1)
}

export function activeStreamsFor(ip: string): number {
  return streamCounts.get(ip) ?? 0
}

// ── test hooks ───────────────────────────────────────────────

/** Test-only: wipe all counters + restore defaults. */
export function resetRateLimitState(): void {
  windows.clear()
  streamCounts.clear()
}

/** Test-only: control the clock. */
export function setRateLimitClock(clock: (() => number) | null): void {
  now = clock ?? (() => Date.now())
}
