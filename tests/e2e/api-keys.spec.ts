import { test, expect, type Browser } from '@playwright/test'
import { createHash } from 'node:crypto'
import { Client } from 'pg'

// v0.24 (Wave 6 core): scoped API keys — the REST rail, end to end.
//
// Proven here through the real UI and the real API:
//   1. a key created in Settings → Profile & AI keys shows its raw
//      value EXACTLY ONCE (and never after a reload)
//   2. the key lists in the profile with its scope chips
//   3. GET /api/v1/designes with the key returns the owner's designs
//      (and only the owner's — a foreign design is a flat 404)
//   4. GET /api/v1/designs without a key is a 401 with a helpful body
//   5. revoking the key makes the very same token 401 (revoked_key)
//
// Needs a database — see playwright.config.ts. The fixture user +
// session + one owned design are seeded straight into the database
// (same pattern as admin-console.spec.ts, inside the register budget).

const USER = { id: 'u_e2e_keys_user', username: 'e2e_keys_user', token: 'e2e-keys-user-token' }
const OTHER = { id: 'u_e2e_keys_other', username: 'e2e_keys_other' } // owns the foreign design

function sessionId(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

let client: InstanceType<typeof Client>

test.setTimeout(120_000)

test.beforeAll(async () => {
  client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  await client.query(`DELETE FROM "ApiKey" WHERE "userId" = $1`, [USER.id])
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
  // one owned design + one foreign design
  await client.query(`DELETE FROM "Design" WHERE "ownerId" IN ($1, $2)`, [USER.id, OTHER.id])
  await client.query(
    `INSERT INTO "Design" ("id", "name", "width", "height", "pages", "ownerId", "createdAt", "updatedAt")
     VALUES ('d_e2e_keys_mine', 'Owned by key user', 1080, 1080, '[]'::jsonb, $1, now(), now()),
            ('d_e2e_keys_other', 'Owned by someone else', 1080, 1080, '[]'::jsonb, $2, now(), now())`,
    [USER.id, OTHER.id]
  )
})

test.afterAll(async () => {
  if (client) {
    await client.query(`DELETE FROM "ApiKey" WHERE "userId" = $1`, [USER.id])
    await client.query(`DELETE FROM "Session" WHERE "userId" = $1`, [USER.id])
    await client.query(`DELETE FROM "Design" WHERE "ownerId" IN ($1, $2)`, [USER.id, OTHER.id])
    await client.query(`DELETE FROM "User" WHERE "id" IN ($1, $2)`, [USER.id, OTHER.id])
    await client.end().catch(() => {})
  }
})

async function signedInContext(browser: Browser) {
  const ctx = await browser.newContext()
  await ctx.addCookies([
    { name: 'canvix_session', value: USER.token, url: process.env.BASE_URL ?? 'http://localhost:3000' },
  ])
  return ctx
}

test.describe('scoped API keys (Wave 6 core)', () => {
  test('create → use → revoke lifecycle through the real surfaces', async ({ browser, request }) => {
    const ctx = await signedInContext(browser)
    const page = await ctx.newPage()
    await page.goto('/')
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })

    // the app is a SPA — the dashboard is a VIEW, not a URL; "Start
    // designing" (or "Back to your designs" when signed in) switches
    // to it (same entry as openBlankEditor in the other specs)
    await page.getByRole('button', { name: /start designing|back to your designs/i }).first().click()
    await page.getByRole('button', { name: 'Account menu' }).waitFor({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Account menu' }).click()
    await page.getByRole('menuitem', { name: /profile & ai keys/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 })

    const keysCard = page.getByTestId('api-keys-card')

    // create a key with the default designs:read scope
    await keysCard.getByRole('button', { name: /create key/i }).click()
    await keysCard.getByLabel('Label', { exact: false }).fill('e2e lifecycle key')
    await keysCard.getByRole('button', { name: /create key/i }).last().click()

    // the raw key is shown exactly once
    await expect(keysCard.getByText(/copy this key now/i)).toBeVisible({ timeout: 15_000 })
    const rawKey = (await keysCard.locator('code').first().textContent()) ?? ''
    expect(rawKey).toMatch(/^cvx_[A-Za-z0-9_-]{43}$/)

    // the key lists with its scope chip
    await expect(keysCard.getByText('e2e lifecycle key')).toBeVisible()
    await expect(keysCard.getByText('designs:read', { exact: true })).toBeVisible()

    // reload: the raw value never comes back (the SPA re-lands on the
    // landing view — walk back into the dashboard first)
    await page.reload()
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
    await page.getByRole('button', { name: /start designing|back to your designs/i }).first().click()
    await page.getByRole('button', { name: 'Account menu' }).waitFor({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Account menu' }).click()
    await page.getByRole('menuitem', { name: /profile & ai keys/i }).click()
    await expect(page.getByTestId('api-keys-card').getByText('e2e lifecycle key')).toBeVisible({ timeout: 15_000 })
    expect(await page.getByTestId('api-keys-card').getByText(/copy this key now/i).count()).toBe(0)

    // REST: no key → 401 with guidance
    const anon = await request.get('/api/v1/designs')
    expect(anon.status()).toBe(401)
    const anonBody = await anon.json()
    expect(anonBody.message).toContain('API key')

    // REST: the key lists the owner's design…
    const ok = await request.get('/api/v1/designs', { headers: { Authorization: `Bearer ${rawKey}` } })
    expect(ok.status()).toBe(200)
    const body = await ok.json()
    const names = (body.designs as { name: string }[]).map((d) => d.name)
    expect(names).toContain('Owned by key user')
    expect(names).not.toContain('Owned by someone else')

    // …fetches it in full…
    const one = await request.get('/api/v1/designs/d_e2e_keys_mine', { headers: { Authorization: `Bearer ${rawKey}` } })
    expect(one.status()).toBe(200)
    const oneBody = await one.json()
    expect(oneBody.name).toBe('Owned by key user')
    expect(Array.isArray(oneBody.pages)).toBe(true)

    // …and a foreign design is a flat 404 (existence is not API business)
    const foreign = await request.get('/api/v1/designs/d_e2e_keys_other', { headers: { Authorization: `Bearer ${rawKey}` } })
    expect(foreign.status()).toBe(404)

    // revoke through the UI (accept the confirm)
    page.on('dialog', (d) => void d.accept())
    await page.getByLabel(`Revoke API key e2e lifecycle key`).click()
    await expect(keysCard.getByText('revoked', { exact: true }).first()).toBeVisible({ timeout: 15_000 })

    // the very same token now 401s with revoked_key
    const revoked = await request.get('/api/v1/designs', { headers: { Authorization: `Bearer ${rawKey}` } })
    expect(revoked.status()).toBe(401)
    const revokedBody = await revoked.json()
    expect(revokedBody.error).toBe('revoked_key')

    await ctx.close()
  })
})
