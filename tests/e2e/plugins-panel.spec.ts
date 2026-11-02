import { expect, test } from '@playwright/test'

/**
 * v0.13 P3 regression check — the Apps panel now mounts the
 * lazy "Installed" plugin section (InstalledApps → dynamic
 * import → GET /api/plugins → flag off on this instance ⇒ 503
 * ⇒ section stays hidden, zero runtime bytes).
 *
 * What must NOT regress with the flag off:
 *   1. the built-in app grid renders exactly as before
 *   2. no console errors from the dynamic import path
 *   3. opening a built-in app still works (Charts)
 *   4. /api/plugins answers 503 PLUGINS_DISABLED
 */
test.describe('Apps panel with plugin runtime mounted (flag off)', () => {
  test('built-in app grid renders and opens an app; no plugin UI leaks', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))

    await page.goto('/')
    await page.getByRole('button', { name: /start designing/i }).first().click()
    await expect(page.getByLabel('Create a design')).toBeVisible()

    // first blank-preset card in the "Start a new design" grid
    await page
      .locator('section:has(h2:text("Start a new design")) [aria-label^="Create "]')
      .first()
      .click()
    await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })

    // open the Apps panel
    await expect(page.getByRole('button', { name: 'Apps' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Apps' }).click()

    // built-in cards unchanged
    await expect(page.getByText('Charts', { exact: true })).toBeVisible()
    await expect(page.getByText('QR generator')).toBeVisible()

    // flag off ⇒ the install input must NOT appear
    await expect(page.getByPlaceholder('https://example.com/plugin/manifest.json')).toHaveCount(0)
    await expect(page.getByText('Installed', { exact: true })).toHaveCount(0)

    // opening a built-in app still routes to its panel
    await page.getByRole('button', { name: 'Open Charts app' }).click()
    await expect(page.getByText('Back to apps')).toBeVisible()

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
  })

  test('GET /api/plugins answers 503 PLUGINS_DISABLED with the flag off', async ({ request }) => {
    const res = await request.get('/api/plugins')
    expect(res.status()).toBe(503)
    const body = (await res.json()) as { code?: string }
    expect(body.code).toBe('PLUGINS_DISABLED')
  })
})
