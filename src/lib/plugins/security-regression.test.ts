import { describe, expect, it } from 'vitest'
import { pluginServeCsp } from '@/lib/security/plugin-csp'
import { checkCloneSafe } from './data-caps'
import { checkEntryHtml, validateManifest } from './manifest'
import { methodAllowed, parsePermission, requiredPermission } from './permissions'
import { parseRpcCall, parseRpcResult, rpcErr } from './rpc'
import { sanitizePluginSvg } from './sanitize-svg'

// ─────────────────────────────────────────────────────────────
// PLUGIN SECURITY REGRESSION SUITE (seed — research §6)
//
// Every entry in this file is a concrete attack that once worked
// against SOME plugin system somewhere. The rule: any failure
// here is a CVE-class regression, not a test flake. This suite
// runs with plain `vitest` on every PR — the same gate that
// guards main. It grows with every milestone (e2e cases land in
// P5/P6; these are the protocol-level guarantees).
//
// Corpus sections:
//   A. manifest fuzz — 16 malformed/hostile manifests
//   B. renderer SVG — hostile output strings
//   C. RPC envelopes — replay, spoof and smuggle attempts
//   D. cross-module — full attack chains
// ─────────────────────────────────────────────────────────────

const HOST = { hostAppVersion: '0.13.0' }

function manifest(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    canvixPluginApi: '1',
    id: 'net.example.plugin',
    name: 'Example',
    version: '1.0.0',
    engines: { canvix: '>=0.13.0 <0.14.0' },
    entry: { panel: 'panel.html' },
    permissions: [],
    ...overrides,
  }
}

describe('A. manifest fuzz corpus (install route must reject every one)', () => {
  // own __proto__ key via defineProperty — the JSON.parse attack shape
  const protoDoc = manifest({}) as Record<string, unknown>
  Object.defineProperty(protoDoc, '__proto__', { value: { polluted: true }, enumerable: true })
  const corpus: Array<{ name: string; doc: unknown }> = [
    { name: 'not an object', doc: '"just a string"' },
    { name: 'array smuggle', doc: [manifest({})] },
    { name: 'null manifest', doc: null },
    { name: 'prototype pollution key', doc: protoDoc },
    { name: 'reserved first-party id', doc: manifest({ id: 'com.canvix.evil' }) },
    { name: 'bare canvix id', doc: manifest({ id: 'canvix' }) },
    { name: 'future api major', doc: manifest({ canvixPluginApi: '2' }) },
    { name: 'future api minor', doc: manifest({ canvixPluginApi: '1.9' }) },
    { name: 'non-numeric api', doc: manifest({ canvixPluginApi: 'one' }) },
    { name: 'wrong host range', doc: manifest({ engines: { canvix: '>=0.99.0' } }) },
    { name: 'garbage range', doc: manifest({ engines: { canvix: 'whenever' } }) },
    { name: 'traversal entry', doc: manifest({ entry: { panel: '../../../etc/passwd.html' } }) },
    { name: 'absolute entry', doc: manifest({ entry: { panel: '/etc/passwd.html' } }) },
    { name: 'remote entry', doc: manifest({ entry: { panel: 'https://evil.example.com/panel.html' } }) },
    { name: 'unknown permission', doc: manifest({ permissions: ['design:read', 'root:everything'] }) },
    { name: 'http network origin', doc: manifest({ permissions: ['network:http://evil.example.com'] }) },
    { name: 'credentialed network origin', doc: manifest({ permissions: ['network:https://user:pass@evil.example.com'] }) },
    { name: 'oversize manifest', doc: manifest({ description: 'x'.repeat(70 * 1024) }) },
    { name: 'invalid semver version', doc: manifest({ version: '1.0' }) },
    { name: 'does nothing (no entry, no elements)', doc: manifest({ entry: {} }) },
  ]

  it('every corpus entry is rejected', () => {
    for (const { name, doc } of corpus) {
      const r = validateManifest(doc, HOST)
      expect(r.ok, `corpus "${name}" must be rejected`).toBe(false)
      if (!r.ok) {
        // rejections must be plain-language, never empty
        expect(r.errors.length).toBeGreaterThan(0)
        for (const e of r.errors) expect(e.length).toBeGreaterThan(5)
      }
    }
  })

  it('a benign manifest still passes (no false-positive drift)', () => {
    const r = validateManifest(manifest({ permissions: ['design:read'] }), HOST)
    expect(r.ok).toBe(true)
  })
})

describe('B. hostile renderer SVG corpus', () => {
  const corpus: Array<{ name: string; svg: string }> = [
    { name: 'inline script', svg: '<svg><script>alert(1)</script></svg>' },
    { name: 'script with attributes', svg: '<svg><script type="text/javascript" src="x.js"></script></svg>' },
    { name: 'foreignObject XSS', svg: '<svg><foreignObject width="10" height="10"><body xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror=alert(1)/></body></foreignObject></svg>' },
    { name: 'event handler', svg: '<svg><rect width="9" height="9" onload="alert(1)"/></svg>' },
    { name: 'animate href flip', svg: '<svg><a><animate attributeName="href" to="https://evil.example.com"/><text>x</text></a></svg>' },
    { name: 'external image beacon', svg: '<svg><image href="https://evil.example.com/pixel.gif" width="1" height="1"/></svg>' },
    { name: 'css exfil', svg: '<svg><style>rect{fill:url(https://evil.example.com/c)}</style><rect width="9" height="9"/></svg>' },
    { name: 'css import', svg: '<svg><style>@import "https://evil.example.com/x.css"</style><rect/></svg>' },
    { name: 'style attr exfil', svg: '<svg><rect width="9" height="9" style="fill:url(\'https://evil.example.com/c\')"/></svg>' },
    { name: 'xxe doctype', svg: '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>' },
    { name: 'cdata smuggle', svg: '<svg><![CDATA[</svg><script>alert(1)</script>]]></svg>' },
    { name: 'comment split script', svg: '<svg><scr<!-- -->ipt>alert(1)</scr<!-- -->ipt></svg>' },
    { name: 'unquoted javascript href', svg: '<svg><a href=javascript:alert(1)><text>x</text></a></svg>' },
    { name: 'nested svg bomb hint', svg: '<svg>' + '<g>'.repeat(200) + '</g>'.repeat(200) + '</svg>' },
    { name: 'html smuggled as svg', svg: '<html><body><script>alert(1)</script></body></html>' },
    { name: 'iframe element', svg: '<svg><iframe href="https://evil.example.com"/></svg>' },
  ]

  it('every corpus entry is rejected', () => {
    for (const { name, svg } of corpus) {
      const r = sanitizePluginSvg(svg)
      expect(r.ok, `svg "${name}" must be rejected`).toBe(false)
    }
  })

  it('benign word-cloud SVG still passes', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect width="800" height="600" fill="#ffffff"/><g font-family="system-ui, sans-serif"><text x="400" y="300" font-size="72" fill="#7630D7" text-anchor="middle">design</text><text x="200" y="150" font-size="40" fill="#02C0CC" text-anchor="middle">fast</text></g></svg>`
    expect(sanitizePluginSvg(svg).ok).toBe(true)
  })
})

describe('C. RPC envelope attacks', () => {
  it('protocol downgrade/upgrade attempts get E_VERSION', () => {
    for (const v of [0, 2, 3, '1', 1.2, null]) {
      const r = parseRpcCall({ v, id: 'rpc_1', dir: 'call', method: 'info' })
      expect(r.ok, `v=${String(v)}`).toBe(false)
      if (!r.ok) expect(r.code).toBe('E_VERSION')
    }
  })

  it('method name injection cannot smuggle through the charset', () => {
    for (const method of [
      '__proto__', 'design.getSnapshot ', ' design.getSnapshot',
      'Design.GetSnapshot', 'design/getSnapshot', 'design.getSnapshot;drop',
    ]) {
      const r = parseRpcCall({ v: 1, id: 'r1', dir: 'call', method })
      expect(r.ok, JSON.stringify(method)).toBe(false)
    }
    // 'constructor' passes the charset on purpose — it is a valid dotted
    // name; the BROKER's catalog check (Object.hasOwn) rejects it
    expect(parseRpcCall({ v: 1, id: 'r1', dir: 'call', method: 'constructor' }).ok).toBe(true)
    expect(requiredPermission('constructor')).toBeUndefined()
  })

  it('replayed result envelopes cannot pose as calls (and vice versa)', () => {
    const result = rpcErr('rpc_9', 'E_PERMISSION', 'nope')
    expect(parseRpcCall(result).ok).toBe(false)
    const call = { v: 1, id: 'r2', dir: 'call', method: 'info' }
    expect(parseRpcResult(call).ok).toBe(false)
  })

  it('oversized/deep/hostile params are rejected at parse time', () => {
    const attacks: unknown[] = [
      { blob: 'x'.repeat(300 * 1024) },
      { nested: JSON.parse('{"a":'.repeat(20) + '1' + '}'.repeat(20)) },
      { fn: () => 'hi' },
      JSON.parse('{"__proto__": {"x": 1}}'),
    ]
    for (const params of attacks) {
      const r = parseRpcCall({ v: 1, id: 'r3', dir: 'call', method: 'design.getSnapshot', params })
      expect(r.ok).toBe(false)
    }
  })

  it('handshake token charset blocks injection into the iframe URL', () => {
    for (const handshake of ['"><script>', '../../path', 'with space', 'ok-token-1234']) {
      const r = parseRpcCall({ v: 1, id: 'r4', dir: 'call', method: 'info', handshake })
      if (handshake === 'ok-token-1234') expect(r.ok).toBe(true)
      else expect(r.ok, handshake).toBe(false)
    }
  })
})

describe('D. cross-module attack chains', () => {
  it('chain: manifest declares nothing, RPC asks for everything → default-deny holds', () => {
    // a valid, permission-free manifest
    const m = validateManifest(manifest({ permissions: [] }), HOST)
    expect(m.ok).toBe(true)
    // its calls still parse, but the broker's permission table denies them
    expect(methodAllowed('design.getSnapshot', [])).toBe(false)
    expect(methodAllowed('actions.apply', [])).toBe(false)
    expect(methodAllowed('storage.get', [])).toBe(false)
  })

  it('chain: network permission strings flow manifest → consent → CSP unchanged', () => {
    const origin = 'network:https://api.example.com'
    const parsed = parsePermission(origin)
    expect(parsed?.origin).toBe('https://api.example.com')
    // plugin-csp accepts exactly this origin and nothing wider
    const csp = pluginServeCsp([parsed!.origin!])
    expect(csp).toContain('connect-src https://api.example.com')
    // a denied origin never appears in the header
    expect(pluginServeCsp([])).toContain("connect-src 'none'")
  })

  it('chain: renderer output with hostile data survives no path into exports', () => {
    // hostile element data (passes manifest caps — it is just strings)…
    const dataOk = checkCloneSafe({ label: '</svg><script>alert(1)</script>' })
    expect(dataOk).toBeNull()
    // …but the same string as renderer OUTPUT is rejected by the sanitizer
    const svg = `<svg><text>${'</svg><script>alert(1)</script>'}</text></svg>`
    expect(sanitizePluginSvg(svg).ok).toBe(false)
  })

  it('chain: entry HTML cannot smuggle execution despite CSP', () => {
    const htmls = [
      '<script>inline()</script>',
      '<img src=x onerror=alert(1)>',
      '<a href="javascript:alert(1)">x</a>',
      '<script src="https://evil.example.com/x.js"></script>',
      '<script src="../outside/x.js"></script>',
    ]
    for (const html of htmls) expect(checkEntryHtml(html)).not.toBeNull()
    expect(checkEntryHtml('<div id="app"></div><script src="app.js"></script>')).toBeNull()
  })
})
