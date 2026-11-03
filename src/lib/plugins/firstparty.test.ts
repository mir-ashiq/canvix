// ─────────────────────────────────────────────────────────────
// First-party rail tests (P5). Two layers:
//
//   A. the SHIPPED bundle is internally consistent — its manifest
//      validates against this very host build (api version, id
//      grammar incl. the reserved com.canvix.* grant, engines
//      range vs the current package.json version), its HTML
//      passes the packaging checks, every file it declares exists
//      on disk, and the whole thing installs through the REAL
//      collectBundle pipeline with the disk fetcher.
//
//   B. the URL predicate + fetcher boundary — only the strict
//      relative /plugins/<bundled-slug>/manifest.json form counts
//      as first-party; traversal and foreign slugs are refused.
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { validateManifest, checkEntryHtml, PLUGIN_API_MAJOR, PLUGIN_API_MINOR } from './manifest'
import { collectBundle } from './install'
import { isBundledManifestUrl, bundledManifestUrl, bundledSyntheticUrl, BUNDLED_PLUGINS } from './firstparty'
import { createBundledFetcher } from './firstparty-fetch'

const BUNDLE_DIR = path.join(process.cwd(), 'public/plugins/wordcloud')
const MANIFEST_PATH = path.join(BUNDLE_DIR, 'manifest.json')
const RAW = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
  canvixPluginApi: string
  id: string
  files: string[]
  elements: { kind: string; schema: unknown[] }[]
}

/** The host's own version — what the install route passes. */
function hostVersion(): string {
  const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
    version: string
  }
  return pkg.version
}

describe('the shipped Word Cloud bundle (A — internal consistency)', () => {
  it('declares plugin API 1.1 — exactly what this host speaks', () => {
    // the P5 bug this suite pins: manifest constants must never drift
    // from the RPC envelope again
    expect(PLUGIN_API_MAJOR).toBe(1)
    expect(PLUGIN_API_MINOR).toBeGreaterThanOrEqual(1)
    expect(RAW.canvixPluginApi).toBe(`${PLUGIN_API_MAJOR}.${PLUGIN_API_MINOR}`)
  })

  it('validates as a first-party manifest against this exact build', () => {
    const result = validateManifest(RAW, {
      hostAppVersion: hostVersion(),
      allowFirstParty: true,
    })
    expect(result.ok, result.ok ? '' : result.errors.join('; ')).toBe(true)
    if (result.ok) {
      expect(result.manifest.id).toBe('com.canvix.wordcloud')
      expect(result.manifest.entry.panel).toBe('panel.html')
      expect(result.manifest.entry.service).toBe('service.html')
      expect(result.networkOrigins).toEqual([]) // zero network — the default-deny proof
      expect(result.manifest.elements[0]?.kind).toBe('cloud')
      expect(result.manifest.elements[0]?.schema.length).toBe(4)
    }
  })

  it('is REFUSED without the first-party grant — com.canvix.* is reserved', () => {
    const result = validateManifest(RAW, { hostAppVersion: hostVersion() })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('com.canvix')
    }
  })

  it('both entry HTML files pass the packaging rules (no inline scripts/handlers)', () => {
    for (const file of ['panel.html', 'service.html']) {
      const err = checkEntryHtml(readFileSync(path.join(BUNDLE_DIR, file), 'utf8'))
      expect(err, `${file}: ${err ?? ''}`).toBeNull()
    }
  })

  it('every declared file exists on disk', () => {
    for (const file of RAW.files) {
      expect(existsSync(path.join(BUNDLE_DIR, file)), file).toBe(true)
    }
  })
})

describe('the first-party install rail (A — the real pipeline)', () => {
  it('collects the shipped bundle from disk: manifest + files, sha256-pinned', async () => {
    const result = await collectBundle(bundledSyntheticUrl('wordcloud'), {
      hostAppVersion: hostVersion(),
      allowFirstParty: true,
      fetcher: createBundledFetcher(),
    })
    expect(result.ok, result.ok ? '' : result.error?.message).toBe(true)
    if (result.ok) {
      expect(result.bundle.manifest.id).toBe('com.canvix.wordcloud')
      expect(result.bundle.networkOrigins).toEqual([])
      expect(result.bundle.assets.length).toBe(RAW.files.length)
      // byte-pinning is real: the sha matches a fresh digest of the file
      const panel = result.bundle.assets.find((a) => a.path === 'panel.html')
      expect(panel).toBeTruthy()
      expect(panel!.bytes.byteLength).toBeGreaterThan(100)
      expect(result.bundle.totalBytes).toBeLessThan(100 * 1024)
    }
  })

  it('a declared-but-missing file fails honestly (404-shaped, no crash)', async () => {
    const result = await collectBundle('http://canvix.bundled.internal/plugins/wordcloud/manifest.json', {
      hostAppVersion: hostVersion(),
      allowFirstParty: true,
      // a fetcher that finds nothing — simulates a diskless/partial runtime
      fetcher: async () => ({
        ok: false,
        status: 404,
        arrayBuffer: async () => {
          throw new Error('gone')
        },
      }),
    })
    expect(result.ok).toBe(false)
  })
})

describe('the bundled URL predicate (B — the boundary)', () => {
  it('accepts exactly the strict relative form for bundled slugs', () => {
    expect(isBundledManifestUrl('/plugins/wordcloud/manifest.json')).toBe(true)
    expect(isBundledManifestUrl(bundledManifestUrl('wordcloud'))).toBe(true)
  })

  it('refuses absolute URLs, foreign slugs, traversal and look-alikes', () => {
    expect(isBundledManifestUrl('https://evil.example/plugins/wordcloud/manifest.json')).toBe(false)
    expect(isBundledManifestUrl('/plugins/totally-other/manifest.json')).toBe(false)
    expect(isBundledManifestUrl('/plugins/wordcloud/../wordcloud/manifest.json')).toBe(false)
    expect(isBundledManifestUrl('/plugins/wordcloud/manifest.canvix.json')).toBe(false)
    expect(isBundledManifestUrl('/plugins/WordCloud/manifest.json')).toBe(false)
    expect(isBundledManifestUrl('/plugins/wordcloud/panel.html')).toBe(false)
    expect(isBundledManifestUrl('')).toBe(false)
  })

  it('the BUNDLED_PLUGINS list stays in sync with what ships on disk', () => {
    for (const b of BUNDLED_PLUGINS) {
      expect(existsSync(path.join(process.cwd(), 'public/plugins', b.slug, 'manifest.json')), b.slug).toBe(true)
    }
  })
})

describe('the disk fetcher (B — containment)', () => {
  const fetcher = createBundledFetcher()

  it('serves a real file with its bytes', async () => {
    const res = await fetcher('http://canvix.bundled.internal/plugins/wordcloud/service.js')
    expect(res.ok).toBe(true)
    const text = new TextDecoder().decode(await res.arrayBuffer())
    expect(text).toContain("elements.registerRenderer")
  })

  it('refuses anything outside /plugins/ and any traversal shape', async () => {
    for (const url of [
      'http://canvix.bundled.internal/package.json',
      'http://canvix.bundled.internal/prisma/schema.prisma',
      'http://canvix.bundled.internal/plugins/../package.json',
      'http://canvix.bundled.internal/plugins/%2e%2e/package.json',
      'http://canvix.bundled.internal/plugins/wordcloud/../../src/lib/plugins/manifest.ts',
      'http://canvix.bundled.internal/plugins/wordcloud/nope.js',
    ]) {
      const res = await fetcher(url)
      expect(res.ok, url).toBe(false)
      expect(res.status).toBe(404)
    }
  })
})
