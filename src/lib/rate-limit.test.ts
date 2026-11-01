import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import {
  RATE_LIMITS,
  acquireStreamSlot,
  activeStreamsFor,
  checkRateLimit,
  clientIp,
  maxStreamsPerIp,
  rateLimitResponse,
  rateLimitsDisabled,
  releaseStreamSlot,
  resetRateLimitState,
  setRateLimitClock,
} from './rate-limit'

// H5: the per-instance limiter that backs the 429s. Deterministic
// through an injected clock — no real waiting anywhere.

function req(headers: Record<string, string> = {}) {
  return new NextRequest('http://canvix.test/api/designs', { headers })
}

let realNow: () => number

beforeEach(() => {
  resetRateLimitState()
  setRateLimitClock(null)
  delete process.env.CANVIX_RATE_LIMITS
  delete process.env.CANVIX_SSE_MAX_PER_IP
})

afterEach(() => {
  setRateLimitClock(null)
  delete process.env.CANVIX_RATE_LIMITS
  delete process.env.CANVIX_SSE_MAX_PER_IP
})

describe('clientIp', () => {
  it('takes the first x-forwarded-for hop', () => {
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('203.0.113.9')
  })
  it('falls back to x-real-ip, then the shared unknown bucket', () => {
    expect(clientIp(req({ 'x-real-ip': '198.51.100.7' }))).toBe('198.51.100.7')
    expect(clientIp(req())).toBe('unknown')
  })
})

describe('checkRateLimit (fixed window)', () => {
  it('allows up to max, then 429s with a sane Retry-After', () => {
    RATE_LIMITS['media:init'] = { windowMs: 60_000, max: 3 }
    const r = req()
    expect(checkRateLimit(r, 'media:init')).toEqual({ ok: true, retryAfterSec: 0 })
    expect(checkRateLimit(r, 'media:init')).toEqual({ ok: true, retryAfterSec: 0 })
    expect(checkRateLimit(r, 'media:init')).toEqual({ ok: true, retryAfterSec: 0 })
    const blocked = checkRateLimit(r, 'media:init')
    expect(blocked.ok).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1)
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60)
  })

  it('buckets are independent — events never consume the designs budget', () => {
    RATE_LIMITS['media:init'] = { windowMs: 60_000, max: 1 }
    const r = req()
    expect(checkRateLimit(r, 'media:init').ok).toBe(true)
    expect(checkRateLimit(r, 'media:init').ok).toBe(false)
    expect(checkRateLimit(r, 'designs:create').ok).toBe(true)
  })

  it('IPs are independent', () => {
    RATE_LIMITS['media:init'] = { windowMs: 60_000, max: 1 }
    expect(checkRateLimit(req({ 'x-forwarded-for': '203.0.113.1' }), 'media:init').ok).toBe(true)
    expect(checkRateLimit(req({ 'x-forwarded-for': '203.0.113.2' }), 'media:init').ok).toBe(true)
    expect(checkRateLimit(req({ 'x-forwarded-for': '203.0.113.1' }), 'media:init').ok).toBe(false)
  })

  it('the window rolls over and resets the count', () => {
    RATE_LIMITS['media:init'] = { windowMs: 1_000, max: 1 }
    let t = 1_000_000
    setRateLimitClock(() => t)
    expect(checkRateLimit(req(), 'media:init').ok).toBe(true)
    expect(checkRateLimit(req(), 'media:init').ok).toBe(false)
    t += 1_001 // past the window
    expect(checkRateLimit(req(), 'media:init').ok).toBe(true)
  })

  it('CANVIX_RATE_LIMITS=off disables every bucket', () => {
    process.env.CANVIX_RATE_LIMITS = 'off'
    expect(rateLimitsDisabled()).toBe(true)
    RATE_LIMITS['media:init'] = { windowMs: 60_000, max: 1 }
    const r = req()
    expect(checkRateLimit(r, 'media:init').ok).toBe(true)
    expect(checkRateLimit(r, 'media:init').ok).toBe(true)
    expect(checkRateLimit(r, 'media:init').ok).toBe(true)
  })
})

describe('rateLimitResponse', () => {
  it('carries Retry-After and the documented body', () => {
    const res = rateLimitResponse({ ok: false, retryAfterSec: 42 })
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('42')
    return res.json().then((body) => {
      expect(body.code).toBe('RATE_LIMITED')
      expect(body.retryAfterSec).toBe(42)
    })
  })
})

describe('SSE connection cap', () => {
  it('caps concurrent streams per IP and releases slots', () => {
    expect(maxStreamsPerIp()).toBe(6)
    const ip = '203.0.113.30'
    for (let i = 0; i < 6; i++) {
      expect(acquireStreamSlot(ip)).toBe(true)
    }
    expect(activeStreamsFor(ip)).toBe(6)
    expect(acquireStreamSlot(ip)).toBe(false) // the 7th connection: 429
    releaseStreamSlot(ip)
    expect(activeStreamsFor(ip)).toBe(5)
    expect(acquireStreamSlot(ip)).toBe(true)
  })

  it('the cap is configurable and off-mode bypasses it', () => {
    process.env.CANVIX_SSE_MAX_PER_IP = '2'
    expect(maxStreamsPerIp()).toBe(2)
    const ip = '203.0.113.31'
    expect(acquireStreamSlot(ip)).toBe(true)
    expect(acquireStreamSlot(ip)).toBe(true)
    expect(acquireStreamSlot(ip)).toBe(false)
    releaseStreamSlot(ip)
    releaseStreamSlot(ip)

    process.env.CANVIX_RATE_LIMITS = 'off'
    expect(acquireStreamSlot(ip)).toBe(true)
  })
})
