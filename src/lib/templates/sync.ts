// ─────────────────────────────────────────────────────────────
// Canvix v0.18 — template library sync (the seed, as a function)
//
// "The template library ships as code" (docs/UPGRADING.md): the
// TEMPLATES array is the source of truth and the database is a
// materialised index of it. This module is the ONE place that
// reconciles the two, so `npm run db:seed` (scripts) and the
// boot-time top-up (src/instrumentation.ts) cannot drift apart.
//
// Semantics — deliberately conservative:
//  • upsert by slug: new templates appear, changed templates are
//    refreshed (the seed behaviour, unchanged);
//  • NEVER deletes: a stale slug in the database is harmless, and
//    deleting rows on boot would fight rollbacks;
//  • count fast-path: when the database already holds ≥ |TEMPLATES|
//    rows the loop is skipped entirely, so a normal boot pays one
//    cheap COUNT query;
//  • idempotent and safe to race (upserts are last-write-wins).
// ─────────────────────────────────────────────────────────────

import { Prisma } from '@/generated/prisma/client'
import { TEMPLATES } from '@/lib/templates'

/** Minimal client surface the sync needs (the app `db` and the seed's
 * script client both satisfy it). */
export interface TemplateSyncDb {
  template: {
    count(): Promise<number>
    upsert(args: {
      where: { slug: string }
      update: {
        name: string
        category: string
        width: number
        height: number
        accent: string
        pages: Prisma.InputJsonValue
        fields: Prisma.InputJsonValue | typeof Prisma.DbNull
      }
      create: {
        slug: string
        name: string
        category: string
        width: number
        height: number
        accent: string
        pages: Prisma.InputJsonValue
        fields: Prisma.InputJsonValue | typeof Prisma.DbNull
      }
    }): Promise<unknown>
  }
}

export interface TemplateSyncResult {
  /** rows written this run (0 when the fast-path skipped the loop) */
  synced: number
  /** rows in the database after the run */
  total: number
  /** true when the count fast-path skipped the upserts */
  skipped: boolean
}

// Typed template list cast for the Postgres jsonb column (same
// casts prisma/seed.ts used before this module existed).
const pagesOf = (t: (typeof TEMPLATES)[number]) => t.pages as unknown as Prisma.InputJsonValue

// v0.17 (Wave 2): field declarations use the same jsonb cast. Plain
// templates store SQL NULL (DbNull), not the jsonb 'null' literal —
// IS NULL filters and the fill route's fallback both rely on it.
const fieldsOf = (t: (typeof TEMPLATES)[number]) =>
  t.fields ? (t.fields as unknown as Prisma.InputJsonValue) : Prisma.DbNull

/** Reconcile the database's template library with the code. See the
 * module header for the exact semantics. `force: true` skips the
 * count fast-path — what `npm run db:seed` wants (an operator running
 * it explicitly is refreshing content, and the count alone can't see
 * content-only changes). */
export async function syncTemplateLibrary(
  db: TemplateSyncDb,
  opts?: { force?: boolean },
): Promise<TemplateSyncResult> {
  const before = await db.template.count()
  if (!opts?.force && before >= TEMPLATES.length) {
    return { synced: 0, total: before, skipped: true }
  }
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
  }
  const total = await db.template.count()
  return { synced: TEMPLATES.length, total, skipped: false }
}
