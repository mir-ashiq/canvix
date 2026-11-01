import { test, expect, type Page } from '@playwright/test'

/**
 * v0.11.7 — QA follow-ups (research/V0114-QA-PASS.md §5.2, the three
 * findings that stayed open after v0.11.6):
 *
 * F1: clicking empty canvas kept the current selection — only Escape (and
 *     touch) deselected. Fix: a bare click is a zero-size marquee, and
 *     selectInMarquee now clears the selection for it (Canva parity).
 * F5: "Cannot update a component (`X`) while rendering a different
 *     component (`CanvasStage`)" — three store writes lived INSIDE setState
 *     updaters (draw-stroke commit, marquee select, ruler-guide drop).
 *     Updaters run during render, so each write re-rendered other
 *     components mid-render. Fix: all three now commit at event time.
 * F6: the Share dialog offered a decorative Only-me/Public access
 *     selector that nothing enforced; it now documents the real model
 *     (ownerless = link-editable, owned = read-only for others, no cloud
 *     gatekeeping) — see src/lib/auth/design-guard.ts.
 *
 * Needs a database (design creation) — see playwright.config.ts.
 */
test.setTimeout(120_000)

async function openBlankEditor(page: Page) {
  await page.goto('/')
  // Next.js dev tools indicator overlays the first rail button in dev mode
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await page.getByRole('button', { name: /start designing/i }).first().click()
  await page
    .locator('section:has(h2:text("Start a new design")) [aria-label^="Create "]')
    .first()
    .click()
  await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })
}

/** collect React's render-phase update warnings ("Cannot update a component…") */
function watchRenderPhaseWarnings(page: Page): () => string[] {
  const bad: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' && m.text().includes('Cannot update a component')) bad.push(m.text())
  })
  return () => bad
}

/** count Konva nodes of a type on the MAIN editor stage.
 * NB: never trust `Konva.stages` order or "inside the design canvas <main>"
 * alone — the PageBar mounts its DesignPreview thumbnails (also Konva
 * stages) INSIDE that <main>, and their mount order races the canvas. The
 * editor canvas is by far the largest stage on the page, so pick largest. */
function konvaCount(page: Page, selector: string): Promise<number> {
  return page.evaluate(
    (sel) => {
      const Konva = (window as unknown as {
        Konva?: { stages: Array<{ width: () => number; height: () => number; find: (s: string) => unknown[] }> }
      }).Konva
      const stages = Konva?.stages ?? []
      const stage = stages.reduce<
        { width: () => number; height: () => number; find: (s: string) => unknown[] } | null
      >((best, s) => (!best || s.width() * s.height() > best.width() * best.height() ? s : best), null)
      return stage ? stage.find(sel).length : -1
    },
    selector
  )
}

// ── F1 ─────────────────────────────────────────────────────────

test('F1: clicking empty canvas deselects the current selection', async ({ page }) => {
  const warnings = watchRenderPhaseWarnings(page)
  await openBlankEditor(page)

  // add a heading — addElement auto-selects it, so the top bar swaps its
  // left section for the context toolbar (the File menu disappears)
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await page.getByLabel('Add a heading').click()
  await expect(page.getByRole('button', { name: 'File menu' })).toBeHidden()

  // THE BUG (F1): a bare click on empty canvas used to keep the selection
  const box = (await page.getByLabel('Design canvas').boundingBox())!
  await page.mouse.click(box.x + box.width * 0.22, box.y + box.height * 0.25)
  await expect(page.getByRole('button', { name: 'File menu' })).toBeVisible()

  // clicking the heading still selects it (no regression from the fix)
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.475)
  await expect(page.getByRole('button', { name: 'File menu' })).toBeHidden()

  expect(warnings(), 'F5: no render-phase update warnings').toEqual([])
})

test('F1/F5: a marquee drag still selects — and commits cleanly at event time', async ({ page }) => {
  const warnings = watchRenderPhaseWarnings(page)
  await openBlankEditor(page)

  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await page.getByLabel('Add a heading').click()
  await expect(page.getByRole('button', { name: 'File menu' })).toBeHidden()

  // deselect via the F1 click, then re-select by dragging a marquee across
  // the centered heading
  const box = (await page.getByLabel('Design canvas').boundingBox())!
  await page.mouse.click(box.x + box.width * 0.22, box.y + box.height * 0.25)
  await expect(page.getByRole('button', { name: 'File menu' })).toBeVisible()

  await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8, { steps: 6 })
  await page.mouse.up()
  await expect(page.getByRole('button', { name: 'File menu' })).toBeHidden()

  // a drag that selects nothing clears instead of sticking
  await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.15)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.3, { steps: 4 })
  await page.mouse.up()
  await expect(page.getByRole('button', { name: 'File menu' })).toBeVisible()

  expect(warnings(), 'F5: no render-phase update warnings').toEqual([])
})

// ── F5 ─────────────────────────────────────────────────────────

test('F5: drawing a stroke commits without render-phase update warnings', async ({ page }) => {
  const warnings = watchRenderPhaseWarnings(page)
  await openBlankEditor(page)

  // activate Draw from the top-bar mode menu (the v0.11.6 path)
  await page.getByRole('button', { name: 'Editing mode' }).click()
  await page.getByRole('menuitem', { name: /Draw — freehand brush/ }).click()

  const box = (await page.getByLabel('Design canvas').boundingBox())!
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.6)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(box.x + box.width * (0.3 + i * 0.05), box.y + box.height * 0.6 + (i % 2 ? 8 : -8))
  }
  await page.mouse.up()

  // the stroke landed as a real Konva Line node (poll: the commit renders async)
  await expect
    .poll(() => konvaCount(page, 'Line'), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(1)
  expect(warnings(), 'F5: the draw commit must not write the store inside a setState updater').toEqual([])
})

test('F5: dropping a ruler guide commits without render-phase update warnings', async ({ page }) => {
  const warnings = watchRenderPhaseWarnings(page)
  await openBlankEditor(page)

  await page.getByRole('button', { name: 'File menu' }).click()
  await page.getByRole('menuitem', { name: /Show rulers/ }).click()
  const ruler = page.getByLabel('Horizontal ruler — drag to create a guide')
  await expect(ruler).toBeVisible()

  const canvas = page.getByLabel('Design canvas')
  const box = (await canvas.boundingBox())!
  const before = await konvaCount(page, 'Line')

  // drag slowly: mousedown → let the guide effect attach its window
  // listeners → several moves → release. A single-shot dispatch can race
  // the effect registration in headless runs.
  await ruler.hover() // actionability-checked position on the ruler strip
  await page.mouse.down()
  await page.waitForTimeout(120)
  const tx = box.x + box.width * 0.5
  const ty = box.y + box.height * 0.45
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(tx, box.y + 11 + (ty - (box.y + 11)) * (i / 6))
    await page.waitForTimeout(40)
  }
  await page.waitForTimeout(80)
  await page.mouse.up()

  // the guide lands as a draggable Konva Line (poll: the commit renders async)
  await expect
    .poll(() => konvaCount(page, 'Line'), { timeout: 10_000 })
    .toBe(before + 1)
  expect(warnings(), 'F5: the guide commit must not write the store inside a setState updater').toEqual([])
})

// ── F6 ─────────────────────────────────────────────────────────

test('F6: the Share dialog documents the real link-access model', async ({ page }) => {
  await openBlankEditor(page)
  await page.getByRole('button', { name: 'Share' }).click()
  const dlg = page.getByRole('dialog')

  // the canonical link is still the centerpiece
  await expect(dlg.getByLabel('Share link')).toHaveValue(/\/design\//)

  // the honest access card (F6): the rules the server actually enforces
  await expect(dlg.getByText('Who can open this link')).toBeVisible()
  await expect(dlg.getByText(/Anyone who can reach this Canvix instance/)).toBeVisible()
  await expect(dlg.getByText(/Ownerless designs/)).toBeVisible()
  await expect(dlg.getByText(/read-only for everyone except the owner/)).toBeVisible()

  // the decorative, unenforced access selector is gone
  await expect(dlg.getByRole('button', { name: /Only me/ })).toHaveCount(0)
  await expect(dlg.getByText(/community gallery/)).toHaveCount(0)

  // this design is ownerless (created signed-out) — no read-only note
  await expect(dlg.getByText(/viewing this design read-only/)).toHaveCount(0)
})
