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

  // v0.11.2 regression: /api/designs has returned a keyset-paginated
  // { designs, nextCursor } envelope since v0.9.2, but the editor's
  // Projects panel still assumed a bare array — the envelope object hit
  // `.filter()` and took down the whole editor tree ("This page couldn't
  // load"). Opening a design and then the Projects panel must list designs.
  test('editor Projects panel lists designs without crashing', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))

    await page.goto('/')
    await page.getByRole('button', { name: /start designing/i }).first().click()
    await expect(page.getByLabel('Create a design')).toBeVisible()

    await page
      .locator('section:has(h2:text("Start a new design")) [aria-label^="Create "]')
      .first()
      .click()
    await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })

    // the editor's left-rail Projects panel
    await page.getByRole('button', { name: 'Projects' }).click()

    // "Loading your projects…" resolves into the panel list — the design
    // created above must appear (the panel fetch is the crashed call).
    await expect(page.getByText('Your saved designs')).toBeVisible()
    await expect(page.getByText('Loading your projects…')).toBeHidden({ timeout: 15_000 })
    await expect(page.getByText(/No saved designs yet|No matches/)).toBeHidden()

    // the editor tree must not have crashed
    await expect(page.getByText('This page couldn’t load')).toHaveCount(0)
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
  })
})
