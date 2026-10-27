// ─────────────────────────────────────────────────────────────
// db-url — Supabase-ready DATABASE_URL handling (v0.8)
//
// Hosted Postgres (Supabase, Neon, RDS…) needs slightly different
// connection flags than a local install, and the #1 source of
// "Could not open template" / 500 errors after moving to Supabase
// is a URL that is missing one of them:
//
//   1. sslmode=require      — hosted servers reject plain TCP
//   2. pgbouncer=true       — Supabase's *transaction pooler*
//                             (port 6543 / *.pooler.supabase.com)
//                             does not support prepared statements;
//                             the flag switches Prisma to a
//                             pgbouncer-compatible mode
//   3. connection_limit=1   — recommended alongside pgbouncer
//
// This module patches those in automatically (with a console note)
// so a copy-pasted Supabase connection string just works.
// ─────────────────────────────────────────────────────────────

export type DatabaseUrlKind =
  | 'supabase-pooler'
  | 'supabase-direct'
  | 'neon'
  | 'remote'
  | 'local'
  | 'unset'

interface ParsedUrl {
  kind: DatabaseUrlKind
  host: string
  port: number
  database: string
}

function parse(url: string): ParsedUrl | null {
  try {
    const u = new URL(url)
    return {
      kind: classify(u),
      host: u.hostname,
      port: Number(u.port) || (u.protocol === 'postgres:' || u.protocol === 'postgresql:' ? 5432 : 0),
      database: u.pathname.replace(/^\//, ''),
    }
  } catch {
    return null
  }
}

function classify(u: URL): DatabaseUrlKind {
  const h = u.hostname
  if (h.endsWith('.pooler.supabase.com')) return 'supabase-pooler'
  if (h.endsWith('.supabase.co') || h.endsWith('.supabase.com')) return 'supabase-direct'
  if (h.endsWith('.neon.tech') || h.endsWith('.neon.build')) return 'neon'
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]') return 'local'
  return 'remote'
}

function isRemote(kind: DatabaseUrlKind): boolean {
  return kind !== 'local' && kind !== 'unset'
}

/**
 * Normalise a Postgres connection string for the driver:
 * - adds `sslmode=require` for remote hosts when not specified
 * - adds `pgbouncer=true&connection_limit=1` for Supabase's
 *   transaction pooler when not specified
 */
export function normalizeDatabaseUrl(rawUrl: string | undefined): string {
  const url = (rawUrl ?? '').trim()
  if (!url) return url

  const parsed = parse(url)
  if (!parsed) return url

  const u = new URL(url)
  const notes: string[] = []

  // 1. remote hosts → require TLS unless the URL already pins an sslmode
  if (isRemote(parsed.kind) && !u.searchParams.has('sslmode') && !u.searchParams.has('ssl')) {
    u.searchParams.set('sslmode', 'require')
    notes.push('sslmode=require')
  }

  // 2. Supabase transaction pooler → pgbouncer-compatible mode
  if (
    parsed.kind === 'supabase-pooler' &&
    !u.searchParams.has('pgbouncer')
  ) {
    u.searchParams.set('pgbouncer', 'true')
    if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', '1')
    notes.push('pgbouncer=true&connection_limit=1')
  }

  if (notes.length) {
    // visible in server logs so the magic is never a mystery
    console.info(
      `[db] ${parsed.kind} connection detected → auto-applied: ${notes.join(', ')}`
    )
  }

  return u.toString()
}

/** Human-readable description of the configured database (no credentials). */
export function describeDatabaseUrl(rawUrl: string | undefined): {
  kind: DatabaseUrlKind
  host: string
  database: string
  normalized: string
} {
  const url = (rawUrl ?? '').trim()
  const parsed = parse(url)
  if (!parsed || !url) {
    return { kind: 'unset', host: '', database: '', normalized: '' }
  }
  return {
    kind: parsed.kind,
    host: parsed.host,
    database: parsed.database,
    normalized: normalizeDatabaseUrl(url),
  }
}

/** Configure process.env.DATABASE_URL for Prisma (idempotent). */
export function applyDatabaseUrlDefaults(): void {
  const raw = process.env.DATABASE_URL
  const normalized = normalizeDatabaseUrl(raw)
  if (normalized && normalized !== raw) {
    process.env.DATABASE_URL = normalized
  }
}
