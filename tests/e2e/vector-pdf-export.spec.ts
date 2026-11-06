import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'

/**
 * v0.15 (R4): vector-text PDF export — acceptance.
 *
 *   1. a text-heavy anonymous design (rich spans, flat text, table,
 *      chart, shapes — two pages) exports through the new engine and
 *      the dialog says what it does BEFORE you click.
 *   2. SELECTABLE + SEARCHABLE (the acceptance): pdftotext extracts
 *      the exact strings from the downloaded file — real text
 *      operators, not a rasterized page. This holds on BOTH font
 *      paths (embedded subsets or the std14 fallback), so the spec
 *      is honest even when the runner cannot reach Google Fonts.
 *   3. structure: PDF 1.4 skeleton, both pages present; when the
 *      font ladder DID reach Google, the embedded machinery must be
 *      consistent (/Type0 + /FontFile2 + /ToUnicode + hex TJ runs).
 *
 * Register budget: ZERO — one anonymous design, fresh context
 * (the PR #26/#30 lesson).
 */

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'

interface Base {
  id: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  locked: boolean
  visible: boolean
}

function flatText(over: Partial<Record<string, unknown>> & { id: string; text: string }): Record<string, unknown> {
  return {
    type: 'text',
    x: 60,
    y: 80,
    width: 900,
    height: 120,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    fontSize: 56,
    fontFamily: 'Poppins',
    bold: true,
    italic: false,
    underline: false,
    strike: false,
    uppercase: false,
    fill: '#1F2226',
    align: 'left',
    lineHeight: 1.25,
    letterSpacing: 0,
    ...over,
  }
}

async function createTextDesign(request: APIRequestContext): Promise<string> {
  const rect = (id: string, y: number): Record<string, unknown> => ({
    id,
    type: 'rect',
    x: 40,
    y,
    width: 1000,
    height: 60,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    fill: '#E8F7F9',
    stroke: '',
    strokeWidth: 0,
    cornerRadius: 8,
  })
  const table: Record<string, unknown> = {
    id: 'T1',
    type: 'table',
    x: 60,
    y: 560,
    width: 640,
    height: 96,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    rows: 2,
    cols: 2,
    cells: [{ text: 'Feature' }, { text: 'Verdict' }, { text: 'Vector text' }, { text: 'Selectable' }],
    colWidths: [320, 320],
    rowHeight: 48,
    borderColor: '#E0E1E6',
    borderWidth: 1.5,
    headerFill: '#1F142E',
    headerTextColor: '#FFFFFF',
    fill: '#FFFFFF',
    textColor: '#1F2226',
    fontSize: 16,
    fontFamily: 'Inter',
  }
  const chart: Record<string, unknown> = {
    id: 'C1',
    type: 'chart',
    x: 720,
    y: 540,
    width: 320,
    height: 220,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    kind: 'bar',
    labels: ['PDF', 'SVG'],
    series: [{ name: 's', color: '#00C4CC', values: [4, 2] }],
    barMode: 'group',
    hole: 0.62,
    smooth: false,
    showGrid: true,
    showValues: false,
    showLegend: false,
    fill: '#FFFFFF',
    textColor: '#3A3F4B',
    fontFamily: 'Inter',
    fontSize: 13,
  }
  const pages = [
    {
      id: 'p1',
      background: { type: 'solid', color: '#ffffff' },
      elements: [
        flatText({ id: 'H1', text: 'Canvix Vector PDF Acceptance' }),
        {
          ...flatText({ id: 'R1', text: 'The quick brown fox jumps over the lazy dog', y: 240, height: 200, bold: false, fontSize: 36 }),
          spans: [
            { text: 'The quick ' },
            { text: 'brown', bold: true, color: '#D97706' },
            { text: ' fox jumps over the ' },
            { text: 'lazy dog', italic: true, underline: true },
          ],
        },
        table,
        chart,
        rect('BG1', 500),
      ],
    },
    {
      id: 'p2',
      background: { type: 'gradient', from: '#0F172A', to: '#1E293B', angle: 90 },
      elements: [
        flatText({ id: 'H2', text: 'Second page ships too', y: 120, fill: '#F8FAFC' }),
        {
          ...flatText({ id: 'R2', text: 'déjà vu — bold accent', y: 260, fontSize: 34, bold: false, fill: '#CBD5E1' }),
          spans: [{ text: 'déjà vu — ' }, { text: 'bold accent', bold: true }],
        },
      ],
    },
  ]
  const res = await request.post(`${BASE}/api/designs`, {
    data: { name: 'r4 vector pdf acceptance', width: 1080, height: 720, pages },
  })
  expect(res.status(), `create design: ${await res.text()}`).toBeLessThan(300)
  return ((await res.json()) as { id: string }).id
}

async function openEditor(page: Page, designId: string): Promise<void> {
  await page.goto(`/design/${designId}`)
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 60_000 })
}

test('text-heavy design exports a vector-text PDF that pdftotext can read back', async ({ page, request }) => {
  test.setTimeout(180_000)

  let pdftotext = true
  try {
    execFileSync('pdftotext', ['-v'])
  } catch {
    pdftotext = false
  }
  test.skip(!pdftotext, 'poppler-utils (pdftotext) not installed on this runner')

  const designId = await createTextDesign(request)
  await openEditor(page, designId)

  await page.getByLabel('Download').click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByText('Download your design')).toBeVisible()
  await dlg.getByRole('button', { name: /^PDF/ }).click()

  // the quality note is honest BEFORE the export starts
  await expect(dlg.getByText(/Vector text with embedded fonts/)).toBeVisible()

  // both pages in one file
  await dlg.getByText('Include all pages').click()

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 150_000 }),
    dlg.getByRole('button', { name: /^Download/ }).click(),
  ])
  const path = (await download.path())!
  expect(download.suggestedFilename()).toMatch(/\.pdf$/)

  const bytes = execFileSync('cat', [path])
  const doc = bytes.toString('latin1')

  // ── structure: PDF 1.4 skeleton, both pages, no raster-only file ──
  expect(doc.startsWith('%PDF-1.4')).toBe(true)
  expect(doc.trimEnd().endsWith('%%EOF')).toBe(true)
  const pageCount = (doc.match(/\/Type \/Page[^s]/g) ?? []).length
  expect(pageCount, 'one PDF page per design page').toBe(2)
  // text operators really ran (not a JPEG-in-PDF)
  expect(doc).toMatch(/BT \/F\d+ [\d.]+ Tf/)

  // ── embedded-font path, when the ladder reached Google ──
  if (doc.includes('/Subtype /Type0')) {
    expect(doc).toContain('/FontFile2')
    expect(doc).toContain('/ToUnicode')
    expect(doc).toContain('/Encoding /Identity-H')
    expect(doc).toMatch(/\[<[0-9a-fA-F]{4}>/)
  }

  // ── THE acceptance: pdftotext reads the exact strings back ──
  const text = execFileSync('pdftotext', [path, '-']).toString()
  for (const needle of [
    'Canvix Vector PDF Acceptance',
    'brown', // bold rich span
    'lazy dog', // italic+underline rich span
    'Vector text', // table body cell
    'Selectable', // table body cell
    'Second page ships too', // page 2
    'déjà vu', // accented latin-1 in the text layer
  ]) {
    expect(text, `pdftotext output must contain ${JSON.stringify(needle)}`).toContain(needle)
  }

  // ── file size sane vs the raster era (a 2-page 1080×720 design
  //    exported as JPEG pages was ~1–2 MB; vector text pages are
  //    tiny unless images dominate — this design has none) ──
  expect(bytes.length, `unexpected ${bytes.length} bytes`).toBeLessThan(1_500_000)
})
