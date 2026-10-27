// ─────────────────────────────────────────────────────────────
// SSRF guard — hardens every outbound fetch the MCP server makes.
//
// The original bug: the private-host check ran only on the FIRST
// url while fetch() followed redirects automatically, so a public
// URL that replied 302 → http://169.254.169.254/ bypassed the
// check entirely (cloud metadata theft, internal port scans).
//
// safeFetch() therefore follows redirects MANUALLY and re-runs
// the full validation on every hop before connecting:
//   1. protocol must be http/https (no file:, data:, gopher:…)
//   2. literal IPs are checked against private/reserved ranges
//   3. hostnames are checked against an intranet blocklist and
//      must NOT be bare (dot-less) names
//   4. DNS is resolved and EVERY resolved address must be public
//
// Known residual risk (documented, accepted for v0.6.1): a DNS
// rebinding TOCTOU — the guard resolves the name, then fetch()
// resolves it again. Pinning the connection IP would break TLS
// SNI for https targets; that is Phase 3 work alongside auth.
// ─────────────────────────────────────────────────────────────

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export const MAX_REDIRECTS = 5

// ── IPv4 private / reserved / non-routable ranges ────────────

function v4ToLong(ip: string): number {
  const parts = ip.split('.')
  return (((Number(parts[0]) << 24) | (Number(parts[1]) << 16) | (Number(parts[2]) << 8) | Number(parts[3])) >>> 0)
}

const V4_BLOCKED: ReadonlyArray<readonly [number, number]> = [
  [v4ToLong('0.0.0.0'), v4ToLong('0.255.255.255')], // "this network" / 0.0.0.0/8
  [v4ToLong('10.0.0.0'), v4ToLong('10.255.255.255')], // RFC1918 private
  [v4ToLong('100.64.0.0'), v4ToLong('100.127.255.255')], // CGNAT 100.64/10
  [v4ToLong('127.0.0.0'), v4ToLong('127.255.255.255')], // loopback
  [v4ToLong('169.254.0.0'), v4ToLong('169.254.255.255')], // link-local + cloud metadata
  [v4ToLong('172.16.0.0'), v4ToLong('172.31.255.255')], // RFC1918 private
  [v4ToLong('192.0.0.0'), v4ToLong('192.0.0.255')], // IETF protocol assignments
  [v4ToLong('192.0.2.0'), v4ToLong('192.0.2.255')], // TEST-NET-1
  [v4ToLong('192.88.99.0'), v4ToLong('192.88.99.255')], // 6to4 relay anycast
  [v4ToLong('192.168.0.0'), v4ToLong('192.168.255.255')], // RFC1918 private
  [v4ToLong('198.18.0.0'), v4ToLong('198.19.255.255')], // benchmarking
  [v4ToLong('198.51.100.0'), v4ToLong('198.51.100.255')], // TEST-NET-2
  [v4ToLong('203.0.113.0'), v4ToLong('203.0.113.255')], // TEST-NET-3
  [v4ToLong('224.0.0.0'), v4ToLong('255.255.255.255')], // multicast + reserved
]

export function isPrivateV4(ip: string): boolean {
  if (isIP(ip) !== 4) return true // not a valid v4 literal → treat as unsafe
  const n = v4ToLong(ip)
  return V4_BLOCKED.some(([lo, hi]) => n >= lo && n <= hi)
}

// ── IPv6 dangerous ranges ────────────────────────────────────

export function isPrivateV6(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0] // drop zone index (fe80::1%eth0)
  if (addr === '::' || addr === '::1') return true // unspecified / loopback
  // v4-mapped (::ffff:a.b.c.d) and v4-compatible (::a.b.c.d)
  const mapped = addr.match(/^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped) return isPrivateV4(mapped[1])
  if (addr.startsWith('64:ff9b:')) return true // NAT64 prefix → reaches IPv4 space
  const head = addr.split(':')[0]
  const first = head === '' ? 0 : parseInt(head, 16)
  if (Number.isNaN(first)) return true
  if ((first & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local
  if ((first & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  // 2001:db8::/32 documentation range (top 32 bits are 2001:0db8)
  if (first === 0x2001 && (parseInt(addr.split(':')[1] ?? '0', 16) & 0xfff0) === 0x0db0) {
    return true
  }
  return false
}

// ── hostname blocklist ───────────────────────────────────────

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal', // GCP metadata
  'instance-data', // EC2 metadata (older)
])

const BLOCKED_SUFFIXES = [
  '.local',
  '.internal',
  '.lan',
  '.intranet',
  '.localdomain',
  '.corp',
  '.home',
  '.kubernetes',
  '.docker',
]

/** Normalize a URL hostname: lowercase, strip brackets and trailing dot. */
export function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '')
}

/**
 * Hostname-level block decision (no DNS). Literal IPs are range-checked;
 * bare dot-less names and known intranet suffixes are blocked.
 */
export function isBlockedHostname(hostname: string): boolean {
  const h = normalizeHost(hostname)
  const version = isIP(h)
  if (version === 4) return isPrivateV4(h)
  if (version === 6) return isPrivateV6(h)
  if (!h.includes('.')) return true // bare intranet name e.g. http://intranet/
  if (BLOCKED_HOSTS.has(h)) return true
  return BLOCKED_SUFFIXES.some((suffix) => h.endsWith(suffix))
}

/**
 * Full host validation: blocklist + DNS resolution. Every address a
 * hostname resolves to must be public, otherwise the request is refused.
 * This also defeats decimal/octal/hex IP encodings (e.g. http://2130706433/)
 * because the resolver normalizes them before the range check.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  const h = normalizeHost(hostname)
  const version = isIP(h)
  if (version === 4) {
    if (isPrivateV4(h)) throw new Error(`Blocked target ${h}: private/reserved IP address.`)
    return
  }
  if (version === 6) {
    if (isPrivateV6(h)) throw new Error(`Blocked target ${h}: private/reserved IP address.`)
    return
  }
  if (isBlockedHostname(h)) throw new Error(`Blocked hostname "${h}": internal-looking name.`)
  let addrs: Array<{ address: string; family: number }>
  try {
    addrs = await lookup(h, { all: true, verbatim: true })
  } catch {
    throw new Error(`Host "${h}" does not resolve.`)
  }
  if (!addrs.length) throw new Error(`Host "${h}" does not resolve.`)
  for (const { address, family } of addrs) {
    const priv = family === 6 ? isPrivateV6(address) : isPrivateV4(address)
    if (priv) throw new Error(`Blocked target "${h}": resolves to private address ${address}.`)
  }
}

// ── protocol + URL validation ────────────────────────────────

export function parseHttpUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`Invalid URL: "${raw.slice(0, 120)}".`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http(s) URLs are allowed (got "${url.protocol}").`)
  }
  return url
}

// ── the safe fetch ───────────────────────────────────────────

export interface SafeFetchOptions extends RequestInit {
  /** max redirect hops that will be followed (default 5) */
  maxRedirects?: number
}

/**
 * fetch() with SSRF-hardened, manually-followed redirects. Every hop
 * (initial URL included) passes assertPublicHost() BEFORE the connection
 * is made. Non-http(s) redirect targets are refused. Callers may pass an
 * AbortSignal in options — it spans the whole hop chain.
 */
export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<Response> {
  const { maxRedirects = MAX_REDIRECTS, ...init } = options
  let current = parseHttpUrl(url)

  for (let hop = 0; ; hop++) {
    await assertPublicHost(current.hostname)

    const res = await fetch(current, { ...init, redirect: 'manual' })

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) return res // 3xx without Location — hand back to caller
      if (hop >= maxRedirects) throw new Error(`Too many redirects (more than ${maxRedirects}).`)
      const next = parseHttpUrl(new URL(location, current).toString())
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        throw new Error(`Blocked redirect to non-http protocol "${next.protocol}".`)
      }
      current = next
      continue
    }
    return res
  }
}
