import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Route tests for the v0.13 plugin API (mocked db + session +
// collectBundle — no network, no Postgres). Invariants:
//   1. CANVIX_PLUGINS off → 503 PLUGINS_DISABLED everywhere
//   2. installs are per-user: 401 without a session, never another
//      account's rows
//   3. CSRF on every mutation
//   4. the serve route emits the per-manifest CSP and honors ETag

const dbMock = vi.hoisted(() => ({
  pluginInstall: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  pluginAsset: { deleteMany: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))

const getSessionUser = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/session', () => ({ getSessionUser }))

const collectBundleMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/plugins/install', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/plugins/install')>()),
  collectBundle: collectBundleMock,
  // keep the real mime map — the serve route uses it
}))

import { NextRequest } from 'next/server'
import { GET as listInstalls, POST as installPlugin } from './route'
import { GET as serveAsset } from './[installId]/serve/[...path]/route'

const USER = { id: 'user-1', username: 'plugfan', createdAt: new Date() }

const GOOD_BUNDLE = {
  manifest: {
    canvixPluginApi: '1',
    id: 'net.example.wordcloud',
    name: 'Word Cloud',
    version: '1.0.0',
    engines: { canvix: '>=0.13.0 <0.14.0' },
    entry: { panel: 'panel.html' },
    files: ['panel.html', 'app.js'],
    permissions: ['design:read', 'network:https://api.example.com'],
    elements: [],
  },
  networkOrigins: ['https://api.example.com'],
  assets: [
    { path: 'panel.html', mime: 'text/html; charset=utf-8', bytes: new Uint8Array([60]), sha256: 'a'.repeat(64) },
    { path: 'app.js', mime: 'text/javascript; charset=utf-8', bytes: new Uint8Array([61]), sha256: 'b'.repeat(64) },
  ],
  totalBytes: 1234,
}

function req(url: string, init?: Omit<RequestInit, 'signal' | 'headers'> & { headers?: Record<string, string> }) {
  return new NextRequest(url, {
    ...init,
    headers: { host: 'canvix.test', ...(init?.headers ?? {}) },
  })
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('CANVIX_PLUGINS', '1')
  getSessionUser.mockReset().mockResolvedValue(USER)
  dbMock.pluginInstall.findMany.mockReset().mockResolvedValue([])
  dbMock.pluginInstall.findUnique.mockReset().mockResolvedValue(null)
  dbMock.pluginInstall.updateMany.mockReset().mockResolvedValue({ count: 1 })
  dbMock.pluginInstall.deleteMany.mockReset().mockResolvedValue({ count: 1 })
  dbMock.pluginAsset.deleteMany.mockReset().mockResolvedValue({ count: 2 })
  dbMock.$transaction.mockReset().mockImplementation(async (fn) =>
    fn({
      pluginAsset: { deleteMany: dbMock.pluginAsset.deleteMany },
      pluginInstall: {
        deleteMany: dbMock.pluginInstall.deleteMany,
        create: dbMock.pluginInstall.create.mockReset().mockResolvedValue({
          id: 'install-1',
          pluginId: GOOD_BUNDLE.manifest.id,
          version: '1.0.0',
          enabled: true,
          createdAt: new Date(),
          manifest: GOOD_BUNDLE.manifest,
          assets: GOOD_BUNDLE.assets.map((a) => ({ path: a.path, sha256: a.sha256 })),
        }),
      },
    }),
  )
  collectBundleMock.mockReset().mockResolvedValue({ ok: true, bundle: GOOD_BUNDLE })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('flag gating — CANVIX_PLUGINS off disables the whole surface', () => {
  it('every method answers 503 PLUGINS_DISABLED', async () => {
    vi.stubEnv('CANVIX_PLUGINS', '')
    const list = await listInstalls(req('http://canvix.test/api/plugins'))
    expect(list.status).toBe(503)
    await expect(list.json()).resolves.toMatchObject({ code: 'PLUGINS_DISABLED' })

    const post = await installPlugin(
      req('http://canvix.test/api/plugins', { method: 'POST', body: '{"manifestUrl":"https://x/m.json"}' }),
    )
    expect(post.status).toBe(503)

    const serve = await serveAsset(
      req('http://canvix.test/api/plugins/i1/serve/panel.html'),
      { params: Promise.resolve({ installId: 'i1', path: ['panel.html'] }) },
    )
    expect(serve.status).toBe(503)
  })
})

describe('GET /api/plugins — list', () => {
  it('requires a session', async () => {
    getSessionUser.mockResolvedValue(null)
    const res = await listInstalls(req('http://canvix.test/api/plugins'))
    expect(res.status).toBe(401)
  })

  it('returns the consent payload: permissions in plain language, no bytes', async () => {
    dbMock.pluginInstall.findMany.mockResolvedValue([
      {
        id: 'install-1',
        pluginId: 'net.example.wordcloud',
        version: '1.0.0',
        enabled: true,
        createdAt: new Date('2026-11-02T00:00:00Z'),
        manifest: GOOD_BUNDLE.manifest,
      },
    ])
    const res = await listInstalls(req('http://canvix.test/api/plugins'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.installs).toHaveLength(1)
    const install = body.installs[0]
    expect(install.name).toBe('Word Cloud')
    expect(install.permissions).toEqual([
      {
        permission: 'design:read',
        description: expect.stringContaining('Read the design'),
      },
      {
        permission: 'network:https://api.example.com',
        description: expect.stringContaining('api.example.com'),
      },
    ])
    expect(JSON.stringify(body)).not.toContain('bytes')
  })
})

describe('POST /api/plugins — install', () => {
  it('enforces CSRF (cross-site origin rejected)', async () => {
    const res = await installPlugin(
      req('http://canvix.test/api/plugins', {
        method: 'POST',
        headers: { origin: 'https://evil.example.com' },
        body: '{"manifestUrl":"https://x/m.json"}',
      }),
    )
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ code: 'CSRF_REJECTED' })
  })

  it('requires a session', async () => {
    getSessionUser.mockResolvedValue(null)
    const res = await installPlugin(
      req('http://canvix.test/api/plugins', {
        method: 'POST',
        body: '{"manifestUrl":"https://x/m.json"}',
      }),
    )
    expect(res.status).toBe(401)
  })

  it('rejects a missing manifestUrl', async () => {
    const res = await installPlugin(
      req('http://canvix.test/api/plugins', { method: 'POST', body: '{}' }),
    )
    expect(res.status).toBe(400)
  })

  it('surfaces manifest validation failures as 422 with the plain-language message', async () => {
    collectBundleMock.mockResolvedValue({
      ok: false,
      error: { code: 'E_MANIFEST', message: 'manifest rejected: this plugin needs plugin API v2' },
    })
    const res = await installPlugin(
      req('http://canvix.test/api/plugins', {
        method: 'POST',
        body: '{"manifestUrl":"https://x/m.json"}',
      }),
    )
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({ code: 'E_MANIFEST' })
  })

  it('stores a pinned snapshot: manifest + assets with sha256, 201', async () => {
    const res = await installPlugin(
      req('http://canvix.test/api/plugins', {
        method: 'POST',
        body: '{"manifestUrl":"https://x/m.json"}',
      }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.install.pluginId).toBe('net.example.wordcloud')
    expect(body.files).toEqual([
      { path: 'panel.html', sha256: 'a'.repeat(64) },
      { path: 'app.js', sha256: 'b'.repeat(64) },
    ])
    expect(body.networkOrigins).toEqual(['https://api.example.com'])
    // the transaction replaced any prior install of the same plugin id
    expect(dbMock.pluginInstall.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER.id, pluginId: 'net.example.wordcloud' },
    })
    expect(dbMock.pluginAsset.deleteMany).toHaveBeenCalledWith({
      where: { install: { userId: USER.id, pluginId: 'net.example.wordcloud' } },
    })
  })
})

describe('GET /api/plugins/[id]/serve/[...path]', () => {
  function serveReq(url: string, headers: Record<string, string> = {}) {
    const m = url.match(/\/api\/plugins\/([^/]+)\/serve\/(.+)$/)!
    return [
      req(url, { headers }),
      { params: Promise.resolve({ installId: m[1], path: m[2].split('/') }) },
    ] as const
  }

  it('rejects traversal paths and unsupported extensions', async () => {
    const bad1 = await serveAsset(...serveReq('http://canvix.test/api/plugins/i1/serve/../secret.env'))
    expect(bad1.status).toBe(400)
    const bad2 = await serveAsset(...serveReq('http://canvix.test/api/plugins/i1/serve/app.exe'))
    expect(bad2.status).toBe(415)
  })

  it('404s (one shape) for unknown install, disabled install, missing file', async () => {
    dbMock.pluginInstall.findUnique.mockResolvedValue(null)
    const res = await serveAsset(...serveReq('http://canvix.test/api/plugins/nope/serve/panel.html'))
    expect(res.status).toBe(404)

    dbMock.pluginInstall.findUnique.mockResolvedValue({
      enabled: false,
      manifest: GOOD_BUNDLE.manifest,
      assets: [],
    })
    const res2 = await serveAsset(...serveReq('http://canvix.test/api/plugins/i1/serve/panel.html'))
    expect(res2.status).toBe(404)
  })

  it('serves bytes with the per-manifest CSP, ETag, nosniff and 304 revalidation', async () => {
    dbMock.pluginInstall.findUnique.mockResolvedValue({
      enabled: true,
      manifest: GOOD_BUNDLE.manifest,
      assets: [{ bytes: Buffer.from('<html></html>'), sha256: 'c'.repeat(64) }],
    })
    const res = await serveAsset(...serveReq('http://canvix.test/api/plugins/i1/serve/panel.html'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toBe(
      "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data: blob:; connect-src https://api.example.com; font-src data:; frame-ancestors 'self'; form-action 'none'; base-uri 'none'",
    )
    expect(res.headers.get('etag')).toBe(`"${'c'.repeat(64)}"`)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toContain('private')

    const res304 = await serveAsset(
      ...serveReq('http://canvix.test/api/plugins/i1/serve/panel.html', {
        'if-none-match': `"${'c'.repeat(64)}"`,
      }),
    )
    expect(res304.status).toBe(304)
  })

  it('zero network grants collapse connect-src to none — the exfil wall', async () => {
    dbMock.pluginInstall.findUnique.mockResolvedValue({
      enabled: true,
      manifest: { ...GOOD_BUNDLE.manifest, permissions: ['design:read'] },
      assets: [{ bytes: Buffer.from('console.log(1)'), sha256: 'd'.repeat(64) }],
    })
    const res = await serveAsset(...serveReq('http://canvix.test/api/plugins/i1/serve/app.js'))
    expect(res.headers.get('content-security-policy')).toContain("connect-src 'none'")
  })
})
