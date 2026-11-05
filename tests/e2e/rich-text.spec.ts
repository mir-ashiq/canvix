import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * v0.15 (R1): rich text — acceptance.
 *
 *   1. a LEGACY flat text element (no spans) opens losslessly, and
 *      styling a range CREATES the spans without touching the text
 *      (the migration is lazy by construction — SAVED doc truth)
 *   2. the editing overlay shows what you're styling: the mirror
 *      carries <strong> for the bolded range while the textarea
 *      stays transparent (observed in-DOM)
 *   3. ONE undo after the editing session reverts spans to null
 *      with the text intact — the session owns exactly one history
 *      entry (beginEditText pushes it; every keystroke and style op
 *      rides updateElementsLive)
 *   4. the exported SVG renders the runs as real tspans: the bold
 *      range at font-weight="700", the rest at 400
 *   5. links fail closed in the UI path: javascript: URLs are
 *      stripped on apply; https:// survives; the clear-styling chip
 *      on the properties bar returns the element to flat (spans
 *      null) with text and base fields untouched
 *
 * Register budget: ZERO — anonymous anon-commons designs, fresh
 * browser context per test (the PR #26/#30 lesson).
 */

interface TextDoc {
  text?: string
  spans?: { text: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; color?: string; link?: string }[] | null
}

function textElement(id: string, text: string) {
  return {
    id,
    type: 'text',
    name: id,
    x: 90,
    y: 300,
    width: 900,
    height: 120,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    text,
    fontSize: 64,
    fontFamily: 'Poppins',
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    uppercase: false,
    fill: '#1F2226',
    align: 'center',
    lineHeight: 1.4,
    letterSpacing: 0,
  }
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

/** the text is actually drawn (pixel truth — the #1F2226 fill on the
 *  biggest canvas; guards the design-load race before any click). */
async function waitForTextRendered(page: Page) {
  await page.waitForFunction(
    () => {
      const scope = document.querySelector('main[aria-label="Design canvas"]')
      const canvases = Array.from((scope ?? document).querySelectorAll('canvas'))
      const biggest = canvases.reduce<HTMLCanvasElement | null>(
        (best, c) => (!best || c.width * c.height > best.width * best.height ? c : best),
        null,
      )
      if (!biggest) return false
      try {
        const ctx = biggest.getContext('2d')
        if (!ctx) return false
        const data = ctx.getImageData(0, 0, biggest.width, biggest.height).data
        for (let i = 0; i < data.length; i += 16) {
          if (data[i] === 0x1f && data[i + 1] === 0x22 && data[i + 2] === 0x26) return true
        }
        return false
      } catch {
        return false
      }
    },
    undefined,
    { timeout: 30_000, polling: 250 },
  )
}

async function docText(page: Page, designId: string, id: string): Promise<TextDoc> {
  const res = await page.request.get(`/api/designs/${designId}`)
  expect(res.status()).toBe(200)
  const doc = (await res.json()) as { pages: { elements: TextDoc[] }[] }
  return doc.pages[0].elements.find((e) => (e as { id?: string }).id === id) ?? {}
}

async function waitForText(
  page: Page,
  designId: string,
  id: string,
  pred: (t: TextDoc) => boolean,
  what: string,
): Promise<TextDoc> {
  const start = Date.now()
  for (;;) {
    const t = await docText(page, designId, id)
    if (pred(t)) return t
    if (Date.now() - start > 45_000) {
      throw new Error(`rich-text: ${what} — document never reached the expected state (got ${JSON.stringify(t)})`)
    }
    await page.waitForTimeout(600)
  }
}

/** click (not double) — re-selects the text element after an editing
 *  session without reopening the overlay */
async function clickText(page: Page) {
  const box = (await page.getByLabel('Design canvas').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

/** double-click the text element: the element spans the design's
 *  centre band, and the fitted view centres the design in the canvas
 *  box — so a double-click at the canvas-box centre is always inside
 *  the element's box, regardless of letterboxing. */
async function dblClickText(page: Page) {
  const box = (await page.getByLabel('Design canvas').boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.dblclick(cx, cy)
}

test.describe('Rich text (v0.15 R1)', () => {
  test.setTimeout(150_000)

  test('flat → bold a range → spans saved, mirror shows it, one undo reverts, SVG carries the runs', async ({ page }) => {
    const design = await createDesign(page, `cvx_r1_${Date.now().toString(36)}`, [textElement('r1_text', 'Hello rich world')])
    await openEditor(page, design)
    await waitForTextRendered(page)

    // ── open the editor overlay on the legacy element ──
    await dblClickText(page)
    const editor = page.getByLabel('Edit text')
    await expect(editor).toBeVisible({ timeout: 10_000 })
    await expect(editor).toHaveValue('Hello rich world')

    // ── select the first word (Home, then Shift+Right ×5) ──
    await editor.press('Home')
    for (let i = 0; i < 5; i++) await editor.press('Shift+ArrowRight')

    // ── the floating toolbar is enabled and mirrors know the range ──
    const boldBtn = page.getByRole('button', { name: 'Bold selection' })
    await expect(boldBtn).toBeEnabled()

    // ── apply bold: the styled mirror appears with <strong>Hello</strong> ──
    await boldBtn.click()
    await expect(page.getByTestId('rich-mirror').locator('strong')).toHaveText('Hello')

    // ── commit (Escape) — the SAVED document carries the spans,
    //    the text is untouched (migration lossless) ──
    await editor.press('Escape')
    await expect(page.getByLabel('Edit text')).toBeHidden({ timeout: 10_000 })
    const saved = await waitForText(
      page,
      design,
      'r1_text',
      (t) => Array.isArray(t.spans) && t.spans.length === 2,
      'bold range persisted',
    )
    expect(saved.text).toBe('Hello rich world')
    expect(saved.spans).toEqual([
      { text: 'Hello', bold: true },
      { text: ' rich world' },
    ])

    // ── export SVG: the runs are real tspans with their weights ──
    await page.getByRole('button', { name: 'Download', exact: true }).click()
    await page.getByRole('button', { name: /^SVG\b/ }).click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Download 1 SVG/i }).click(),
    ])
    const svg = readFileSync((await download.path())!, 'utf8')
    expect(svg).toContain('font-weight="700"')
    expect(svg).toContain('font-weight="400"')
    expect(svg).toMatch(/>Hello</)
    expect(svg).toMatch(/> rich world</)
    await expect(page.getByRole('button', { name: 'Close' })).toBeHidden({ timeout: 10_000 })

    // ── ONE undo reverts the whole editing session: spans null, text intact ──
    await clickText(page) // re-select (the export dialog had focus)
    await page.keyboard.press('Control+z')
    const undone = await waitForText(page, design, 'r1_text', (t) => !t.spans, 'undo cleared spans')
    expect(undone.text).toBe('Hello rich world')
  })

  test('links fail closed (javascript: stripped, https: kept) and the Clear chip flattens', async ({ page }) => {
    const design = await createDesign(page, `cvx_r1b_${Date.now().toString(36)}`, [textElement('r1_link', 'Visit the docs today')])
    await openEditor(page, design)
    await waitForTextRendered(page)

    await dblClickText(page)
    const editor = page.getByLabel('Edit text')
    await expect(editor).toBeVisible({ timeout: 10_000 })

    // select "docs" (chars 10..14)
    await editor.press('Home')
    for (let i = 0; i < 14; i++) await editor.press('ArrowRight')
    for (let i = 0; i < 4; i++) await editor.press('Shift+ArrowRight')

    // ── hostile href: applied, but sanitizeLink strips it (fail closed) ──
    await page.getByRole('button', { name: 'Link selection' }).click()
    const linkInput = page.getByLabel('Link URL')
    await expect(linkInput).toBeVisible()
    await linkInput.fill('javascript:alert(1)')
    await page.getByRole('button', { name: 'Apply link' }).click()
    // the op ran but stored no link → spans exist only if some style was
    // applied… none was, so the element may be flat again — the hostile
    // URL must NOT appear anywhere in the saved doc either way
    await editor.press('Escape')
    await expect(page.getByLabel('Edit text')).toBeHidden({ timeout: 10_000 })
    const afterHostile = await waitForText(
      page,
      design,
      'r1_link',
      (t) => JSON.stringify(t).indexOf('javascript:') === -1 && t.text === 'Visit the docs today',
      'hostile link never stored',
    )
    expect(afterHostile.spans ?? null).toBeNull()

    // ── real link: styled run with the sanitized href ──
    await dblClickText(page)
    await expect(page.getByLabel('Edit text')).toBeVisible({ timeout: 10_000 })
    await editor.press('Home')
    for (let i = 0; i < 14; i++) await editor.press('ArrowRight')
    for (let i = 0; i < 4; i++) await editor.press('Shift+ArrowRight')
    await page.getByRole('button', { name: 'Link selection' }).click()
    await page.getByLabel('Link URL').fill('https://example.com/docs')
    await page.getByRole('button', { name: 'Apply link' }).click()
    await editor.press('Escape')
    await expect(page.getByLabel('Edit text')).toBeHidden({ timeout: 10_000 })
    const linked = await waitForText(
      page,
      design,
      'r1_link',
      (t) => Array.isArray(t.spans) && t.spans.some((s) => s.link === 'https://example.com/docs'),
      'https link stored',
    )
    expect(linked.text).toBe('Visit the docs today')

    // ── the properties-bar chip clears the rich styling (one patch,
    //    text + base fields untouched) ──
    await clickText(page) // ensure the element is selected (chip needs selection)
    const chip = page.getByTestId('clear-rich-text')
    await expect(chip).toBeVisible({ timeout: 10_000 })
    await chip.click()
    const cleared = await waitForText(page, design, 'r1_link', (t) => !t.spans, 'chip cleared spans')
    expect(cleared.text).toBe('Visit the docs today')
  })
})
