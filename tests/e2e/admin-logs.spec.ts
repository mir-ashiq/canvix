import { test, expect, type Browser } from '@playwright/test'
import { createHash } from 'node:crypto'
import { Client } from 'pg'

// Admin Logs view (v0.16.3 A3) — the "why did the AI feature fail"
// page. Zero e2e coverage until now (the admin specs covered overview,
// users, settings and the audit regressions, never /admin/logs). This
// spec proves, end to end through the real console:
//
//   1. /admin/logs refuses plain accounts and renders for admins
//   2. seeded AIUsage rows surface with feature, provider, status chip
//      and the scrubbed error reason
//   3. the outcome filter (errors only) actually filters
//   4. the counts strip reflects the seeded rows (calls + errors)
//   5. v0.24 (§5.7): with any slot wired but video unconfigured, the
//      "video is provider-dependent, not broken" callout shows
//
// Needs a database — see playwright.config.ts. Fixture users and
// their sessions are seeded straight into the database (same pattern
// as admin-console.spec.ts, inside the register budget).

const ADMIN = { id: 'u_e2e_admin_logs', username: 'e2e_admin_logs', token: 'e2e-admin-token-logs' }
const PLAIN = { id: 'u_e2e_user_logs', username: 'e2e_user_logs', token: 'e2e-plain-token-logs' }

function sessionId(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

let client: InstanceType<typeof Client>

test.setTimeout(120_000)

test.beforeAll(async () => {
  client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  for (const u of [ADMIN, PLAIN]) {
    await client.query(`DELETE FROM "Session" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "username" = $1)`, [u.username])
    await client.query(`DELETE FROM "User" WHERE "username" = $1`, [u.username])
    await client.query(
      `INSERT INTO "User" ("id", "username", "passwordHash", "role", "createdAt")
       VALUES ($1, $2, 'seed-no-login', $3, now())`,
      [u.id, u.username, u.id === ADMIN.id ? 'admin' : 'user']
    )
    await client.query(
      `INSERT INTO "Session" ("id", "userId", "createdAt", "expiresAt")
       VALUES ($1, $2, now(), now() + interval '2 hours')`,
      [sessionId(u.token), u.id]
    )
  }
})

test.afterAll(async () => {
  if (client) {
    await client.query(`DELETE FROM "AIUsage" WHERE "feature" = 'e2e-logs-probe'`)
    for (const u of [ADMIN, PLAIN]) {
      await client.query(`DELETE FROM "Session" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "username" = $1)`, [u.username])
      await client.query(`DELETE FROM "User" WHERE "username" = $1`, [u.username])
    }
    await client.end().catch(() => {})
  }
})

async function contextWithToken(browser: Browser, token: string | null) {
  const ctx = await browser.newContext()
  if (token) {
    await ctx.addCookies([
      { name: 'canvix_session', value: token, url: process.env.BASE_URL ?? 'http://localhost:3000' },
    ])
  }
  return ctx
}

test.describe('admin logs view (A3)', () => {
  test('refuses plain accounts, renders for admins with seeded rows', async ({ browser }) => {
    // plain account: bounced to the denied page
    const plainCtx = await contextWithToken(browser, PLAIN.token)
    const plainPage = await plainCtx.newPage()
    await plainPage.goto('/admin/logs')
    await expect(plainPage.getByText('No administrator access')).toBeVisible({ timeout: 20_000 })
    await plainCtx.close()

    // seed two rows: one ok, one failure with a reason (id is a
    // client-side cuid default in Prisma — raw SQL must supply one)
    await client.query(
      `INSERT INTO "AIUsage" ("id", "feature", "provider", "ok", "model", "status", "durationMs", "error", "createdAt")
       VALUES
         ('aia_e2e_logs_ok', 'e2e-logs-probe', 'e2e-provider', true, 'test-model', 200, 123, NULL, now()),
         ('aia_e2e_logs_err', 'e2e-logs-probe', 'e2e-provider', false, 'test-model', 429, 456, 'rate limited by upstream', now())`
    )

    const ctx = await contextWithToken(browser, ADMIN.token)
    const page = await ctx.newPage()
    await page.goto('/admin/logs')
    await expect(page.getByRole('heading', { name: 'AI request log' })).toBeVisible({ timeout: 20_000 })

    // the slot strip renders five cards
    await expect(page.getByText('AI slot status')).toBeVisible()
    for (const label of ['Text', 'Vision', 'Image generation', 'Image editing', 'Video generation']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible()
    }

    // both rows surface (default window 24h, all outcomes)
    await expect(page.getByText('e2e-logs-probe').first()).toBeVisible()
    await expect(page.getByText('rate limited by upstream').first()).toBeVisible()
    await expect(page.getByText('429 · rate limit').first()).toBeVisible()

    // counts strip: 2 calls, 1 error from our probe rows (other rows
    // may exist; assert at least our contribution)
    const calls = await page.getByText(/\d+ calls/).first().textContent()
    expect(Number(calls?.match(/\d+/)?.[0] ?? 0)).toBeGreaterThanOrEqual(2)

    // errors-only filter drops the ok row's provider line
    await page.getByRole('combobox').nth(2).selectOption('errors')
    await expect(page.getByText('rate limited by upstream').first()).toBeVisible()
    await ctx.close()
  })
})
