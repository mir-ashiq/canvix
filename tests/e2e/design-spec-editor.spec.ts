import { test, expect, type Page } from '@playwright/test'
import { extractBrief } from '@/lib/agent/brief'
import { specFromBrief } from '@/lib/design-spec/from-brief'
import { compileSpec } from '@/lib/design-engine/compile'

/**
 * v0.29.5+ (DesignSpec Phase A): the compiled design in the REAL
 * product — create → open in the editor → edit a text through the UI
 * → autosave → reload → everything the exact-text contract promised
 * is still there, character-for-character.
 *
 *   1. the canonical poster brief compiles with ALL checks green
 *      (exact texts, required colors, wrap-aware fit, contrast) —
 *      asserted here, in the same process that will drive the browser
 *   2. the compiled pages are created as a REAL design through
 *      /api/designs (the app's own persistence path — Postgres)
 *   3. the real editor opens it and renders the Konva canvas
 *   4. double-clicking the canvas opens the text overlay carrying
 *      one of the required lines verbatim
 *   5. editing it, waiting out the debounced autosave, then
 *      reloading: the edit persisted AND the untouched required
 *      lines are intact character-for-character
 *
 * Register budget: ZERO — anonymous, like the charts spec.
 */

const PROOF_BRIEF = [
  'Create a poster for a harvest festival.',
  'The poster must show these exact lines:',
  '"Kashmir Apple Harvest Festival 2026",',
  '"Oct 18 · Dachigam Grounds · Srinagar",',
  '"Entry Free — 10 AM to 6 PM".',
  'Use the colors #1B5E20 and #F9A825 somewhere.',
  'Size 1080x1350. Warm autumn feel, bold and inviting.',
].join(' ')

const REQUIRED = [
  'Kashmir Apple Harvest Festival 2026',
  'Oct 18 · Dachigam Grounds · Srinagar',
  'Entry Free — 10 AM to 6 PM',
]

async function createDesign(page: Page, name: string, elements: unknown[], width: number, height: number): Promise<string> {
  const res = await page.request.post('/api/designs', {
    data: { name, width, height, pages: [{ id: 'p1', background: { type: 'solid', color: '#FFFFFF' }, elements }] },
  })
  expect(res.status(), `create design: ${await res.text()}`).toBeLessThan(300)
  return ((await res.json()) as { id: string }).id
}

async function openEditor(page: Page, designId: string) {
  await page.goto(`/design/${designId}`)
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 60_000 })
}

async function docTexts(page: Page, designId: string): Promise<string[]> {
  const res = await page.request.get(`/api/designs/${designId}`)
  expect(res.status()).toBe(200)
  const doc = (await res.json()) as { pages: { elements: { type: string; text?: string }[] }[] }
  return doc.pages[0].elements.filter((e) => e.type === 'text' && typeof e.text === 'string').map((e) => e.text as string)
}

test.describe('DesignSpec compiled poster in the real editor', () => {
  test.setTimeout(150_000)

  test('compile → create → open → edit through the UI → autosave → reload: contract intact', async ({ page }) => {
    // ── 1. compile in-process: all checks must pass ──
    const spec = specFromBrief(extractBrief(PROOF_BRIEF))
    const result = compileSpec(spec)
    expect(result.checks.passed, result.checks.failures.join('; ')).toBe(true)
    for (const t of result.checks.exactTexts) expect(t.found, t.text).toBe(true)
    for (const c of result.checks.colors) expect(c.found, c.hex).toBe(true)
    expect(result.checks.textFits).toBe(true)

    // ── 2. real design through the app's own API ──
    const designId = await createDesign(
      page,
      `cvx_designspec_${Date.now().toString(36)}`,
      JSON.parse(JSON.stringify(result.pages[0].elements)),
      spec.format.width,
      spec.format.height,
    )
    const before = await docTexts(page, designId)
    for (const r of REQUIRED) expect(before).toContain(r) // compiled texts landed intact

    // ── 3. the real editor renders it ──
    await openEditor(page, designId)
    await page.screenshot({ path: 'test-results/designspec/editor-loaded.png' })

    // ── 4. open the text overlay on the SUBLINE element — zoom-exact
    // mapping from the compiled element geometry (the fitted view
    // centres the design in the canvas box; the zoom label carries
    // the live scale, so the double-click lands inside the element
    // regardless of letterboxing) ──
    const elements = result.pages[0].elements as unknown as { type: string; text?: string; x: number; y: number; width: number; height: number }[]
    const subline = elements.find((e) => e.type === 'text' && e.text === 'Oct 18 · Dachigam Grounds · Srinagar')
    expect(subline).toBeTruthy()
    const zoomPct = Number.parseInt((await page.getByLabel('Zoom options').textContent()) ?? '0', 10)
    expect(zoomPct, 'live zoom label readable').toBeGreaterThan(0)
    const zoom = zoomPct / 100
    const box = (await page.getByLabel('Design canvas').boundingBox())!
    const dx = subline!.x + subline!.width / 2 - spec.format.width / 2
    const dy = subline!.y + subline!.height / 2 - spec.format.height / 2
    await page.mouse.dblclick(box.x + box.width / 2 + dx * zoom, box.y + box.height / 2 + dy * zoom)
    const editor = page.getByLabel('Edit text')
    await expect(editor).toBeVisible({ timeout: 10_000 })
    const original = await editor.inputValue()
    expect(REQUIRED).toContain(original) // the overlay carries a required line verbatim
    await page.screenshot({ path: 'test-results/designspec/editor-editing.png' })

    // ── 5. edit it, commit with Escape, let the debounced autosave land ──
    const edited = `${original} — edited live`
    await editor.fill(edited)
    await editor.press('Escape') // commit — the documented overlay close
    await expect(editor).toBeHidden({ timeout: 10_000 })
    await expect
      .poll(async () => (await docTexts(page, designId)).join('\u0001'), { timeout: 20_000 })
      .toContain(edited)

    // untouched required lines survive the roundtrip character-for-character
    const after = await docTexts(page, designId)
    for (const r of REQUIRED) {
      if (r === original) continue
      expect(after).toContain(r)
    }

    // ── 6. reload: the edit persisted in the real product ──
    await openEditor(page, designId)
    await page.screenshot({ path: 'test-results/designspec/editor-reloaded.png' })
    const persisted = await docTexts(page, designId)
    expect(persisted).toContain(edited)
    for (const r of REQUIRED) {
      if (r === original) continue
      expect(persisted).toContain(r)
    }
  })
})
