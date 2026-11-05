import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * v0.14 (D7): the data-bound chart element — acceptance.
 *
 *   1. adding a bar chart from the Elements panel lands a REAL chart
 *      element (API truth: kind/labels/series), rendered on the canvas
 *   2. "Edit data" in the toolbar changes labels + values → the
 *      document updates, and the canvas pixels move
 *   3. the toolbar converts the kind in place (bar → donut)
 *   4. data persists across a reload
 *   5. the SVG export carries the real geometry — category labels and
 *      series colours as a bar chart; annular arc paths + the centre
 *      total as a donut
 *   6. line + scatter charts land with their own data shapes; a
 *      HOSTILE clipboard envelope pastes as a sanitized chart (junk
 *      kind → bar fallback, caps applied, id remapped)
 *
 * Register budget: ONE registration per run (the second test logs in
 * with the shared account — the PR #26 discipline).
 */

let SHARED_ACCOUNT: { username: string; password: string } | null = null

async function register(page: Page, tag: string): Promise<string> {
  const username = `d7_${tag}_${Date.now().toString(36)}`
  const password = `D7-E2e-${username}-17!q`
  const res = await page.request.post('/api/auth/register', { data: { username, password } })
  expect(res.status(), `register ${username}`).toBeLessThan(300)
  if (!SHARED_ACCOUNT) SHARED_ACCOUNT = { username, password }
  return username
}

async function createDesign(page: Page, name: string, elements: unknown[]): Promise<string> {
  const res = await page.request.post('/api/designs', {
    data: { name, width: 1080, height: 720, pages: [{ id: 'p1', background: { type: 'solid', color: '#FFFFFF' }, elements }] },
  })
  expect(res.status(), `create design: ${await res.text()}`).toBeLessThan(300)
  return ((await res.json()) as { id: string }).id
}

async function openEditor(page: Page, designId: string) {
  await page.goto(`/design/${designId}`)
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 60_000 })
}

interface DocChart {
  id: string
  type: string
  kind?: string
  labels?: string[]
  series?: { name: string; color: string; values: number[] }[]
  barMode?: string
  hole?: number
  smooth?: boolean
}

async function docCharts(page: Page, designId: string): Promise<DocChart[]> {
  const res = await page.request.get(`/api/designs/${designId}`)
  expect(res.status()).toBe(200)
  const doc = (await res.json()) as { pages: { elements: DocChart[] }[] }
  return doc.pages[0].elements.filter((e) => e.type === 'chart')
}

/** the main Konva canvas as a data URL (pixel truth; scoped + biggest — the D4 lesson) */
async function canvasSnapshot(page: Page): Promise<string> {
  return page.evaluate(() => {
    const scope = document.querySelector('main[aria-label="Design canvas"]')
    const canvases = Array.from((scope ?? document).querySelectorAll('canvas'))
    const biggest = canvases.reduce<HTMLCanvasElement | null>(
      (best, c) => (!best || c.width * c.height > best.width * best.height ? c : best),
      null
    )
    return biggest ? biggest.toDataURL() : ''
  })
}

test.describe('Charts (v0.14 D7)', () => {
  test.setTimeout(180_000)

  test('add bar → edit data → convert to donut → persist → SVG exports', async ({ page }) => {
    const username = await register(page, 'main')
    const design = await createDesign(page, `cvx_d7_${username}`, [])
    await openEditor(page, design)

    // ── add a bar chart from the Elements panel ──
    await page.getByRole('button', { name: 'Elements', exact: true }).first().click()
    await page.getByRole('tab', { name: 'Charts', exact: true }).click()
    await page.getByRole('button', { name: 'Add Bar chart' }).click()

    // API truth: a real chart element with the sample data
    await expect
      .poll(async () => (await docCharts(page, design)).length, { timeout: 45_000 })
      .toBe(1)
    let chart = (await docCharts(page, design))[0]
    expect(chart.kind).toBe('bar')
    expect(chart.labels).toEqual(['Q1', 'Q2', 'Q3', 'Q4'])
    expect(chart.series).toHaveLength(2)
    expect(chart.series?.[0]).toMatchObject({ name: 'Revenue', color: '#7630D7', values: [128, 155, 141, 190] })
    expect(chart.barMode).toBe('group')

    // the canvas actually rendered it (non-blank, and stable)
    const barPixels = await canvasSnapshot(page)
    expect(barPixels.length, 'canvas rendered the chart').toBeGreaterThan(1_000)

    // ── Edit data: a new label + a new value ──
    await page.getByRole('button', { name: 'Edit chart data' }).click()
    const pop = page.locator('.cv-pop').last()
    await expect(pop).toBeVisible()
    await pop.getByLabel('Label 1').fill('2023')
    await pop.getByLabel('Series 1 value 1').fill('200')

    await expect
      .poll(async () => {
        chart = (await docCharts(page, design))[0]
        return chart.labels?.[0] === '2023' && chart.series?.[0].values?.[0] === 200
      }, { timeout: 20_000 })
      .toBe(true)

    // the geometry moved with the data (pixel truth, observed end state)
    const editedPixels = await canvasSnapshot(page)
    expect(editedPixels, 'value edit changed the rendering').not.toBe(barPixels)

    // close the popover (its backdrop intercepts toolbar/export clicks)
    await page.mouse.click(30, 700)

    // ── export SVG as a bar chart: real labels + series colours ──
    await page.getByRole('button', { name: 'Download', exact: true }).click()
    await page.getByRole('button', { name: /^SVG\b/ }).click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Download 1 SVG/i }).click(),
    ])
    const barSvg = readFileSync((await download.path())!, 'utf8')
    expect(barSvg).toContain('>2023<') // edited category label
    expect(barSvg).toContain('fill="#7630D7"') // series colour
    expect(barSvg).toContain('>200<') // y-axis tick reaching the edited max
    // the export dialog auto-closes after the download (observed end state)
    await expect(page.getByRole('button', { name: 'Close' })).toBeHidden({ timeout: 10_000 })

    // ── convert to a donut in place ──
    await page.getByRole('button', { name: 'Convert to Donut chart' }).click()
    await expect
      .poll(async () => (await docCharts(page, design))[0].kind, { timeout: 20_000 })
      .toBe('donut')

    const donutPixels = await canvasSnapshot(page)
    expect(donutPixels, 'donut renders different pixels than the bar chart').not.toBe(editedPixels)

    // ── reload — the conversion + edits persist ──
    await page.reload()
    await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 60_000 })
    chart = (await docCharts(page, design))[0]
    expect(chart.kind).toBe('donut')
    expect(chart.labels?.[0]).toBe('2023')
    expect(chart.series?.[0].values?.[0]).toBe(200)

    // ── export SVG as a donut: annular arc paths + the centre total ──
    await page.getByRole('button', { name: 'Download', exact: true }).click()
    await page.getByRole('button', { name: /^SVG\b/ }).click()
    const [download2] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Download 1 SVG/i }).click(),
    ])
    const donutSvg = readFileSync((await download2.path())!, 'utf8')
    // annular sector: outer arc + line to inner radius + arc back + close
    expect(donutSvg).toMatch(/<path d="M [0-9.]+ [0-9.]+ A [0-9.]+ [0-9.]+ 0 [01] 1 /)
    expect(donutSvg).toContain('>686<') // centre total: 200+155+141+190
  })

  test('line + scatter shapes land, hostile envelope pastes sanitized', async ({ browser }) => {
    expect(SHARED_ACCOUNT, 'a prior test registered the shared account').not.toBeNull()
    const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
    const page = await ctx.newPage()
    const login = await page.request.post('/api/auth/login', {
      data: { username: SHARED_ACCOUNT!.username, password: SHARED_ACCOUNT!.password },
    })
    expect(login.status(), 'login as the shared account').toBeLessThan(300)

    const design = await createDesign(page, `cvx_d7_b_${SHARED_ACCOUNT!.username}`, [])
    await openEditor(page, design)

    // ── line chart ──
    await page.getByRole('button', { name: 'Elements', exact: true }).first().click()
    await page.getByRole('tab', { name: 'Charts', exact: true }).click()
    await page.getByRole('button', { name: 'Add Line chart' }).click()
    await expect
      .poll(async () => (await docCharts(page, design)).filter((c) => c.kind === 'line').length, { timeout: 45_000 })
      .toBe(1)
    const line = (await docCharts(page, design)).find((c) => c.kind === 'line')
    expect(line?.labels).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'])
    expect(line?.series).toHaveLength(2)
    expect(line?.smooth).toBe(true)

    // ── scatter chart (labels stay empty, values are flat x,y pairs) ──
    await page.getByRole('button', { name: 'Add Scatter chart' }).click()
    await expect
      .poll(async () => (await docCharts(page, design)).filter((c) => c.kind === 'scatter').length, { timeout: 45_000 })
      .toBe(1)
    const scatter = (await docCharts(page, design)).find((c) => c.kind === 'scatter')
    expect(scatter?.labels).toEqual([])
    const scatterValues = scatter?.series?.[0]?.values ?? []
    expect(scatterValues.length).toBeGreaterThan(4)
    expect(scatterValues.length % 2).toBe(0)

    // ── hostile envelope on the OS clipboard → native paste ──
    const hostile = {
      app: 'canvix',
      v: 1,
      elements: [
        {
          id: 'hostile_chart_id',
          type: 'chart',
          kind: 'EVIL',
          x: 80,
          y: 80,
          width: 560,
          height: 360,
          labels: ['ok', 7, 'x'.repeat(60)],
          series: [
            { name: 'a', color: 'javascript:alert(1)', values: [1, 'x', 2e12] },
            'junk',
            { name: 'b', color: '#02C0CC', values: [5, 5, 5] },
          ],
          barMode: 'diagonal',
          hole: 5,
        },
      ],
    }
    await page.evaluate((payload) => navigator.clipboard.writeText(payload), JSON.stringify(hostile))
    await page.keyboard.press('Control+v')

    await expect
      .poll(async () => (await docCharts(page, design)).length, { timeout: 20_000 })
      .toBe(3)
    const pasted = (await docCharts(page, design)).find((c) => c.id !== line?.id && c.id !== scatter?.id)
    expect(pasted, 'the pasted chart exists').toBeTruthy()
    if (pasted) {
      expect(pasted.id).not.toBe('hostile_chart_id') // ids are never trusted
      expect(pasted.kind).toBe('bar') // junk kind falls back, never reaches the renderers
      expect(pasted.labels).toEqual(['ok', 'x'.repeat(24)])
      expect(pasted.series).toEqual([
      { name: 'a', color: '#7630D7', values: [1, 1e9] }, // junk color → palette, non-finite dropped, 2e12 clamped
      { name: 'b', color: '#02C0CC', values: [5, 5, 5] }, // the valid series survives untouched
    ])
      expect(pasted.barMode).toBe('group')
      expect(pasted.hole).toBe(0.85)
    }
    await ctx.close()
  })
})
