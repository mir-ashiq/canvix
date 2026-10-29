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
// v0.9 (Phase 3 close-out) added connection PINNING on Node: the
// transport uses a custom DNS lookup that only ever returns the
// already-validated IP, closing the DNS-rebinding TOCTOU window
// (guard resolves, fetch would re-resolve). TLS keeps the real
// hostname for SNI, so certificate validation is unaffected.
//
// v0.9.3 made the guard runtime-portable (Cloudflare Workers):
//   - node:net's isIP is replaced by a local, strict, fail-closed
//     implementation (invalid literals are never mistaken for
//     hostnames — they die in DNS resolution instead)
//   - on Node/Bun: unchanged — node:dns lookup + node:http(s)
//     transport pinned to the validated address
//   - on workerd: there is no node:dns and fetch() owns its own
//     name resolution, so a connection cannot be pinned. Instead
//     the hostname is resolved via DNS-over-HTTPS (Cloudflare's
//     public JSON API) and every address is range-checked before
//     fetch() is allowed to run; the wrangler flag
//     `global_fetch_strictly_public` is a second net that stops
//     fetch() from ever dialing internal space. The residual gap
//     vs Node is the theoretical rebinding window between the DoH
//     answer and Cloudflare's internal resolution — accepted and
//     documented for a runtime that cannot pin sockets.
// ─────────────────────────────────────────────────────────────

import { isWorkersRuntime } from '@/lib/runtime'

export const MAX_REDIRECTS = 5

// ── local IP-literal validation (replaces node:net isIP) ────
// Strict on purpose: anything that is not an unambiguous IP
// literal classifies as a hostname and then has to survive the
// blocklist + DNS checks. Malformed literals therefore fail
// CLOSED (they cannot resolve), exactly like node:net did.

const V4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const V6_GROUP_RE = /^[0-9a-f]{1,4}$/i

function isIpv4Literal(s: string): boolean {
  const m = V4_RE.exec(s)
  if (!m) return false
  for (let i = 1; i <= 4; i++) {
    const part = m[i]
    const n = Number(part)
    if (n > 255) return false
    // reject leading zeros ("01") like node:net does — they are
    // ambiguous (octal in some parsers) and never legitimate here
    if (part.length > 1 && part.startsWith('0')) return false
  }
  return true
}

function isIpv6Literal(s: string): boolean {
  if (!s.includes(':')) return false
  // three-or-more consecutive colons is malformed for every parser
  if (/:{3,}/.test(s)) return false
  // a single leading/trailing colon is malformed in every form
  // ("::" at either end is the legal compression marker)
  if (s.startsWith(':') && !s.startsWith('::')) return false
  if (s.endsWith(':') && !s.endsWith('::')) return false
  // optional trailing IPv4 part ("::ffff:1.2.3.4")
  let body = s
  let v4Tail = false
  const lastColon = s.lastIndexOf(':')
  const tail = s.slice(lastColon + 1)
  if (tail.includes('.')) {
    if (!isIpv4Literal(tail)) return false
    v4Tail = true
    body = s.slice(0, lastColon + 1) // keep the colon that preceded the v4 part
  }
  // at most one "::" compression marker
  const doubleCount = (body.match(/::/g) ?? []).length
  if (doubleCount > 1) return false

  const countGroups = (side: string): number => {
    let n = 0
    for (const piece of side.split(':')) {
      if (piece === '') continue
      if (!V6_GROUP_RE.test(piece)) return -1
      n += 1
    }
    return n
  }

  if (doubleCount) {
    // "::" expands to at least one zero group → at most 7 explicit ones.
    // NB: validate each side separately — a -1 sentinel on one side must
    // not be cancelled out by a valid count on the other.
    const [left, right = ''] = body.split('::')
    const leftCount = countGroups(left)
    const rightCount = countGroups(right)
    if (leftCount < 0 || rightCount < 0) return false
    if (leftCount + rightCount + (v4Tail ? 2 : 0) > 7) return false
  } else {
    // full form: exactly 8 groups (a v4 tail counts as two)
    const explicit = countGroups(body)
    if (explicit < 0 || explicit + (v4Tail ? 2 : 0) !== 8) return false
  }
  return true
}

/** 0 = not an IP literal, 4 = IPv4, 6 = IPv6 (node:net isIP semantics). */
export function isIpLiteral(host: string): 0 | 4 | 6 {
  const h = host.toLowerCase()
  if (h.includes(':')) return isIpv6Literal(h) ? 6 : 0
  return isIpv4Literal(h) ? 4 : 0
}

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
  if (isIpLiteral(ip) !== 4) return true // not a valid v4 literal → treat as unsafe
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

// ── hostname blocklist ──────────────────────────────────────

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
  const version = isIpLiteral(h)
  if (version === 4) return isPrivateV4(h)
  if (version === 6) return isPrivateV6(h)
  if (!h.includes('.')) return true // bare intranet name e.g. http://intranet/
  if (BLOCKED_HOSTS.has(h)) return true
  return BLOCKED_SUFFIXES.some((suffix) => h.endsWith(suffix))
}

// ── name resolution (runtime-adaptive since v0.9.3) ─────────

/** node:dns/promises.lookup — only importable on Node-like runtimes. */
async function nodeLookup(h: string): Promise<Array<{ address: string; family: number }>> {
  const dns = await import('node:dns/promises')
  return dns.lookup(h, { all: true, verbatim: true })
}

/**
 * DNS-over-HTTPS resolution for workerd (no node:dns there).
 * Uses Cloudflare's public JSON API — free, unauthenticated, and fast
 * from inside Workers. Returns A + AAAA records; every address must
 * still pass the private-range checks performed by the caller.
 */
const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query'

async function dohLookup(h: string): Promise<Array<{ address: string; family: number }>> {
  const query = async (type: 'A' | 'AAAA') => {
    const res = await fetch(`${DOH_ENDPOINT}?name=${encodeURIComponent(h)}&type=${type}`, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) throw new Error(`DoH lookup failed with HTTP ${res.status}.`)
    return (await res.json()) as { Status: number; Answer?: Array<{ type: number; data: string }> }
  }
  const [a, aaaa] = await Promise.all([query('A'), query('AAAA')])
  if (a.Status !== 0 || !a.Answer?.length) {
    // NXDOMAIN / servfail — mirror node:dns behaviour
    throw new Error('ENOTFOUND')
  }
  const out: Array<{ address: string; family: number }> = []
  for (const rec of a.Answer ?? []) if (rec.type === 1) out.push({ address: rec.data, family: 4 })
  for (const rec of aaaa.Answer ?? []) if (rec.type === 28) out.push({ address: rec.data, family: 6 })
  if (!out.length) throw new Error('ENOTFOUND')
  return out
}

async function resolveHost(h: string): Promise<Array<{ address: string; family: number }>> {
  return isWorkersRuntime() ? dohLookup(h) : nodeLookup(h)
}

/**
 * Full host validation: blocklist + DNS resolution. Every address a
 * hostname resolves to must be public, otherwise the request is refused.
 * This also defeats decimal/octal/hex IP encodings (e.g. http://2130706433/)
 * because the resolver normalizes them before the range check.
 *
 * v0.9: returns the validated address the connection will be PINNED to
 * (Node — the transport honours the pin; workerd — best-effort, see
 * the file header).
 */
export async function resolvePublicHost(hostname: string): Promise<{ address: string; family: number }> {
  const h = normalizeHost(hostname)
  const version = isIpLiteral(h)
  if (version === 4) {
    if (isPrivateV4(h)) throw new Error(`Blocked target ${h}: private/reserved IP address.`)
    return { address: h, family: 4 }
  }
  if (version === 6) {
    if (isPrivateV6(h)) throw new Error(`Blocked target ${h}: private/reserved IP address.`)
    return { address: h, family: 6 }
  }
  if (isBlockedHostname(h)) throw new Error(`Blocked hostname "${h}": internal-looking name.`)
  let addrs: Array<{ address: string; family: number }>
  try {
    addrs = await resolveHost(h)
  } catch {
    throw new Error(`Host "${h}" does not resolve.`)
  }
  if (!addrs.length) throw new Error(`Host "${h}" does not resolve.`)
  for (const { address, family } of addrs) {
    const priv = family === 6 ? isPrivateV6(address) : isPrivateV4(address)
    if (priv) throw new Error(`Blocked target "${h}": resolves to private address ${address}.`)
  }
  return addrs[0]
}

/** Back-compat wrapper: validate without returning the pin. */
export async function assertPublicHost(hostname: string): Promise<void> {
  await resolvePublicHost(hostname)
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

/** Connection-layer function: performs the HTTP(S) exchange against a
 *  pre-validated IP while presenting `url`'s hostname (Host header + TLS SNI). */
export type PinnedTransport = (
  url: URL,
  ip: string,
  family: number,
  init: RequestInit
) => Promise<Response>

export interface SafeFetchOptions extends RequestInit {
  /** max redirect hops that will be followed (default 5) */
  maxRedirects?: number
  /** @internal transport override — used by the test suite to observe
   *  the pinned address without real network I/O */
  transport?: PinnedTransport
}

function normalizeHeaders(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!h) return out
  if (h instanceof Headers) {
    h.forEach((v, k) => {
      out[k] = v
    })
  } else if (Array.isArray(h)) {
    for (const [k, v] of h) out[k] = v
  } else {
    for (const [k, v] of Object.entries(h)) out[k] = String(v)
  }
  return out
}

/**
 * Default transport on Node/Bun: node:http(s) with a DNS lookup pinned
 * to the validated address — the connection can never drift to a
 * rebound record between validation and connect. The node modules are
 * imported lazily so this file stays loadable on runtimes without them.
 */
export const pinnedFetch: PinnedTransport = (url, ip, family, init) =>
  (async () => {
    const [{ request: httpRequest }, { request: httpsRequest }, { Readable }] = await Promise.all([
      import('node:http'),
      import('node:https'),
      import('node:stream'),
    ])
    return new Promise<Response>((resolve, reject) => {
      const lib = url.protocol === 'https:' ? httpsRequest : httpRequest
      let settled = false
      const fail = (err: unknown) => {
        if (!settled) {
          settled = true
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      }
      let req: import('node:http').ClientRequest
      try {
        req = lib(url, {
          method: init.method ?? 'GET',
          headers: normalizeHeaders(init.headers),
          signal: init.signal ?? undefined,
          // THE PIN: net/tls ask this lookup for the address; it can only
          // ever answer with the address the SSRF validation approved.
          lookup: (
            _hostname: string,
            _opts: unknown,
            cb: (err: null, addresses: Array<{ address: string; family: number }>) => void
          ) => {
            cb(null, [{ address: ip, family }])
          },
        })
      } catch (err) {
        fail(err)
        return
      }
      req.on('error', fail)
      req.on('response', (res) => {
        const headers = new Headers()
        for (const [k, v] of Object.entries(res.headers)) {
          if (Array.isArray(v)) v.forEach((x) => headers.append(k, x))
          else if (v != null) headers.set(k, String(v))
        }
        settled = true
        resolve(
          new Response(Readable.toWeb(res) as unknown as ReadableStream, {
            status: res.statusCode ?? 200,
            statusText: res.statusMessage ?? '',
            headers,
          })
        )
      })
      if (init.body != null) {
        const b = init.body
        if (typeof b === 'string' || Buffer.isBuffer(b) || b instanceof Uint8Array || b instanceof ArrayBuffer) {
          req.write(b)
        } else {
          fail(new Error('safeFetch: unsupported body type for a pinned request.'))
          req.destroy()
          return
        }
      }
      req.end()
    })
  })()

/**
 * Default transport on workerd: fetch() owns name resolution, so the
 * validated address cannot be enforced at the socket layer. The DoH
 * check in resolvePublicHost() plus the `global_fetch_strictly_public`
 * wrangler flag are the guards on this runtime.
 */
export const publicFetch: PinnedTransport = (url, _ip, _family, init) =>
  fetch(url, { ...init, redirect: 'manual' })

function defaultTransport(): PinnedTransport {
  return isWorkersRuntime() ? publicFetch : pinnedFetch
}

/**
 * fetch() with SSRF-hardened, manually-followed redirects and a connection
 * pinned to the validated address (Node — see pinnedFetch; workerd — DoH
 * validation + public-only fetch). Every hop (initial URL included) passes
 * resolvePublicHost() BEFORE the connection is made. Non-http(s) redirect
 * targets are refused. Callers may pass an AbortSignal in options — it
 * spans the whole hop chain.
 */
export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<Response> {
  const { maxRedirects = MAX_REDIRECTS, transport = defaultTransport(), ...init } = options
  let current = parseHttpUrl(url)

  for (let hop = 0; ; hop++) {
    const { address, family } = await resolvePublicHost(current.hostname)

    const res = await transport(current, address, family, { ...init, redirect: 'manual' })

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
