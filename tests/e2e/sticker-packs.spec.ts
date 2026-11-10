import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import sharp from 'sharp'

/**
 * v0.22 sticker packs — acceptance.
 *
 * The library that replaced the 40-emoji starter set must be real in
 * the product, not just in the data module:
 *
 *   1. the Stickers app (Apps panel) lists the pack chips, search
 *      narrows them, and the emoji quick set survives at the bottom
 *   2. clicking a vector sticker inserts a NATIVE sticker element —
 *      the document gains svg + stickerId + alt (the render paths:
 *      canvas Konva.Image, video buildKonvaNode, SVG nest, PDF raster
 *      strip, PPTX raster fallback)
 *   3. THE PIXEL PROOF: a page whose only element is a red-heart
 *      sticker exports a PNG with saturated red pixels INSIDE the
 *      sticker's box and a white page around it — the SVG actually
 *      rasterized, not a placeholder or a blank
 *   4. the Elements-panel sticker tab carries the teaser row and the
 *      launcher into the full app
 *
 * Register budget: ZERO — one anonymous design, API-created.
 */

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'

// the exact markup from src/lib/stickers/hearts.ts is imported at
// runtime? No — e2e runs from the shipped bundle. We pin the id and
// assert presence generically (svg/stickerId/alt), never the markup.

async function createDesign(
  request: APIRequestContext,
  elements: unknown[],
  name = 'v022 sticker acceptance',
): Promise<string> {
  const res = await request.post(`${BASE}/api/designs`, {
    data: { name, width: 1080, height: 720, pages: [{ id: 'p1', background: { type: 'solid', color: '#FFFFFF' }, elements }] },
  })
  expect(res.status(), `create design: ${await res.text()}`).toBeLessThan(300)
  return ((await res.json()) as { id: string }).id
}

async function openEditor(page: Page, designId: string): Promise<void> {
  await page.goto(`/design/${designId}`)
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 60_000 })
}

async function doc(page: Page, designId: string) {
  const res = await page.request.get(`${BASE}/api/designs/${designId}`)
  expect(res.status()).toBe(200)
  return (await res.json()) as { pages: { elements: Record<string, any>[] }[] }
}

/** poll until the autosync lands the predicate (wave4 pattern) */
async function waitForDoc(
  page: Page,
  designId: string,
  predicate: (d: Awaited<ReturnType<typeof doc>>) => boolean,
  what: string,
  timeoutMs = 20_000,
) {
  const started = Date.now()
  let last: Awaited<ReturnType<typeof doc>> | null = null
  while (Date.now() - started < timeoutMs) {
    last = await doc(page, designId)
    if (predicate(last)) return last
    await page.waitForTimeout(500)
  }
  throw new Error(`document never showed ${what} — last: ${JSON.stringify(last?.pages[0])?.slice(0, 300)}`)
}

test('the Stickers app: pack chips, search, emoji set, vector insert', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(String(err)))

  const designId = await createDesign(page.request, [])
  await openEditor(page, designId)

  // open the Apps panel → Stickers app (the wave4 openApp pattern)
  await page.getByRole('button', { name: 'Apps', exact: true }).click()
  await page.getByText('Stickers', { exact: true }).first().click()
  await expect(page.getByPlaceholder('Search 160+ stickers')).toBeVisible({ timeout: 20_000 })

  // 1. the pack chips: the vector packs + the emoji quick set
  for (const chip of ['All', 'Faces', 'Hearts', 'Celebrate', 'Food', 'Emoji']) {
    await expect(page.getByRole('button', { name: new RegExp(chip), exact: false }).first()).toBeVisible()
  }

  // 2. search narrows to the coffee sticker; clicking it inserts
  await page.getByPlaceholder('Search 160+ stickers').fill('coffee')
  const coffeeTile = page.getByTestId('sticker-food-coffee')
  await expect(coffeeTile).toBeVisible({ timeout: 10_000 })
  await coffeeTile.click()

  const d = await waitForDoc(
    page,
    designId,
    (x) => x.pages[0].elements.filter((e) => e.type === 'sticker').length === 1,
    'the coffee sticker',
  )
  const stickers = d.pages[0].elements.filter((e) => e.type === 'sticker')
  expect(stickers[0].stickerId).toBe('food-coffee')
  expect(typeof stickers[0].svg).toBe('string')
  expect(stickers[0].svg).toContain('<svg')
  expect(stickers[0].alt).toBe('Coffee cup')

  // 3. clear search → the emoji quick set renders at the bottom
  await page.getByPlaceholder('Search 160+ stickers').fill('')
  await expect(page.getByLabel('Add sticker 😀').first()).toBeVisible({ timeout: 10_000 })

  // 4. an emoji click still inserts the text-sticker path
  await page.getByLabel('Add sticker 😀').first().click()
  const d2 = await waitForDoc(
    page,
    designId,
    (x) => x.pages[0].elements.filter((e) => e.type === 'sticker').length === 2,
    'the emoji sticker',
  )
  const stickers2 = d2.pages[0].elements.filter((e) => e.type === 'sticker')
  const emojiOne = stickers2.find((s) => s.char === '😀')
  expect(emojiOne, 'emoji sticker present').toBeTruthy()
  expect(emojiOne!.svg, 'emoji stays on the text path (no svg)').toBeUndefined()

  expect(errors, 'no page errors').toHaveLength(0)
})

test('pixel proof: a vector sticker really rasterizes into the PNG export', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(String(err)))

  // the ONLY element is a big red heart sticker dead-center
  const designId = await createDesign(
    page.request,
    [
      {
        id: 'st1',
        type: 'sticker',
        x: 340,
        y: 160,
        width: 400,
        height: 400,
        rotation: 0,
        opacity: 1,
        locked: false,
        visible: true,
        char: 'Red heart',
        fontSize: 300,
        stickerId: 'hearts-red',
        alt: 'Red heart',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><path d="M60 100 C 30 80 14 60 14 42 C 14 26 26 16 40 16 C 50 16 57 22 60 30 C 63 22 70 16 80 16 C 94 16 106 26 106 42 C 106 60 90 80 60 100 Z" fill="#FF6B6B" stroke="#2D2A32" stroke-width="3.5" stroke-linejoin="round"/></svg>',
      },
    ],
    'v022 sticker pixel proof',
  )
  await openEditor(page, designId)

  // export PNG through the canonical dialog selectors
  const downloadPromise = page.waitForEvent('download', { timeout: 120_000 })
  await page.getByRole('button', { name: 'Download', exact: true }).click()
  await page.getByRole('button', { name: /^PNG\b/ }).click()
  await page.getByRole('button', { name: /Download 1 PNG/i }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.png$/)

  // the pixel proof: saturated red INSIDE the sticker box, white page outside
  const png = sharp(await (await download.path())!)
  const { data, info } = await png.raw().toBuffer({ resolveWithObject: true })
  const px = (x: number, y: number) => {
    const i = (y * info.width + x) * info.channels
    return [data[i], data[i + 1], data[i + 2]]
  }
  // export scale: page 1080 wide → PNG info.width; sticker box maps proportionally
  const sx = info.width / 1080
  const cx = Math.round(540 * sx) // sticker centre
  const cy = Math.round(280 * sx) // upper heart lobe
  const [r, g, b] = px(cx, cy)
  expect(r, `heart centre is red, got rgb(${r},${g},${b}) at ${info.width}px wide`).toBeGreaterThan(180)
  expect(g).toBeLessThan(140)
  expect(b).toBeLessThan(140)

  // white margin (outside the sticker box, left edge)
  const [mr, mg, mb] = px(Math.round(60 * sx), Math.round(360 * sx))
  expect(mr + mg + mb, 'page margin stays white').toBeGreaterThan(720)

  expect(errors, 'no page errors').toHaveLength(0)
})

test('the Elements sticker tab carries the pack teaser + launcher', async ({ page }) => {
  test.setTimeout(120_000)
  const designId = await createDesign(page.request, [], 'v022 elements tab teaser')
  await openEditor(page, designId)

  await page.getByRole('button', { name: 'Elements', exact: true }).click()
  await page.getByRole('tab', { name: 'Stickers', exact: true }).click()

  // the launcher names the full library
  await expect(page.getByText(/Browse all \d+ stickers in apps/i)).toBeVisible({ timeout: 10_000 })

  // a featured vector sticker tile inserts a real pack sticker
  const first = page.locator('button[aria-label^="Add sticker"]').first()
  await first.click()
  await waitForDoc(
    page,
    designId,
    (x) => x.pages[0].elements.some((e) => e.type === 'sticker' && typeof e.svg === 'string'),
    'a featured pack sticker',
  )
})
