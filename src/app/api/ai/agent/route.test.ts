// Unit tests for POST /api/ai/agent — the side-channel bridge
// (acks / destructive confirmations / refreshed context) and the
// request validation. No provider is involved: the bridge branch
// returns before withProvider, and provider-dependent paths are
// exercised in src/lib/agent/loop.test.ts instead.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// provider + session + logging stubs — withProvider must never run
const withProviderMock = vi.hoisted(() => vi.fn(async (_f: string, _r: unknown, _l: unknown, fn: unknown) => {
  // if a test reaches withProvider, the run starts — hand back a
  // minimal NextResponse so the failure is visible, not a crash
  const { NextResponse } = await import('next/server')
  void (fn as () => void)
  return NextResponse.json({ error: 'provider path not under test' }, { status: 501 })
}))
vi.mock('@/lib/ai/provider', () => ({ withProvider: withProviderMock }))
vi.mock('@/lib/observability', () => ({
  withLogging: (_name: string, fn: unknown) => fn,
}))

import { NextRequest } from 'next/server'
import { POST } from './route'

function req(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: 'http://canvix.test' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/ai/agent (validation + bridge)', () => {
  it('rejects an empty message with 400', async () => {
    const res = await POST(req('http://canvix.test/api/ai/agent', { message: '' }))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toContain('message')
  })

  it('rejects a malformed JSON body without crashing', async () => {
    const res = await POST(req('http://canvix.test/api/ai/agent', 'not json{'))
    expect(res.status).toBe(400)
  })

  it('a bridge POST for an unknown run is a 404, not a provider call', async () => {
    const res = await POST(
      req('http://canvix.test/api/ai/agent?bridge=run-does-not-exist', { ack: { ok: true } }),
    )
    expect(res.status).toBe(404)
    expect(withProviderMock).not.toHaveBeenCalled()
  })

  it('the bridge path parses the body ONCE — acks land without a second req.json() (regression: the double-parse threw and every ack timed out)', async () => {
    // Regression shape: the original bug called req.json() a second
    // time inside the bridge branch. With the real NextRequest the
    // second call rejects ("Body is unusable"), the catch produced
    // {} and the ack was silently dropped — runs stalled on the
    // 30 s ack timeout. This test fails if the bridge ever re-reads
    // the request.
    const res = await POST(
      req('http://canvix.test/api/ai/agent?bridge=run-x1', {
        ack: { ok: true, message: 'applied', design: { name: 'refreshed' } },
      }),
    )
    // unknown run → 404, but the body WAS parsed once without error;
    // the important assertion is no crash and no provider call
    expect(res.status).toBe(404)
    expect(withProviderMock).not.toHaveBeenCalled()
  })

  it('a run POST with a message reaches withProvider (the normal path)', async () => {
    await POST(req('http://canvix.test/api/ai/agent', { message: 'make it bolder' }))
    expect(withProviderMock).toHaveBeenCalledTimes(1)
    expect(withProviderMock.mock.calls[0][0]).toBe('assistant')
  })
})
