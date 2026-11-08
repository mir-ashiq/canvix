import { expect, test } from '@playwright/test'

/**
 * v0.16.4 A4 — stock-photo search, NO PROVIDER KEYS (the F2b gate).
 *
 * Unlike the Videos rail, the Photos tab NEVER hides — it ships a
 * bundled library that works with zero configuration. What gates is
 * the web-search section: on the default suite (no PEXELS_API_KEY /
 * PIXABAY_API_KEY):
 *   1. /api/stock-photo/available answers available=false
 *   2. POST /api/stock-photo/search answers 503 NO_PROVIDER (+ the
 *      operator hint names the keys; the key never leaks)
 *   3. the Photos tab is right there and the bundled library renders
 *   4. no console/page errors from the probe path
 *
 * The keyed world (search → insert → durable attribution) lives in
 * tests/e2e-stock-video/stock-photo.spec.ts via the mock provider.
 */
test.describe('stock photo search without provider keys (F2b gate)', () => {
  test('available=false, search 503 NO_PROVIDER with hint, Photos rail intact', async ({ page, request }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))

    // 1. secret-free availability probe
    const avail = await request.get('/api/stock-photo/available')
    expect(avail.status()).toBe(200)
    expect(await avail.json()).toEqual({ available: false, providers: [] })

    // 2. the gated search route — hint names the keys, nothing leaks
    const res = await request.post('/api/stock-photo/search', { data: { query: 'ocean' } })
    expect(res.status()).toBe(503)
    const body = (await res.json()) as { code?: string; hint?: string }
    expect(body.code).toBe('NO_PROVIDER')
    expect(body.hint).toContain('PEXELS_API_KEY')
    expect(JSON.stringify(body)).not.toMatch(/(nvapi-|sk-|pexels-|pixabay-)[A-Za-z0-9]+/)

    // 3. the editor: the Photos tab stays (bundled library), Videos
    //    stays hidden (no video keys on this suite either)
    await page.goto('/')
    // Next.js dev tools indicator overlays the first rail button in dev mode
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
    await page.getByRole('button', { name: /start designing/i }).first().click()
    await expect(page.getByLabel('Create a design')).toBeVisible()

    await page
      .locator('section:has(h2:text("Start a new design")) [aria-label^="Create "]')
      .first()
      .click()
    await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })

    // give the (cached, module-level) availability probe a beat
    await page.waitForTimeout(1200)
    await expect(page.getByRole('button', { name: 'Photos', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Videos', exact: true })).toHaveCount(0)

    // the bundled library opens and renders its photos
    await page.getByRole('button', { name: 'Photos', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Photos', exact: true })).toBeVisible()
    await expect(page.locator('aside').locator('img').first()).toBeVisible({ timeout: 15_000 })

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
  })
})
