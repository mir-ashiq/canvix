import { afterEach, describe, expect, it } from 'vitest'
import { rateLimit } from './provider'

// The limiter the auth routes use (predates lib/rate-limit.ts).
// v0.18: CANVIX_RATE_LIMITS=off is the documented "turn EVERYTHING
// off" switch — this limiter must honour it too, or CI e2e (which
// registers one account per spec module on one localhost) burns the
// 5/h register cap halfway through the suite.

const req = (headers: Record<string, string> = {}) => ({ headers: new Map(Object.entries(headers)) }) as unknown as Parameters<typeof rateLimit>[1]

describe('rateLimit (ai/provider) — the CANVIX_RATE_LIMITS=off kill switch', () => {
  const ENV = 'CANVIX_RATE_LIMITS'

  afterEach(() => {
    delete process.env[ENV]
  })

  it('limits normally when the env is unset', () => {
    delete process.env[ENV]
    expect(rateLimit('t:on', req(), 2, 60).ok).toBe(true)
    expect(rateLimit('t:on', req(), 2, 60).ok).toBe(true)
    expect(rateLimit('t:on', req(), 2, 60).ok).toBe(false)
  })

  it('CANVIX_RATE_LIMITS=off disables the limiter entirely', () => {
    process.env[ENV] = 'off'
    for (let i = 0; i < 10; i++) {
      expect(rateLimit('t:off', req(), 1, 60).ok).toBe(true)
    }
  })

  it('any other value keeps the limiter on (strict opt-in)', () => {
    process.env[ENV] = '0'
    expect(rateLimit('t:other', req(), 1, 60).ok).toBe(true)
    expect(rateLimit('t:other', req(), 1, 60).ok).toBe(false)
  })
})
