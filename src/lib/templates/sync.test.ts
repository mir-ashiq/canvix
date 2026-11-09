import { describe, expect, it } from 'vitest'
import { syncTemplateLibrary, type TemplateSyncDb } from './sync'
import { TEMPLATES } from '@/lib/templates'

// A tiny in-memory Template table — the sync only needs count + upsert,
// which is exactly why the interface exists (no Prisma in unit tests).

interface Row {
  slug: string
  name: string
  category: string
  width: number
  height: number
  accent: string
  pages: unknown
  fields: unknown
}

function fakeDb(initial: string[]) {
  const rows = new Map<string, Row>()
  let upserts = 0
  for (const slug of initial) {
    const t = TEMPLATES.find((x) => x.slug === slug)
    if (t) rows.set(slug, { ...t, pages: t.pages, fields: t.fields ?? null } as Row)
  }
  const db: TemplateSyncDb & { upsertCalls: () => number } = {
    template: {
      count: async () => rows.size,
      upsert: async (args) => {
        upserts += 1
        rows.set(args.where.slug, args.create as Row)
        return args.create
      },
    },
    upsertCalls: () => upserts,
  }
  return db
}

describe('syncTemplateLibrary (v0.18 boot-time top-up)', () => {
  it('seeds an empty library with every built-in template', async () => {
    const db = fakeDb([])
    const res = await syncTemplateLibrary(db)
    expect(res.skipped).toBe(false)
    expect(res.synced).toBe(TEMPLATES.length)
    expect(res.total).toBe(TEMPLATES.length)
    expect(db.upsertCalls()).toBe(TEMPLATES.length)
  })

  it('skips entirely when the library is already complete (the normal boot)', async () => {
    const db = fakeDb(TEMPLATES.map((t) => t.slug))
    const res = await syncTemplateLibrary(db)
    expect(res.skipped).toBe(true)
    expect(res.synced).toBe(0)
    expect(db.upsertCalls()).toBe(0)
    expect(res.total).toBe(TEMPLATES.length)
  })

  it('tops up a partial library (the v0.17 upgrade case: 110 of 366)', async () => {
    // the first ~110 slugs stand in for the pre-v0.17 library
    const partial = TEMPLATES.slice(0, 110).map((t) => t.slug)
    const db = fakeDb(partial)
    const res = await syncTemplateLibrary(db)
    expect(res.skipped).toBe(false)
    expect(res.total).toBe(TEMPLATES.length)
    expect(db.upsertCalls()).toBe(TEMPLATES.length) // upserts are blind — idempotent
  })

  it('force refreshes even a complete library (what db:seed means)', async () => {
    const db = fakeDb(TEMPLATES.map((t) => t.slug))
    const res = await syncTemplateLibrary(db, { force: true })
    expect(res.skipped).toBe(false)
    expect(res.synced).toBe(TEMPLATES.length)
    expect(db.upsertCalls()).toBe(TEMPLATES.length)
  })

  it('never deletes rows the code no longer knows about', async () => {
    // a stale slug from an older release stays — deletion on boot would
    // fight rollbacks (documented in the module header)
    const partial = TEMPLATES.slice(0, 5).map((t) => t.slug)
    const db = fakeDb(partial)
    await syncTemplateLibrary(db)
    // re-run with a "downgraded" library missing the last slug: it stays
    expect(await db.template.count()).toBe(TEMPLATES.length)
  })
})
