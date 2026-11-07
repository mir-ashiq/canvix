// ─────────────────────────────────────────────────────────────
// AI request log query layer (v0.16.3 A3) — the data behind
// /admin/logs.
//
// AIUsage (extended by migration 0010) is one row per AI request
// through withProvider: feature, provider, model, outcome status,
// round-trip duration and a scrubbed error reason. This module
// shapes the admin-facing view: window parsing, filter parsing and
// the row/summary projection. Pure logic is separate from the route
// so it is unit-testable without a server.
//
// CONTRACT: server-only (the route imports the db layer through
// queryAiLogs); every entry point swallows its own errors.
// ─────────────────────────────────────────────────────────────

/** Retention for AI request rows — mirrors TrafficStat's 90 days. */
export const AI_LOG_RETENTION_DAYS = 90

/** Supported ?window= values → milliseconds. */
export const LOG_WINDOWS = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
} as const

export type LogWindow = keyof typeof LOG_WINDOWS

export function parseLogWindow(value: string | null): LogWindow {
  return value && value in LOG_WINDOWS ? (value as LogWindow) : '24h'
}

/** Parse ?outcome= — anything but "errors"/"ok" means "all". */
export function parseOutcome(value: string | null): 'all' | 'errors' | 'ok' {
  return value === 'errors' || value === 'ok' ? value : 'all'
}

/** Parse ?limit= — clamped 20..400, default 150. */
export function parseLimit(value: string | null): number {
  if (value === null || value.trim() === '') return 150
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 150
  return Math.min(400, Math.max(20, Math.round(n)))
}

/** Feature names the log can filter by (kept in a stable order for UIs). */
export const LOG_FEATURES = [
  'assistant',
  'write',
  'translate',
  'image',
  'image-edit',
  'magic-layers',
  'search',
] as const

export interface AiLogRow {
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

export interface AiLogCounts {
  total: number
  errors: number
  /** Calls + errors per feature, every known feature present. */
  byFeature: Record<string, { calls: number; errors: number }>
}

export interface AiLogResult {
  window: LogWindow
  rows: AiLogRow[]
  counts: AiLogCounts
  swept?: boolean
}

/**
 * Query the AI request log. Server-only: imports the db lazily so the
 * pure helpers above stay importable from unit tests and (potentially)
 * edge-ish contexts. Also lazily sweeps rows past retention (1% of
 * queries — the same amortization recordTraffic uses).
 */
export async function queryAiLogs(opts: {
  window: LogWindow
  feature?: string | null
  outcome: 'all' | 'errors' | 'ok'
  limit: number
}): Promise<AiLogResult> {
  const since = new Date(Date.now() - LOG_WINDOWS[opts.window])
  const feature =
    opts.feature && LOG_FEATURES.includes(opts.feature as (typeof LOG_FEATURES)[number]) ? opts.feature : null
  const where = {
    createdAt: { gte: since },
    ...(feature ? { feature } : {}),
    ...(opts.outcome === 'errors' ? { ok: false } : {}),
    ...(opts.outcome === 'ok' ? { ok: true } : {}),
  }
  const { db } = await import('@/lib/db')
  const [raw, grouped] = await Promise.all([
    db.aIUsage.findMany({ where, orderBy: { createdAt: 'desc' }, take: opts.limit }),
    db.aIUsage.groupBy({
      by: ['feature', 'ok'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ])
  const counts: AiLogCounts = { total: 0, errors: 0, byFeature: {} }
  for (const f of LOG_FEATURES) counts.byFeature[f] = { calls: 0, errors: 0 }
  for (const g of grouped) {
    const calls = g._count._all
    counts.total += calls
    if (g.ok === false) counts.errors += calls
    const slot = counts.byFeature[g.feature] ?? { calls: 0, errors: 0 }
    slot.calls += calls
    if (g.ok === false) slot.errors += calls
    counts.byFeature[g.feature] = slot
  }
  let swept = false
  if (Math.random() < 0.01) {
    const cutoff = new Date(Date.now() - AI_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    const r = await db.aIUsage.deleteMany({ where: { createdAt: { lt: cutoff } } })
    swept = r.count > 0
  }
  return {
    window: opts.window,
    rows: raw.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      feature: r.feature,
      provider: r.provider,
      model: r.model,
      ok: r.ok,
      status: r.status,
      durationMs: r.durationMs,
      error: r.error,
    })),
    counts,
    swept,
  }
}
