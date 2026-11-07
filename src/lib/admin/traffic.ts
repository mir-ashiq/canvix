// ─────────────────────────────────────────────────────────────
// Traffic + activity recording (v0.16 A1) — the counters behind
// the console's Traffic and DAU charts.
//
// TrafficStat: one fire-and-forget upsert per API request from the
// withLogging wrapper every route already uses. Aggregate counts only
// (route template, method, status, day) — the same no-ids/no-IPs/no-
// query-strings stance as /api/health?v=2. CANVIX_TRAFFIC=0 opts out.
//
// DailyActive: one upsert per (day, actor) from the two surfaces that
// mean "someone used Canvix today" (design list / editor open). The
// actor is a userId or the already-hashed anonymous cookie key.
//
// Both are best-effort by design (the pattern recordUsage set in
// v0.5): accounting must never break the request it accounts for.
// On serverless/workerd runtimes a fire-and-forget write can be
// cancelled after the response — documented in docs/ADMIN.md; the
// self-hosted Node runtime this app primarily targets is exact.
//
// CONTRACT: server-only; every entry point swallows its own errors.
// ─────────────────────────────────────────────────────────────

/** CANVIX_TRAFFIC=0 is the explicit opt-out. Counting is on by default. */
export function trafficRecordingEnabled(): boolean {
  return process.env.CANVIX_TRAFFIC !== '0'
}

/** UTC midnight of the given instant — the day bucket for both tables. */
export function utcDay(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/**
 * withLogging names look like "GET /api/designs". Split into the stored
 * pair; anything without the expected shape is stored whole as the route
 * with the request's method, so a misnamed wrapper never crashes accounting.
 */
export function parseRouteName(name: string, fallbackMethod: string): { route: string; method: string } {
  const space = name.indexOf(' ')
  if (space === -1 || space === 0 || space === name.length - 1) {
    return { route: name, method: fallbackMethod }
  }
  return { route: name.slice(space + 1), method: name.slice(0, space) }
}

/** Counters older than this are swept lazily. */
export const TRAFFIC_RETENTION_DAYS = 90

/** Bounded route/status text — defense against a misbehaving wrapper name. */
const ROUTE_MAX = 160

/**
 * Record one API request into the day's aggregate. Fire-and-forget:
 * call sites `void` this; it never rejects. Also lazily sweeps rows
 * past the retention window (1% of calls — amortized, bounded).
 */
export async function recordTraffic(name: string, method: string, status: number): Promise<void> {
  if (!trafficRecordingEnabled()) return
  try {
    const { route, method: m } = parseRouteName(name, method)
    const day = utcDay()
    const { db } = await import('@/lib/db')
    await db.trafficStat.upsert({
      where: { day_route_method_status: { day, route: route.slice(0, ROUTE_MAX), method: m.slice(0, 10), status } },
      create: { day, route: route.slice(0, ROUTE_MAX), method: m.slice(0, 10), status, hits: 1 },
      update: { hits: { increment: 1 } },
    })
    if (Math.random() < 0.01) {
      const cutoff = new Date(day.getTime() - TRAFFIC_RETENTION_DAYS * 24 * 60 * 60 * 1000)
      await db.trafficStat.deleteMany({ where: { day: { lt: cutoff } } })
    }
  } catch {
    /* accounting must never break the request */
  }
}

/**
 * Record a daily-active actor (a userId or the pre-hashed anon key).
 * Null actors (no session, no anon cookie yet) are a no-op.
 */
export async function recordActive(actor: string | null | undefined): Promise<void> {
  if (!actor) return
  try {
    const day = utcDay()
    const { db } = await import('@/lib/db')
    await db.dailyActive.upsert({
      where: { day_actor: { day, actor: actor.slice(0, 80) } },
      create: { day, actor: actor.slice(0, 80) },
      update: {},
    })
  } catch {
    /* best-effort by design */
  }
}
