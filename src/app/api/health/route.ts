import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { APP_VERSION, APP_BUILD_COMMIT, APP_BUILD_TIME, withLogging } from '@/lib/observability'

const REQUIRED_TABLES = [
  'Design',
  'DesignVersion',
  'Template',
  'DesignEvent',
  'Presence',
  'Comment',
  'AIUsage',
  'User',
  'Session',
] as const

async function __midad_get(req: NextRequest) {
  const wantsV2 = req.nextUrl.searchParams.get('v') === '2'
  const database = { kind: 'cloudflare-d1', name: 'midad-db' }

  const probeStart = Date.now()
  try {
    await db.$queryRaw`SELECT 1`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      {
        ok: false,
        step: 'connect',
        database,
        error: 'Cannot connect to Cloudflare D1',
        detail: message.slice(0, 300),
        fix: 'Check the D1 binding named DB and confirm the midad-db database is attached to the Worker.',
      },
      { status: 503 },
    )
  }
  const dbLatencyMs = Date.now() - probeStart

  const rows = await db.$queryRaw<{ name: string }[]>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `
  const present = new Set(rows.map((r) => r.name))
  const missing = REQUIRED_TABLES.filter((t) => !present.has(t))
  if (missing.length) {
    return NextResponse.json(
      {
        ok: false,
        step: 'migrate',
        database,
        error: `Missing tables: ${missing.join(', ')}`,
        fix: 'Apply the Cloudflare D1 migrations before switching production.',
      },
      { status: 503 },
    )
  }

  const templateRows = await db.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*) AS count FROM "Template"
  `
  const templates = Number(templateRows?.[0]?.count ?? 0)
  if (templates === 0) {
    return NextResponse.json(
      {
        ok: false,
        step: 'seed',
        database,
        error: 'Template table is empty',
        fix: 'Run the D1 template sync/seed step before switching production.',
      },
      { status: 503 },
    )
  }

  if (!wantsV2) {
    return NextResponse.json(
      { v: 1, ok: true, database, templates },
      {
        headers: {
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex',
        },
      },
    )
  }

  const [designs, users, media, versions, comments] = await Promise.all([
    db.$queryRaw<{ count: number }[]>`SELECT COUNT(*) AS count FROM "Design" WHERE "deletedAt" IS NULL`,
    db.$queryRaw<{ count: number }[]>`SELECT COUNT(*) AS count FROM "User"`,
    db.$queryRaw<{ count: number; bytes: number | null }[]>`SELECT COUNT(*) AS count, COALESCE(SUM("size"), 0) AS bytes FROM "Media" WHERE "finalizedAt" IS NOT NULL`,
    db.$queryRaw<{ count: number }[]>`SELECT COUNT(*) AS count FROM "DesignVersion"`,
    db.$queryRaw<{ count: number }[]>`SELECT COUNT(*) AS count FROM "Comment"`,
  ])
  const n = (r: { count: number }[] | undefined) => Number(r?.[0]?.count ?? 0)

  return NextResponse.json(
    {
      v: 2,
      ok: true,
      database,
      templates,
      counts: {
        designs: n(designs),
        users: n(users),
        media: n(media),
        mediaBytes: Number(media?.[0]?.bytes ?? 0),
        versions: n(versions),
        comments: n(comments),
      },
      db: { latencyMs: dbLatencyMs },
      app: {
        version: APP_VERSION,
        commit: APP_BUILD_COMMIT,
        builtAt: APP_BUILD_TIME,
        uptimeSec: Math.round(process.uptime()),
      },
    },
    {
      headers: {
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex',
      },
    },
  )
}

export const GET = withLogging('GET /api/health', __midad_get)
