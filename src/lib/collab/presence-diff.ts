/**
 * Presence diff key (v0.11.5 — F4 fix).
 *
 * The collab stream pump only pushed a frame every 20th tick when a design
 * was quiet, so an idle client learned about a *joining* collaborator only
 * via that keepalive — 60–90 s at the 3.2 s idle tick cadence (QA finding
 * F4, research/V0114-QA-PASS.md). The pump now compares each tick's visible
 * presence snapshot against the last one it sent and pushes immediately on
 * any change; this module computes the comparison key.
 *
 * What counts as "visible" (and therefore as a change):
 *   id, name, color, cursor            — everything the client renders
 * What deliberately does NOT count:
 *   lastSeen                           — bumps on every 15 s heartbeat;
 *                                        keying on it would push a frame per
 *                                        heartbeat and defeat the v0.9.2
 *                                        idle backoff for no visible effect
 *   row order                          — the query orders by lastSeen desc, so
 *                                        heartbeats reorder rows constantly;
 *                                        the key sorts rows by identity first
 *
 * Pure and dependency-free so it can be unit-tested in isolation.
 */

export interface PresenceRowLike {
  id: string
  name: string
  color: string
  cursor: unknown
}

/** Deterministic JSON: object keys sorted recursively, arrays in order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

/**
 * Stable comparison key for a presence snapshot. Two snapshots produce the
 * same key iff they render identically (same collaborators, same visible
 * attributes, cursors equal as JSON modulo key order).
 */
export function presenceKey(rows: PresenceRowLike[]): string {
  return rows
    .map((r) => [r.id, r.name, r.color, stableStringify(r.cursor ?? null)].join('\u0001'))
    .sort()
    .join('\u0002')
}
