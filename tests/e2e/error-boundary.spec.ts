import { test, expect } from '@playwright/test'

/**
 * H4 (v0.12.2): error boundaries — a forced render-time crash in a
 * child of the editor boundary must render the recovery UI (never a
 * white screen), offer working recoveries, and include the design id
 * + last saved seq in copyable diagnostics.
 *
 * The crash is forced through the dev-only crash probe compiled into
 * ErrorBoundary (NODE_ENV-gated, dropped from production builds).
 */

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

test('a forced render crash shows the boundary UI, not a white screen', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(err.message))

  // open a blank editor like the smoke spec does
  await page.goto('/')
  await page.getByRole('button', { name: /start designing/i }).first().click()
  await expect(page.getByLabel('Create a design')).toBeVisible()
  await page
    .locator('section:has(h2:text("Start a new design")) [aria-label^="Create "]')
    .first()
    .click()
  await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })

  // force a render-time crash inside the editor boundary
  await page.evaluate(() => window.__canvixRequestDevCrash?.())

  // the recovery UI renders — never an unmounted white screen.
  // (role+name: Next's route announcer is also role=alert)
  await expect(page.getByRole('alert', { name: 'editor crashed' })).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.getByText('Something went wrong')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reload editor' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Back to dashboard' })).toBeVisible()

  // diagnostics are copyable and carry the acceptance-criteria fields
  await page.getByRole('button', { name: 'Copy diagnostics' }).click()
  await expect(page.getByText('Diagnostics copied ✓')).toBeVisible()
  const raw = await page.evaluate(() => navigator.clipboard.readText())
  const diag = JSON.parse(raw) as Record<string, unknown>
  expect(diag.surface).toBe('editor')
  expect(typeof diag.designId).toBe('string')
  expect(diag.designId).not.toBe('')
  expect('lastSavedSeq' in diag).toBe(true)
  expect(String(diag.error)).toContain('dev crash probe')

  // “Back to dashboard” recovers without a page reload
  await page.getByRole('button', { name: 'Back to dashboard' }).click()
  await expect(page.getByLabel('Create a design')).toBeVisible()

  // the editor still opens after recovery (boundary state reset)
  await page
    .locator('section:has(h2:text("Start a new design")) [aria-label^="Create "]')
    .first()
    .click()
  await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })

  // the only uncaught error is the probe itself — nothing else broke
  expect(pageErrors.filter((m) => !m.includes('dev crash probe'))).toEqual([])
})
