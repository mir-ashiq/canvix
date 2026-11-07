// Admin console acceptance (v0.16 A1).
//
// Zero registrations by construction: the two fixture users (one admin,
// one plain) and their sessions are seeded straight into the database
// the server runs on — the same Postgres the app uses, reached through
// the `pg` driver already present in node_modules (@prisma/adapter-pg's
// dependency; ambiently typed in ./pg-shim.d.ts, imported directly so
// no createRequire/import.meta gymnastics are needed) — keeping the
// suite inside the 5/h/IP register budget the other specs honor.
//
// What is proven here, end to end:
//   1. /admin is invisible to anonymous visitors and refuses plain users.
//   2. An admin session renders the console with live aggregate numbers.
//   3. Role management round-trips through the real UI (two-step confirm).
//   4. AI feature switches actually reach /api/ai/capabilities.
//   5. The sign-ups switch actually refuses /api/auth/register.
//   6. Traffic counters really capture API requests.

import { test, expect, type Browser } from '@playwright/test'
import { createHash } from 'node:crypto'
import { Client } from 'pg'

const ADMIN = { id: 'u_e2e_admin_a1', username: 'e2e_admin_a1', token: 'e2e-admin-token-a1' }
const PLAIN = { id: 'u_e2e_user_a1', username: 'e2e_user_a1', token: 'e2e-plain-token-a1' }

function sessionId(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

let client: InstanceType<typeof Client>

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
    for (const u of [ADMIN, PLAIN]) {
      await client.query(`DELETE FROM "Session" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "username" = $1)`, [u.username])
      await client.query(`DELETE FROM "User" WHERE "username" = $1`, [u.username])
    }
    await client.end().catch(() => {})
  }
})

/** A browser context carrying one of the seeded session cookies. */
async function contextWithToken(browser: Browser, token: string | null) {
  const ctx = await browser.newContext()
  if (token) {
    await ctx.addCookies([
      { name: 'canvix_session', value: token, url: process.env.BASE_URL ?? 'http://localhost:3000' },
    ])
  }
  return ctx
}

test.describe('admin console (A1)', () => {
  test('anonymous visitors and plain accounts cannot open /admin', async ({ browser }) => {
    const anonCtx = await contextWithToken(browser, null)
    const anonPage = await anonCtx.newPage()
    await anonPage.goto('/admin')
    await expect(anonPage.getByText('Sign in required')).toBeVisible()
    await anonCtx.close()

    const plainCtx = await contextWithToken(browser, PLAIN.token)
    const plainPage = await plainCtx.newPage()
    await plainPage.goto('/admin')
    await expect(plainPage.getByText('No administrator access')).toBeVisible()
    await plainCtx.close()
  })

  test('the admin API refuses non-admins at the boundary', async ({ browser }) => {
    const plainCtx = await contextWithToken(browser, PLAIN.token)
    const res = await plainCtx.request.get('/api/admin/overview')
    expect(res.status()).toBe(403)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('ADMIN_REQUIRED')
    await plainCtx.close()
  })

  test('an admin sees the console overview with live totals', async ({ browser }) => {
    const ctx = await contextWithToken(browser, ADMIN.token)
    const page = await ctx.newPage()
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Admin console' })).toBeVisible()
    // the stat cards render real numbers (>= 2 seeded users)
    await expect(page.getByText('Users', { exact: true })).toBeVisible()
    await expect(page.getByText('Designs', { exact: true })).toBeVisible()
    await expect
      .poll(async () => {
        const res = await ctx.request.get('/api/admin/overview')
        const data = (await res.json()) as { totals?: { users?: number }; windows?: { requests24h?: number } }
        return data.totals?.users ?? 0
      })
      .toBeGreaterThanOrEqual(2)
    // section nav reaches the other pages
    await expect(page.getByRole('link', { name: 'Users' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'AI & models' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()
    await ctx.close()
  })

  test('role management round-trips through the real UI', async ({ browser }) => {
    const ctx = await contextWithToken(browser, ADMIN.token)
    const page = await ctx.newPage()
    await page.goto('/admin/users')
    const row = page.locator('tr', { hasText: PLAIN.username })
    await expect(row).toBeVisible()
    // two-step confirm: make admin → confirm
    await row.getByRole('button', { name: /make admin/ }).click()
    await row.getByRole('button', { name: 'confirm', exact: true }).click()
    await expect(row.getByRole('button', { name: /revoke/ })).toBeVisible({ timeout: 10_000 })
    // and the DB really changed
    const dbRow = (await client.query(`SELECT "role" FROM "User" WHERE "username" = $1`, [PLAIN.username])).rows[0]
    expect(dbRow?.['role']).toBe('admin')
    // revert through the API (also covers the route)
    const res = await ctx.request.post(`/api/admin/users/${PLAIN.id}/role`, { data: { role: 'user' } })
    expect(res.status()).toBe(200)
    await ctx.close()
  })

  test('AI feature switches reach the public capabilities endpoint', async ({ browser }) => {
    const ctx = await contextWithToken(browser, ADMIN.token)
    const put = await ctx.request.put('/api/admin/config', { data: { features: { magicWrite: false } } })
    expect(put.status()).toBe(200)
    const caps = (await (await ctx.request.get('/api/ai/capabilities')).json()) as {
      capabilities: Record<string, boolean>
    }
    expect(caps.capabilities.magicWrite).toBe(false)
    expect(caps.capabilities.backgroundRemoval).toBe(true) // local feature untouched
    // restore
    const restore = await ctx.request.put('/api/admin/config', { data: { features: { magicWrite: true } } })
    expect(restore.status()).toBe(200)
    await ctx.close()
  })

  test('closing sign-ups refuses registration with 503 SIGNUPS_CLOSED', async ({ browser }) => {
    const ctx = await contextWithToken(browser, ADMIN.token)
    const put = await ctx.request.put('/api/admin/config', { data: { settings: { signupsOpen: false } } })
    expect(put.status()).toBe(200)
    // a fresh anonymous registration attempt is refused…
    const anonCtx = await contextWithToken(browser, null)
    const res = await anonCtx.request.post('/api/auth/register', {
      data: { username: `closed_${Date.now() % 100000}`, password: 'longenough1' },
    })
    expect(res.status()).toBe(503)
    expect(((await res.json()) as { code: string }).code).toBe('SIGNUPS_CLOSED')
    await anonCtx.close()
    // …and reopening restores normal behaviour
    const reopen = await ctx.request.put('/api/admin/config', { data: { settings: { signupsOpen: true } } })
    expect(reopen.status()).toBe(200)
    await ctx.close()
  })

  test('API traffic is counted and surfaces in the overview', async ({ browser }) => {
    const ctx = await contextWithToken(browser, ADMIN.token)
    for (let i = 0; i < 3; i++) {
      await ctx.request.get('/api/health')
    }
    // fire-and-forget counters — poll until the day aggregate shows them
    await expect
      .poll(
        async () => {
          const res = await ctx.request.get('/api/admin/overview')
          const data = (await res.json()) as { windows?: { requests24h?: number } }
          return data.windows?.requests24h ?? 0
        },
        { timeout: 20_000 }
      )
      .toBeGreaterThan(0)
    await ctx.close()
  })
})
