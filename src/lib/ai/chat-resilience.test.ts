/**
 * v0.32.7 · PROVIDER RESILIENCE — retry, circuit breaker, fallback.
 * The 26 Nov 2026 production incident as tests: 502 → fetch failed →
 * 429 must never kill a run when a configured provider can answer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatWithRetry, chatResilient, circuitBreaker, isTransientError } from './chat-resilience'

const noSleep = () => Promise.resolve()

describe('chat-resilience · transient classification', () => {
  it('429 / 5xx / network / timeouts are transient', () => {
    for (const msg of [
      'API request failed with status 502: Bad Gateway',
      'fetch failed',
      'API request failed with status 429: Too Many Requests',
      'status 503: service unavailable',
      'gateway timeout',
      'network error: ECONNRESET',
    ]) {
      expect(isTransientError(new Error(msg))).toBe(true)
    }
  })
  it('auth / bad-request / unsupported-param errors are PERMANENT (fail fast)', () => {
    for (const msg of [
      'invalid api key',
      'status 401: unauthorized',
      'status 404: model not found',
      'response_format is not supported',
      'unknown field: thinking',
    ]) {
      expect(isTransientError(new Error(msg))).toBe(false)
    }
  })
})

describe('chat-resilience · chatWithRetry (bounded exponential backoff)', () => {
  it('retries transient failures and succeeds', async () => {
    let calls = 0
    const out = await chatWithRetry(
      async () => {
        calls += 1
        if (calls < 3) throw new Error('fetch failed')
        return 'ok'
      },
      { attempts: 3, sleep: noSleep },
    )
    expect(out).toBe('ok')
    expect(calls).toBe(3)
  })
  it('PERMANENT errors fail fast — no retry, no wasted spend', async () => {
    const fn = vi.fn(async () => {
      throw new Error('status 401: invalid api key')
    })
    await expect(chatWithRetry(fn, { attempts: 3, sleep: noSleep })).rejects.toThrow('401')
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('gives up after the bounded attempts and rethrows the last error', async () => {
    let calls = 0
    const delays: number[] = []
    await expect(
      chatWithRetry(
        async () => {
          calls += 1
          throw new Error('status 502: bad gateway')
        },
        { attempts: 3, baseDelayMs: 10, maxDelayMs: 20, sleep: async (ms) => { delays.push(ms) } },
      ),
    ).rejects.toThrow('502')
    expect(calls).toBe(3)
    expect(delays).toHaveLength(2) // 3 attempts → 2 waits between them
  })
})

describe('chat-resilience · circuit breaker', () => {
  afterEach(() => circuitBreaker.reset())
  it('opens after the consecutive-failure threshold and recovers after the cooldown', () => {
    const key = 'test:provider'
    for (let i = 0; i < 5; i++) circuitBreaker.recordFailure(key)
    expect(circuitBreaker.canPass(key)).toBe(false)
    // after the cooldown the key is half-open again
    expect(circuitBreaker.canPass(key, Date.now() + 31_000)).toBe(true)
    circuitBreaker.recordSuccess(key)
    expect(circuitBreaker.canPass(key)).toBe(true)
  })
})

describe('chat-resilience · chatResilient (the configured fallback chain)', () => {
  afterEach(() => circuitBreaker.reset())
  it('fails over to the next CONFIGURED provider on transient failure', async () => {
    const out = await chatResilient(
      [
        { key: 'primary', fn: async () => { throw new Error('fetch failed') } },
        { key: 'backup', fn: async () => 'backup answer' },
      ],
      { attempts: 2, sleep: noSleep },
    )
    expect(out).toBe('backup answer')
  })
  it('PERMANENT primary errors do NOT fail over (report immediately)', async () => {
    const backup = vi.fn(async () => 'backup')
    await expect(
      chatResilient(
        [
          { key: 'primary', fn: async () => { throw new Error('status 401: invalid api key') } },
          { key: 'backup', fn: backup },
        ],
        { attempts: 2, sleep: noSleep },
      ),
    ).rejects.toThrow('401')
    expect(backup).not.toHaveBeenCalled()
  })
  it('an OPEN circuit skips straight to the fallback (the dead gateway is not retried)', async () => {
    const key = 'flapping:gateway'
    for (let i = 0; i < 5; i++) circuitBreaker.recordFailure(key)
    const dead = vi.fn(async () => 'should not run')
    const out = await chatResilient(
      [
        { key, fn: dead },
        { key: 'healthy', fn: async () => 'healthy answer' },
      ],
      { attempts: 1, sleep: noSleep },
    )
    expect(out).toBe('healthy answer')
    expect(dead).not.toHaveBeenCalled()
  })
  it('noFallback=1 keeps the failure on the primary (spend control)', async () => {
    await expect(
      chatResilient(
        [
          { key: 'primary', fn: async () => { throw new Error('fetch failed') } },
          { key: 'backup', fn: async () => 'backup' },
        ],
        { attempts: 1, noFallback: true, sleep: noSleep },
      ),
    ).rejects.toThrow('fetch failed')
  })
  it('all providers failing rethrows the last transient error', async () => {
    await expect(
      chatResilient(
        [
          { key: 'a', fn: async () => { throw new Error('status 502') } },
          { key: 'b', fn: async () => { throw new Error('fetch failed') } },
        ],
        { attempts: 1, sleep: noSleep },
      ),
    ).rejects.toThrow('fetch failed')
  })
})
