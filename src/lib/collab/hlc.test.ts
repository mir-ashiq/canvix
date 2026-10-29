// ─────────────────────────────────────────────────────────────
// v0.10 offline merge — HLC invariants
//
// Locks in the total-order properties every merge decision depends on:
//   1. monotonic issuance within an actor (across storage reloads)
//   2. cross-actor ordering is total (no ties between different actors)
//   3. observe() absorbs remote stamps (causality moves forward)
//   4. formatted strings compare correctly as plain strings
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import {
  HybridLogicalClock,
  compareHlc,
  formatHlc,
  hlcIsNewer,
  parseHlc,
  HLC_EPOCH,
} from './hlc'

function memoryStorage(initial?: string): Storage {
  const map = new Map<string, string>()
  if (initial) map.set('canvix-hlc', initial)
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() { return map.size },
  } as Storage
}

describe('hlc formatting', () => {
  it('round-trips through parse', () => {
    const h = formatHlc(1770000000000, 42, 'p_abc')
    const p = parseHlc(h)!
    expect(p.w).toBe(1770000000000)
    expect(p.c).toBe(42)
    expect(p.actor).toBe('p_abc')
  })

  it('pads so plain string comparison equals numeric comparison', () => {
    const a = formatHlc(99, 5, 'x')
    const b = formatHlc(100, 0, 'x')
    const c = formatHlc(99, 6, 'x')
    expect(a < b).toBe(true) // walltime dominates
    expect(a < c).toBe(true) // counter breaks walltime ties
  })

  it('rejects malformed stamps in parse', () => {
    expect(parseHlc('garbage')).toBeNull()
    expect(parseHlc('')).toBeNull()
    expect(parseHlc(':::')).toBeNull()
  })

  it('treats undefined/empty as epoch (legacy data)', () => {
    expect(compareHlc(undefined, undefined)).toBe(0)
    expect(hlcIsNewer('0000000001:00000:a', undefined)).toBe(true)
    expect(hlcIsNewer(undefined, HLC_EPOCH)).toBe(false)
    expect(hlcIsNewer(undefined, '0000000001:00000:a')).toBe(false)
  })
})

describe('hlc clock', () => {
  it('issues strictly monotonic stamps within an actor', () => {
    const clock = new HybridLogicalClock('p_a', memoryStorage())
    const stamps = Array.from({ length: 500 }, () => clock.nowHlc())
    for (let i = 1; i < stamps.length; i++) {
      expect(compareHlc(stamps[i], stamps[i - 1])).toBeGreaterThan(0)
    }
  })

  it('stays monotonic across a restart (persisted state)', () => {
    const store = memoryStorage()
    const c1 = new HybridLogicalClock('p_a', store)
    const last = c1.nowHlc()
    const c2 = new HybridLogicalClock('p_a', store)
    expect(compareHlc(c2.nowHlc(), last)).toBeGreaterThan(0)
  })

  it('absorbs remote stamps (observe moves causality forward)', () => {
    const mine = new HybridLogicalClock('p_a', memoryStorage())
    const remote = new HybridLogicalClock('p_b', memoryStorage())
    // simulate a remote clock that is ahead
    const ahead = formatHlc(Date.now() + 60_000, 9, 'p_b')
    mine.observe(ahead)
    const next = mine.nowHlc()
    expect(compareHlc(next, ahead)).toBeGreaterThan(0)
    // remote's older stamps never overtake
    const older = remote.nowHlc()
    expect(compareHlc(older, next)).toBeLessThan(0)
  })

  it('two actors never issue equal stamps', () => {
    const a = new HybridLogicalClock('p_a', memoryStorage())
    const b = new HybridLogicalClock('p_b', memoryStorage())
    const set = new Set<string>()
    for (let i = 0; i < 200; i++) {
      set.add(a.nowHlc())
      set.add(b.nowHlc())
    }
    expect(set.size).toBe(400)
  })

  it('skewed local clocks stay bounded by observe', () => {
    let fakeNow = Date.now() + 86_400_000 // one day ahead
    const skew = new HybridLogicalClock('p_skew', memoryStorage(), () => fakeNow)
    const honest = new HybridLogicalClock('p_honest', memoryStorage())
    const skewed = skew.nowHlc()
    honest.observe(skewed)
    const response = honest.nowHlc()
    // honest clock jumps past the skewed stamp (absorption), so its next
    // write wins the LWW arbitration despite an honest wall clock
    expect(compareHlc(response, skewed)).toBeGreaterThan(0)
    fakeNow += 1
    expect(compareHlc(skew.nowHlc(), response)).toBeGreaterThan(0)
  })
})
