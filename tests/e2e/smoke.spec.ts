import { test, expect } from '@playwright/test'

/**
 * Landing → dashboard → editor smoke flow.
 * Needs a database (template/design API calls) — see playwright.config.ts.
 */
test.describe('Canvix smoke', () => {
  test('landing page renders the marketing hero', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Canvix home' })).toBeVisible()
    await expect(
      page.getByRole('button', { name: /start designing/i }).first(),
    ).toBeVisible()
  })

  test('Start designing opens the dashboard', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /start designing/i }).first().click()
    await expect(page.getByLabel('Create a design')).toBeVisible()
  })

  test('a blank preset opens the editor canvas', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /start designing/i }).first().click()
    await expect(page.getByLabel('Create a design')).toBeVisible()

    // first blank-preset card in the "Start a new design" grid
    // ("Create <preset name>" — not the "Create a design" dialog trigger)
    await page
      .locator('section:has(h2:text("Start a new design")) [aria-label^="Create "]')
      .first()
      .click()

    // editor mounts react-konva inside <main aria-label="Design canvas">
    await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.konvajs-content').first()).toBeVisible({ timeout: 30_000 })
  })
})
