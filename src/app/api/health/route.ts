import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { describeDatabaseUrl } from '@/lib/db-url'

// GET /api/health — one-shot setup diagnostics.
// Tells you whether the database is reachable, migrated and seeded,
// and prints the exact fix when it is not. Point a browser here first
// whenever designs/templates fail to open after a host switch
// (e.g. Neon → Supabase).

const REQUIRED_TABLES = [
  'Design',
  'DesignVersion',
  'Template',
  'DesignEvent',
  'Presence',
  'Comment',
  'AIUsage',
  // v0.9: accounts
  'User',
  'Session',
] as const

export async function GET() {
  const url = process.env.DATABASE_URL
  const info = describeDatabaseUrl(url)

  // 1. no DATABASE_URL at all
  if (!url) {
    return NextResponse.json(
      {
        ok: false,
        step: 'env',
        error: 'DATABASE_URL is not set',
        fix: 'Copy .env.example to .env and put your Postgres/Supabase connection string in it.',
      },
      { status: 503 }
    )
  }

  // 2. reachable at all?
  try {
    await db.$queryRaw`SELECT 1`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const poolerHint =
      info.kind === 'supabase-direct'
        ? ' Tip: Supabase direct connections (db.<ref>.supabase.co:5432) are IPv6-only on most plans — use the transaction pooler URL (…pooler.supabase.com:6543) if the host has no IPv6 route.'
        : ''
    return NextResponse.json(
      {
        ok: false,
        step: 'connect',
        database: { kind: info.kind, host: info.host, database: info.database },
        error: 'Cannot connect to the database',
        detail: message.slice(0, 300),
        fix: `Check the URL, database password and network access.${poolerHint}`,
      },
      { status: 503 }
    )
  }

  // 3. migrated? (all tables present)
  // (::text — the rust-free query compiler, unlike the classic engine,
  //  refuses Postgres catalog `name` columns in raw results)
  const rows = await db.$queryRaw<{ table_name: string }[]>`
    SELECT table_name::text AS table_name FROM information_schema.tables
    WHERE table_schema = 'public'
  `
  const present = new Set(rows.map((r) => r.table_name))
  const missing = REQUIRED_TABLES.filter((t) => !present.has(t))
  if (missing.length) {
    return NextResponse.json(
      {
        ok: false,
        step: 'migrate',
        database: { kind: info.kind, host: info.host, database: info.database },
        error: `Missing tables: ${missing.join(', ')}`,
        fix: 'Run  npm run db:setup  (applies migrations + seeds the template library).',
      },
      { status: 503 }
    )
  }

  // 4. seeded? (template library loaded)
  const [templateCount] = await db.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "Template"
  `
  const templates = Number(templateCount?.count ?? 0)
  if (templates === 0) {
    return NextResponse.json(
      {
        ok: false,
        step: 'seed',
        database: { kind: info.kind, host: info.host, database: info.database },
        error: 'Template table is empty',
        fix: 'Run  npm run db:seed  to load the built-in template library.',
      },
      { status: 503 }
    )
  }

  // 5. all green
  return NextResponse.json(
    {
      ok: true,
      database: { kind: info.kind, host: info.host, database: info.database },
      templates,
    },
    {
      headers: {
        // v0.9.2: diagnostics must never be cached (stale health is worse
        // than none) and should not be indexed.
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex',
      },
    }
  )
}
