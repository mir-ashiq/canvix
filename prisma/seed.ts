// Seed the Canvix database with built-in templates.
// Run: npm run db:seed   (or as part of: npm run db:setup)
import { Prisma } from '../src/generated/prisma/client'
import { TEMPLATES } from '../src/lib/templates'
import { createScriptClient } from '../src/lib/db-script'

const db = createScriptClient()

// Typed template list cast for the Postgres jsonb column.
const pagesOf = (t: (typeof TEMPLATES)[number]) =>
  t.pages as unknown as Prisma.InputJsonValue

// v0.17 (Wave 2): field declarations use the same jsonb cast. Plain
// templates store SQL NULL (DbNull), not the jsonb 'null' literal —
// IS NULL filters and the fill route's fallback both rely on it.
const fieldsOf = (t: (typeof TEMPLATES)[number]) =>
  t.fields
    ? (t.fields as unknown as Prisma.InputJsonValue)
    : Prisma.DbNull

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
        // v0.17 (Wave 2): smart-template field declarations
        fields: fieldsOf(t),
      },
      create: {
        slug: t.slug,
        name: t.name,
        category: t.category,
        width: t.width,
        height: t.height,
        accent: t.accent,
        pages: pagesOf(t),
        fields: fieldsOf(t),
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
