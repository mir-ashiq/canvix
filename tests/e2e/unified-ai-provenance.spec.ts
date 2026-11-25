import { test, expect, type Browser } from '@playwright/test'
import { createHash } from 'node:crypto'
import { Client } from 'pg'

// v0.32 (Unified Canvix AI) — design provenance, end to end.
//
// The stored brief contract of a design: what an applied autonomous
// generation was verified against, persisted so later natural-language
// refinement of the SAME design stays gated on it. Proven here through
// the real API and the real database (migration 0013 applied by
// db:setup, same as CI):
//
//   1. PUT /api/designs/[id]/ai-provenance stores a brief (normalized:
//      tiers forced mandatory, hexes lowercased)
//   2. GET /api/designs/[id] (the editor's load path) carries it back
//      as aiProvenance — this is what hydrates the editor store
//   3. GET /api/designs/[id]/ai-provenance returns it too
//   4. a brief with nothing usable is a 422 (honest rejection)
//   5. a foreign design is a flat 404 on both GET and PUT — no
//      existence oracle
//   6. dimension-only briefs are rejected too (the design owns the
//      geometry after apply — a stored size would fail every
//      refinement on a legitimately resized design)
//
// Needs a database — see playwright.config.ts. The fixture user +
// session + designs are seeded straight into the database (same
// pattern as api-keys.spec.ts, inside the register budget).

const USER = { id: 'u_e2e_prov_user', username: 'e2e_prov_user', token: 'e2e-prov-user-token' }
const OTHER = { id: 'u_e2e_prov_other', username: 'e2e_prov_other' } // owns the foreign design

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'

function sessionId(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

let client: InstanceType<typeof Client>

test.setTimeout(120_000)

test.beforeAll(async () => {
  client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  await client.query(`DELETE FROM "Session" WHERE "userId" = $1`, [USER.id])
  await client.query(`DELETE FROM "User" WHERE "id" IN ($1, $2)`, [USER.id, OTHER.id])
  await client.query(
    `INSERT INTO "User" ("id", "username", "passwordHash", "createdAt") VALUES ($1, $2, 'seed-no-login', now()), ($3, $4, 'seed-no-login', now())`,
    [USER.id, USER.username, OTHER.id, OTHER.username]
  )
  await client.query(
    `INSERT INTO "Session" ("id", "userId", "createdAt", "expiresAt") VALUES ($1, $2, now(), now() + interval '2 hours')`,
    [sessionId(USER.token), USER.id]
  )
  await client.query(`DELETE FROM "Design" WHERE "ownerId" IN ($1, $2)`, [USER.id, OTHER.id])
  await client.query(
    `INSERT INTO "Design" ("id", "name", "width", "height", "pages", "ownerId", "createdAt", "updatedAt")
     VALUES ('d_e2e_prov_mine', 'Provenance mine', 1080, 1350, '[]'::jsonb, $1, now(), now()),
            ('d_e2e_prov_other', 'Provenance foreign', 1080, 1350, '[]'::jsonb, $2, now(), now())`,
    [USER.id, OTHER.id]
  )
})

test.afterAll(async () => {
  if (client) {
    // provenance rows cascade with their designs; clean the designs
    await client.query(`DELETE FROM "Design" WHERE "ownerId" IN ($1, $2)`, [USER.id, OTHER.id])
    await client.query(`DELETE FROM "Session" WHERE "userId" = $1`, [USER.id])
    await client.query(`DELETE FROM "User" WHERE "id" IN ($1, $2)`, [USER.id, OTHER.id])
    await client.end().catch(() => {})
  }
})

async function signedInContext(browser: Browser) {
  const ctx = await browser.newContext()
  await ctx.addCookies([{ name: 'canvix_session', value: USER.token, url: BASE }])
  return ctx
}

test.describe('design AI provenance (Unified Canvix AI)', () => {
  test('PUT stores the normalized brief; the design GET carries it back to the editor', async ({ browser }) => {
    const ctx = await signedInContext(browser)
    const api = ctx.request

    // 1. store a provenance brief (the DesignAgent Apply path)
    const put = await api.fetch(`${BASE}/api/designs/d_e2e_prov_mine/ai-provenance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', origin: BASE },
      data: {
        prompt: 'A poster for a night run',
        outcome: 'passed',
        brief: {
          requiredTexts: [
            { tier: 'preference', text: 'Run Dal Lake 2026' },
            { tier: 'preference', text: '12km · Dachigam Road · 26 Jan' },
          ],
          requiredColors: [{ tier: 'preference', hex: '#1B3A6B' }],
          dimensions: { tier: 'mandatory', width: 1080, height: 1350 },
        },
      },
    })
    expect(put.status()).toBe(200)
    const stored = (await put.json()) as { provenance?: { brief?: { requiredTexts?: { tier?: string; text?: string }[]; requiredColors?: { hex?: string }[]; dimensions?: unknown } } }
    // normalized: tiers forced mandatory, hex lowercased
    expect(stored.provenance?.brief?.requiredTexts?.[0]).toEqual({ tier: 'mandatory', text: 'Run Dal Lake 2026' })
    expect(stored.provenance?.brief?.requiredColors).toEqual([{ tier: 'mandatory', hex: '#1b3a6b' }])
    expect(stored.provenance?.brief?.dimensions).toBeUndefined()

    // 2. the editor's load path carries it (this hydrates the store)
    const got = await api.fetch(`${BASE}/api/designs/d_e2e_prov_mine`)
    expect(got.status()).toBe(200)
    const design = (await got.json()) as { aiProvenance?: { brief?: { requiredTexts?: { text?: string }[] } } }
    expect(design.aiProvenance?.brief?.requiredTexts?.map((t) => t.text)).toEqual(
      expect.arrayContaining(['Run Dal Lake 2026', '12km · Dachigam Road · 26 Jan'])
    )

    // 3. the dedicated GET returns it too
    const direct = await api.fetch(`${BASE}/api/designs/d_e2e_prov_mine/ai-provenance`)
    expect(direct.status()).toBe(200)
    const directBody = (await direct.json()) as { provenance?: { outcome?: string } }
    expect(directBody.provenance?.outcome).toBe('passed')

    await ctx.close()
  })

  test('a brief with nothing usable is a 422, a dimension-only brief included', async ({ browser }) => {
    const ctx = await signedInContext(browser)
    const api = ctx.request

    const junk = await api.fetch(`${BASE}/api/designs/d_e2e_prov_mine/ai-provenance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', origin: BASE },
      data: { brief: { requiredTexts: [], requiredColors: [] } },
    })
    expect(junk.status()).toBe(422)

    // dimensions alone never survive normalization — nothing checkable
    // remains, so the PUT rejects instead of storing a no-op contract
    const dimsOnly = await api.fetch(`${BASE}/api/designs/d_e2e_prov_mine/ai-provenance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', origin: BASE },
      data: { brief: { dimensions: { tier: 'mandatory', width: 1080, height: 1350 } } },
    })
    expect(dimsOnly.status()).toBe(422)

    await ctx.close()
  })

  test('a foreign design is a flat 404 on both GET and PUT — no existence oracle', async ({ browser }) => {
    const ctx = await signedInContext(browser)
    const api = ctx.request

    const got = await api.fetch(`${BASE}/api/designs/d_e2e_prov_other/ai-provenance`)
    expect(got.status()).toBe(404)
    const put = await api.fetch(`${BASE}/api/designs/d_e2e_prov_other/ai-provenance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', origin: BASE },
      data: { brief: { requiredTexts: [{ text: 'nope' }] } },
    })
    expect(put.status()).toBe(404)

    await ctx.close()
  })
})
