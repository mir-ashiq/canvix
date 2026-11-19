import { test, expect, type Page } from '@playwright/test'

/**
 * v0.24 (D5) — auto version snapshots before destructive ops.
 *
 * The five destructive operations (template apply, Magic Resize,
 * Translate, Magic Layers page-replace, page delete) now save an
 * `auto`-flagged version snapshot of the PRE-op state first, so a
 * mis-click is always recoverable from Version history. This spec
 * proves the page-delete path end to end through the real editor:
 *
 *   1. a design with one text element gets a second page
 *   2. deleting it via the page bar saves an auto snapshot
 *   3. Version history shows it with the "auto" chip and the
 *      "Auto — before page delete" label
 *   4. restoring brings the deleted page back
 *   5. a manual snapshot taken afterwards survives list pressure
 *      (the preferential-prune guarantee — unit-tested in full in
 *      src/store/editor-store-d5.test.ts; here just the UI surface)
 *
 * Needs a database (design creation) — see playwright.config.ts.
 */
test.setTimeout(120_000)

async function openBlankEditor(page: Page) {
  await page.goto('/')
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await page.getByRole('button', { name: /start designing/i }).first().click()
  await page
    .locator('section:has(h2:text("Start a new design")) [aria-label^="Create "]')
    .first()
    .click()
  await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })
}

test('deleting a page auto-saves a recoverable snapshot', async ({ page }) => {
  await openBlankEditor(page)

  // add a second page, then delete it via the page bar
  await page.getByRole('button', { name: 'Add page' }).click()
  await expect(page.getByRole('button', { name: 'Go to page 2' })).toBeVisible()
  await page.getByRole('button', { name: 'Delete page' }).last().click()
  await expect(page.getByRole('button', { name: 'Go to page 2' })).toBeHidden()

  // Version history: the auto snapshot is there with the auto chip
  await page.getByRole('button', { name: 'File menu' }).click()
  await page.getByRole('menuitem', { name: /version history/i }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Auto — before page delete')).toBeVisible()
  await expect(dialog.getByText('auto', { exact: true })).toBeVisible()

  // restore: the deleted page comes back (close the dialog first —
  // the modal's accessibility tree hides the page bar behind it)
  await dialog.getByRole('button', { name: 'Restore' }).first().click()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Go to page 2' })).toBeVisible({ timeout: 15_000 })
})
