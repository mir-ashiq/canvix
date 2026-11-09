import { test, expect, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'

/**
 * v0.18 (Wave 3) — editor depth parity e2e.
 * Exercises the surfaces a user actually touches: the polygon palette,
 * the shape-property sliders, image masks, list/RTL/auto-fit text
 * controls, the grid overlay, per-page sizes, and the presenter view
 * with speaker notes. Document truth is asserted through the designs
 * API (the same discipline the D4/D7 suites use).
 *
 * Register budget: ONE registration per run.
 */

// an 8×8 solid-red PNG (75 bytes)
const RED_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC'

function textEl(overrides: Record<string, unknown> = {}) {
  return {
    id: 'w3_text',
    type: 'text',
    name: 'wave3 text',
    x: 100,
    y: 100,
    width: 500,
    height: 80,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    text: 'Alpha bravo charlie delta echo foxglove',
    fontSize: 48,
    fontFamily: 'Inter',
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    uppercase: false,
    fill: '#1F2226',
    align: 'left',
    lineHeight: 1.25,
    letterSpacing: 0,
    ...overrides,
  }
}

function imageEl(overrides: Record<string, unknown> = {}) {
  return {
    id: 'w3_image',
    type: 'image',
    name: 'wave3 image',
    x: 420,
    y: 120,
    width: 300,
    height: 300,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    src: `data:image/png;base64,${RED_PNG_B64}`,
    radius: 0,
    naturalWidth: 8,
    naturalHeight: 8,
    ...overrides,
  }
}

let SHARED_ACCOUNT: { username: string; password: string } | null = null

/** module state may reset between tests (playwright restarts workers after
 * failures) — credentials are also shared through /tmp so every test in
 * the run LOGS IN with the same account instead of re-registering
 * (the register endpoint allows 5/h/IP in production). */
const CRED_FILE = '/tmp/w3-e2e-account.json'

async function ensureAccount(page: Page, tag: string): Promise<string> {
  if (SHARED_ACCOUNT) {
    // already authenticated in this module instance — nothing to do
    return SHARED_ACCOUNT.username
  }
  // try a saved account from an earlier test in this run
  try {
    const saved = JSON.parse(readFileSync(CRED_FILE, 'utf8')) as { username: string; password: string }
    const res = await page.request.post('/api/auth/login', { data: saved })
    if (res.status() < 300) {
      SHARED_ACCOUNT = saved
      return saved.username
    }
  } catch {
    /* no saved account yet */
  }
  const username = await register(page, tag)
  return username
}

async function register(page: Page, tag: string): Promise<string> {
  const username = `w3_${tag}_${Date.now().toString(36)}`
  const password = `W3-E2e-${username}-18!q`
  const res = await page.request.post('/api/auth/register', { data: { username, password } })
  expect(res.status(), `register ${username}`).toBeLessThan(300)
  SHARED_ACCOUNT = { username, password }
  try {
    writeFileSync(CRED_FILE, JSON.stringify(SHARED_ACCOUNT))
  } catch {
    /* read-only fs — the module fallback still covers same-file tests */
  }
  return username
}

async function createDesign(page: Page, name: string, elements: unknown[], pageOver: Record<string, unknown> = {}): Promise<string> {
  const res = await page.request.post('/api/designs', {
    data: {
      name,
      width: 1080,
      height: 720,
      pages: [{ id: 'p1', background: { type: 'solid', color: '#FFFFFF' }, elements, ...pageOver }],
    },
  })
  expect(res.status(), `create design: ${await res.text()}`).toBeLessThan(300)
  return ((await res.json()) as { id: string }).id
}

async function openEditor(page: Page, designId: string) {
  await page.goto(`/design/${designId}`)
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 60_000 })
}

async function doc(page: Page, designId: string) {
  const res = await page.request.get(`/api/designs/${designId}`)
  expect(res.status()).toBe(200)
  return (await res.json()) as {
    pages: { elements: Record<string, any>[]; notes?: string; width?: number; height?: number }[]
  }
}

/** document truth arrives through the 1.6s debounced autosave — poll
 * the designs API until the predicate holds (or fail loudly). */
async function waitForDoc(
  page: Page,
  designId: string,
  predicate: (d: Awaited<ReturnType<typeof doc>>) => boolean,
  what: string,
  timeoutMs = 15_000
) {
  const started = Date.now()
  let last: Awaited<ReturnType<typeof doc>> | null = null
  while (Date.now() - started < timeoutMs) {
    last = await doc(page, designId)
    if (predicate(last)) return last
    await page.waitForTimeout(500)
  }
  throw new Error(`document never showed ${what} within ${timeoutMs}ms — last: ${JSON.stringify(last?.pages[0]).slice(0, 300)}`)
}

/** select an element through the Layers tab (Konva is DOM-opaque) */
async function selectViaLayers(page: Page, label: string) {
  // The Tools rail is a toggle — when the panel is already open (this
  // suite selects twice), clicking Tools again would close it and hide
  // the tabs. Only navigate when the Layers tab isn't already showing.
  const layersTab = page.getByRole('button', { name: 'Layers', exact: true })
  if (!(await layersTab.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Tools', exact: true }).click()
    await layersTab.click()
  }
  await page.getByText(label, { exact: true }).click()
}

test.describe('Wave 3 — editor depth parity', () => {
  test.setTimeout(180_000)

  test('polygon palette inserts native parametric polygons + stars', async ({ page }) => {
    const username = await register(page, 'shapes')
    // fresh design through the dashboard flow
    await page.goto('/')
    await page.getByRole('button', { name: /start designing/i }).first().click()
    await expect(page.getByLabel('Create a design')).toBeVisible()
    await page.locator('section:has(h2:text("Start a new design")) [aria-label^="Create "]').first().click()
    await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })

    // Elements panel → Shapes → polygons + stars sections
    await page.getByRole('button', { name: 'Elements', exact: true }).click()
    await page.getByRole('tab', { name: 'Shapes' }).click()
    await expect(page.getByText('Polygons')).toBeVisible()
    await expect(page.getByText('Stars')).toBeVisible()

    await page.getByRole('button', { name: 'Add Hexagon' }).click()

    // the polygon landed in the document (layers panel shows its auto label)
    await page.getByRole('button', { name: 'Tools', exact: true }).click()
    await page.getByRole('button', { name: 'Layers', exact: true }).click()
    await expect(page.getByText('Polygon', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
  })

  test('image mask picker writes maskShape + document truth', async ({ page }) => {
    const username = await ensureAccount(page, 'mask')
    const design = await createDesign(page, `cvx_w3_mask_${username}`, [imageEl()])
    await openEditor(page, design)
    await selectViaLayers(page, 'wave3 image')

    await page.getByRole('button', { name: 'Image mask' }).click()
    const grid = page.getByTestId('mask-grid')
    await expect(grid).toBeVisible()

    // 13 options: none + 10 presets + 2 parametric
    await expect(grid.getByRole('button')).toHaveCount(13)

    await grid.getByTestId('mask-circle').click()
    await page.keyboard.press('Escape')

    await waitForDoc(
      page,
      design,
      (d) => d.pages[0].elements.find((e) => e.id === 'w3_image')?.maskShape === 'circle',
      'maskShape=circle'
    )

    // parametric option exposes the sides slider (Escape deselected the
    // image — the editor's documented "Deselect / close" — so re-select)
    await selectViaLayers(page, 'wave3 image')
    await page.getByRole('button', { name: 'Image mask' }).click()
    await grid.getByTestId('mask-polyStar').click()
    await expect(page.getByText('Spike ratio')).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('text list + auto-fit + rtl controls round-trip to the document', async ({ page }) => {
    // reuse the shared account when present (register budget)
    const username = await ensureAccount(page, 'text')
    const design = await createDesign(page, `cvx_w3_text_${username}_${Date.now().toString(36)}`, [textEl()])
    await openEditor(page, design)
    await selectViaLayers(page, 'wave3 text')

    await page.getByRole('button', { name: 'List and fit options' }).click()
    const pop = page.locator('.cv-pop').last()
    await expect(pop).toBeVisible()

    await pop.getByTestId('list-number').click()
    await pop.getByTestId('dir-rtl').click()
    await pop.getByTestId('autofit-toggle').locator('input[type="checkbox"]').check()
    await page.keyboard.press('Escape')

    const d = await waitForDoc(
      page,
      design,
      (dd) => {
        const t = dd.pages[0].elements.find((e) => e.id === 'w3_text')
        return t?.listStyle === 'number' && t?.direction === 'rtl' && t?.autoFit === true
      },
      'listStyle=number + direction=rtl + autoFit=true'
    )
    const t = d.pages[0].elements.find((e) => e.id === 'w3_text')
    expect(t?.listStyle).toBe('number')
    expect(t?.direction).toBe('rtl')
    expect(t?.autoFit).toBe(true)
  })

  test('grid overlay toggle + snap + size selector', async ({ page }) => {
    const username = await ensureAccount(page, 'grid')
    const design = await createDesign(page, `cvx_w3_grid_${username}_${Date.now().toString(36)}`, [])
    await openEditor(page, design)

    // grid off by default: no size selector
    await expect(page.getByTestId('grid-size')).toHaveCount(0)

    await page.getByTestId('grid-toggle').click()
    await expect(page.getByTestId('snap-toggle')).toBeVisible()
    await expect(page.getByTestId('grid-size')).toBeVisible()

    // snap toggle + grid size round-trip
    await page.getByTestId('snap-toggle').click()
    await page.getByTestId('grid-size').selectOption('80')

    // grid draws lines on the stage (canvas pixels change)
    const withGrid = await page.evaluate(() => {
      const scope = document.querySelector('main[aria-label="Design canvas"]')
      const canvases = Array.from((scope ?? document).querySelectorAll('canvas'))
      const biggest = canvases.reduce<HTMLCanvasElement | null>(
        (best, c) => (!best || c.width * c.height > best.width * best.height ? c : best),
        null
      )
      return biggest ? biggest.toDataURL() : ''
    })
    await page.getByTestId('grid-toggle').click()
    const withoutGrid = await page.evaluate(() => {
      const scope = document.querySelector('main[aria-label="Design canvas"]')
      const canvases = Array.from((scope ?? document).querySelectorAll('canvas'))
      const biggest = canvases.reduce<HTMLCanvasElement | null>(
        (best, c) => (!best || c.width * c.height > best.width * best.height ? c : best),
        null
      )
      return biggest ? biggest.toDataURL() : ''
    })
    expect(withGrid).not.toBe(withoutGrid)
  })

  test('per-page size + speaker notes + presenter view', async ({ page }) => {
    const username = await ensureAccount(page, 'page')
    const design = await createDesign(page, `cvx_w3_page_${username}_${Date.now().toString(36)}`, [])
    await openEditor(page, design)

    // per-page resize
    await page.getByTestId('page-size-button').click()
    await expect(page.getByTestId('page-size-popover')).toBeVisible()
    await page.getByTestId('page-size-w').fill('500')
    await page.getByTestId('page-size-h').fill('500')
    await page.getByTestId('page-size-apply').click()

    await waitForDoc(
      page,
      design,
      (d) => d.pages[0].width === 500 && d.pages[0].height === 500,
      'page size 500×500'
    )
    // the chip now shows the custom size
    await expect(page.getByTestId('page-size-button')).toContainText('500×500')

    // speaker notes (exact — the top bar's "Present with speaker notes"
    // also substring-matches a non-exact query)
    await page.getByRole('button', { name: 'Speaker notes', exact: true }).click()
    await page.getByTestId('notes-textarea').fill('Welcome everyone — this is the opening slide.')
    await page.keyboard.press('Escape')

    await waitForDoc(
      page,
      design,
      (d) => (d.pages[0].notes ?? '').includes('opening slide'),
      'speaker notes'
    )

    // presenter view shows the note
    await page.getByTestId('present-notes-button').click()
    await expect(page.getByRole('dialog', { name: 'Presenter view' })).toBeVisible()
    await expect(page.getByTestId('presenter-notes')).toHaveValue('Welcome everyone — this is the opening slide.')

    // keyboard: escape closes
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Presenter view' })).toHaveCount(0)
  })
})
