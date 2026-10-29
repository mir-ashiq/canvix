// Unit tests for v0.9.3 cross-runtime infrastructure:
//   - isIpLiteral: the local node:net.isIP replacement used by the SSRF
//     guard on runtimes without node:net (workerd)
//   - driverConnectionString: the pg-driver URL rewriter (strips
//     Prisma-engine-only params, keeps TLS defaults)
//   - detectServerRuntime / isWorkersRuntime

import { describe, it, expect } from 'vitest'
import { isIP } from 'node:net'
import { isIpLiteral } from './mcp/ssrf-guard'
import { driverConnectionString, normalizeDatabaseUrl } from './db-url'
import { detectServerRuntime, isWorkersRuntime } from './runtime'

// ── isIpLiteral vs node:net.isIP ─────────────────────────────
// The replacement must classify EXACTLY like node:net on every input
// we could ever see, because the SSRF guard's fail-closed guarantees
// depend on the classification (literal → range check, anything else
// → hostname blocklist + DNS). Tests run on Node, so node:net is the
// oracle.

const CORPUS = [
  // valid IPv4
  '0.0.0.0', '8.8.8.8', '127.0.0.1', '93.184.216.34', '255.255.255.255', '192.0.2.5',
  // invalid IPv4
  '8.8.8.256', '1.2.3', '1.2.3.4.5', '01.2.3.4', '1.2.3.04', 'not-an-ip', '', '8.8.8.8.',
  '8.8.8', '999.1.1.1', '1.2.3.4 ', ' 1.2.3.4', '1..2.3', '.1.2.3',
  // valid IPv6
  '::', '::1', '::ffff:8.8.8.8', '::ffff:127.0.0.1', '::10.0.0.5',
  'fe80::1', 'fe80::', 'fe80::ffff', 'fc00::1', 'fd12:3456:789a::1',
  '64:ff9b::808:808', '2606:4700:4700::1111', '2001:db8::1',
  '2a00:1450:4001:81b::200e',
  '2606:4700:4700:0000:0000:0000:0000:1111', // full form
  '1:2:3:4:5:6:1.2.3.4', // full form with v4 tail
  '1:2::1.2.3.4', // compressed with v4 tail
  // invalid IPv6
  ':::1', '1::2::3', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7::8',
  '12345::', 'g::1', ':1:2::3', '1:2::3:', '1:2:3:4:5:6:7:8:',
  '1:2:3:4:5:6:7', '1:2:3:4:5:6:7:1.2.3.4',
  // hostnames (must classify as 0)
  'example.com', 'localhost', 'intranet', 'sub.domain.example.org',
  'EXAMPLE.COM', 'xn--e1afmkfd.xn--p1ai',
]

describe('isIpLiteral (node:net isIP parity)', () => {
  it.each(CORPUS)('%s', (input) => {
    expect(isIpLiteral(input)).toBe(isIP(input))
  })

  it('never misclassifies a private literal as a hostname (fail-closed)', () => {
    // if these were treated as hostnames they would still be blocked, but
    // they MUST be literals so the range checks run deterministically
    expect(isIpLiteral('10.0.0.1')).toBe(4)
    expect(isIpLiteral('169.254.169.254')).toBe(4)
    expect(isIpLiteral('::1')).toBe(6)
    expect(isIpLiteral('fd00::1')).toBe(6)
  })
})

// ── driverConnectionString ───────────────────────────────────

describe('driverConnectionString', () => {
  it('strips Prisma-engine-only params and relaxes sslmode=require to no-verify', () => {
    const inUrl =
      'postgresql://postgres.abc:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1&sslmode=require'
    const out = driverConnectionString(inUrl)
    expect(out).not.toContain('pgbouncer')
    expect(out).not.toContain('connection_limit')
    // node-postgres treats require as verify-full (breaks Supabase/Neon
    // pooler CA chains) — the driver path pins no-verify = encrypt only,
    // the exact classic-engine behaviour
    expect(out).toContain('sslmode=no-verify')
    expect(out).toContain('aws-0-eu-central-1.pooler.supabase.com:6543')
  })

  it('adds sslmode for remote hosts that lack it (via normalize)', () => {
    const out = driverConnectionString(
      'postgresql://u:p@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres'
    )
    expect(out).toContain('sslmode=no-verify')
    expect(out).not.toContain('pgbouncer')
  })

  it('leaves local URLs untouched', () => {
    expect(driverConnectionString('postgresql://postgres:postgres@localhost:5432/canvix')).toBe(
      'postgresql://postgres:postgres@localhost:5432/canvix'
    )
  })

  it('returns empty string for unset URLs (late failure, not crash)', () => {
    expect(driverConnectionString(undefined)).toBe('')
    expect(driverConnectionString('')).toBe('')
  })

  it('keeps driver-clean URLs byte-identical', () => {
    const clean =
      'postgresql://u:p@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres?sslmode=no-verify'
    expect(driverConnectionString(clean)).toBe(clean)
  })

  it('leaves user-pinned verification levels untouched', () => {
    const pinned =
      'postgresql://u:p@db.example.com:5432/canvix?sslmode=verify-full&sslrootcert=%2Fetc%2Fca.pem'
    expect(driverConnectionString(pinned)).toBe(pinned)
  })

  it('normalizeDatabaseUrl still adds the Prisma flags for the engine/CLI path', () => {
    const out = normalizeDatabaseUrl(
      'postgresql://postgres.abc:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres'
    )
    expect(out).toContain('pgbouncer=true')
    expect(out).toContain('connection_limit=1')
  })
})

// ── runtime detection ────────────────────────────────────────

describe('detectServerRuntime', () => {
  it('reports a Node-like runtime under vitest (never workerd)', () => {
    expect(isWorkersRuntime()).toBe(false)
    expect(['node', 'bun']).toContain(detectServerRuntime())
  })

  it('is memoized', () => {
    expect(detectServerRuntime()).toBe(detectServerRuntime())
  })
})
