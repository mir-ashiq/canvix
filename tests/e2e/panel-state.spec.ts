import { test, expect, type Page } from '@playwright/test'

/**
 * v0.11.6 — panel state hygiene (QA findings F2 + F3,
 * research/V0114-QA-PASS.md §5.2).
 *
 * F2: the Photos panel kept filtering the bundled library by a search query
 *     after a category tab was clicked, so "All photos" showed the stale
 *     6-photo result set instead of the 42-photo library until the panel
 *     was closed and reopened; and a server with no stock-provider keys
 *     (v0.16.4 A4: photo search runs on Pexels/Pixabay, not an AI slot)
 *     left web search hintless, which the panel rendered as "no results" —
 *     reading like broken search.
 *     Fix: a category click exits results mode (query, box text, stock
 *     results and errors all clear), and an unkeyed server says so.
 *
 * F3: the top-bar "Editing mode" control (editingMode) and the Tools-panel
 *     Select/Draw toggle (tool) held separate state, so the panel could
 *     show "Draw" pressed over a read-only canvas, and only the panel
 *     toggle reliably started drawing. Fix: one derivation
 *     (lib/editor-utils interactionMode) labels both controls, the top-bar
 *     menu can activate Draw directly, and activating a tool leaves
 *     read-only viewing.
 *
 * Needs a database (design creation) — see playwright.config.ts.
 */
test.setTimeout(120_000)

async function openEditorPanel(page: Page, panel: string) {
  await page.goto('/')
  // Next.js dev tools indicator overlays the first rail button in dev mode
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await page.getByRole('button', { name: /start designing/i }).first().click()
  await page
    .locator('section:has(h2:text("Start a new design")) [aria-label^="Create "]')
    .first()
    .click()
  await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: panel }).click()
}

const BUNDLED_TOTAL = 42 // 7 categories × 6 bundled photos

// ── F2 ────────────────────────────────────────────────────────

test('F2: clicking a category tab exits Photos search mode and restores the library', async ({ page }) => {
  await openEditorPanel(page, 'Photos')
  const aside = page.locator('aside')
  const search = page.getByLabel('Photos search')

  // the full library is up before any search
  await expect(aside.locator('img')).toHaveCount(BUNDLED_TOTAL)

  // search "food" — bundled grid narrows to the food category's six photos
  await search.fill('food')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(aside.locator('img')).toHaveCount(6)

  // THE BUG: "All photos" used to keep the query filtering — 6 stale tiles
  await page.getByRole('button', { name: 'All photos' }).click()
  await expect(aside.locator('img')).toHaveCount(BUNDLED_TOTAL)
  await expect(search).toHaveValue('')
  // the stock-results section is gone entirely, not just emptied (the
  // header counts — "Stock photos (N)"; the licenses footnote stays)
  await expect(aside.getByText(/^Stock photos \(/)).toBeHidden()

  // a specific category chip exits search mode too (was: same stale filter)
  await search.fill('mountain')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(aside.locator('img')).toHaveCount(6)
  await page.getByRole('button', { name: 'Textures' }).click()
  await expect(aside.locator('img')).toHaveCount(6) // the six TEXTURE photos
  await expect(search).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Textures' })).toHaveAttribute('aria-pressed', 'true')
})

test('F2: a server without stock keys says so instead of "no photos matched"', async ({ page }) => {
  // mock the unkeyed availability probe — deterministic regardless of
  // whether the machine running this spec has stock keys configured
  await page.route('**/api/stock-photo/available', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ available: false, providers: [] }),
    }),
  )
  await openEditorPanel(page, 'Photos')
  const aside = page.locator('aside')

  await page.getByLabel('Photos search').fill('mountain')
  await page.getByRole('button', { name: 'Search', exact: true }).click()

  // the configuration hint, not the misleading empty-result message
  await expect(aside.getByText('Photo search runs on free stock-provider keys')).toBeVisible()
  await expect(aside.getByText(/PEXELS_API_KEY/)).toBeVisible()
  await expect(aside.getByText('No stock photos matched')).toBeHidden()
})

// ── F3 ────────────────────────────────────────────────────────

test('F3: top-bar mode and Tools-panel tool toggle always agree', async ({ page }) => {
  await openEditorPanel(page, 'Tools')
  const modeButton = page.locator('button[aria-label="Editing mode"]')
  // the cursor style lives on the canvas container INSIDE the main editing
  // area — the page navigator below renders its own mini .konvajs-content
  const canvas = page
    .getByLabel('Design canvas')
    .locator('.konvajs-content')
    .first()
    .locator('xpath=..')

  const drawToggle = page.locator('aside .p-4 button[aria-pressed]', { hasText: 'Draw' })
  const selectToggle = page.locator('aside .p-4 button[aria-pressed]', { hasText: 'Select' })

  // initial: top bar reads Editing, canvas is a normal select cursor
  await expect(modeButton).toContainText('Editing')

  // panel toggle activates drawing — and the TOP BAR must say so (was: it
  // kept reading "Editing" over a crosshair cursor)
  await drawToggle.click()
  await expect(modeButton).toContainText('Draw')
  await expect(drawToggle).toHaveAttribute('aria-pressed', 'true')
  await expect(canvas).toHaveCSS('cursor', 'crosshair')

  // top-bar menu: three coherent options; Viewing makes the canvas read-only
  await modeButton.click()
  await page.getByRole('menuitem', { name: 'Viewing — read only' }).click()
  await expect(modeButton).toContainText('Viewing')
  await expect(canvas).toHaveCSS('cursor', 'default')
  // the panel explains itself instead of showing Draw "pressed" silently
  await expect(page.getByText('Viewing mode is read-only — picking a tool resumes editing.')).toBeVisible()

  // activating a tool from the PANEL leaves read-only viewing (was: Draw
  // stayed pressed over a read-only canvas forever)
  await selectToggle.click()
  await expect(modeButton).toContainText('Editing')

  // activating Draw from the TOP BAR works too — previously only the
  // panel toggle reliably started drawing
  await modeButton.click()
  await page.getByRole('menuitem', { name: 'Draw — freehand brush' }).click()
  await expect(modeButton).toContainText('Draw')
  await expect(drawToggle).toHaveAttribute('aria-pressed', 'true')
  await expect(canvas).toHaveCSS('cursor', 'crosshair')
})
