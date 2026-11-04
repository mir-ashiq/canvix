// scripts/media-gc.ts — media orphan GC (v0.12.4, roadmap H6).
//
// The media store keeps finalized uploads (audio/video, up to 32 MB
// each as bytea) until someone deletes them; deleting the design
// that used them (permanent delete) removes the element JSON but
// never the media row. This script finds and (with --prune) removes:
//
//   1. never-finalized uploads older than 24 h — the same rule the
//      upload-init route applies lazily, applied deterministically
//   2. finalized uploads older than the grace period (default 14 d)
//      whose id is not referenced by ANY live design's pages — an
//      element references its media as `/api/media/<id>` in src.
//      v0.14 (D1): rows kept in the uploads library
//      (keepInLibrary = true) are SKIPPED — a library item is kept
//      on purpose, not orphaned; --prune-library opts back in and
//      treats them like any unreferenced row.
//
// Default mode REPORTS only; --prune actually deletes. The grace
// period exists because a freshly uploaded file can legitimately be
// referenced only by an UNSAVED design (autosave 1.6 s debounce, an
// offline tab, or a design that was never saved at all).
//
// Usage:
//   DATABASE_URL=... npx tsx scripts/media-gc.ts                 # report
//   DATABASE_URL=... npx tsx scripts/media-gc.ts --prune         # delete
//   GRACE_DAYS=30 npx tsx scripts/media-gc.ts --prune            # custom grace
//   DATABASE_URL=... npx tsx scripts/media-gc.ts --prune --prune-library  # also library items
import { createScriptClient } from '../src/lib/db-script'

const db = createScriptClient()

const PRUNE = process.argv.includes('--prune')
const PRUNE_LIBRARY = process.argv.includes('--prune-library')
const GRACE_DAYS = Math.max(1, Number(process.env.GRACE_DAYS ?? 14))
const ABANDON_MS = 24 * 3600 * 1000
const GRACE_MS = GRACE_DAYS * 24 * 3600 * 1000

/** every `/api/media/<id>` referenced by any page of this design */
function referencedMediaIds(pages: unknown): Set<string> {
  const ids = new Set<string>()
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      // element src — also catches src in exports/settings mirrors
      const m = value.match(/\/api\/media\/([a-zA-Z0-9_-]+)/g)
      if (m) for (const hit of m) ids.add(hit.slice('/api/media/'.length))
      return
    }
    if (Array.isArray(value)) {
      value.forEach(walk)
      return
    }
    if (value && typeof value === 'object') {
      Object.values(value).forEach(walk)
    }
  }
  walk(pages)
  return ids
}

async function main() {
  const now = Date.now()
  console.log('════ CANVIX MEDIA ORPHAN GC ════')
  console.log(`run at:      ${new Date().toISOString()}`)
  console.log(`mode:        ${PRUNE ? 'PRUNE (deletes!)' : 'report only'}`)
  console.log(`grace:       ${GRACE_DAYS} days for finalized orphans`)

  // 1. abandoned (never finalized) uploads
  const abandoned = await db.media.findMany({
    where: { finalizedAt: null, createdAt: { lt: new Date(now - ABANDON_MS) } },
    select: { id: true, size: true, createdAt: true },
  })
  const abandonedBytes = abandoned.reduce((n, m) => n + m.size, 0)
  console.log(`\nabandoned uploads (>24 h, never finalized): ${abandoned.length}`)
  console.log(`  reclaimable: ${(abandonedBytes / 1024 / 1024).toFixed(2)} MB`)
  if (PRUNE && abandoned.length) {
    await db.media.deleteMany({
      where: { finalizedAt: null, createdAt: { lt: new Date(now - ABANDON_MS) } },
    })
    console.log('  → deleted')
  }

  // 2. finalized orphans past the grace period
  //    (v0.14 D1: library-kept rows only pruned with --prune-library)
  const candidates = await db.media.findMany({
    where: {
      finalizedAt: { not: null },
      createdAt: { lt: new Date(now - GRACE_MS) },
      ...(PRUNE_LIBRARY ? {} : { keepInLibrary: false }),
    },
    select: { id: true, size: true, createdAt: true, keepInLibrary: true },
  })
  const kept = await db.media.count({
    where: { finalizedAt: { not: null }, keepInLibrary: true, createdAt: { lt: new Date(now - GRACE_MS) } },
  })
  console.log(
    `\nfinalized uploads older than ${GRACE_DAYS} d: ${candidates.length}` +
      ` (${(candidates.reduce((n, m) => n + m.size, 0) / 1024 / 1024).toFixed(2)} MB)`,
  )
  if (kept > 0 && !PRUNE_LIBRARY) {
    console.log(`  (skipping ${kept} library-kept row${kept === 1 ? '' : 's'} — pass --prune-library to include them)`)
  }

  // referenced set — scan live (non-trashed) designs in batches
  const referenced = new Set<string>()
  let cursor: string | undefined
  let scanned = 0
  for (;;) {
    const batch = await db.design.findMany({
      where: { deletedAt: null, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: 100,
      select: { id: true, pages: true },
    })
    if (!batch.length) break
    cursor = batch[batch.length - 1].id
    scanned += batch.length
    for (const d of batch) {
      for (const id of referencedMediaIds(d.pages)) referenced.add(id)
    }
  }
  console.log(`live designs scanned for references: ${scanned}`)

  const orphans = candidates.filter((m) => !referenced.has(m.id))
  const orphanBytes = orphans.reduce((n, m) => n + m.size, 0)
  console.log(`\norphaned finalized media: ${orphans.length}`)
  console.log(`  reclaimable: ${(orphanBytes / 1024 / 1024).toFixed(2)} MB`)
  for (const m of orphans.slice(0, 20)) {
    console.log(`    ${m.id}  ${(m.size / 1024 / 1024).toFixed(2)} MB  ${m.createdAt.toISOString()}`)
  }
  if (orphans.length > 20) console.log(`    … and ${orphans.length - 20} more`)
  if (PRUNE && orphans.length) {
    await db.media.deleteMany({ where: { id: { in: orphans.map((m) => m.id) } } })
    console.log('  → deleted')
  }

  if (!PRUNE) {
    console.log('\n(report only — re-run with --prune to delete)')
  }
  console.log(`\n${PRUNE ? 'PRUNED' : 'REPORTED'} — done.`)
}

main()
  .catch((e) => {
    console.error('media-gc failed:', e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
