// scripts/inspect-presence-constraints.ts — pre-migration forensics for 0004
// Usage: npx tsx scripts/inspect-presence-constraints.ts <DATABASE_URL>
import { createScriptClient } from '../src/lib/db-script'

async function main() {
  const url = process.argv[2] ?? process.env.DATABASE_URL
  if (!url) {
    console.error('✗ no DATABASE_URL given')
    process.exit(1)
  }
  const db = createScriptClient(url)
  try {
    const cons = await db.$queryRawUnsafe(`
      SELECT conname::text, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = '"Presence"'::regclass
      ORDER BY conname`) as Array<{ conname: string; def: string }>
    console.log('— Presence constraints —')
    for (const c of cons) console.log(`  ${c.conname}: ${c.def}`)

    const cols = await db.$queryRawUnsafe(`
      SELECT column_name::text, data_type::text, is_nullable::text
      FROM information_schema.columns
      WHERE table_name = 'Presence' ORDER BY ordinal_position`) as Array<Record<string, string>>
    console.log('— Presence columns —')
    for (const c of cols) console.log(`  ${c.column_name} ${c.data_type} nullable=${c.is_nullable}`)

    const evCols = await db.$queryRawUnsafe(`
      SELECT column_name::text, data_type::text
      FROM information_schema.columns
      WHERE table_name = 'DesignEvent' ORDER BY ordinal_position`) as Array<Record<string, string>>
    console.log('— DesignEvent columns —')
    for (const c of evCols) console.log(`  ${c.column_name} ${c.data_type}`)

    const rows = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n, COUNT(DISTINCT id)::int AS ids, COUNT(DISTINCT (\"designId\", id))::int AS pairs FROM "Presence"`) as Array<{ n: number; ids: number; pairs: number }>
    console.log(`— Presence rows: ${rows[0].n} (distinct id ${rows[0].ids}, distinct (designId,id) ${rows[0].pairs})`)

    const mig = await db.$queryRawUnsafe(`
      SELECT migration_name::text, checksum::text FROM "_prisma_migrations" ORDER BY finished_at`) as Array<{ migration_name: string; checksum: string }>
    console.log('— applied migrations —')
    for (const m of mig) console.log(`  ${m.migration_name} checksum=${m.checksum.slice(0, 16)}…`)
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => {
  console.error('inspect failed:', (e as Error).message)
  process.exit(1)
})
