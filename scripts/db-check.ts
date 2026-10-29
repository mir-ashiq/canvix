// scripts/db-check.ts — tiny Prisma-based SQL checker used by verify-db-setup.sh
// Usage: npx tsx scripts/db-check.ts <DATABASE_URL> <json-spec>
//   { "sql": "SELECT COUNT(*)::int AS c FROM \"Template\"", "expectField": "c", "expect": 110 }
import { createScriptClient } from '../src/lib/db-script'

async function main() {
  const url = process.argv[2]
  const spec = JSON.parse(process.argv[3]) as {
    sql: string
    expectField?: string
    expect?: number | string
    label?: string
  }
  const db = createScriptClient(url)
  try {
    const rows = await db.$queryRawUnsafe(spec.sql) as Array<Record<string, unknown>>
    if (spec.expectField !== undefined) {
      const got = rows[0]?.[spec.expectField]
      const want = spec.expect
      const ok = String(got) === String(want)
      console.log(`${ok ? '✓' : '✗'} ${spec.label ?? spec.sql} → ${got} (want ${want})`)
      process.exit(ok ? 0 : 1)
    }
    console.log('✓ ' + (spec.label ?? 'query') + ' → ' + JSON.stringify(rows[0] ?? null))
    process.exit(0)
  } catch (e) {
    console.error('✗ ' + (spec.label ?? spec.sql) + ' → ' + (e as Error).message.slice(0, 200))
    process.exit(1)
  } finally {
    await db.$disconnect()
  }
}
main()
