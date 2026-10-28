// Unit tests for the MCP SSRF guard — the regression suite for the
// redirect-bypass vulnerability fixed in v0.6.1.
//
// What was broken: the old code checked the private-host regex on the
// FIRST url only and then used fetch(url, { redirect: 'follow' }), so
// any public endpoint that 302'd to an internal address was reachable.
// safeFetch() now re-validates every hop.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// DNS is mocked for every test in this file so the suite is hermetic.
// (assertPublicHost resolves real names otherwise.)
const lookupMock = vi.hoisted(() => vi.fn())
vi.mock('node:dns/promises', () => ({
  lookup: lookupMock,
}))

import {
  isPrivateV4,
  isPrivateV6,
  isBlockedHostname,
  normalizeHost,
  assertPublicHost,
  parseHttpUrl,
  safeFetch,
  pinnedFetch,
  type PinnedTransport,
} from './ssrf-guard'
import { createServer, type Server } from 'node:http'

const PUBLIC_DNS = [{ address: '93.184.216.34', family: 4 }]

beforeEach(() => {
  lookupMock.mockReset()
  lookupMock.mockResolvedValue(PUBLIC_DNS)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── IPv4 ranges ───────────────────────────────────────────────

describe('isPrivateV4', () => {
  it.each([
    ['127.0.0.1', true],
    ['127.255.255.255', true],
    ['10.0.0.1', true],
    ['10.255.255.255', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['169.254.169.254', true], // cloud metadata
    ['192.168.1.1', true],
    ['192.168.0.255', true],
    ['0.0.0.0', true],
    ['100.64.0.1', true], // CGNAT
    ['100.127.255.255', true],
    ['198.18.0.1', true], // benchmarking
    ['224.0.0.1', true], // multicast
    ['255.255.255.255', true],
    ['192.0.2.5', true], // TEST-NET-1
  ])('%s → %s', (ip, expected) => {
    expect(isPrivateV4(ip)).toBe(expected)
  })

  it.each([
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['172.32.0.1', false], // just outside 172.16/12
    ['172.15.255.255', false],
    ['100.128.0.1', false], // just outside CGNAT
    ['93.184.216.34', false],
    ['203.0.114.1', false], // just outside TEST-NET-3
  ])('%s (public) → %s', (ip, expected) => {
    expect(isPrivateV4(ip)).toBe(expected)
  })

  it('treats malformed input as unsafe', () => {
    expect(isPrivateV4('8.8.8.256')).toBe(true)
    expect(isPrivateV4('not-an-ip')).toBe(true)
  })
})

// ── IPv6 ranges ───────────────────────────────────────────────

describe('isPrivateV6', () => {
  it.each([
    ['::1', true],
    ['::', true],
    ['fe80::1', true],
    ['fe80::ffff', true],
    ['fc00::1', true],
    ['fd12:3456:789a::1', true], // ULA under fc00::/7
    ['::ffff:127.0.0.1', true], // v4-mapped loopback
    ['::ffff:10.0.0.5', true], // v4-mapped private
    ['::10.0.0.5', true], // v4-compatible private
    ['64:ff9b::808:808', true], // NAT64
    ['2001:db8::1', true], // documentation
  ])('%s → %s', (ip, expected) => {
    expect(isPrivateV6(ip)).toBe(expected)
  })

  it.each([
    ['2606:4700:4700::1111', false], // Cloudflare DNS
    ['2a00:1450:4001:81b::200e', false], // Google
    ['::ffff:8.8.8.8', false], // v4-mapped PUBLIC
  ])('%s (public) → %s', (ip, expected) => {
    expect(isPrivateV6(ip)).toBe(expected)
  })
})

// ── hostname blocklist ────────────────────────────────────────

describe('isBlockedHostname / normalizeHost', () => {
  it('normalizes case, brackets and trailing dots', () => {
    expect(normalizeHost('EXAMPLE.com.')).toBe('example.com')
    expect(normalizeHost('[::1]')).toBe('::1')
    expect(normalizeHost('  LocalHost ')).toBe('localhost')
  })

  it.each([
    ['localhost', true],
    ['LOCALHOST', true],
    ['localhost.localdomain', true],
    ['metadata.google.internal', true],
    ['instance-data', true],
    ['intranet', true], // bare dot-less name
    ['database', true], // bare dot-less name
    ['printer.local', true],
    ['api.internal', true],
    ['git.corp', true],
    ['cache.docker', true],
    ['portal.lan', true],
  ])('blocks "%s"', (host) => {
    expect(isBlockedHostname(host)).toBe(true)
  })

  it.each([
    ['example.com', false],
    ['example.com.', false],
    ['images.cdn.example.org', false],
    ['8.8.8.8', false],
    ['93.184.216.34', false],
  ])('allows "%s"', (host) => {
    expect(isBlockedHostname(host)).toBe(false)
  })
})

// ── URL / protocol validation ─────────────────────────────────

describe('parseHttpUrl', () => {
  it.each([
    'file:///etc/passwd',
    'ftp://example.com/x',
    'data:text/html,hello',
    'gopher://example.com',
    'javascript:alert(1)',
  ])('rejects non-http protocol %s', (url) => {
    expect(() => parseHttpUrl(url)).toThrow(/only http\(s\)/i)
  })

  it('rejects garbage', () => {
    expect(() => parseHttpUrl('not a url at all')).toThrow(/invalid url/i)
  })

  it('accepts http and https', () => {
    expect(parseHttpUrl('https://example.com/a?b=c').hostname).toBe('example.com')
    expect(parseHttpUrl('http://example.com/').protocol).toBe('http:')
  })
})

// ── assertPublicHost (DNS path) ───────────────────────────────

describe('assertPublicHost', () => {
  it('rejects private IPv4 literals without DNS', async () => {
    await expect(assertPublicHost('10.1.2.3')).rejects.toThrow(/private/i)
    await expect(assertPublicHost('169.254.169.254')).rejects.toThrow(/private/i)
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('rejects private IPv6 literals (with or without brackets)', async () => {
    await expect(assertPublicHost('::1')).rejects.toThrow(/private/i)
    await expect(assertPublicHost('[fd00::1]')).rejects.toThrow(/private/i)
  })

  it('rejects blocked hostnames before DNS', async () => {
    await expect(assertPublicHost('localhost')).rejects.toThrow(/internal-looking|blocked/i)
    await expect(assertPublicHost('db.internal')).rejects.toThrow(/internal-looking|blocked/i)
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('rejects hostnames that resolve to a private address', async () => {
    lookupMock.mockResolvedValue([{ address: '192.168.0.10', family: 4 }])
    await expect(assertPublicHost('evil.example.com')).rejects.toThrow(/resolves to private/)
  })

  it('rejects when ANY resolved address is private (mixed A records)', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.7', family: 4 },
    ])
    await expect(assertPublicHost('sneaky.example.com')).rejects.toThrow(/resolves to private/)
  })

  it('rejects when DNS fails', async () => {
    lookupMock.mockRejectedValue(new Error('ENOTFOUND'))
    await expect(assertPublicHost('nonexistent.example.invalid')).rejects.toThrow(/does not resolve/)
  })

  it('rejects hostnames that resolve to loopback / link-local / metadata addresses', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    await expect(assertPublicHost('loop.example.com')).rejects.toThrow(/resolves to private/)
    lookupMock.mockResolvedValue([{ address: '169.254.169.254', family: 4 }])
    await expect(assertPublicHost('meta.example.com')).rejects.toThrow(/resolves to private/)
    lookupMock.mockResolvedValue([{ address: '::1', family: 6 }])
    await expect(assertPublicHost('v6loop.example.com')).rejects.toThrow(/resolves to private/)
  })

  it('allows hostnames that resolve only to public addresses', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ])
    await expect(assertPublicHost('fine.example.com')).resolves.toBeUndefined()
  })
})

// ── safeFetch: the redirect-pinning regression tests ──────────

function res(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers })
}

describe('safeFetch', () => {
  it('returns a normal 200 response after validating the host, PINNED to the resolved IP', async () => {
    const transport = vi.fn().mockResolvedValue(res(200, { 'content-type': 'image/png' }))
    const out = await safeFetch('https://cdn.example.com/img.png', { transport })
    expect(out.status).toBe(200)
    expect(transport).toHaveBeenCalledTimes(1)
    // v0.9: the connection address is the VALIDATED one from DNS
    expect(transport.mock.calls[0][1]).toBe('93.184.216.34')
    expect(transport.mock.calls[0][2]).toBe(4)
    expect(transport.mock.calls[0][0].href).toBe('https://cdn.example.com/img.png')
  })

  it('REDIRECT BYPASS (the v0.6 bug): a public URL that 302s to a private IP is refused', async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(res(302, { location: 'http://169.254.169.254/latest/meta-data/' }))
    await expect(safeFetch('https://evil.example.com/redirect', { transport })).rejects.toThrow(
      /private|blocked/i,
    )
    expect(transport).toHaveBeenCalledTimes(1) // never connected to the metadata service
  })

  it('redirect to an internal hostname is refused', async () => {
    const transport = vi.fn().mockResolvedValue(res(301, { location: 'http://intranet.corp/secret' }))
    await expect(safeFetch('https://evil.example.com/r', { transport })).rejects.toThrow(/internal-looking|blocked/i)
  })

  it('redirect to a non-http protocol is refused', async () => {
    const transport = vi.fn().mockResolvedValue(res(302, { location: 'file:///etc/passwd' }))
    await expect(safeFetch('https://evil.example.com/r', { transport })).rejects.toThrow(
      /non-http|only http\(s\)/i,
    )
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('follows redirects to PUBLIC hosts — re-pinning on every hop', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(res(302, { location: 'https://mirror.example.org/real.png' }))
      .mockResolvedValueOnce(res(200, { 'content-type': 'image/png' }))
    const out = await safeFetch('https://cdn.example.com/img.png', { transport })
    expect(out.status).toBe(200)
    expect(transport).toHaveBeenCalledTimes(2)
    expect(transport.mock.calls[1][0].href).toBe('https://mirror.example.org/real.png')
    // each hop is pinned to ITS OWN validated address
    expect(transport.mock.calls[1][1]).toBe('93.184.216.34')
  })

  it('resolves RELATIVE redirect locations against the current URL', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(res(302, { location: '/deep/real.png' }))
      .mockResolvedValueOnce(res(200))
    await safeFetch('https://cdn.example.com/a/b/img.png', { transport })
    expect(transport.mock.calls[1][0].href).toBe('https://cdn.example.com/deep/real.png')
  })

  it('refuses after MAX_REDIRECTS hops', async () => {
    const transport = vi.fn().mockImplementation(async () => res(302, { location: 'https://loop.example.com/next' }))
    await expect(safeFetch('https://loop.example.com/start', { transport })).rejects.toThrow(/too many redirects/i)
    expect(transport.mock.calls.length).toBeLessThanOrEqual(6) // 5 hops + initial
  })

  it('refuses the initial URL itself when it is private', async () => {
    const transport = vi.fn()
    await expect(safeFetch('http://192.168.1.1/admin', { transport })).rejects.toThrow(/private/i)
    expect(transport).not.toHaveBeenCalled()
  })

  it('refuses non-http initial URLs', async () => {
    const transport = vi.fn()
    await expect(safeFetch('file:///etc/passwd', { transport })).rejects.toThrow(/only http\(s\)/i)
    expect(transport).not.toHaveBeenCalled()
  })

  it('hands the transport a manual-redirect init (pinning is manual)', async () => {
    const transport = vi.fn().mockResolvedValue(res(200))
    await safeFetch('https://cdn.example.com/img.png', { transport })
    const init = transport.mock.calls[0][3] as RequestInit
    expect(init.redirect).toBe('manual')
  })

  it('DNS REBINDING (the v0.6.1 residual): a name that flips to a private IP after validation cannot be reached', async () => {
    // The guard resolves the name (public) and hands the transport the
    // validated address. Even if real DNS rebound a moment later, the
    // connection still goes to the validated IP — there is no second
    // lookup. This test asserts the invariant the pin enforces.
    lookupMock.mockResolvedValue([{ address: '203.0.114.10', family: 4 }])
    const transport = vi.fn().mockResolvedValue(res(200))
    await safeFetch('https://rebind.example.net/x', { transport })
    expect(transport.mock.calls[0][1]).toBe('203.0.114.10') // the pinned address
  })

  it('DNS CHANGES BETWEEN REQUESTS: a host that was public earlier is re-validated — and refused once it flips private', async () => {
    // Request 1 succeeds against the then-public record…
    lookupMock.mockResolvedValueOnce([{ address: '203.0.114.10', family: 4 }])
    const transport = vi.fn().mockResolvedValue(res(200))
    await safeFetch('https://flip.example.net/x', { transport })
    expect(transport).toHaveBeenCalledTimes(1)
    // …then DNS changes. The NEXT request must re-resolve and refuse —
    // validation is per-request, never cached.
    lookupMock.mockResolvedValueOnce([{ address: '10.0.0.9', family: 4 }])
    await expect(safeFetch('https://flip.example.net/x', { transport })).rejects.toThrow(/resolves to private/)
    expect(transport).toHaveBeenCalledTimes(1) // no second connection
  })

  it('DNS CHANGES MID-CHAIN: a redirect hop whose target has rebound to loopback is refused before connecting', async () => {
    // initial host resolves public…
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
    const transport = vi.fn().mockResolvedValue(res(302, { location: 'https://hop2.example.net/x' }))
    // …but the redirect target now resolves to loopback
    lookupMock.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
    await expect(safeFetch('https://start.example.com/r', { transport })).rejects.toThrow(/resolves to private/)
    expect(transport).toHaveBeenCalledTimes(1) // connected to hop 1 only, never to loopback
  })
})

// ── pinnedFetch: the real transport, exercised end-to-end ─────

describe('pinnedFetch (default transport)', () => {
  let server: Server
  let port: number
  let sawHost: string | null = null

  beforeEach(async () => {
    sawHost = null
    server = createServer((req, res) => {
      sawHost = req.headers.host ?? null
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('hello from pinned')
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    port = (server.address() as { port: number }).port
  })

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('connects to the PINNED address while sending the real hostname', async () => {
    // example.test would normally resolve via DNS — but the pin forces the
    // connection to 127.0.0.1:port. If the lookup were not pinned, this
    // request would fail (NXDOMAIN / wrong host).
    const url = new URL(`http://pin-target.example.test:${port}/x`)
    const out = await pinnedFetch(url, '127.0.0.1', 4, {})
    expect(out.status).toBe(200)
    expect(await out.text()).toBe('hello from pinned')
    // the Host header still carries the ORIGINAL hostname, not the IP
    expect(sawHost).toBe(`pin-target.example.test:${port}`)
  })

  it('rejects when the pinned address is unreachable', async () => {
    // port 1 on loopback: nothing listens there — connection refused
    const url = new URL('http://pin-target.example.test:1/x')
    await expect(pinnedFetch(url, '127.0.0.1', 4, {})).rejects.toThrow()
  })
})
