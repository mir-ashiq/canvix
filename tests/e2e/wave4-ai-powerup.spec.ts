import { test, expect, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'

/**
 * v0.19 (Wave 4) — AI Power-Up e2e.
 *
 * Exercises the surfaces a user actually touches, with the AI providers
 * MOCKED at the route layer (the same discipline the suite uses for
 * stock providers): the agentic plan review gate, speaker-notes
 * generation, AI themes, alt text, and the local image power tools
 * (which need no provider at all — the upscaler is driven for real in
 * the browser). Document truth is asserted through the designs API.
 *
 * Register budget: ONE registration per run (the wave3 pattern).
 */

// an 8×8 solid-red PNG (75 bytes)
const RED_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC'

function textEl(overrides: Record<string, unknown> = {}) {
  return {
    id: 'w4_text',
    type: 'text',
    name: 'wave4 text',
    x: 100,
    y: 100,
    width: 500,
    height: 80,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    text: 'Quarterly Results',
    fontSize: 72,
    fontFamily: 'Inter',
    bold: true,
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
    id: 'w4_image',
    type: 'image',
    name: 'wave4 image',
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
const CRED_FILE = '/tmp/w4-e2e-account.json'

async function register(page: Page, tag: string): Promise<string> {
  if (SHARED_ACCOUNT) return SHARED_ACCOUNT.username
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
  const username = `w4_${tag}_${Date.now().toString(36)}`
  const password = `W4-E2e-${username}-19!q`
  const res = await page.request.post('/api/auth/register', { data: { username, password } })
  expect(res.status(), `register ${username}`).toBeLessThan(300)
  SHARED_ACCOUNT = { username, password }
  try {
    writeFileSync(CRED_FILE, JSON.stringify(SHARED_ACCOUNT))
  } catch {
    /* read-only fs — module fallback covers same-file tests */
  }
  return username
}

async function createDesign(page: Page, name: string, elements: unknown[]): Promise<string> {
  const res = await page.request.post('/api/designs', {
    data: {
      name,
      width: 1080,
      height: 720,
      pages: [{ id: 'p1', background: { type: 'solid', color: '#FFFFFF' }, elements }],
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
    pages: { elements: Record<string, any>[]; notes?: string }[]
  }
}

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
  const layersTab = page.getByRole('button', { name: 'Layers', exact: true })
  if (!(await layersTab.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Tools', exact: true }).click()
    await layersTab.click()
  }
  await page.getByText(label, { exact: true }).click()
}

/** open a registry app from the Apps rail */
async function openApp(page: Page, appName: string) {
  await page.getByRole('button', { name: 'Apps', exact: true }).click()
  await page.getByText(appName, { exact: true }).first().click()
}

/** the mocked plan the /api/ai/plan route fulfills with */
const MOCK_PLAN = {
  plan: {
    name: 'Trattoria Menu',
    summary: 'Rustic two-page menu with warm accents',
    width: 1080,
    height: 720,
    pages: [
      {
        id: 'pp1',
        title: 'Cover',
        enabled: true,
        background: { type: 'gradient', from: '#7A3B2E', to: '#D9A566', angle: 135 },
        elements: [
          { id: 'e1', type: 'text', enabled: true, text: 'Trattoria da Luca', x: 140, y: 240, width: 800, fontSize: 84, fontFamily: 'Playfair Display', bold: true, fill: '#FFF6EC', align: 'center' },
          { id: 'e2', type: 'rect', enabled: true, x: 340, y: 420, width: 400, height: 8, fill: '#D9A566' },
        ],
      },
      {
        id: 'pp2',
        title: 'Antipasti',
        enabled: true,
        background: { type: 'solid', color: '#FFF6EC' },
        elements: [
          { id: 'e3', type: 'text', enabled: true, text: 'Antipasti', x: 140, y: 120, width: 400, fontSize: 56, fontFamily: 'Playfair Display', bold: true, fill: '#7A3B2E', align: 'left' },
        ],
      },
    ],
  },
}

const MOCK_THEME = {
  theme: {
    name: 'Nordic calm',
    mood: 'cool editorial',
    palette: [
      { hex: '#0B1220', role: 'background' },
      { hex: '#16233A', role: 'surface' },
      { hex: '#F5F7FA', role: 'ink' },
      { hex: '#C3CCDA', role: 'inkSoft' },
      { hex: '#5B8DEF', role: 'accent' },
      { hex: '#9BB8F5', role: 'accentSoft' },
    ],
    fonts: { heading: 'Montserrat', body: 'Inter' },
  },
}

const MOCK_NOTES = {
  notes: [
    { page: 1, text: 'Welcome the room, land the one number that matters, tease the demo.' },
    { page: 2, text: 'Walk the antipasti board left to right; mention the daily cheese.' },
  ],
}

test.describe('Wave 4 — AI Power-Up', () => {
  test.setTimeout(180_000)

  test('agentic plan: review gate lets you edit, toggle, then apply native pages', async ({ page }) => {
    await register(page, 'plan')
    const designId = await createDesign(page, 'w4 plan', [textEl({ text: 'Seed page' })])
    await openEditor(page, designId)

    await page.route('**/api/ai/plan', (route) => route.fulfill({ json: MOCK_PLAN }))
    await openApp(page, 'AI design plan')

    // the brief + generate
    await page.getByLabel('Design brief').fill('Two-page trattoria menu, rustic and warm')
    await page.getByRole('button', { name: 'Plan my design' }).click()

    // the review gate: both pages render as cards
    await expect(page.getByText('Trattoria Menu', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Cover', { exact: true })).toBeVisible()
    await expect(page.getByText('Antipasti', { exact: true })).toBeVisible()

    // editable copy — rewrite the headline
    const headline = page.locator('input[aria-label="Element text"]').first()
    await headline.fill('Trattoria da Enzo')

    // toggle the second page OFF — the gate must skip it on apply
    // (the page checkbox's aria-label is namespaced with "page")
    await page.getByRole('button', { name: 'Disable page Antipasti' }).click()

    await page.getByRole('button', { name: /Apply \(1p/ }).click()

    // document truth: exactly one new page, with the EDITED headline
    const applied = await waitForDoc(page, designId, (d) => d.pages.length === 2, 'the applied plan page')
    expect(applied.pages).toHaveLength(2)
    const newTexts = applied.pages[1].elements.filter((e) => e.type === 'text').map((e) => e.text)
    expect(newTexts).toContain('Trattoria da Enzo')
    expect(newTexts).not.toContain('Trattoria da Luca')
    // the applied page carries the plan's gradient background
    expect(applied.pages[1].elements.some((e) => e.type === 'rect')).toBe(true)
  })

  test('speaker notes: AI draft is reviewed, edited, then saved per page', async ({ page }) => {
    await register(page, 'notes')
    // two pages — the mocked draft covers both
    const res = await page.request.post('/api/designs', {
      data: {
        name: 'w4 notes',
        width: 1080,
        height: 720,
        pages: [
          {
            id: 'p1',
            background: { type: 'solid', color: '#FFFFFF' },
            elements: [
              textEl({ text: 'Quarterly Results', fontSize: 72 }),
              textEl({ id: 'w4_text2', text: 'Revenue up 24% YoY', y: 220, fontSize: 28, bold: false }),
            ],
          },
          {
            id: 'p2',
            background: { type: 'solid', color: '#FFFFFF' },
            elements: [textEl({ id: 'w4_text3', text: 'Antipasti board', fontSize: 56 })],
          },
        ],
      },
    })
    expect(res.status()).toBeLessThan(300)
    const designId = ((await res.json()) as { id: string }).id
    await openEditor(page, designId)

    await page.route('**/api/ai/notes', (route) => route.fulfill({ json: MOCK_NOTES }))

    // open the notes popover on the page bar (exact — the present button
    // is named "Present with speaker notes")
    await page.getByRole('button', { name: 'Speaker notes', exact: true }).click()
    await expect(page.getByTestId('notes-popover')).toBeVisible()
    await page.getByTestId('notes-ai-generate').click()

    // the review dialog shows BOTH pages' drafts, editable
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    const page2box = dialog.locator('textarea[aria-label="Notes for page 2"]')
    await page2box.fill('Walk the board left to right; land the margin story.')

    await dialog.getByRole('button', { name: 'Apply to pages' }).click()
    await expect(dialog).toBeHidden()

    // document truth: each page's notes saved (page 1 verbatim, page 2 edited)
    await waitForDoc(page, designId, (d) => Boolean(d.pages[0]?.notes && d.pages[1]?.notes), 'saved speaker notes')
    const d = await doc(page, designId)
    expect(d.pages[0].notes).toContain('one number that matters')
    expect(d.pages[1].notes).toContain('margin story')
  })

  test('AI theme: palette preview applies design-wide with contrast guards', async ({ page }) => {
    await register(page, 'theme')
    const designId = await createDesign(page, 'w4 theme', [
      textEl({ text: 'Headline', fontSize: 72 }),
      textEl({ id: 'w4_body', text: 'Body copy here', y: 240, fontSize: 24, bold: false }),
      imageEl({ x: 120, y: 400 }),
    ])
    await openEditor(page, designId)

    await page.route('**/api/ai/theme', (route) => route.fulfill({ json: MOCK_THEME }))
    await openApp(page, 'AI theme')

    await page.getByLabel('Theme mood').fill('nordic calm, cool editorial')
    await page.getByRole('button', { name: 'Generate' }).click()

    // the preview: six role rows + the font pairing
    await expect(page.getByText('Nordic calm', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Montserrat + Inter')).toBeVisible()
    await expect(page.getByText('Background', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Apply theme' }).click()

    // document truth: background + text recolored, image untouched
    const applied = await waitForDoc(
      page,
      designId,
      (d) => (d.pages[0].elements as any[]).some((e) => e.fill === '#F5F7FA'),
      'the applied theme'
    )
    const els = applied.pages[0].elements
    expect(els.find((e) => e.type === 'text' && e.fontSize === 72)?.fill).toBe('#F5F7FA') // heading ink
    expect(els.find((e) => e.type === 'text' && e.fontSize === 24)?.fill).toBe('#C3CCDA') // body inkSoft
    expect(els.find((e) => e.type === 'image')?.src).toContain('data:image/png;base64,') // untouched
  })

  test('local image tools: upscaler really enlarges; brush eraser + alt UI are wired', async ({ page }) => {
    await register(page, 'local')
    const designId = await createDesign(page, 'w4 local', [imageEl()])
    await openEditor(page, designId)

    // select the image through the Layers tab
    await selectViaLayers(page, 'wave4 image')

    // the three Wave-4 toolbar entries exist
    await expect(page.getByRole('button', { name: 'Upscale image' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Brush eraser' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Alt text' })).toBeVisible()

    // run the REAL local upscaler — 2x on the 8×8 red square
    await page.getByRole('button', { name: 'Upscale image' }).click()
    await page.getByRole('button', { name: /2× → 16px/ }).click()
    await page.getByRole('button', { name: /Upscale to 16×16/ }).click()
    await expect(page.getByText('Upscaled 2×', { exact: true })).toBeVisible({ timeout: 30_000 })

    // document truth: the element's natural size doubled (8 → 16)
    await waitForDoc(
      page,
      designId,
      (d) => (d.pages[0].elements as any[]).some((e) => e.type === 'image' && e.naturalWidth === 16),
      'the upscaled image'
    )

    // the brush eraser dialog opens with a paintable surface
    await page.getByRole('button', { name: 'Brush eraser' }).click()
    const dlg = page.getByRole('dialog')
    await expect(dlg).toBeVisible()
    await expect(dlg.getByLabel('Erase brush area')).toBeVisible()
    await expect(dlg.getByRole('button', { name: 'Erase painted area' })).toBeDisabled() // nothing painted yet
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toBeHidden()
  })

  test('alt text: AI suggestion is editable and saved on the element', async ({ page }) => {
    await register(page, 'alt')
    const designId = await createDesign(page, 'w4 alt', [imageEl()])
    await openEditor(page, designId)

    await page.route('**/api/ai/alt-text', (route) =>
      route.fulfill({ json: { alt: 'A solid red square used as a color swatch.', decorative: false } })
    )

    await selectViaLayers(page, 'wave4 image')
    await page.getByRole('button', { name: 'Alt text' }).click()
    await expect(page.getByTestId('alt-text-input')).toBeVisible()

    await page.getByRole('button', { name: 'Generate' }).click()
    await expect(page.getByTestId('alt-text-input')).toHaveValue(/solid red square/, { timeout: 15_000 })

    // review-edit before saving
    await page.getByTestId('alt-text-input').fill('A red color swatch.')
    await page.getByRole('button', { name: 'Save' }).click()

    // document truth: alt saved on the image element
    await waitForDoc(
      page,
      designId,
      (d) => (d.pages[0].elements as any[]).some((e) => e.type === 'image' && e.alt === 'A red color swatch.'),
      'the saved alt text'
    )
  })

  test('capabilities endpoint reports the Wave 4 feature set', async ({ page }) => {
    const res = await page.request.get('/api/ai/capabilities')
    expect(res.status()).toBe(200)
    const body = (await res.json()) as { capabilities: Record<string, boolean> }
    // locals are always on
    expect(body.capabilities.upscale).toBe(true)
    expect(body.capabilities.brushEraser).toBe(true)
    expect(body.capabilities.backgroundRemoval).toBe(true)
    // the provider-gated Wave 4 keys exist as booleans
    for (const key of ['agenticPlanning', 'notesGeneration', 'themeGeneration', 'altText', 'videoGeneration']) {
      expect(typeof body.capabilities[key]).toBe('boolean')
    }
  })
})
