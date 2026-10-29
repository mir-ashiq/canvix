// Seed the Canvix database with built-in templates.
// Run: npm run db:seed   (or as part of: npm run db:setup)
import { Prisma } from '../src/generated/prisma/client'
import { TEMPLATES } from '../src/lib/templates'
import { createScriptClient } from '../src/lib/db-script'

const db = createScriptClient()

// Typed template list cast for the Postgres jsonb column.
const pagesOf = (t: (typeof TEMPLATES)[number]) =>
  t.pages as unknown as Prisma.InputJsonValue

async function main() {
  console.log(`Seeding ${TEMPLATES.length} templates…`)
  for (const t of TEMPLATES) {
    await db.template.upsert({
      where: { slug: t.slug },
      update: {
        name: t.name,
        category: t.category,
        width: t.width,
        height: t.height,
        accent: t.accent,
        pages: pagesOf(t),
      },
      create: {
        slug: t.slug,
        name: t.name,
        category: t.category,
        width: t.width,
        height: t.height,
        accent: t.accent,
        pages: pagesOf(t),
      },
    })
    console.log(`  ✓ ${t.slug}`)
  }
  console.log('Done.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
