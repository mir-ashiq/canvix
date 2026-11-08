import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Route tests for the A5 stock-key probe. No network, no Postgres.
// The db is mocked (sessions for the admin guard, AppConfig for the
// stored keys); the global fetch is stubbed per test — the probe is
// the one place the route actually goes out, and these tests pin
// both the verdict mapping and the never-leak-the-key invariants
// (Pixabay's key rides the request URL; provider bodies may echo it).

const dbMock = vi.hoisted(() => ({
  session: { findUnique: vi.fn() },
  appConfig: { findMany: vi.fn(), upsert: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))

import { POST as stockTest } from './route'
import { invalidateAdminConfig } from '@/lib/admin/config'

// provider.ts's rateLimit (the one this route uses) keeps its own
// bucket store with no reset hook — give every request a unique
// x-forwarded-for so each test gets a fresh bucket instead of
// tripping the 1-per-10s cap meant for real operators.

const ADMIN_SESSION = {
  id: 'sess-admin',
  expiresAt: new Date(Date.now() + 86_400_000),
  user: { id: 'u-admin', username: 'root', role: 'admin', createdAt: new Date('2026-01-01T00:00:00Z') },
}

function req(url: string, init: { body?: unknown; cookie?: string | null; origin?: string } = {}) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-forwarded-for': `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  }
  if (init.cookie !== null) headers.cookie = init.cookie ?? 'canvix_session=tok'
  if (init.origin) headers.origin = init.origin
  return new NextRequest(url, {
    method: 'POST',
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  invalidateAdminConfig()
  dbMock.session.findUnique.mockResolvedValue(ADMIN_SESSION)
  dbMock.appConfig.findMany.mockResolvedValue([])
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('POST /api/admin/config/stock-test (v0.16.5 A5)', () => {
  it('non-admins never probe (fail-closed guard)', async () => {
    // sticky (not Once): clearAllMocks drains calls, not the once-queue
    dbMock.session.findUnique.mockResolvedValue(null)
    const res = await stockTest(req('http://localhost/api/admin/config/stock-test', { body: { provider: 'pexels' }, cookie: null }))
    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cross-origin mutation → CSRF 403 before any provider work', async () => {
    const res = await stockTest(
      req('http://localhost/api/admin/config/stock-test', { body: { provider: 'pexels' }, origin: 'https://evil.io' })
    )
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('unknown provider → 400', async () => {
    const res = await stockTest(req('http://localhost/api/admin/config/stock-test', { body: { provider: 'unsplash' } }))
    expect(res.status).toBe(400)
  })

  it('no key stored and no env var → 400 naming the env fallback', async () => {
    const res = await stockTest(req('http://localhost/api/admin/config/stock-test', { body: { provider: 'pexels' } }))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('PEXELS_API_KEY')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('pexels: 200 with results → ok, message sanitized, key never echoed', async () => {
    vi.stubEnv('PEXELS_API_KEY', 'env-pexels-key-1234')
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ total_results: 1234, photos: [] }), { status: 200 })
    )
    const res = await stockTest(req('http://localhost/api/admin/config/stock-test', { body: { provider: 'pexels' } }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; message: string }
    expect(body.ok).toBe(true)
    expect(body.message).toContain('key valid')
    // the probe went out with the env key in the Authorization header…
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/v1/search')
    expect((init.headers as Record<string, string>).Authorization).toBe('env-pexels-key-1234')
    // …but the answer never carries it
    expect(JSON.stringify(body)).not.toContain('env-pexels-key-1234')
  })

  it('pexels: 401 → the verdict says the key was rejected, nothing else', async () => {
    vi.stubEnv('PEXELS_API_KEY', 'env-pexels-key-1234')
    fetchMock.mockResolvedValueOnce(new Response('{"error":"invalid key env-pexels-key-1234"}', { status: 401 }))
    const res = await stockTest(req('http://localhost/api/admin/config/stock-test', { body: { provider: 'pexels' } }))
    const body = (await res.json()) as { ok: boolean; message: string }
    expect(body.ok).toBe(false)
    expect(body.message).toContain('rejected')
    expect(JSON.stringify(body)).not.toContain('env-pexels-key-1234')
  })

  it('pixabay: a stored console key wins over the env var', async () => {
    vi.stubEnv('PIXABAY_API_KEY', 'env-pixabay-key')
    dbMock.appConfig.findMany.mockResolvedValue([{ key: 'stock.providers', value: { pixabay: 'db-pixabay-key' } }])
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ total: 99, hits: [] }), { status: 200 }))
    const res = await stockTest(req('http://localhost/api/admin/config/stock-test', { body: { provider: 'pixabay' } }))
    const body = (await res.json()) as { ok: boolean; message: string }
    expect(body.ok).toBe(true)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('key=db-pixabay-key') // the REQUEST carries the db key…
    expect(JSON.stringify(body)).not.toContain('db-pixabay-key') // …the verdict never does
  })

  it('pixabay: a 200-with-error-object body → rejected verdict, body never echoed', async () => {
    vi.stubEnv('PIXABAY_API_KEY', 'env-pixabay-key')
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 400, message: 'key env-pixabay-key invalid' } }), { status: 200 })
    )
    const res = await stockTest(req('http://localhost/api/admin/config/stock-test', { body: { provider: 'pixabay' } }))
    const body = (await res.json()) as { ok: boolean; message: string }
    expect(body.ok).toBe(false)
    expect(body.message).toContain('rejected')
    expect(JSON.stringify(body)).not.toContain('env-pixabay-key')
  })

  it('network failure → a generic verdict (the error text may embed the URL)', async () => {
    vi.stubEnv('PEXELS_API_KEY', 'env-pexels-key-1234')
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed https://api.pexels.com?key=env-pexels-key-1234'))
    const res = await stockTest(req('http://localhost/api/admin/config/stock-test', { body: { provider: 'pexels' } }))
    const body = (await res.json()) as { ok: boolean; message: string }
    expect(body.ok).toBe(false)
    expect(body.message).toContain('Could not reach')
    expect(JSON.stringify(body)).not.toContain('env-pexels-key-1234')
  })
})
