// scripts/cleanup-v0110-probes.ts — one-off hygiene: remove ALL probe rows
// created by tests/e2e/v0110-smoke.spec.ts runs. The spec overwrites its
// probe ledger each run, so match by the distinct design name the spec
// uses ('v0110 browser smoke', always ownerless) and harvest the media ids
// from the designs' own element srcs — never touch other rows.
export {}

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createScriptClient } from '../src/lib/db-script'

const PROBE_NAME = 'v0110 browser smoke'

async function main() {
  const env = readFileSync(join(process.cwd(), '.env'), 'utf8')
  const line = env.split('\n').find((l) => l.startsWith('DATABASE_URL='))
  if (!line) throw new Error('no DATABASE_URL in .env')
  const db = createScriptClient(line.slice('DATABASE_URL='.length).trim())

  const designs = await db.design.findMany({
    where: { name: PROBE_NAME, ownerId: null },
    select: { id: true, pages: true },
  })
  console.log(`probe designs found: ${designs.length}`)

  // harvest media ids from the designs' audio/video element srcs
  const mediaIds = new Set<string>()
  for (const d of designs) {
    const pages = (d.pages as Array<{ elements?: Array<{ type?: string; src?: string }> }> | null) ?? []
    for (const p of pages) {
      for (const el of p.elements ?? []) {
        if ((el.type === 'audio' || el.type === 'video') && typeof el.src === 'string') {
          const m = /\/api\/media\/([a-z0-9]+)/i.exec(el.src)
          if (m) mediaIds.add(m[1])
        }
      }
    }
  }
  console.log(`media referenced: ${mediaIds.size}`)

  const ids = designs.map((d) => d.id)
  const dl = await db.design.deleteMany({ where: { id: { in: ids } } })
  const ml = await db.media.deleteMany({ where: { id: { in: [...mediaIds] } } })
  const pl = await db.presence.deleteMany({ where: { designId: { in: ids } } })
  const cl = await db.comment.deleteMany({ where: { designId: { in: ids } } })
  await db.$disconnect()
  console.log(`deleted: ${dl.count} designs (events cascade), ${ml.count} media, ${pl.count} presence, ${cl.count} comments`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
