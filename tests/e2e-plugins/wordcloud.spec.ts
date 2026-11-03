import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * Word Cloud — the v0.13 plugin-system MVP acceptance suite
 * (research/PLUGIN-SYSTEM.md §5, run with CANVIX_PLUGINS=1 via
 * playwright.plugins.config.ts).
 *
 * The golden path, end to end, in five specs:
 *
 *   1. install from the bundled chip → consent screen lists every
 *      permission VERBATIM → the install is listed
 *   2. mid-session install (the service layer must notice) → panel
 *      handshake → collect this page's text → generate → the service
 *      frame actually RENDERS (console seam) → autosave persists the
 *      element (API truth)
 *   3. the exported SVG embeds the real cloud — not a placeholder
 *   4. restyle through the HOST-rendered schema card → disable →
 *      the export degrades to the honest placeholder
 *   5. a signed-out viewer degrades honestly; uninstall leaves the
 *      design data byte-identical (§4.9 durability)
 */

// ── fixtures ───────────────────────────────────────────────────

const PAGE_TEXT =
  'Canvix makes design feel like play. The canvas is live, the design is yours, ' +
  'and every design decision stays yours. Design everywhere, canvas first, play always.'

const CLOUD_ELEMENT = (id: string, name: string, palette = 'canvix') => ({
  id,
  type: 'plugin',
  pluginId: 'com.canvix.wordcloud',
  kind: 'cloud',
  pluginVersion: '1.0.0',
  data: {
    words: [
      { text: 'canvix', weight: 24 },
      { text: 'design', weight: 18 },
      { text: 'canvas', weight: 15 },
      { text: 'plugins', weight: 11 },
      { text: 'security', weight: 9 },
      { text: 'sandbox', weight: 7 },
      { text: 'render', weight: 5 },
      { text: 'export', weight: 3 },
    ],
    seed: 42,
    density: 0.7,
    mask: 'rect',
    palette,
  },
  x: 120,
  y: 140,
  width: 480,
  height: 300,
  rotation: 0,
  opacity: 1,
  locked: false,
  visible: true,
  name,
  shadow: { enabled: false, color: '#000000', blur: 0, offsetX: 0, offsetY: 0 },
})

const TEXT_ELEMENT = {
  id: 'txt_wc_e2e',
  type: 'text',
  text: PAGE_TEXT,
  x: 80,
  y: 60,
  width: 400,
  height: 60,
  rotation: 0,
  opacity: 1,
  locked: false,
  visible: true,
  fontSize: 36,
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
  shadow: { enabled: false, color: '#000000', blur: 0, offsetX: 0, offsetY: 0 },
}

// ── helpers ────────────────────────────────────────────────────

async function register(page: Page, tag: string): Promise<string> {
  const username = `wc_${tag}_${Date.now().toString(36)}`
  const res = await page.request.post('/api/auth/register', {
    data: { username, password: `Wc-E2e-${username}-17!q` },
  })
  expect(res.status(), `register ${username}`).toBeLessThan(300)
  return username
}

async function createDesign(page: Page, name: string, elements: unknown[]) {
  const res = await page.request.post('/api/designs', {
    data: {
      name,
      width: 1080,
      height: 720,
      pages: [{ id: 'page_wc', background: { type: 'solid', color: '#FFFFFF' }, elements }],
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

/** Install the bundled Word Cloud through the API rail (relative URL). */
async function installWordCloud(page: Page) {
  const res = await page.request.post('/api/plugins', {
    data: { manifestUrl: '/plugins/wordcloud/manifest.json' },
  })
  expect(res.status(), `install: ${await res.text()}`).toBeLessThan(300)
}

async function openAppsPanel(page: Page) {
  await page.getByRole('button', { name: 'Apps', exact: true }).click()
  await expect(page.getByPlaceholder('https://example.com/plugin/manifest.json')).toBeVisible()
}

/** Collect console lines from ANY frame (the service iframe logs its renders). */
function consoleTape(page: Page): string[] {
  const lines: string[] = []
  page.on('console', (m) => lines.push(m.text()))
  return lines
}

async function waitForRender(lines: string[], timeoutMs = 30_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (lines.some((l) => l.includes('[wordcloud] rendered'))) return
    await page_sleep(500)
  }
  throw new Error(`no [wordcloud] render observed within ${timeoutMs}ms — got: ${lines.slice(-8).join(' | ')}`)
}

function page_sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** P5 robustness: confirm a disable by its OBSERVED effects — the
 * install list reports enabled:false and the plugin's service frame
 * has unmounted (its title is the one that says "renderer") — instead
 * of a fixed sleep. On slow machines a dev-mode cold compile of the
 * PATCH route can outrun any fixed wait (observed 8.4 s on a loaded
 * self-host box; the UI flips optimistically long before the server
 * does), and this is exactly the precondition the export depends on:
 * transport deregistered → settled renders dropped → placeholder. */
async function waitForPluginDisabled(page: Page, timeoutMs = 30_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const observed = await page.evaluate(async () => {
      let apiDisabled = false
      try {
        const r = await fetch('/api/plugins', { cache: 'no-store' })
        if (r.ok) {
          const d = (await r.json()) as { installs?: { pluginId: string; enabled: boolean }[] }
          const row = (d.installs ?? []).find((i) => i.pluginId === 'com.canvix.wordcloud')
          apiDisabled = !!row && row.enabled === false
        }
      } catch {
        apiDisabled = false
      }
      const serviceFrameGone = !Array.from(document.querySelectorAll('iframe')).some(
        (f) => f.title.includes('renderer'),
      )
      return apiDisabled && serviceFrameGone
    })
    if (observed) return
    await page_sleep(250)
  }
  throw new Error(`Word Cloud not disabled (api + service frame) within ${timeoutMs}ms`)
}

async function exportSvg(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Download', exact: true }).click()
  await page.getByRole('button', { name: /^SVG\b/ }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Download 1 SVG/i }).click(),
  ])
  const path = await download.path()
  expect(path, 'download landed').toBeTruthy()
  return readFileSync(path!, 'utf8')
}

// the four permission lines the consent screen must show VERBATIM
// (note: the design:write line carries a typographic apostrophe —
// permissions.ts renders Canvix\u2019s)
const CONSENT_LINES = [
  'Read the design you have open — pages, elements and their properties',
  'Add, edit and delete elements in this design (via Canvix’s undoable actions)',
  'Add its own element types to the canvas and draw them',
  'Remember its settings in this browser (namespaced, 256 KB cap)',
]

// ── the suite ──────────────────────────────────────────────────

test.describe('Word Cloud bundled plugin — the MVP acceptance (flag ON)', () => {
  test('install from the bundled chip; consent lists every permission verbatim', async ({ page }) => {
    await register(page, 'consent')
    const designId = await createDesign(page, 'cvx_wc_consent', [TEXT_ELEMENT])
    await openEditor(page, designId)
    await openAppsPanel(page)

    // the bundled chip
    const chip = page.getByRole('button', { name: 'Install Word Cloud (bundled)' })
    await expect(chip).toBeVisible()
    await chip.click()

    // consent screen — permissions verbatim, in plain language
    const dialog = page.getByRole('dialog', { name: /Permissions for Word Cloud/ })
    await expect(dialog).toBeVisible()
    for (const line of CONSENT_LINES) {
      await expect(dialog.getByText(line)).toBeVisible()
    }
    // zero network permissions — the default-deny proof
    await expect(dialog.getByText(/Send and receive data with/)).toHaveCount(0)

    await dialog.getByRole('button', { name: 'Keep installed' }).click()
    await expect(dialog).toBeHidden()

    // listed as installed, openable
    await expect(page.getByRole('button', { name: 'Open Word Cloud' })).toBeVisible()

    // the API projection the service layer depends on
    const list = await page.request.get('/api/plugins')
    expect(list.status()).toBe(200)
    const body = (await list.json()) as {
      installs: { installId: string; pluginId: string; elements: { kind: string }[]; entry: { service?: string } }[]
    }
    const wc = body.installs.find((i) => i.pluginId === 'com.canvix.wordcloud')
    expect(wc, 'listed').toBeTruthy()
    expect(wc!.installId).toBeTruthy() // the bug-2 regression: the layer keys on this
    expect(wc!.elements[0]?.kind).toBe('cloud')
    expect(wc!.entry.service).toBe('service.html')
  })

  test('panel generates a cloud; the service frame renders it; autosave persists it', async ({ page }) => {
    const lines = consoleTape(page)
    await register(page, 'golden')
    const designId = await createDesign(page, 'cvx_wc_golden', [TEXT_ELEMENT])

    // editor FIRST — the install that follows is genuinely mid-session
    await openEditor(page, designId)
    await openAppsPanel(page)

    // install through the UI (mid-session — bug 4's regression path)
    await page.getByRole('button', { name: 'Install Word Cloud (bundled)' }).click()
    const dialog = page.getByRole('dialog', { name: /Permissions for Word Cloud/ })
    await dialog.getByRole('button', { name: 'Keep installed' }).click()
    await expect(page.getByRole('button', { name: 'Open Word Cloud' })).toBeVisible()

    // open the panel (bug 3's regression path: the panel must be able
    // to generate elements — caller identity + declared kinds)
    await page.getByRole('button', { name: 'Open Word Cloud' }).click()
    await expect(page.getByText('Back to apps')).toBeVisible()

    // the panel iframe is identified by its stable title (the host
    // renders "<name> (sandboxed plugin)")
    const panel = page.frameLocator('iframe[title="Word Cloud (sandboxed plugin)"]')
    await expect(panel.locator('#wc-api')).toContainText('plugin API v1', { timeout: 30_000 })

    // collect the page's text through the snapshot API
    await panel.locator('#wc-use-page').click()
    await expect(panel.locator('#wc-text')).toHaveValue(/Canvix makes design feel like play/, { timeout: 20_000 })
    await expect(panel.locator('#wc-status')).toContainText(/Collected 1 text element/)

    // generate → the element lands (and instantly becomes selected — the
    // panel's selection handler then reports "Selected a cloud…", which is
    // itself proof the element exists) → the service frame mounts + renders
    await panel.locator('#wc-add').click()
    await expect(panel.locator('#wc-status')).toContainText(/Added|Element added|Selected a cloud/, { timeout: 20_000 })
    await waitForRender(lines)

    // autosave → API truth
    await page.waitForTimeout(4500)
    const reread = await page.request.get(`/api/designs/${designId}`)
    expect(reread.status()).toBe(200)
    const doc = (await reread.json()) as { pages: { elements: Record<string, unknown>[] }[] }
    const el = doc.pages[0].elements.find((e) => e.type === 'plugin') as
      | { pluginId: string; kind: string; data: { words: unknown[]; seed: number } }
      | undefined
    expect(el, 'the plugin element was saved').toBeTruthy()
    expect(el!.pluginId).toBe('com.canvix.wordcloud')
    expect(el!.kind).toBe('cloud')
    expect(el!.data.words.length).toBeGreaterThanOrEqual(5)
    expect(el!.data.seed).toBeGreaterThanOrEqual(1)
  })

  test('the exported SVG embeds the real cloud', async ({ page }) => {
    const lines = consoleTape(page)
    await register(page, 'export')
    await installWordCloud(page)
    const designId = await createDesign(page, 'cvx_wc_export', [CLOUD_ELEMENT('plg_wc_export', 'WC export cloud')])
    await openEditor(page, designId)
    await waitForRender(lines)

    const svg = await exportSvg(page)
    // the cloud's words are real SVG text runs…
    expect(svg).toContain('>canvix<')
    expect(svg).toContain('>design<')
    // …and it is NOT the degradation card
    expect(svg).not.toContain('WC export cloud')
  })

  test('restyle via the host schema card; disable → placeholder in the export', async ({ page }) => {
    const lines = consoleTape(page)
    await register(page, 'restyle')
    await installWordCloud(page)
    const designId = await createDesign(page, 'cvx_wc_restyle', [
      CLOUD_ELEMENT('plg_wc_restyle', 'WC restyle cloud', 'canvix'),
    ])
    await openEditor(page, designId)
    await waitForRender(lines)

    // select the element through the layers tab of the Tools panel
    // (Konva is DOM-opaque; the topbar also has a "Magic Layers"
    // button, so the tab is matched exactly)
    await page.getByRole('button', { name: 'Tools', exact: true }).click()
    await page.getByRole('button', { name: 'Layers', exact: true }).click()
    await page.getByText('WC restyle cloud', { exact: true }).click()

    // the HOST-rendered properties slot (manifest schema, no plugin code)
    const palette = page.getByLabel('Palette')
    await expect(palette).toBeVisible({ timeout: 10_000 })
    await palette.selectOption('sunset')

    // autosave → the data changed through the host path
    await page.waitForTimeout(4500)
    const reread = await page.request.get(`/api/designs/${designId}`)
    const doc = (await reread.json()) as { pages: { elements: { id: string; data: { palette: string } }[] }[] }
    const el = doc.pages[0].elements.find((e) => e.id === 'plg_wc_restyle')
    expect(el?.data.palette).toBe('sunset')

    // disable the plugin → the export must degrade to the placeholder
    await page.getByRole('button', { name: 'Apps', exact: true }).click()
    await page.getByRole('button', { name: 'Disable Word Cloud' }).click()
    await waitForPluginDisabled(page)

    const svg = await exportSvg(page)
    expect(svg).toContain('WC restyle cloud') // the honest card names the element
    expect(svg).not.toContain('>canvix<') // no cloud pixels
  })

  test('signed-out viewer degrades; uninstall leaves data byte-identical', async ({ page, request }) => {
    // an OWNERLESS design (created with the cookie-less `request`
    // fixture) — anyone with the link, signed out included, may open it
    const created = await request.post('/api/designs', {
      data: {
        name: 'cvx_wc_signedout',
        width: 1080,
        height: 720,
        pages: [
          { id: 'page_wc', background: { type: 'solid', color: '#FFFFFF' }, elements: [CLOUD_ELEMENT('plg_wc_out', 'WC out cloud')] },
        ],
      },
    })
    expect(created.status(), `ownerless create: ${await created.text()}`).toBeLessThan(300)
    const designId = ((await created.json()) as { id: string }).id

    const signedOut = await page.context().browser()!.newContext()
    const outPage = await signedOut.newPage()
    const errors: string[] = []
    outPage.on('pageerror', (e) => errors.push(String(e)))
    await outPage.goto(`/design/${designId}`)
    await outPage.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
    await expect(outPage.getByLabel('Design canvas')).toBeVisible({ timeout: 60_000 })
    await outPage.waitForTimeout(2000)
    expect(errors, 'the placeholder path is inert for signed-out viewers').toEqual([])
    await signedOut.close()

    // uninstall durability: the owner installs, then removes, and the
    // element survives byte-identical
    await register(page, 'uninstall')
    const ownId = await createDesign(page, 'cvx_wc_uninstall', [CLOUD_ELEMENT('plg_wc_un', 'WC un cloud')])
    await openEditor(page, ownId)
    await openAppsPanel(page)
    await page.getByRole('button', { name: 'Install Word Cloud (bundled)' }).click()
    const dialog = page.getByRole('dialog', { name: /Permissions for Word Cloud/ })
    await dialog.getByRole('button', { name: 'Keep installed' }).click()
    await expect(page.getByRole('button', { name: 'Open Word Cloud' })).toBeVisible()

    const before = (await (await page.request.get(`/api/designs/${ownId}`)).json()) as {
      pages: { elements: unknown[] }[]
    }
    const beforeEl = before.pages[0].elements.find((e) => (e as { id?: string }).id === 'plg_wc_un')

    await page.getByRole('button', { name: 'Remove Word Cloud' }).click()
    await expect(page.getByRole('button', { name: 'Remove Word Cloud' })).toHaveCount(0, { timeout: 10_000 })
    await page.waitForTimeout(1000)

    const after = (await (await page.request.get(`/api/designs/${ownId}`)).json()) as {
      pages: { elements: unknown[] }[]
    }
    const afterEl = after.pages[0].elements.find((e) => (e as { id?: string }).id === 'plg_wc_un')
    expect(afterEl, 'uninstall never touches design data').toEqual(beforeEl)
  })
})
