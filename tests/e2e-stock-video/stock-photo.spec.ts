import { expect, test } from '@playwright/test'

/**
 * v0.16.4 A4 — stock-photo ACCEPTANCE, provider keyed (mock Pexels).
 *
 * This suite runs under playwright.stockvideo.config.ts: the dev
 * server carries PEXELS_API_KEY + PEXELS_API_BASE pointing at the
 * local mock provider (tests/stock-video/mock-provider.mjs — the
 * same mock serves the photo half since A4), so the whole path
 * runs for real:
 *
 *   1. availability flips true — ONE key now activates BOTH rails
 *      (photo + video) — and names only the connector, never the key
 *   2. typing searches the provider (auth header enforced by the
 *      mock — the key path is part of the contract)
 *   3. clicking a tile downloads the rendition in the browser
 *      (CORS *), uploads it through the chunked media store, probes
 *      the real dimensions, and adds the element
 *   4. ATTRIBUTION IS DURABLE: selecting the element shows the
 *      credit chip in the properties bar (the toast also fires, but
 *      toasts auto-dismiss — assert the OBSERVED end state, the P5
 *      lesson)
 *   5. no console/page errors anywhere in the path
 */
test.describe('stock photo search + insert + durable attribution (mock provider)', () => {
  test('Photos panel → search → add → credit chip on the element', async ({ page, request }) => {
    test.setTimeout(240_000)
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))

    // 1. availability answers true, names the connector, leaks no key
    const avail = await request.get('/api/stock-photo/available')
    expect(avail.status()).toBe(200)
    const availBody = (await avail.json()) as { available: boolean; providers: string[] }
    expect(availBody).toEqual({ available: true, providers: ['pexels'] })
    expect(JSON.stringify(availBody)).not.toContain('ci-stock-video-key')

    await page.goto('/')
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
    await page.getByRole('button', { name: /start designing/i }).first().click()
    await expect(page.getByLabel('Create a design')).toBeVisible()

    await page
      .locator('section:has(h2:text("Start a new design")) [aria-label^="Create "]')
      .first()
      .click()
    await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })

    // 2. open the Photos panel (always visible — bundled library)
    await page.getByRole('button', { name: 'Photos', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Photos', exact: true })).toBeVisible()

    // 3. search (600 ms debounce) → the mock's tile renders with its
    //    preview + provider chip
    await page.getByLabel('Photos search').fill('coffee')
    const tile = page.locator('button[aria-label="Add stock photo by Mock Photographer"]')
    await expect(tile).toBeVisible({ timeout: 20_000 })
    await expect(tile.getByText('Pexels', { exact: true })).toBeVisible()

    // 4. insert → download + upload + dims probe + element. The OBSERVED
    //    completion signal is the tile re-enabling (busyTile clears in
    //    the finally) — generous timeout: the first upload pays the
    //    dev server's cold-route compilation
    await tile.click()
    await expect(tile.getByText('Adding…')).toBeVisible()
    await expect(tile).toBeEnabled({ timeout: 90_000 })

    // 5. the element sits page-center (the placement cascade); select
    //    it and read the durable credit from the properties bar
    const canvas = page.getByLabel('Design canvas')
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    await canvas.click({ position: { x: Math.round(box!.width / 2), y: Math.round(box!.height / 2) } })

    await expect(page.getByLabel('Stock photo by Mock Photographer on Pexels')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByLabel('Stock photo by Mock Photographer on Pexels')).toContainText('Pexels · Mock Photographer')

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
  })

  test('the search route answers the normalized, credited result set', async ({ request }) => {
    // a WRONG key would 401 at the mock; the route maps provider
    // failures to a sanitized 502. The suite's key is correct, so
    // instead prove the search route works end-to-end here and the
    // 401 path stays covered by the unit suite (route.test.ts).
    const res = await request.post('/api/stock-photo/search', { data: { query: 'coffee' } })
    expect(res.status()).toBe(200)
    const body = (await res.json()) as {
      count: number
      results: { id: string; download: string; credit: { author: string; license: string } }[]
    }
    expect(body.count).toBe(1)
    expect(body.results[0].id).toBe('pexels-77007')
    // large2x is the primary rendition (the ladder's design-tool sweet spot)
    expect(body.results[0].download).toContain('/stock-photo.jpg')
    expect(body.results[0].credit.author).toBe('Mock Photographer')
    expect(body.results[0].credit.license).toBe('Pexels License')
  })
})
