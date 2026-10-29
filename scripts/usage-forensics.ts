// scripts/usage-forensics.ts — one-shot DB forensics for the Vercel usage spike.
// Reads only aggregates (counts/sizes/dates) — no user content, no secrets.
// Usage: DATABASE_URL=... npx tsx scripts/usage-forensics.ts
import { createScriptClient } from '../src/lib/db-script'

const db = createScriptClient()

const q = async (label: string, sql: string) => {
  try {
    const rows = (await db.$queryRawUnsafe(sql)) as Array<Record<string, unknown>>
    console.log(`\n### ${label}`)
    for (const r of rows) {
      console.log(
        JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
      )
    }
    if (rows.length === 0) console.log('(no rows)')
  } catch (e) {
    console.log(`\n### ${label}\n  !! ${(e as Error).message.slice(0, 160)}`)
  }
}

async function main() {
  console.log('════ CANVIX DB FORENSICS ════')
  console.log(`run at: ${new Date().toISOString()}`)

  await q(
    'table sizes (n_live_tup + total_relation_size)',
    // relname::text — the rust-free query compiler refuses catalog `name`
    // columns in raw results (v0.9.3)
    `SELECT relname::text AS table,
            n_live_tup AS rows,
            n_tup_ins AS inserts,
            n_tup_upd AS updates,
            n_tup_del AS deletes,
            seq_scan,
            pg_size_pretty(pg_total_relation_size(relid)) AS total_size
       FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC`,
  )

  await q(
    'top SQL statements by total time (pg_stat_statements, if enabled)',
    `SELECT calls,
            round(total_exec_time::numeric, 0) AS total_ms,
            round(mean_exec_time::numeric, 2) AS mean_ms,
            round(rows::numeric / GREATEST(calls,1), 1) AS rows_per_call,
            left(regexp_replace(query, '[\\s\\n\\r]+', ' ', 'g'), 110) AS query
       FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND query NOT ILIKE '%pg_stat%'
      ORDER BY total_exec_time DESC
      LIMIT 18`,
  )

  await q(
    'per-day activity — users / designs / events / comments (Oct 20 →)',
    `SELECT d.day,
            (SELECT COUNT(*)::int FROM "User" u WHERE date_trunc('day', u."createdAt") = d.day) AS new_users,
            (SELECT COUNT(*)::int FROM "Design" g WHERE date_trunc('day', g."createdAt") = d.day) AS new_designs,
            (SELECT COUNT(*)::int FROM "Design" g WHERE date_trunc('day', g."updatedAt") = d.day AND g."updatedAt" > '2026-10-20') AS design_writes,
            (SELECT COUNT(*)::int FROM "DesignEvent" e WHERE date_trunc('day', e."createdAt") = d.day) AS collab_events,
            (SELECT COUNT(*)::int FROM "Comment" c WHERE date_trunc('day', c."createdAt") = d.day) AS comments
       FROM generate_series('2026-10-20'::timestamptz, now(), '1 day') AS d(day)
      ORDER BY d.day`,
  )

  await q(
    'design payload sizes',
    `SELECT COUNT(*)::int AS designs,
            pg_size_pretty(SUM(length("pages"::text))::bigint::numeric::bigint) AS pages_total,
            round(AVG(length("pages"::text))) AS pages_avg,
            MAX(length("pages"::text)) AS pages_max,
            pg_size_pretty(SUM(length(coalesce("thumbnail",'')))::bigint) AS thumbs_total,
            round(AVG(length(coalesce("thumbnail",'')))) AS thumb_avg,
            MAX(length(coalesce("thumbnail",''))) AS thumb_max
       FROM "Design" WHERE "deletedAt" IS NULL`,
  )

  await q(
    'top 10 largest designs',
    `SELECT left(id, 12) AS design,
            left(name, 24) AS name,
            length("pages"::text) AS pages_bytes,
            length(coalesce("thumbnail",'')) AS thumb_bytes,
            "ownerId" IS NOT NULL AS owned,
            "createdAt"::date AS created,
            "updatedAt"::date AS updated
       FROM "Design"
      WHERE "deletedAt" IS NULL
      ORDER BY length("pages"::text) DESC
      LIMIT 10`,
  )

  await q(
    'collab-event hotspots — last 8 days (retry loops?)',
    `SELECT left("designId", 12) AS design,
            COUNT(*)::int AS events,
            COUNT(DISTINCT "actorId")::int AS actors,
            MIN("createdAt") AS first,
            MAX("createdAt") AS last
       FROM "DesignEvent"
      WHERE "createdAt" > now() - interval '8 days'
      GROUP BY "designId"
      ORDER BY events DESC
      LIMIT 12`,
  )

  await q(
    'event kinds — last 8 days',
    `SELECT "kind", COUNT(*)::int AS n
       FROM "DesignEvent"
      WHERE "createdAt" > now() - interval '8 days'
      GROUP BY "kind" ORDER BY n DESC`,
  )

  await q(
    'events per hour — since Oct 25 (spike window)',
    `SELECT date_trunc('hour', "createdAt") AS hour, COUNT(*)::int AS n
       FROM "DesignEvent"
      WHERE "createdAt" >= '2026-10-25'
      GROUP BY 1 ORDER BY 1`,
  )

  await q(
    'event payload sizes — last 8 days',
    `SELECT COUNT(*)::int AS n,
            pg_size_pretty(SUM(length("payload"::text))::bigint) AS total,
            round(AVG(length("payload"::text))) AS avg_bytes,
            MAX(length("payload"::text)) AS max_bytes
       FROM "DesignEvent"
      WHERE "createdAt" > now() - interval '8 days'`,
  )

  await q(
    'versions & templates & sessions',
    `SELECT (SELECT COUNT(*)::int FROM "DesignVersion") AS versions,
            (SELECT pg_size_pretty(SUM(length("pages"::text))::bigint) FROM "DesignVersion") AS versions_size,
            (SELECT COUNT(*)::int FROM "Template") AS templates,
            (SELECT pg_size_pretty(SUM(length("pages"::text))::bigint) FROM "Template") AS templates_size,
            (SELECT COUNT(*)::int FROM "Session") AS sessions,
            (SELECT COUNT(*)::int FROM "Session" WHERE "expiresAt" > now()) AS sessions_live,
            (SELECT COUNT(*)::int FROM "Design" WHERE "ownerId" IS NULL AND "deletedAt" IS NULL) AS legacy_designs`,
  )

  console.log('\n════ END FORENSICS ════')
  await db.$disconnect()
}

main().catch(async (e) => {
  console.error('FATAL', e)
  await db.$disconnect()
  process.exit(1)
})
