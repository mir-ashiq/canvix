// scripts/apply-migration.ts — apply a Prisma migration through the WASM
// client (the classic CLI engine hangs in some sandboxed environments).
// Records a checksum-correct _prisma_migrations row so a later
// `prisma migrate deploy` sees the migration as applied and skips it.
//
// Usage: npx tsx scripts/apply-migration.ts <migration-name> <DATABASE_URL>
//   e.g. npx tsx scripts/apply-migration.ts 0004_presence_scope_event_dedup "$DATABASE_URL"
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createScriptClient } from '../src/lib/db-script'

function statementsOf(sql: string): string[] {
  // split on statement-terminating semicolons at end-of-line; this repo's
  // migrations contain no semicolons inside string literals. Comment lines
  // are stripped WITHIN each statement (a statement may carry a leading
  // comment block — the SQL itself still has to run).
  return sql
    .split(/;\s*\n/)
    .map((s) =>
      s
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n')
        .replace(/\n{2,}/g, '\n')
        .trim(),
    )
    .filter((s) => s.length > 0)
}

async function main() {
  const name = process.argv[2]
  const url = process.argv[3] ?? process.env.DATABASE_URL
  if (!name || !url) {
    console.error('usage: tsx scripts/apply-migration.ts <migration-name> <DATABASE_URL>')
    process.exit(1)
  }
  const file = join(process.cwd(), 'prisma', 'migrations', name, 'migration.sql')
  const sql = readFileSync(file, 'utf8')
  const checksum = createHash('sha256').update(sql, 'utf8').digest('hex')

  const db = createScriptClient(url)
  try {
    const already = await db.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM "_prisma_migrations" WHERE migration_name = $1`,
      name,
    ) as Array<{ n: number }>
    if (already[0].n > 0) {
      console.log(`= ${name} already recorded in _prisma_migrations — nothing to do`)
      return
    }

    const stmts = statementsOf(sql)
    console.log(`→ applying ${name} (${stmts.length} statements)`)
    for (const stmt of stmts) {
      const first = stmt.split('\n').find((l) => !l.trim().startsWith('--')) ?? stmt
      await db.$executeRawUnsafe(stmt)
      console.log(`  ✓ ${first.slice(0, 72)}${first.length > 72 ? '…' : ''}`)
    }

    // record exactly as `prisma migrate deploy` would (checksum = sha256
    // of migration.sql — verified against the 0001–0003 rows)
    await db.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES ($1, $2, NOW(), $3, NULL, NULL, NOW(), 1)`,
      randomUUID(),
      checksum,
      name,
    )
    console.log(`✓ ${name} applied + recorded (checksum ${checksum.slice(0, 16)}…)`)
  } catch (e) {
    console.error(`✗ ${name} failed:`, (e as Error).message)
    process.exit(1)
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => {
  console.error('apply-migration crashed:', e)
  process.exit(1)
})
