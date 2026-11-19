import { test, expect, type Browser } from '@playwright/test'
import { createHash } from 'node:crypto'
import { Client } from 'pg'

// Admin console regression suite (post-audit, 2026-11-19):
//
//   1. user search finds MIXED-CASE usernames typed in any case — the
//      audit found the route lowercased the query while Prisma's
//      `contains` stayed case-sensitive, making every mixed-case
//      username unfindable (both "JohnDoe" and "johndoe" missed).
//   2. the overview carries the BYOK adoption stat — how many users
//      added their own API keys (UserAIProvider), with per-slot
//      coverage (the slots column is CSV: "text,vision").
//   3. the Model-slots card counts against 5 slots, not the stale
//      v0.16-era 4 (video joined in v0.19 — the chip read "5/4 wired").
//
// Zero registrations: fixtures seeded straight into the DB (the
// admin-console.spec.ts pattern).

const ADMIN = { id: 'u_e2e_admin_a1', username: 'e2e_admin_a1', token: 'e2e-admin-token-a1' }
const MIXED = { id: 'u_e2e_mixedsearch', username: 'JohnDoe_MixedCase' }

function sessionId(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

let client: InstanceType<typeof Client>

test.beforeAll(async () => {
  client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  // the shared admin fixture (created by admin-console.spec.ts when it
  // runs first; ensure it exists for standalone runs too)
  const admin = await client.query(`SELECT "id" FROM "User" WHERE "username" = $1`, [ADMIN.username])
  const adminId = (admin.rows[0]?.['id'] as string | undefined) ?? ADMIN.id
  if (admin.rows.length === 0) {
    await client.query(
      `INSERT INTO "User" ("id", "username", "passwordHash", "role", "createdAt")
       VALUES ($1, $2, 'seed-no-login', 'admin', now())`,
      [ADMIN.id, ADMIN.username]
    )
    await client.query(
      `INSERT INTO "Session" ("id", "userId", "createdAt", "expiresAt")
       VALUES ($1, $2, now(), now() + interval '2 hours')`,
      [sessionId(ADMIN.token), ADMIN.id]
    )
  } else {
    // refresh the session row regardless (expiry from older runs)
    await client.query(
      `INSERT INTO "Session" ("id", "userId", "createdAt", "expiresAt")
       VALUES ($1, $2, now(), now() + interval '2 hours')
       ON CONFLICT ("id") DO UPDATE SET "expiresAt" = now() + interval '2 hours'`,
      [sessionId(ADMIN.token), adminId]
    )
    ADMIN.id = adminId
  }
  // the mixed-case search fixture + one BYOK provider row for it
  await client.query(`DELETE FROM "UserAIProvider" WHERE "userId" = $1`, [MIXED.id])
  await client.query(`DELETE FROM "User" WHERE "username" = $1`, [MIXED.username])
  await client.query(
    `INSERT INTO "User" ("id", "username", "passwordHash", "role", "createdAt")
     VALUES ($1, $2, 'seed-no-login', 'user', now())`,
    [MIXED.id, MIXED.username]
  )
  await client.query(
    `INSERT INTO "UserAIProvider" ("id", "userId", "label", "baseUrl", "apiKey", "slots", "models", "createdAt", "updatedAt")
     VALUES ('byok_e2e_1', $1, 'e2e own key', 'https://api.example.com/v1', 'sk-e2e', 'text,vision', '{}', now(), now())`,
    [MIXED.id]
  )
})

test.afterAll(async () => {
  if (client) {
    await client.query(`DELETE FROM "UserAIProvider" WHERE "userId" = $1`, [MIXED.id])
    await client.query(`DELETE FROM "User" WHERE "username" = $1`, [MIXED.username])
    await client.end().catch(() => {})
  }
})

async function adminContext(browser: Browser) {
  const ctx = await browser.newContext()
  await ctx.addCookies([
    { name: 'canvix_session', value: ADMIN.token, url: process.env.BASE_URL ?? 'http://localhost:3000' },
  ])
  return ctx
}

test.describe('admin console — audit regressions', () => {
  test('user search finds mixed-case usernames in any case', async ({ browser }) => {
    const ctx = await adminContext(browser)
    const page = await ctx.newPage()
    await page.goto('/admin/users')

    // type the username in LOWER case — the bug: route lowercased the
    // query but `contains` matched case-sensitively → 0 rows
    const box = page.getByLabel('Search users by username')
    await box.fill('johndoe')
    await expect(page.locator('tr', { hasText: MIXED.username })).toBeVisible({ timeout: 10_000 })

    // and in the EXACT mixed case — also broken before (lowercased away)
    await box.fill('JohnDoe_MixedCase')
    await expect(page.locator('tr', { hasText: MIXED.username })).toBeVisible()

    // the API agrees in both directions
    const lower = await ctx.request.get('/api/admin/users?q=johndoe')
    expect(((await lower.json()) as { total: number }).total).toBeGreaterThanOrEqual(1)
    const upper = await ctx.request.get('/api/admin/users?q=JOHNDOE')
    expect(((await upper.json()) as { total: number }).total).toBeGreaterThanOrEqual(1)
    await ctx.close()
  })

  test('overview reports BYOK adoption — users with their own API keys', async ({ browser }) => {
    const ctx = await adminContext(browser)

    // the API block: the seeded fixture counts (≥1 user, ≥1 provider,
    // text+vision covered by the CSV parse)
    const res = await ctx.request.get('/api/admin/overview')
    expect(res.status()).toBe(200)
    const byok = ((await res.json()) as { byok: { users: number; providers: number; slots: Record<string, number> } }).byok
    expect(byok.users).toBeGreaterThanOrEqual(1)
    expect(byok.providers).toBeGreaterThanOrEqual(1)
    expect(byok.slots.text ?? 0).toBeGreaterThanOrEqual(1)
    expect(byok.slots.vision ?? 0).toBeGreaterThanOrEqual(1)

    // the stat card renders it on the page (label <p> → parent StatCard)
    const page = await ctx.newPage()
    await page.goto('/admin')
    await expect(page.getByText('Own API keys', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/keys? · [0-5]\/5 slots covered/)).toBeVisible()
    await ctx.close()
  })

  test('the Model-slots card counts against 5 slots (video included)', async ({ browser }) => {
    const ctx = await adminContext(browser)
    const page = await ctx.newPage()
    await page.goto('/admin/ai')
    // whatever the wiring state, the chip denominator is 5 — never "5/4"
    const chip = page.getByText(/\/5 wired/)
    await expect(chip.first()).toBeVisible({ timeout: 15_000 })
    const text = await chip.first().textContent()
    expect(text).toMatch(/^[0-5]\/5 wired$/)
    await ctx.close()
  })
})
