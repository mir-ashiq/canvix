import { test, expect } from '@playwright/test'

/**
 * v0.11.4: clean design URLs.
 *   /design/<id>      — canonical, opens the editor directly
 *   /?design=<id>     — legacy deep link, still works
 *   Share dialog      — generates the canonical /design/<id> link
 * Needs a database (template/design API calls) — see playwright.config.ts.
 */
test.describe('Canvix design URLs', () => {
  test('opening a design puts the canonical path in the address bar', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /start designing/i }).first().click()
    await expect(page.getByLabel('Create a design')).toBeVisible()

    await page
      .locator('section:has(h2:text("Start a new design")) [aria-label^="Create "]')
      .first()
      .click()
    await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })

    // v0.11.4: the address bar follows the open design
    await expect(page).toHaveURL(/\/design\/[a-zA-Z0-9_-]{5,40}$/)

    // going back home resets the URL
    await page.getByLabel('Back to home').click()
    await expect(page.getByLabel('Create a design')).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
  })

  test('a canonical /design/<id> link opens the editor directly', async ({ page }) => {
    // create a design first, then re-open it from a cold navigation
    await page.goto('/')
    await page.getByRole('button', { name: /start designing/i }).first().click()
    await page
      .locator('section:has(h2:text("Start a new design")) [aria-label^="Create "]')
      .first()
      .click()
    await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })
    const url = page.url()

    await page.goto('/') // leave the editor — a cold load starts on the landing
    await expect(page.getByRole('button', { name: 'Canvix home' })).toBeVisible()

    await page.goto(url) // cold-open the canonical link
    await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })
    await expect(page).toHaveURL(/\/design\/[a-zA-Z0-9_-]{5,40}$/)
  })

  test('legacy /?design=<id> links keep working', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /start designing/i }).first().click()
    await page
      .locator('section:has(h2:text("Start a new design")) [aria-label^="Create "]')
      .first()
      .click()
    await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })
    const match = page.url().match(/\/design\/([a-zA-Z0-9_-]{5,40})$/)
    expect(match).not.toBeNull()
    const designId = match![1]

    await page.goto(`/?design=${designId}`)
    await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })
    // the legacy query resolves into the canonical path
    await expect(page).toHaveURL(new RegExp(`/design/${designId}$`))
  })

  test('Share dialog generates the canonical link', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /start designing/i }).first().click()
    await page
      .locator('section:has(h2:text("Start a new design")) [aria-label^="Create "]')
      .first()
      .click()
    await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })
    const match = page.url().match(/\/design\/([a-zA-Z0-9_-]{5,40})$/)
    const designId = match![1]

    // Share is a text button (icon + "Share"), not aria-labelled
    await page.getByRole('button', { name: 'Share' }).click()
    await expect(page.getByLabel('Share link')).toHaveValue(
      new RegExp(`/design/${designId}$`),
    )
  })

  test('an unknown /design/<id> falls back to the landing page', async ({ page }) => {
    await page.goto('/design/unknown-design-id-99')
    // dead path — the shell resets to the landing page instead of rendering nothing
    await expect(page.getByRole('button', { name: 'Canvix home' })).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveURL(/\/$/)
  })
})
