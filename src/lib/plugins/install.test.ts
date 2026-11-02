import { describe, expect, it } from 'vitest'
import {
  MAX_BUNDLE_BYTES,
  assetUrl,
  collectBundle,
  mimeForPath,
  type FetchLike,
} from './install'

// The install pipeline with a fake network — the same discipline
// as ssrf-guard.test.ts's transport override. Every cap from §4.7
// is pinned here: 2 MB total, per-file fetch, manifest JSON,
// packaging rules on html files, sha256 pinning.

const HOST = { hostAppVersion: '0.13.0' }

const MANIFEST = {
  canvixPluginApi: '1',
  id: 'net.example.wordcloud',
  name: 'Word Cloud',
  version: '1.0.0',
  engines: { canvix: '>=0.13.0 <0.14.0' },
  entry: { panel: 'panel.html' },
  files: ['panel.html', 'app.js'],
  permissions: ['design:read', 'design:write'],
}

const PANEL_HTML =
  '<!doctype html><html><body><div id="app"></div><script src="app.js"></script></body></html>'
const APP_JS = 'console.log("word cloud")'

function fakeNet(files: Record<string, { body: string; status?: number }>, manifest = MANIFEST): FetchLike {
  return async (url) => {
    if (url.endsWith('manifest.canvix.json')) {
      const status = files['@manifest']?.status ?? 200
      return {
        ok: status === 200,
        status,
        arrayBuffer: async () =>
          new TextEncoder().encode(JSON.stringify(manifest)).buffer as ArrayBuffer,
      }
    }
    for (const [path, file] of Object.entries(files)) {
      if (url.endsWith(path)) {
        return {
          ok: (file.status ?? 200) === 200,
          status: file.status ?? 200,
          arrayBuffer: async () => new TextEncoder().encode(file.body).buffer as ArrayBuffer,
        }
      }
    }
    return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
  }
}

const URL_ = 'https://plugins.example.net/wordcloud/manifest.canvix.json'

describe('collectBundle — the golden path', () => {
  it('fetches, validates, package-checks and pins every file', async () => {
    const r = await collectBundle(URL_, {
      ...HOST,
      fetcher: fakeNet({ 'panel.html': { body: PANEL_HTML }, 'app.js': { body: APP_JS } }),
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.bundle.manifest.id).toBe('net.example.wordcloud')
    expect(r.bundle.networkOrigins).toEqual([])
    expect(r.bundle.assets.map((a) => a.path).sort()).toEqual(['app.js', 'panel.html'])
    expect(r.bundle.assets[0].sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(r.bundle.totalBytes).toBeGreaterThan(0)
  })

  it('network permissions flow through to the consent payload', async () => {
    const r = await collectBundle(URL_, {
      ...HOST,
      fetcher: fakeNet(
        { 'panel.html': { body: PANEL_HTML }, 'app.js': { body: APP_JS } },
        { ...MANIFEST, permissions: ['design:read', 'network:https://api.example.com'] },
      ),
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.bundle.networkOrigins).toEqual(['https://api.example.com'])
  })
})

describe('collectBundle — every cap and hostile case', () => {
  it('rejects non-http(s) and unparseable manifest URLs', async () => {
    for (const bad of ['', 'not a url', 'ftp://x/y.json']) {
      const r = await collectBundle(bad, { ...HOST, fetcher: fakeNet({}) })
      expect(r.ok, JSON.stringify(bad)).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('E_URL')
    }
  })

  it('rejects a manifest that is not JSON / not an object / invalid', async () => {
    const notJson: FetchLike = async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode('this is not json').buffer as ArrayBuffer,
    })
    const r1 = await collectBundle(URL_, { ...HOST, fetcher: notJson })
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.error.code).toBe('E_MANIFEST')

    const r2 = await collectBundle(URL_, {
      ...HOST,
      fetcher: fakeNet({}, { ...MANIFEST, canvixPluginApi: '9' }),
    })
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error.message).toMatch(/manifest rejected/)
  })

  it('rejects missing files (404) and fetch failures', async () => {
    const r = await collectBundle(URL_, {
      ...HOST,
      fetcher: fakeNet({ 'panel.html': { body: PANEL_HTML } }), // app.js missing
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('E_FETCH')
      expect(r.error.message).toMatch(/app\.js/)
    }
  })

  it('enforces the 2 MB total cap with a named error', async () => {
    const big = 'x'.repeat(Math.ceil(MAX_BUNDLE_BYTES / 2) + 100)
    const r = await collectBundle(URL_, {
      ...HOST,
      fetcher: fakeNet(
        { 'panel.html': { body: PANEL_HTML }, 'app.js': { body: big }, 'extra.css': { body: big } },
        { ...MANIFEST, files: ['panel.html', 'app.js', 'extra.css'] },
      ),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.message).toMatch(/bundle exceeds/)
  })

  it('rejects hostile panel HTML at install, not at run', async () => {
    for (const html of [
      '<script>inline()</script>',
      '<img src=x onerror=alert(1)>',
      '<script src="https://evil.example.com/x.js"></script>',
    ]) {
      const r = await collectBundle(URL_, {
        ...HOST,
        fetcher: fakeNet({ 'panel.html': { body: html }, 'app.js': { body: APP_JS } }),
      })
      expect(r.ok, html.slice(0, 40)).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('E_MANIFEST')
    }
  })

  it('never follows an unvalidated redirect chain — safeFetch is the default transport', async () => {
    // (the fake fetcher stands in for safeFetch here; the SSRF
    // guard's own suite pins the redirect/dns behavior)
    const r = await collectBundle(URL_, {
      ...HOST,
      fetcher: async () => ({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('E_FETCH')
  })
})

describe('assetUrl / mimeForPath', () => {
  it('resolves declared paths against the manifest URL', () => {
    expect(assetUrl('https://x.example/plug/manifest.canvix.json', 'panel.html')).toBe(
      'https://x.example/plug/panel.html',
    )
    expect(assetUrl('https://x.example/plug/manifest.canvix.json', 'js/app.js')).toBe(
      'https://x.example/plug/js/app.js',
    )
  })

  it('maps only allowlisted extensions to mime types', () => {
    expect(mimeForPath('a.html')).toContain('text/html')
    expect(mimeForPath('a.js')).toContain('text/javascript')
    expect(mimeForPath('a.woff2')).toBe('font/woff2')
    expect(mimeForPath('a.exe')).toBeNull()
    expect(mimeForPath('a')).toBeNull()
    expect(mimeForPath('a.php')).toBeNull()
  })
})
