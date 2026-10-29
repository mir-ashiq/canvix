// Live smoke: prove the rust-free Prisma client + @prisma/adapter-pg can
// query the real Supabase transaction pooler exactly like the classic
// engine did (auth, TLS, jsonb, bigint aggregate).
// Usage: npx tsx scripts/smoke-rust-free.ts   (DATABASE_URL from env)
import { createScriptClient } from '../src/lib/db-script'

async function main() {
  const db = createScriptClient()
  try {
    const one = await db.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`
    console.log(`✓ SELECT 1 → ok=${one[0]?.ok}`)

    const templates = await db.template.count()
    console.log(`✓ template.count() → ${templates}`)

    const designs = await db.design.findMany({
      select: { id: true, name: true, width: true, height: true, pages: true },
      take: 3,
      orderBy: { createdAt: 'desc' },
    })
    console.log(`✓ design.findMany(take:3) → ${designs.length} rows`)
    for (const d of designs) {
      const pageCount = Array.isArray(d.pages) ? d.pages.length : -1
      console.log(`  · ${d.id} "${d.name}" ${d.width}x${d.height} pages=${pageCount}`)
    }

    const events = await db.designEvent.aggregate({ _max: { id: true } })
    console.log(`✓ designEvent MAX(id) → ${events._max.id?.toString() ?? 'n/a'} (bigint round-trip)`)

    const [users] = await db.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*)::bigint AS count FROM "User"`
    console.log(`✓ user count → ${users.count.toString()}`)

    console.log('\nRUST-FREE CLIENT SMOKE: ALL GREEN')
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e)
  process.exit(1)
})
