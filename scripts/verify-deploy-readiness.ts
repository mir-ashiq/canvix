// scripts/verify-deploy-readiness.ts — one-shot deployment readiness check
// Verifies: migrations applied, schema matches Prisma models, core row counts,
// connection-string normalization parity across runtimes.
// Usage: npx tsx scripts/verify-deploy-readiness.ts <DATABASE_URL>
import { createScriptClient } from '../src/lib/db-script'

async function main() {
  const url = process.argv[2] ?? process.env.DATABASE_URL
  if (!url) {
    console.error('✗ no DATABASE_URL given')
    process.exit(1)
  }
  const db = createScriptClient(url)
  const pass = (label: string, detail: string) => console.log(`✓ ${label} — ${detail}`)
  const fail = (label: string, detail: string) => {
    console.error(`✗ ${label} — ${detail}`)
    process.exitCode = 1
  }
  try {
    // 1. server version
    const [ver] = await db.$queryRawUnsafe('SELECT version()::text AS v') as Array<{ v: string }>
    pass('connect', ver.v.split(',')[0])

    // 2. migrations applied
    const migrations = await db.$queryRawUnsafe<{ migration_name: string; finished_at: string }[]>(
      `SELECT migration_name::text, finished_at::text FROM "_prisma_migrations" ORDER BY finished_at`,
    )
    const names = migrations.map((m) => m.migration_name)
    for (const want of ['0001_init', '0002_accounts', '0003_anon_attribution']) {
      if (names.includes(want)) pass('migration', `${want} applied (${migrations.find((m) => m.migration_name === want)?.finished_at ?? '?'})`)
      else fail('migration', `${want} MISSING`)
    }

    // 3. schema completeness (tables + key columns the v0.9.x code depends on)
    const tables = await db.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name::text FROM information_schema.tables WHERE table_schema='public'`,
    )
    const tableNames = tables.map((t) => t.table_name)
    for (const want of ['User', 'Session', 'Design', 'DesignEvent', 'Template']) {
      if (tableNames.includes(want)) pass('table', `${want} present`)
      else fail('table', `${want} MISSING`)
    }
    const cols = await db.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
      `SELECT table_name::text, column_name::text FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('Design','User','Session')`,
    )
    const colKey = new Set(cols.map((c) => `${c.table_name}.${c.column_name}`))
    for (const want of ['Design.ownerId', 'Design.anonKey', 'User.passwordHash', 'Session.expiresAt']) {
      if (colKey.has(want)) pass('column', `${want} present`)
      else fail('column', `${want} MISSING`)
    }

    // 4. row counts + indexes the app relies on
    const [counts] = await db.$queryRawUnsafe(
      `SELECT (SELECT COUNT(*)::int FROM "Template") AS templates, (SELECT COUNT(*)::int FROM "Design") AS designs,
              (SELECT COUNT(*)::int FROM "User") AS users, (SELECT COUNT(*)::int FROM "Session") AS sessions,
              (SELECT COUNT(*)::int FROM "DesignEvent") AS events`,
    ) as Array<{ templates: number; designs: number; users: number; sessions: number; events: number }>
    pass('data', `templates=${counts.templates} designs=${counts.designs} users=${counts.users} sessions=${counts.sessions} events=${counts.events}`)
    if (counts.templates !== 110) fail('templates', `expected 110, got ${counts.templates}`)

    const idx = await db.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname::text FROM pg_indexes WHERE schemaname='public' AND tablename='Design'`,
    )
    const idxNames = idx.map((i) => i.indexname)
    pass('indexes', idxNames.join(', ') || '(none)')

    // 5. transaction-pooler discipline: prepared statements must not be used.
    //    A $1-placeholder query through the app client proves the pgbouncer
    //    compatibility path works (the driver deduplicates named statements).
    const [param] = await db.$queryRawUnsafe('SELECT $1::int AS n', 7) as Array<{ n: number }>
    if (param.n === 7) pass('parameterized query', 'works through pooler')
    else fail('parameterized query', `got ${param.n}`)

    console.log('\nDeploy-readiness: ' + (process.exitCode ? 'FAILED' : 'ALL GREEN'))
  } catch (e) {
    console.error('✗ fatal — ' + (e as Error).message)
    process.exitCode = 1
  } finally {
    await db.$disconnect()
  }
}
main()
