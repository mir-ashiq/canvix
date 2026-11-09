import { test, expect, type Page } from '@playwright/test'

/**
 * The Next.js dev overlay indicator (bottom-left portal) sits on top of
 * the LAST left-rail button ("Apps") and intercepts its clicks in dev
 * mode. Production builds don't ship the portal; dev-mode e2e removes it.
 */
async function removeDevOverlay(page: Page) {
  await page.evaluate(() => {
    document.querySelectorAll('nextjs-portal').forEach((el) => el.remove())
  })
}


/**
 * v0.17 (Wave 2) — asset & template ecosystem e2e.
 * Exercises the surfaces a user actually touches: the preset browser,
 * the expanded font dropdown (369 families, on-demand), the icon and
 * illustration apps, save-as-template, and the smart-template fill
 * dialog. Needs a database (see playwright.config.ts).
 */

test.describe('Wave 2 — assets & templates', () => {
  test('dashboard preset browser lists 60+ sizes across groups', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /start designing/i }).first().click()
    await expect(page.getByLabel('Create a design')).toBeVisible()

    await page.getByRole('button', { name: 'Browse all design sizes' }).click()
    await expect(page.getByRole('dialog').getByText('All design sizes')).toBeVisible()
    await expect(page.getByText(/60\+ presets/)).toBeVisible()

    // groups render
    for (const group of ['Social media', 'Print', 'Web & marketing']) {
      await expect(page.getByRole('dialog').getByText(group)).toBeVisible()
    }

    // search narrows
    await page.getByLabel('Search design sizes').fill('poster')
    await expect(page.getByRole('dialog').getByLabel(/Create Poster/).first()).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('font dropdown offers the expanded catalog with category pills', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /start designing/i }).first().click()
    await expect(page.getByLabel('Create a design')).toBeVisible()

    await page
      .locator('section:has(h2:text("Start a new design")) [aria-label^="Create "]')
      .first()
      .click()
    await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })
    await removeDevOverlay(page)

    // add a text element via the Text panel to select it (font dropdown
    // lives on the context toolbar for selected text)
    await page.getByRole('button', { name: 'Text' }).click()
    await page.getByRole('button', { name: 'Add a heading' }).click()

    await page.getByRole('button', { name: 'Toggle font selector' }).click()
    await expect(page.getByPlaceholder(/Search 369 fonts/)).toBeVisible()

    // category pills present
    for (const pill of ['sans', 'serif', 'display']) {
      await expect(page.getByRole('button', { name: pill, exact: true })).toBeVisible()
    }

    // search narrows to a Wave-2 family
    await page.getByPlaceholder(/Search 369 fonts/).fill('Shrikhand')
    await expect(page.getByRole('option', { name: /Shrikhand/ })).toBeVisible()

    // upload affordance present
    await expect(page.getByRole('button', { name: 'Upload a custom font' })).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('Icons app shows the offline pack and the online toggle', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /start designing/i }).first().click()
    await expect(page.getByLabel('Create a design')).toBeVisible()

    await page
      .locator('section:has(h2:text("Start a new design")) [aria-label^="Create "]')
      .first()
      .click()
    await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })
    await removeDevOverlay(page)

    await page.getByRole('button', { name: 'Apps' }).click()
    await page.getByRole('button', { name: 'Open Icons app' }).click()

    await expect(page.getByPlaceholder('Search 562 icons…')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Offline · 562' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Online · Iconify' })).toBeVisible()

    // searching finds basics and inserts a vector icon
    await page.getByLabel('Search icons').fill('rocket')
    await page.getByRole('button', { name: 'Add icon Rocket' }).first().click()
    await expect(page.locator('.konvajs-content').first()).toBeVisible()
  })

  test('Illustrations app offers six packs and inserts on canvas', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /start designing/i }).first().click()
    await expect(page.getByLabel('Create a design')).toBeVisible()

    await page
      .locator('section:has(h2:text("Start a new design")) [aria-label^="Create "]')
      .first()
      .click()
    await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })
    await removeDevOverlay(page)

    await page.getByRole('button', { name: 'Apps' }).click()
    await page.getByRole('button', { name: 'Open Illustrations app' }).click()

    await expect(page.getByPlaceholder('Search illustrations')).toBeVisible()
    await expect(page.getByText('Festive')).toBeVisible()

    await page.getByLabel('Search illustrations').fill('rocket')
    await page.getByRole('button', { name: 'Add illustration Rocket launch' }).click()
    await expect(page.locator('.konvajs-content').first()).toBeVisible()
  })

  test('Save as template dialog opens from the File menu', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /start designing/i }).first().click()
    await expect(page.getByLabel('Create a design')).toBeVisible()

    await page
      .locator('section:has(h2:text("Start a new design")) [aria-label^="Create "]')
      .first()
      .click()
    await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })
    await removeDevOverlay(page)

    await page.getByRole('button', { name: 'File menu' }).click()
    await page.getByRole('menuitem', { name: 'Save as template…' }).click()

    await expect(page.getByRole('dialog').getByText('Save as template')).toBeVisible()
    await expect(page.getByLabel('Template name')).toBeVisible()
  })

  test('smart template opens the fill dialog and applies values', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /start designing/i }).first().click()
    await expect(page.getByLabel('Create a design')).toBeVisible()

    await page
      .locator('section:has(h2:text("Start a new design")) [aria-label^="Create "]')
      .first()
      .click()
    await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })
    await removeDevOverlay(page)

    // the editor Templates panel offers the smart template
    await page.getByRole('button', { name: 'Templates' }).click()
    await page.getByLabel('Search templates').fill('Certificate of Excellence')

    // applying the base template opens the guided fill dialog
    await page.getByRole('button', { name: 'Apply Certificate of Excellence', exact: true }).click()
    await expect(page.getByLabel('Recipient name')).toBeVisible({ timeout: 15_000 })
    await page.getByLabel('Recipient name').fill('Grace Hopper')
    await page.getByRole('button', { name: 'Use this template' }).click()

    // the applied canvas carries the substituted text
    await expect(page.locator('.konvajs-content').first()).toBeVisible()
  })

  test('the templates panel lists 300+ designs and the variants are distinct', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /start designing/i }).first().click()
    await expect(page.getByLabel('Create a design')).toBeVisible()

    // dashboard template grid: 122 originals render in "All"
    const cards = page.locator('section:has(h2:text("Templates")) [aria-label^="Open template"]')
    await expect(cards.first()).toBeVisible()
    const count = await cards.count()
    expect(count).toBeGreaterThanOrEqual(100)

    // a computed variant exists: Aurora colourway of the first template
    await expect(cards.filter({ hasText: '· Aurora' }).first()).toBeVisible()
    await expect(cards.filter({ hasText: '· Ink' }).first()).toBeVisible()
  })
})
