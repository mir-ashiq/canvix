// ─────────────────────────────────────────────────────────────
// Day-series helpers (v0.16 A1) — pure functions the admin
// overview route uses to turn sparse SQL group-bys into gap-free
// chart series. Unit-tested; no I/O.
// ─────────────────────────────────────────────────────────────

export interface DayPoint {
  /** UTC date, YYYY-MM-DD */
  day: string
  value: number
}

/** Format a Date as a UTC YYYY-MM-DD key. */
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** The last `days` UTC day keys, oldest first, ending today. */
export function recentDayKeys(days: number, now: Date = new Date()): string[] {
  const out: string[] = []
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  for (let i = days - 1; i >= 0; i--) {
    out.push(dayKey(new Date(today - i * 24 * 60 * 60 * 1000)))
  }
  return out
}

/**
 * Merge a sparse {day→value} map onto the last `days` day keys.
 * Missing days become 0 — charts stay continuous across idle days.
 * Input days outside the window are dropped; the newest value wins
 * on duplicate keys.
 */
export function fillDays(
  values: Iterable<[string, number]>,
  days: number,
  now: Date = new Date()
): DayPoint[] {
  const map = new Map<string, number>()
  for (const [k, v] of values) map.set(k, v)
  return recentDayKeys(days, now).map((day) => ({ day, value: map.get(day) ?? 0 }))
}

/** Total over a filled series — for the "last N days" stat cards. */
export function sumSeries(series: DayPoint[], lastN: number): number {
  return series.slice(-lastN).reduce((acc, p) => acc + p.value, 0)
}
