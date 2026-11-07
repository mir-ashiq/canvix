// Unit tests for v0.16.3 (A3): provider error normalization + full-outcome
// request logging in withProvider. The AIUsage row is what /admin/logs
// reads, so these invariants ARE the Logs view's contract:
//
//   1. describeProviderError turns SDK-shaped messages into {status,
//      message} with credentials scrubbed and length capped.
//   2. withProvider records EVERY outcome: success (status + duration
//      + model), provider failure (HTTP status + scrubbed reason — and
//      the client 502 body carries the same reason), and the unconfigured
//      503 with the slot named.
//   3. The failure reason in the row is the same string the client
//      sees — one truth, two audiences.
//
// Hermeticity: /etc/.z-ai-config can exist on dev machines (it does on
// the build sandbox) — the fs mock below forces the file layer absent
// so the unconfigured case is deterministic everywhere.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const dbMock = vi.hoisted(() => ({
  aIUsage: { create: vi.fn().mockResolvedValue({}) },
  appConfig: { findUnique: vi.fn().mockResolvedValue(null) },
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, existsSync: () => false }
})

// SDK mock — the class mirrors the real constructor surface (A2)
const chatCreate = vi.fn(async () => ({
  choices: [{ message: { content: 'ok' } }],
}))
vi.mock('z-ai-web-dev-sdk', () => ({
  default: class MockZAI {
    chat: { completions: { create: typeof chatCreate } }
    constructor(_config: { baseUrl?: string; apiKey?: string }) {
      this.chat = { completions: { create: chatCreate } }
    }
  },
}))

import { NextRequest, NextResponse } from 'next/server'
import { describeProviderError, scrubErrorText, withProvider } from './provider'

function sameOriginPost(url: string): NextRequest {
  return new NextRequest(`http://canvix.test${url}`, {
    method: 'POST',
    headers: { host: 'canvix.test', origin: 'http://canvix.test', 'content-type': 'application/json' },
    body: '{}',
  })
}

/** recordUsage is fire-and-forget on the success/failure paths — let the
 * voided promise settle before asserting on the row. */
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 20))
}

beforeEach(() => {
  vi.stubEnv('ZAI_BASE_URL', 'http://provider.test')
  vi.stubEnv('ZAI_API_KEY', 'test-key')
  vi.clearAllMocks()
  dbMock.aIUsage.create.mockResolvedValue({})
  chatCreate.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('describeProviderError (A3)', () => {
  it('extracts the HTTP status from the SDK-shaped message', () => {
    const out = describeProviderError(new Error('API request failed with status 404: 404 page not found'))
    expect(out.status).toBe(404)
    expect(out.message).toContain('404 page not found')
    expect(out.message).toContain('(HTTP 404)')
    // the SDK prefix must not survive verbatim
    expect(out.message).not.toMatch(/^API request failed/)
  })

  it('scrubs key-shaped tokens from the reason', () => {
    const out = describeProviderError(
      new Error('API request failed with status 401: invalid key nvapi-AbCdEfGh12345678 rejected')
    )
    expect(out.status).toBe(401)
    expect(out.message).not.toContain('nvapi-AbCdEfGh12345678')
    expect(out.message).toContain('nvapi-***')
  })

  it('caps the message length', () => {
    const long = 'x'.repeat(500)
    const out = describeProviderError(new Error(long))
    expect(out.message.length).toBeLessThanOrEqual(240)
  })

  it('handles non-Error throwables and collapses whitespace', () => {
    const out = describeProviderError('boom\n\twith\nnewlines')
    expect(out.status).toBeNull()
    expect(out.message).toBe('boom with newlines')
  })
})

describe('scrubErrorText (A3)', () => {
  it('masks every known key prefix', () => {
    const out = scrubErrorText('sk-abcdefgh1234 gsk_xxxx1234 Bearer tokentoken123')
    expect(out).not.toMatch(/(abcdefgh1234|xxxx1234|tokentoken123)/)
  })
  it('leaves ordinary text intact', () => {
    expect(scrubErrorText('provider answered 429 too many requests')).toBe('provider answered 429 too many requests')
  })
})

describe('withProvider request logging (A3)', () => {
  it('records a success row with model, status and duration', async () => {
    const res = await withProvider('write', sameOriginPost('/api/ai/write'), { limit: 5, windowSec: 60 }, async (ctx) => {
      await ctx.zai.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] })
      return NextResponse.json({ ok: true })
    })
    expect(res.status).toBe(200)
    await flush()
    expect(dbMock.aIUsage.create).toHaveBeenCalledTimes(1)
    const row = dbMock.aIUsage.create.mock.calls[0][0].data
    expect(row.feature).toBe('write')
    expect(row.ok).toBe(true)
    expect(row.status).toBe(200)
    expect(typeof row.durationMs).toBe('number')
    expect(row.provider).toBe('env') // fallback-chain label = config source
  })

  it('records the provider failure with its HTTP status and reason, and the client 502 carries the same reason', async () => {
    chatCreate.mockRejectedValueOnce(new Error('API request failed with status 404: 404 page not found'))
    const res = await withProvider('image', sameOriginPost('/api/ai/image'), { limit: 5, windowSec: 60 }, async (ctx) => {
      // image slot resolves through the same env chain in this test —
      // calling ANY provider method stands in for the generation call
      await ctx.zai.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] })
      return NextResponse.json({})
    })
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.code).toBe('PROVIDER_ERROR')
    expect(body.detail).toContain('404 page not found')
    await flush()
    expect(dbMock.aIUsage.create).toHaveBeenCalledTimes(1)
    const row = dbMock.aIUsage.create.mock.calls[0][0].data
    expect(row.ok).toBe(false)
    expect(row.status).toBe(404)
    expect(row.error).toContain('404 page not found')
    expect(row.provider).toBe('env')
  })

  it('records the unconfigured 503 with the slot named', async () => {
    vi.stubEnv('ZAI_BASE_URL', '')
    vi.stubEnv('ZAI_API_KEY', '')
    const res = await withProvider(
      'image',
      sameOriginPost('/api/ai/image'),
      { limit: 5, windowSec: 60 },
      async () => NextResponse.json({})
    )
    expect(res.status).toBe(503)
    expect(dbMock.aIUsage.create).toHaveBeenCalledTimes(1)
    const row = dbMock.aIUsage.create.mock.calls[0][0].data
    expect(row.ok).toBe(false)
    expect(row.status).toBe(503)
    expect(row.provider).toBe('no-provider (image)')
    expect(row.error).toContain('image')
  })
})
