import { test, expect } from '@playwright/test'

/**
 * H7 (v0.12.5): /api/health?v=2 — the observability payload.
 * Counts and latency, never ids; v1 stays shape-compatible.
 */
test('health v2 returns counts + latency probe without ids', async ({ request }) => {
  const res = await request.get('/api/health?v=2')
  expect(res.status()).toBe(200)
  const body = await res.json()

  expect(body.v).toBe(2)
  expect(body.ok).toBe(true)
  expect(body.templates).toBeGreaterThan(0)

  // the counts the epic named — designs, users, media (count + bytes)
  expect(typeof body.counts.designs).toBe('number')
  expect(body.counts.designs).toBeGreaterThanOrEqual(0)
  expect(typeof body.counts.users).toBe('number')
  expect(typeof body.counts.media).toBe('number')
  expect(typeof body.counts.mediaBytes).toBe('number')
  expect(body.counts.mediaBytes).toBeGreaterThanOrEqual(0)

  // the DB latency probe
  expect(typeof body.db.latencyMs).toBe('number')
  expect(body.db.latencyMs).toBeLessThan(2000)

  // app identity
  expect(typeof body.app.version).toBe('string')
  expect(body.app.version).not.toBe('')
  expect(typeof body.app.uptimeSec).toBe('number')

  // acceptance: counts without leaking ids — no cuid-shaped strings
  // anywhere in the payload
  const json = JSON.stringify(body)
  expect(json).not.toMatch(/cmv[a-z0-9]{20,}/) // cuid v2 (designs, media)
  expect(json).not.toMatch(/clt[a-z0-9]{20,}/) // cuid (comments, versions)
  expect(json).not.toMatch(/[0-9a-f-]{36}/) // uuid (sessions, users)

  // diagnostics are never cached
  expect(res.headers()['cache-control']).toBe('no-store')
})

test('health v1 stays shape-compatible (plus the explicit version tag)', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.v).toBe(1)
  expect(body.ok).toBe(true)
  expect(typeof body.database.kind).toBe('string')
  expect(typeof body.templates).toBe('number')
  // v1 does NOT pay for the counts
  expect(body.counts).toBeUndefined()
})
