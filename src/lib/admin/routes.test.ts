// Route-level unit tests for the admin API (v0.16 A1) — the guards,
// the validation and the sanitized echo, all against a mocked db.
// Pattern: claim-media.test.ts (vi.hoisted db mock; routes import the
// same module). The withLogging wrapper's fire-and-forget traffic
// recording silently no-ops against the mock — by design.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const dbMock = vi.hoisted(() => ({
  session: { findUnique: vi.fn(), deleteMany: vi.fn() },
  user: { findUnique: vi.fn(), update: vi.fn() },
  appConfig: { findMany: vi.fn(), upsert: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))

import { POST as roleRoute } from '@/app/api/admin/users/[id]/role/route'
import { POST as sessionsRoute } from '@/app/api/admin/users/[id]/sessions/route'
import { GET as configGet, PUT as configPut } from '@/app/api/admin/config/route'
import { POST as registerRoute } from '@/app/api/auth/register/route'
import { invalidateAdminConfig } from './config'

const ADMIN_SESSION = {
  id: 'sess-admin',
  expiresAt: new Date(Date.now() + 86_400_000),
  user: { id: 'u-admin', username: 'root', role: 'admin', createdAt: new Date('2026-01-01T00:00:00Z') },
}
const PLAIN_SESSION = {
  id: 'sess-plain',
  expiresAt: new Date(Date.now() + 86_400_000),
  user: { id: 'u-plain', username: 'mallory', role: 'user', createdAt: new Date('2026-01-01T00:00:00Z') },
}

function req(url: string, init: { method?: string; body?: unknown; cookie?: string | null; origin?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (init.cookie !== null) headers.cookie = init.cookie ?? 'canvix_session=tok'
  if (init.origin) headers.origin = init.origin
  return new NextRequest(url, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  invalidateAdminConfig()
  dbMock.appConfig.findMany.mockResolvedValue([])
  dbMock.appConfig.upsert.mockResolvedValue({})
})

describe('POST /api/admin/users/[id]/role (v0.16 A1)', () => {
  it('no session → 401, plain user → 403 (fail-closed)', async () => {
    // 401: a cookie token that resolves to no session row
    dbMock.session.findUnique.mockResolvedValueOnce(null)
    const res1 = await roleRoute(req('http://localhost/api/admin/users/u-1/role', { method: 'POST', body: { role: 'admin' } }), { params: Promise.resolve({ id: 'u-1' }) })
    expect(res1.status).toBe(401)

    dbMock.session.findUnique.mockResolvedValueOnce(PLAIN_SESSION)
    const res2 = await roleRoute(req('http://localhost/api/admin/users/u-1/role', { method: 'POST', body: { role: 'admin' } }), { params: Promise.resolve({ id: 'u-1' }) })
    expect(res2.status).toBe(403)
  })

  it('cross-origin mutation → CSRF 403 before any db work', async () => {
    dbMock.session.findUnique.mockResolvedValueOnce(ADMIN_SESSION)
    const res = await roleRoute(
      req('http://localhost/api/admin/users/u-1/role', { method: 'POST', body: { role: 'admin' }, origin: 'https://evil.io' }),
      { params: Promise.resolve({ id: 'u-1' }) }
    )
    expect(res.status).toBe(403)
    expect(dbMock.user.findUnique).not.toHaveBeenCalled()
  })

  it('rejects garbage roles and self-changes', async () => {
    dbMock.session.findUnique.mockResolvedValue(ADMIN_SESSION)
    const bad = await roleRoute(req('http://localhost/api/admin/users/u-1/role', { method: 'POST', body: { role: 'superadmin' } }), { params: Promise.resolve({ id: 'u-1' }) })
    expect(bad.status).toBe(400)

    const self = await roleRoute(req('http://localhost/api/admin/users/u-admin/role', { method: 'POST', body: { role: 'user' } }), { params: Promise.resolve({ id: 'u-admin' }) })
    expect(self.status).toBe(400)
    expect(((await self.json()) as { code: string }).code).toBe('SELF_ROLE_CHANGE')
  })

  it('promotes a user and echoes the effective admin state', async () => {
    dbMock.session.findUnique.mockResolvedValue(ADMIN_SESSION)
    dbMock.user.findUnique.mockResolvedValueOnce({ id: 'u-1', username: 'alice', role: 'user' })
    dbMock.user.update.mockResolvedValueOnce({ id: 'u-1', username: 'alice', role: 'admin', createdAt: new Date('2026-02-02T00:00:00Z') })
    const res = await roleRoute(req('http://localhost/api/admin/users/u-1/role', { method: 'POST', body: { role: 'admin' } }), { params: Promise.resolve({ id: 'u-1' }) })
    expect(res.status).toBe(200)
    expect(dbMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u-1' }, data: { role: 'admin' } })
    )
    const body = (await res.json()) as { user: { admin: boolean; adminSource: string } }
    expect(body.user.admin).toBe(true)
    expect(body.user.adminSource).toBe('db')
  })

  it('unknown target → 404', async () => {
    dbMock.session.findUnique.mockResolvedValue(ADMIN_SESSION)
    dbMock.user.findUnique.mockResolvedValueOnce(null)
    const res = await roleRoute(req('http://localhost/api/admin/users/nope/role', { method: 'POST', body: { role: 'admin' } }), { params: Promise.resolve({ id: 'nope' }) })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/admin/users/[id]/sessions (v0.16 A1)', () => {
  it('revokes every session of the target', async () => {
    dbMock.session.findUnique.mockResolvedValue(ADMIN_SESSION)
    dbMock.user.findUnique.mockResolvedValueOnce({ id: 'u-1' })
    dbMock.session.deleteMany.mockResolvedValueOnce({ count: 4 })
    const res = await sessionsRoute(req('http://localhost/api/admin/users/u-1/sessions', { method: 'POST', body: {} }), { params: Promise.resolve({ id: 'u-1' }) })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { revoked: number }).revoked).toBe(4)
    expect(dbMock.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u-1' } })
  })
})

describe('GET/PUT /api/admin/config (v0.16 A1)', () => {
  it('GET never echoes the stored key — only a mask', async () => {
    dbMock.session.findUnique.mockResolvedValue(ADMIN_SESSION)
    dbMock.appConfig.findMany.mockResolvedValue([
      { key: 'ai.provider', value: { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-secret-abcdef-wxyz' } },
    ])
    const res = await configGet(req('http://localhost/api/admin/config'))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain('sk-secret-abcdef-wxyz')
    const body = JSON.parse(text)
    expect(body.provider.source).toBe('db')
    expect(body.provider.stored.keyMasked).toBe('sk-s…wxyz')
    expect(body.provider.activeBaseUrl).toBe('https://api.example.com/v1')
  })

  it('PUT rejects a half-configured provider override', async () => {
    dbMock.session.findUnique.mockResolvedValue(ADMIN_SESSION)
    const res = await configPut(req('http://localhost/api/admin/config', { method: 'PUT', body: { provider: { baseUrl: 'https://x.io' } } }))
    expect(res.status).toBe(400)
  })

  it('PUT rejects a scheme-invalid provider override', async () => {
    dbMock.session.findUnique.mockResolvedValue(ADMIN_SESSION)
    const res = await configPut(req('http://localhost/api/admin/config', { method: 'PUT', body: { provider: { baseUrl: 'javascript:alert(1)', apiKey: 'k' } } }))
    expect(res.status).toBe(400)
  })

  it('PUT provider null clears the override (env fallback returns)', async () => {
    dbMock.session.findUnique.mockResolvedValue(ADMIN_SESSION)
    const res = await configPut(req('http://localhost/api/admin/config', { method: 'PUT', body: { provider: null } }))
    expect(res.status).toBe(200)
    expect(dbMock.appConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'ai.provider' }, update: { value: {} } })
    )
  })

  it('PUT features merges over the current flags', async () => {
    dbMock.session.findUnique.mockResolvedValue(ADMIN_SESSION)
    // read #1 (merge base) sees defaults; read #2 (post-write echo) sees the stored row
    dbMock.appConfig.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ key: 'ai.features', value: { magicWrite: false } }])
    const res = await configPut(req('http://localhost/api/admin/config', { method: 'PUT', body: { features: { magicWrite: false } } }))
    expect(res.status).toBe(200)
    const arg = dbMock.appConfig.upsert.mock.calls.find((c) => c[0].where.key === 'ai.features')?.[0]
    expect(arg.update.value).toMatchObject({ magicWrite: false, assistant: true })
    const body = (await res.json()) as { features: Record<string, boolean> }
    expect(body.features.magicWrite).toBe(false)
  })

  it('PUT settings merges and sanitizes the echo', async () => {
    dbMock.session.findUnique.mockResolvedValue(ADMIN_SESSION)
    dbMock.appConfig.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ key: 'app.settings', value: { signupsOpen: false } }])
    const res = await configPut(req('http://localhost/api/admin/config', { method: 'PUT', body: { settings: { signupsOpen: false } } }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { settings: { signupsOpen: boolean; anonymousEditing: boolean } }
    expect(body.settings.signupsOpen).toBe(false)
    expect(body.settings.anonymousEditing).toBe(true)
  })

  it('non-admins never see the config', async () => {
    dbMock.session.findUnique.mockResolvedValueOnce(PLAIN_SESSION)
    const res = await configGet(req('http://localhost/api/admin/config'))
    expect(res.status).toBe(403)
  })
})

describe('POST /api/auth/register × signups switch (v0.16 A1)', () => {
  it('closed signups → 503 SIGNUPS_CLOSED before validation or rate limiting', async () => {
    dbMock.appConfig.findMany.mockResolvedValue([{ key: 'app.settings', value: { signupsOpen: false } }])
    const res = await registerRoute(
      req('http://localhost/api/auth/register', { method: 'POST', body: { username: 'somebody', password: 'longenough1' }, cookie: null })
    )
    expect(res.status).toBe(503)
    expect(((await res.json()) as { code: string }).code).toBe('SIGNUPS_CLOSED')
    // nothing past the gate ran — no user lookups
    expect(dbMock.user.findUnique).not.toHaveBeenCalled()
  })

  it('open signups (default) → the route proceeds to normal validation', async () => {
    dbMock.appConfig.findMany.mockResolvedValue([])
    const res = await registerRoute(
      req('http://localhost/api/auth/register', { method: 'POST', body: { username: 'x', password: 'short' }, cookie: null })
    )
    // reached validation and failed on the username (not on the gate)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code?: string }).code).toBeUndefined()
  })
})
