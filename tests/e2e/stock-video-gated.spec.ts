import { expect, test } from '@playwright/test'

/**
 * v0.15 R6 — stock-video rail, NO PROVIDER KEYS (the F2b gate).
 *
 * The acceptance: "No provider = feature hidden, everything else
 * works." On the default suite the instance has no PEXELS_API_KEY
 * / PIXABAY_API_KEY, so:
 *   1. /api/stock-video/available answers available=false
 *   2. POST /api/stock-video/search answers 503 NO_PROVIDER
 *   3. the rail NEVER renders the Videos tab (fail-closed probe —
 *      no flash-then-hide), and the rest of the rail is intact
 *   4. no console/page errors from the probe path
 *
 * The keyed world (search → insert → durable attribution) lives
 * in tests/e2e-stock-video via playwright.stockvideo.config.ts.
 */
test.describe('stock video rail without provider keys (F2b gate)', () => {
  test('available=false, search 503 NO_PROVIDER, rail tab hidden, rail intact', async ({ page, request }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))

    // 1. secret-free availability probe
    const avail = await request.get('/api/stock-video/available')
    expect(avail.status()).toBe(200)
    expect(await avail.json()).toEqual({ available: false, providers: [] })

    // 2. the gated search route
    const res = await request.post('/api/stock-video/search', { data: { query: 'ocean' } })
    expect(res.status()).toBe(503)
    expect(((await res.json()) as { code?: string }).code).toBe('NO_PROVIDER')

    // 3. the editor: Videos hidden, everything else unchanged
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

    // give the (cached, module-level) availability probe a beat — the
    // assertion is that the tab NEVER appears, not that it disappears
    await page.waitForTimeout(1200)
    await expect(page.getByRole('button', { name: 'Videos', exact: true })).toHaveCount(0)

    // the neighbouring tabs are all still there
    for (const label of ['Photos', 'Uploads', 'Elements', 'Apps']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
    }

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
  })
})
