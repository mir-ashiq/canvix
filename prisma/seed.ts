// Seed the Canvix database with built-in templates.
// Run: npm run db:seed   (or as part of: npm run db:setup)
//
// v0.18: the upsert loop lives in src/lib/templates/sync.ts (shared
// with the boot-time top-up) — this script is the operator-facing
// wrapper. force: true means "refresh content even when the count
// already matches", which is what an explicit seed run means.
import { TEMPLATES } from '../src/lib/templates'
import { createScriptClient } from '../src/lib/db-script'
// relative import — plain tsx must run without the '@/' alias resolved
import { syncTemplateLibrary } from '../src/lib/templates/sync'

const db = createScriptClient()

async function main() {
  console.log(`Seeding ${TEMPLATES.length} templates…`)
  const before = await db.template.count()
  const res = await syncTemplateLibrary(db, { force: true })
  console.log(`Done. ${res.synced} templates upserted (library had ${before}, now ${res.total}).`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
