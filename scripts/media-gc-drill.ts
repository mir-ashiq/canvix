// one-off drill for scripts/media-gc.ts (v0.12.4, H6): plants
//   (a) an old ORPHAN media row, and
//   (b) an old media row REFERENCED by a live design's pages,
// runs the GC in report + prune mode, and asserts that exactly the
// orphan is flagged and deleted while the referenced one survives.
// Restores the design's pages afterwards. Safe to re-run.
// Usage: DATABASE_URL=... npx tsx scripts/media-gc-drill.ts
import { createScriptClient } from '../src/lib/db-script'

const db = createScriptClient()
const OLD = new Date(Date.now() - 30 * 24 * 3600 * 1000)
const bytes = new Uint8Array([1, 2, 3, 4])

interface PageShape {
  id?: string
  elements?: Array<Record<string, unknown>>
  [k: string]: unknown
}

function asPages(raw: unknown): PageShape[] {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  return Array.isArray(parsed) ? (parsed as PageShape[]) : []
}

async function main() {
  // a live design with at least one page to anchor the "referenced" probe
  const designs = await db.design.findMany({
    where: { deletedAt: null },
    orderBy: { updatedAt: 'desc' },
    take: 20,
    select: { id: true, pages: true },
  })
  const design = designs.find((d) => {
    const pages = asPages(d.pages)
    return pages.length > 0 && Array.isArray(pages[0].elements)
  })
  if (!design) throw new Error('need at least one live design with a page for the drill')

  const originalPages = design.pages
  const pages = asPages(design.pages)

  const orphan = await db.media.create({
    data: { mime: 'audio/mp4', size: 4, bytes, finalizedAt: OLD, createdAt: OLD },
    select: { id: true },
  })
  const kept = await db.media.create({
    data: { mime: 'video/webm', size: 4, bytes, finalizedAt: OLD, createdAt: OLD },
    select: { id: true },
  })
  const probeElement = {
    type: 'video',
    src: `/api/media/${kept.id}`,
    x: 0,
    y: 0,
    w: 10,
    h: 10,
  }
  pages[0].elements!.push(probeElement)
  await db.design.update({ where: { id: design.id }, data: { pages: pages as never } })
  console.log(`planted orphan=${orphan.id} referenced=${kept.id} (in design ${design.id})`)

  try {
    const { execSync } = await import('node:child_process')
    const out = execSync('npx tsx scripts/media-gc.ts', {
      env: { ...process.env },
      encoding: 'utf8',
    })
    const flagsOrphan = out.includes(orphan.id)
    const flagsKept = out.includes(kept.id)
    console.log(`report flags orphan: ${flagsOrphan}, flags referenced: ${flagsKept}`)

    const prune = execSync('npx tsx scripts/media-gc.ts --prune', {
      env: { ...process.env },
      encoding: 'utf8',
    })
    const prunedOrphan = prune.includes(orphan.id)
    const orphanGone = !(await db.media.findUnique({ where: { id: orphan.id } }))
    const keptAlive = !!(await db.media.findUnique({ where: { id: kept.id } }))
    console.log(
      `prune lists orphan: ${prunedOrphan}; orphan deleted: ${orphanGone}; referenced kept: ${keptAlive}`,
    )

    const pass = flagsOrphan && !flagsKept && prunedOrphan && orphanGone && keptAlive
    console.log(pass ? 'MEDIA GC DRILL: PASS' : 'MEDIA GC DRILL: FAIL')
    process.exitCode = pass ? 0 : 1
  } finally {
    // restore the design's pages + drop the probe media row
    await db.design
      .update({ where: { id: design.id }, data: { pages: originalPages as never } })
      .catch(() => {})
    await db.media.delete({ where: { id: kept.id } }).catch(() => {})
    console.log('drill cleaned up')
  }
}

main()
  .catch((e) => {
    console.error('drill failed:', e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
