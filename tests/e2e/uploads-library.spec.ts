import { test, expect, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * v0.14 (D1): the persistent uploads library — acceptance.
 *
 *   1. an uploaded image lands in the media store (not the document),
 *      is visible in the Uploads panel, and SURVIVES a reload
 *   2. the same library item inserts into a SECOND design
 *   3. the exported SVG inlines media-store images (portable file)
 *   4. removing an item from the library never breaks designs that
 *      still reference it (the row survives; the GC owns reaping)
 *   5. an anonymous upload is claimed into the account on register —
 *      the library follows the account (D1 acceptance criterion)
 */

// a real 8×8 PNG (base64 of a valid 95-byte file)
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVR4nGP8z8Dwn4EIwESMolGFI0chAG+bAR7/Og14AAAAAElFTkSuQmCC'

function pngFixture(): string {
  const p = join(tmpdir(), `canvix-d1-${Date.now()}.png`)
  writeFileSync(p, Buffer.from(PNG_B64, 'base64'))
  return p
}

async function register(page: Page, tag: string): Promise<string> {
  const username = `d1_${tag}_${Date.now().toString(36)}`
  const res = await page.request.post('/api/auth/register', {
    data: { username, password: `D1-E2e-${username}-17!q` },
  })
  expect(res.status(), `register ${username}`).toBeLessThan(300)
  return username
}

async function createBlankDesign(page: Page, name: string): Promise<string> {
  const res = await page.request.post('/api/designs', {
    data: { name, width: 1080, height: 720, pages: [{ id: 'p1', background: { type: 'solid', color: '#FFFFFF' }, elements: [] }] },
  })
  expect(res.status(), `create design: ${await res.text()}`).toBeLessThan(300)
  return ((await res.json()) as { id: string }).id
}

async function openEditor(page: Page, designId: string) {
  await page.goto(`/design/${designId}`)
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 60_000 })
}

async function openUploadsPanel(page: Page) {
  await page.getByRole('button', { name: 'Uploads', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Uploads', exact: true })).toBeVisible()
}

async function designDoc(page: Page, id: string) {
  const res = await page.request.get(`/api/designs/${id}`)
  expect(res.status()).toBe(200)
  return (await res.json()) as {
    pages: { elements: { id: string; type: string; src?: string }[] }[]
  }
}

test.describe('Uploads library (v0.14 D1)', () => {
  test('upload → library persists across reload → second design inserts it → SVG export inlines it', async ({ page }) => {
    const username = await register(page, 'main')
    const designA = await createBlankDesign(page, `cvx_d1_a_${username}`)
    await openEditor(page, designA)

    // upload a PNG through the panel
    await openUploadsPanel(page)
    await page.setInputFiles('input[aria-label="File upload"]', pngFixture())

    // the element lands on the canvas with a media-store src (API truth)
    await expect
      .poll(async () => {
        const doc = await designDoc(page, designA)
        return doc.pages[0].elements.filter((e) => e.type === 'image' && e.src?.startsWith('/api/media/')).length
      }, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(1)

    // the library lists the file with the quota line
    await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/of 268\.4 MB|of 256\.0 MB/).first()).toBeVisible()

    // the media serves
    const docA = await designDoc(page, designA)
    const mediaId = docA.pages[0].elements.find((e) => e.src?.startsWith('/api/media/'))!.src!.slice('/api/media/'.length)
    expect((await page.request.get(`/api/media/${mediaId}`)).status()).toBe(200)

    // reload the editor — the library survives (it is DB-backed)
    await openEditor(page, designA)
    await openUploadsPanel(page)
    await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible({ timeout: 15_000 })
    const firstItem = page.locator('div.grid > div').first()
    await expect(firstItem.locator('img')).toBeVisible({ timeout: 15_000 })

    // a SECOND design: insert the library item from the grid
    const designB = await createBlankDesign(page, `cvx_d1_b_${username}`)
    await openEditor(page, designB)
    await openUploadsPanel(page)
    await page.locator('div.grid button[aria-label^="Add "]').first().click()
    await expect
      .poll(async () => {
        const doc = await designDoc(page, designB)
        return doc.pages[0].elements.filter((e) => e.type === 'image' && e.src === `/api/media/${mediaId}`).length
      }, { timeout: 20_000 })
      .toBe(1)

    // the SVG export inlines media images (portable, no /api/media refs)
    await page.getByRole('button', { name: 'Download', exact: true }).click()
    await page.getByRole('button', { name: /^SVG\b/ }).click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Download 1 SVG/i }).click(),
    ])
    const path = await download.path()
    expect(path, 'download landed').toBeTruthy()
    const { readFileSync } = await import('node:fs')
    const svg = readFileSync(path!, 'utf8')
    expect(svg).toContain('data:image/png;base64,')
    expect(svg).not.toContain('/api/media/')
  })

  test('removing a library item never breaks designs using it', async ({ page }) => {
    const username = await register(page, 'remove')
    const design = await createBlankDesign(page, `cvx_d1_rm_${username}`)
    await openEditor(page, design)
    await openUploadsPanel(page)
    await page.setInputFiles('input[aria-label="File upload"]', pngFixture())
    await expect
      .poll(async () => {
        const doc = await designDoc(page, design)
        return doc.pages[0].elements.filter((e) => e.type === 'image' && e.src?.startsWith('/api/media/')).length
      }, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(1)

    const doc = await designDoc(page, design)
    const mediaId = doc.pages[0].elements.find((e) => e.src?.startsWith('/api/media/'))!.src!.slice('/api/media/'.length)

    // remove from the library (trash button on hover) — assert the
    // OBSERVED end state (panel empties), never toast timing (the P5
    // lesson: toasts auto-dismiss and race any fixed expect)
    await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible({ timeout: 15_000 })
    await page.locator('div.grid > div').first().hover()
    await page.getByRole('button', { name: /^Remove .* from library$/ }).first().click()
    await expect(page.getByText('No uploads yet')).toBeVisible({ timeout: 10_000 })

    // …but the design's element still serves (row survives while referenced)
    expect((await page.request.get(`/api/media/${mediaId}`)).status()).toBe(200)
    const after = await designDoc(page, design)
    expect(after.pages[0].elements.some((e) => e.src === `/api/media/${mediaId}`)).toBe(true)
  })

  test('an anonymous upload is claimed into the account on register', async ({ page }) => {
    // anonymous: upload inside a fresh design (the upload stamps the anon cookie)
    const design = await createBlankDesign(page, 'cvx_d1_anon')
    await openEditor(page, design)
    await openUploadsPanel(page)
    await page.setInputFiles('input[aria-label="File upload"]', pngFixture())
    await expect
      .poll(async () => {
        const doc = await designDoc(page, design)
        return doc.pages[0].elements.filter((e) => e.type === 'image' && e.src?.startsWith('/api/media/')).length
      }, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(1)

    // the anonymous library lists it…
    await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible({ timeout: 15_000 })

    // …then registering claims the rows into the account
    const username = await register(page, 'claim')
    // the API now attributes the library to the account
    const lib = await page.request.get('/api/media/library')
    expect(lib.status()).toBe(200)
    const body = (await lib.json()) as { items: { id: string }[] }
    expect(body.items.length).toBeGreaterThanOrEqual(1)

    // and a brand-new context? — same account sees it after login (device B story)
    const ctx = await page.context().browser()!.newContext()
    const pageB = await ctx.newPage()
    await pageB.goto('/')
    const login = await pageB.request.post('/api/auth/login', {
      data: { username, password: `D1-E2e-${username}-17!q` },
    })
    expect(login.status()).toBe(200)
    const libB = await pageB.request.get('/api/media/library')
    const bodyB = (await libB.json()) as { items: { id: string }[] }
    expect(bodyB.items.map((i) => i.id).sort()).toEqual(body.items.map((i) => i.id).sort())
    await ctx.close()
  })
})
