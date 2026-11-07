// Unit tests for the in-memory live traffic module (v0.16.2 A2) —
// bucketing, window expiry, gap-filled snapshot, latency percentiles
// and the bounded-eviction invariants. All timestamps are injected, so
// no fake timers are needed.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { recordLiveRequest, recordLiveAi, liveSnapshot, resetRealtime } from './realtime'

const T0 = 1_700_000_000_000 // an arbitrary epoch ms on a minute boundary
const min = (n: number) => T0 + n * 60_000
const sec = (n: number) => T0 + n * 1000

beforeEach(() => {
  resetRealtime()
  delete process.env.CANVIX_TRAFFIC
})

afterEach(() => {
  resetRealtime()
})

describe('recordLiveRequest + liveSnapshot (v0.16.2 A2)', () => {
  it('counts requests, errors, routes and visitors into the 5-minute window', () => {
    recordLiveRequest('GET /api/designs', 200, 12, 'v1', sec(0))
    recordLiveRequest('GET /api/designs', 200, 20, 'v1', sec(1))
    recordLiveRequest('POST /api/ai/write', 500, 90, 'v2', sec(1))
    recordLiveRequest('GET /api/health', 404, 5, null, sec(2))
    const snap = liveSnapshot(sec(3))
    expect(snap.window5m.requests).toBe(4)
    expect(snap.window5m.errors).toBe(2)
    expect(snap.window5m.visitors).toBe(2) // v1 + v2; null visitor not counted
    expect(snap.topRoutes[0]).toEqual({ route: 'GET /api/designs', hits: 2 })
    // the 60-second strip: 4 buckets with data, newest last
    expect(snap.seconds).toHaveLength(60)
    expect(snap.seconds[59]).toEqual({ t: Math.floor(sec(3) / 1000), req: 0, err: 0 })
    expect(snap.seconds[57].req).toBe(2) // second 1
    expect(snap.seconds[58].req).toBe(1) // second 2
  })

  it('gap-fills per-second buckets — the strip is always 60 long', () => {
    recordLiveRequest('GET /a', 200, 1, 'v1', sec(0))
    const snap = liveSnapshot(sec(30))
    expect(snap.seconds).toHaveLength(60)
    const withData = snap.seconds.filter((p) => p.req > 0)
    expect(withData).toHaveLength(1)
  })

  it('expires requests, routes and visitors past the 5-minute window', () => {
    recordLiveRequest('GET /old', 200, 5, 'v1', min(0))
    // still inside the window
    expect(liveSnapshot(min(4)).window5m.requests).toBe(1)
    expect(liveSnapshot(min(4)).window5m.visitors).toBe(1)
    // six minutes later everything has aged out (the read sweeps)
    const stale = liveSnapshot(min(6))
    expect(stale.window5m.requests).toBe(0)
    expect(stale.window5m.visitors).toBe(0)
    expect(stale.topRoutes).toEqual([])
  })

  it('drops per-second buckets older than 120 s from the strip', () => {
    recordLiveRequest('GET /a', 200, 1, 'v1', sec(0))
    const snap = liveSnapshot(sec(130))
    expect(snap.seconds.some((p) => p.req > 0)).toBe(false)
  })

  it('computes p50/p95 over the latency ring', () => {
    for (let i = 1; i <= 100; i++) recordLiveRequest('GET /x', 200, i, 'v1', sec(0)) // 1..100 ms
    const snap = liveSnapshot(sec(1))
    expect(snap.window5m.p50Ms).toBe(50)
    expect(snap.window5m.p95Ms).toBe(95)
  })

  it('caps the latency ring (last 720 requests only)', () => {
    for (let i = 1; i <= 1000; i++) recordLiveRequest('GET /x', 200, i, 'v1', sec(0))
    const snap = liveSnapshot(sec(1))
    // ring holds only the newest 720 of the 1..1000 ms requests (281..1000)
    expect(snap.window5m.requests).toBe(1000)
    expect(snap.window5m.p50Ms).toBe(640) // sorted[359] of 281..1000
    expect(snap.window5m.p95Ms).toBe(964) // sorted[683] of 281..1000
  })

  it('evicts the coldest route when the key cap is hit (bounded memory)', () => {
    for (let i = 0; i < 300; i++) recordLiveRequest(`GET /route-${i}`, 200, 1, 'v1', sec(0))
    recordLiveRequest('GET /hot', 200, 1, 'v1', sec(0))
    recordLiveRequest('GET /hot', 200, 1, 'v1', sec(0))
    const snap = liveSnapshot(sec(1))
    const routes = snap.topRoutes.map((r) => r.route)
    expect(routes).toContain('GET /hot')
    expect(routes.length).toBeLessThanOrEqual(8)
    // window totals are exact regardless of per-route eviction
    expect(snap.window5m.requests).toBe(302)
  })

  it('CANVIX_TRAFFIC=0 disables live recording entirely', () => {
    process.env.CANVIX_TRAFFIC = '0'
    recordLiveRequest('GET /a', 200, 1, 'v1', sec(0))
    recordLiveAi('write', true, sec(0))
    const snap = liveSnapshot(sec(1))
    expect(snap.window5m.requests).toBe(0)
    expect(snap.window5m.aiCalls).toBe(0)
    delete process.env.CANVIX_TRAFFIC
  })
})

describe('recordLiveAi (v0.16.2 A2)', () => {
  it('counts calls and successes per rolling minute', () => {
    recordLiveAi('write', true, min(0))
    recordLiveAi('write', true, min(0))
    recordLiveAi('image', false, min(1))
    const snap = liveSnapshot(min(2))
    expect(snap.window5m.aiCalls).toBe(3)
    expect(snap.window5m.aiOk).toBe(2)
    // aged out
    expect(liveSnapshot(min(6)).window5m.aiCalls).toBe(0)
  })
})

describe('liveSnapshot shape (v0.16.2 A2)', () => {
  it('reports uptime and an ISO timestamp', () => {
    // real clock here — uptime is measured from the actual module load
    const now = Date.now()
    const snap = liveSnapshot(now)
    expect(snap.now).toBe(new Date(now).toISOString())
    expect(snap.uptimeSec).toBeGreaterThanOrEqual(0)
    expect(snap.seconds).toHaveLength(60)
  })
})
