import { test, expect, type Page } from '@playwright/test'

/**
 * v0.14 (D3): even distribution — acceptance.
 *
 *   1. four shapes at uneven gaps (incl. one overlapping pair): a
 *      marquee selection shows the Position popover's Distribute
 *      section (≥ 3 selected); Spacing H equalizes the edge GAPS in
 *      the SAVED document (API truth) with the extremes fixed, the
 *      exact integer positions the pure geometry predicts, and y
 *      untouched
 *   2. Spacing V (same open popover, same selection) mirrors the
 *      geometry vertically — the initial y's overlap, and Canva/Figma
 *      distribute those instead of refusing (the behavior this slice
 *      changed)
 *   3. ONE undo reverts ONLY the V distribution (x's stay spaced,
 *      y's return to their originals) and a second undoes the H —
 *      each distribute is exactly ONE history entry (the old
 *      assistant path spent one undo step PER ELEMENT)
 *   4. two selected → the Distribute section is not offered
 *
 * Race notes (why the flow is ordered this way):
 *   - the marquee waits for the shapes to be PIXEL-rendered first:
 *     "Design canvas" visible ≠ design data loaded — an early drag
 *     selects nothing (observed flake)
 *   - both distributes share ONE selection + ONE open popover, and
 *     the undos need neither: undo's own `pages:replace` broadcast
 *     echoes back over SSE and the receive side clears the selection
 *     (editor-store) — nothing after this point depends on it
 *
 * Register budget: ZERO — anonymous anon-commons designs, fresh
 * browser context per test (the PR #26/#30 lesson: the suite-wide
 * register budget is saturated; this spec must not spend any of it).
 */

interface DistRect {
  id: string
  type: string
  x: number
  y: number
}

function rect(id: string, x: number, y: number, w = 120, h = 90) {
  return {
    id,
    type: 'rect',
    name: `dist ${id}`,
    x,
    y,
    width: w,
    height: h,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    fill: '#00C4CC',
    stroke: 'transparent',
    strokeWidth: 0,
    cornerRadius: 24,
    shadow: { enabled: false, color: '#000000', blur: 0, offsetX: 0, offsetY: 0 },
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

/** the shapes are actually ON the stage (pixel truth — the fill colour
 *  #00C4CC present on the biggest canvas in the workspace; scoped so
 *  toolbar thumbnails never fool it). Guards the design-load race. */
async function waitForShapesRendered(page: Page) {
  await page.waitForFunction(
    () => {
      const scope = document.querySelector('main[aria-label="Design canvas"]')
      const canvases = Array.from((scope ?? document).querySelectorAll('canvas'))
      const biggest = canvases.reduce<HTMLCanvasElement | null>(
        (best, c) => (!best || c.width * c.height > best.width * best.height ? c : best),
        null
      )
      if (!biggest) return false
      try {
        const ctx = biggest.getContext('2d')
        if (!ctx) return false
        const data = ctx.getImageData(0, 0, biggest.width, biggest.height).data
        for (let i = 0; i < data.length; i += 16) {
          if (data[i] === 0x00 && data[i + 1] === 0xc4 && data[i + 2] === 0xcc) return true
        }
        return false
      } catch {
        return false
      }
    },
    undefined,
    { timeout: 30_000, polling: 250 }
  )
}

async function docRectsById(page: Page, designId: string): Promise<Map<string, DistRect>> {
  const res = await page.request.get(`/api/designs/${designId}`)
  expect(res.status()).toBe(200)
  const doc = (await res.json()) as { pages: { elements: DistRect[] }[] }
  return new Map(doc.pages[0].elements.filter((e) => e.type === 'rect').map((r) => [r.id, r]))
}

/** poll the saved document until pred holds (observed end state — the
 *  PR #23 lesson: never sleep a fixed time and hope) */
async function waitForRects(
  page: Page,
  designId: string,
  pred: (m: Map<string, DistRect>) => boolean,
  what: string
): Promise<Map<string, DistRect>> {
  const start = Date.now()
  for (;;) {
    const m = await docRectsById(page, designId)
    if (pred(m)) return m
    if (Date.now() - start > 45_000) {
      throw new Error(`distribute: ${what} — document never reached the expected state (got ${[...m.values()].map((r) => `${r.id}@${r.x},${r.y}`).join(' ')})`)
    }
    await page.waitForTimeout(600)
  }
}

/** edge gaps along an axis (rects are all 120×90 in this spec) */
function gapsOf(ids: string[], m: Map<string, DistRect>, axis: 'x' | 'y', size: number): number[] {
  const sorted = ids.map((id) => m.get(id)![axis]).sort((a, b) => a - b)
  const out: number[] = []
  for (let i = 1; i < sorted.length; i++) out.push(sorted[i] - (sorted[i - 1] + size))
  return out
}

async function marqueeSelectAll(page: Page) {
  // elements live in the page's middle band (x 240..960, y 280..470),
  // so a drag from the empty area above-left of the band to below-
  // right of it intersects all four (marquee hits are intersections;
  // the page bar / zoom controls hug the bottom corners and stay
  // clear of the end point)
  const box = (await page.getByLabel('Design canvas').boundingBox())!
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.18)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.95, box.y + box.height * 0.83, { steps: 8 })
  await page.mouse.up()
}

async function openPosition(page: Page) {
  await page.getByRole('button', { name: 'Position', exact: true }).click()
  await expect(page.getByText('Align to page')).toBeVisible()
}

test.describe('Even distribute (v0.14 D3)', () => {
  test.setTimeout(150_000)

  test('marquee 4 shapes → Spacing H → Spacing V → each undoes in ONE step', async ({ page }) => {
    // x gaps: 40, −60 (b/c overlap), 260 → distribute → 80, 80, 80
    // y gaps (sorted c,a,d,b): −80, −50, −50 → distribute → −57, −56, −57
    const design = await createDesign(page, `cvx_d3_${Date.now().toString(36)}`, [
      rect('dist_a', 240, 300),
      rect('dist_b', 400, 380),
      rect('dist_c', 460, 280),
      rect('dist_d', 840, 340),
    ])
    await openEditor(page, design)
    await waitForShapesRendered(page)

    const ids = ['dist_a', 'dist_b', 'dist_c', 'dist_d']

    await marqueeSelectAll(page)
    await openPosition(page)

    // the Distribute section exists for a 4-selection
    await expect(page.getByRole('button', { name: 'Spacing H', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Spacing V', exact: true })).toBeVisible()

    // ── Spacing H: equal gaps, extremes fixed, y untouched ──
    await page.getByRole('button', { name: 'Spacing H', exact: true }).click()

    const afterH = await waitForRects(
      page,
      design,
      (m) => m.get('dist_a')!.x === 240 && m.get('dist_b')!.x === 440 && m.get('dist_c')!.x === 640 && m.get('dist_d')!.x === 840,
      'Spacing H positions'
    )
    // the pure geometry's exact integer prediction
    expect(afterH.get('dist_a')!.x).toBe(240) // first stays
    expect(afterH.get('dist_b')!.x).toBe(440)
    expect(afterH.get('dist_c')!.x).toBe(640)
    expect(afterH.get('dist_d')!.x).toBe(840) // last stays
    expect(gapsOf(ids, afterH, 'x', 120)).toEqual([80, 80, 80])
    // the other axis is passed through untouched
    expect(afterH.get('dist_a')!.y).toBe(300)
    expect(afterH.get('dist_b')!.y).toBe(380)
    expect(afterH.get('dist_c')!.y).toBe(280)
    expect(afterH.get('dist_d')!.y).toBe(340)

    // ── Spacing V: same selection, same open popover ──
    await page.getByRole('button', { name: 'Spacing V', exact: true }).click()
    const afterV = await waitForRects(
      page,
      design,
      (m) => m.get('dist_a')!.y === 313 && m.get('dist_b')!.y === 380 && m.get('dist_c')!.y === 280 && m.get('dist_d')!.y === 347,
      'Spacing V positions'
    )
    expect(afterV.get('dist_c')!.y).toBe(280) // topmost stays
    expect(afterV.get('dist_b')!.y).toBe(380) // bottom-most stays
    expect(afterV.get('dist_a')!.y).toBe(313)
    expect(afterV.get('dist_d')!.y).toBe(347)
    // the overlapping input was distributed (even negative gaps), not refused
    const gv = gapsOf(ids, afterV, 'y', 90)
    expect(Math.abs(gv[0] - gv[1])).toBeLessThanOrEqual(1)
    expect(Math.abs(gv[1] - gv[2])).toBeLessThanOrEqual(1)
    // and the x's keep their distributed values
    expect(afterV.get('dist_a')!.x).toBe(240)
    expect(afterV.get('dist_b')!.x).toBe(440)
    expect(afterV.get('dist_c')!.x).toBe(640)
    expect(afterV.get('dist_d')!.x).toBe(840)

    // ── ONE undo reverts ONLY the V distribution ──
    // (undo broadcasts pages:replace, whose SSE echo clears the
    // selection — nothing below depends on it)
    await page.keyboard.press('Control+z')
    const afterUndoV = await waitForRects(
      page,
      design,
      (m) => m.get('dist_a')!.y === 300 && m.get('dist_b')!.y === 380 && m.get('dist_c')!.y === 280 && m.get('dist_d')!.y === 340,
      'first undo reverts only Spacing V'
    )
    // x's still distributed from Spacing H…
    expect(afterUndoV.get('dist_b')!.x).toBe(440)
    expect(afterUndoV.get('dist_c')!.x).toBe(640)
    // …y's back to the originals
    expect(afterUndoV.get('dist_a')!.y).toBe(300)
    expect(afterUndoV.get('dist_d')!.y).toBe(340)

    // ── a second undo reverts the H distribution ──
    await page.keyboard.press('Control+z')
    const afterUndoH = await waitForRects(
      page,
      design,
      (m) => m.get('dist_b')!.x === 400 && m.get('dist_c')!.x === 460,
      'second undo reverts Spacing H'
    )
    expect(afterUndoH.get('dist_a')!.x).toBe(240)
    expect(afterUndoH.get('dist_d')!.x).toBe(840)
    expect(afterUndoH.get('dist_b')!.x).toBe(400)
    expect(afterUndoH.get('dist_c')!.x).toBe(460)
  })

  test('two selected → no Distribute section offered', async ({ page }) => {
    const design = await createDesign(page, `cvx_d3_pair_${Date.now().toString(36)}`, [
      rect('pair_a', 300, 300),
      rect('pair_b', 600, 400),
    ])
    await openEditor(page, design)
    await waitForShapesRendered(page)

    await marqueeSelectAll(page)
    await openPosition(page)

    // the align grid is there for any multi-selection…
    await expect(page.getByText('Align to page')).toBeVisible()
    // …but distribute needs ≥ 3 — nothing to space evenly with two
    await expect(page.getByRole('button', { name: 'Spacing H', exact: true })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Spacing V', exact: true })).toBeHidden()
    await expect(page.getByText('Distribute')).toBeHidden()
  })
})
