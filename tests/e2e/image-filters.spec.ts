import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * v0.14 (D4): the image filter gallery — acceptance.
 *
 *   1. preset chips render LIVE previews of the element's own image
 *      (the pixel pipeline runs in the popover, not a static sprite)
 *   2. clicking a preset lands in the document (API truth: filter +
 *      filterIntensity), the intensity slider adjusts it, and the
 *      main canvas re-renders with different pixels
 *   3. the filter persists across a reload (stored in the element)
 *   4. the exported SVG carries the approximation primitives AND the
 *      D1 media inlining (filters + portable exports compose)
 *   5. a second design's mixed-preset images each export their own
 *      primitive (per-element filters, no cross-contamination)
 *
 * Register budget: ONE registration per run (the second test logs in
 * with the shared account — the PR #26 discipline).
 */

// an 8×8 solid-red PNG (75 bytes)
const RED_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC'

function imageEl(id: string, x: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'image',
    name: `filter target ${id}`,
    x,
    y: 120,
    width: 240,
    height: 180,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    src: `data:image/png;base64,${RED_PNG_B64}`,
    radius: 0,
    naturalWidth: 8,
    naturalHeight: 8,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    ...overrides,
  }
}

// tests in this file run sequentially — the first test to register
// publishes its credentials; the second logs in instead (5/h/IP budget)
let SHARED_ACCOUNT: { username: string; password: string } | null = null

async function register(page: Page, tag: string): Promise<string> {
  const username = `d4_${tag}_${Date.now().toString(36)}`
  const password = `D4-E2e-${username}-17!q`
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

interface DocImage {
  id: string
  filter?: string
  filterIntensity?: number
}

async function docImages(page: Page, designId: string): Promise<DocImage[]> {
  const res = await page.request.get(`/api/designs/${designId}`)
  expect(res.status()).toBe(200)
  const doc = (await res.json()) as { pages: { elements: DocImage[] }[] }
  return doc.pages[0].elements.filter((e) => e.id)
}

/** the main Konva canvas as a data URL (pixel truth). Scoped to the
 *  workspace <main> — toolbar popovers (filter thumbs!) render their
 *  own canvases EARLIER in DOM order, so a bare querySelector('canvas')
 *  would snapshot a 56×40 thumb instead of the stage. */
async function canvasSnapshot(page: Page): Promise<string> {
  return page.evaluate(() => {
    const scope = document.querySelector('main[aria-label="Design canvas"]')
    const canvases = Array.from((scope ?? document).querySelectorAll('canvas'))
    // the stage canvas is by far the largest in the workspace
    const biggest = canvases.reduce<HTMLCanvasElement | null>(
      (best, c) => (!best || c.width * c.height > best.width * best.height ? c : best),
      null
    )
    return biggest ? biggest.toDataURL() : ''
  })
}

test.describe('Image filters (v0.14 D4)', () => {
  test.setTimeout(150_000)

  test('preset chips preview live → apply persists → intensity → canvas pixels → SVG export', async ({ page }) => {
    const username = await register(page, 'main')
    const design = await createDesign(page, `cvx_d4_${username}`, [imageEl('img_d4_main', 420)])
    await openEditor(page, design)

    // select the image through the layers tab (Konva is DOM-opaque)
    await page.getByRole('button', { name: 'Tools', exact: true }).click()
    await page.getByRole('button', { name: 'Layers', exact: true }).click()
    await page.getByText('filter target img_d4_main', { exact: true }).click()

    // open the gallery (the old "Filter tint (soon)" stub is gone)
    await page.getByRole('button', { name: 'Filters', exact: true }).click()
    const popover = page.locator('.cv-pop').last()
    await expect(popover).toBeVisible()

    // 8 preset chips, Original first, none of the old stub anywhere
    for (const label of ['Original', 'Mono', 'Warm', 'Cool', 'Vintage', 'Blur', 'Sharpen', 'Vignette']) {
      await expect(popover.getByRole('button', { name: `Filter ${label}` })).toBeVisible()
    }

    // the chips render LIVE previews: Mono's thumb pixels differ from
    // Original's (the pixel pipeline runs on the element's own image)
    const thumbUrls = await popover.evaluate(() => {
      const out: Record<string, string> = {}
      for (const btn of Array.from(document.querySelectorAll('.cv-pop button[aria-label^="Filter "]'))) {
        const label = btn.getAttribute('aria-label')!.slice('Filter '.length)
        const canvas = btn.querySelector('canvas')
        out[label] = canvas ? canvas.toDataURL() : ''
      }
      return out
    })
    expect(thumbUrls.Original, 'Original thumb rendered').not.toBe('')
    expect(thumbUrls.Mono).not.toBe('')
    expect(thumbUrls.Mono, 'Mono preview differs from Original (red → gray)').not.toBe(thumbUrls.Original)

    // the main canvas is stable before the filter (no idle animation)
    const before1 = await canvasSnapshot(page)
    await page.waitForTimeout(700)
    const before2 = await canvasSnapshot(page)
    const canvasWasStable = before1 === before2 && before1 !== ''

    // apply Mono → lands in the document (API truth)
    await popover.getByRole('button', { name: 'Filter Mono' }).click()
    await expect
      .poll(async () => {
        const imgs = await docImages(page, design)
        return imgs.find((e) => e.id === 'img_d4_main')?.filter
      }, { timeout: 20_000 })
      .toBe('grayscale')
    const applied = (await docImages(page, design)).find((e) => e.id === 'img_d4_main')
    expect(applied?.filterIntensity).toBe(100)

    // the main canvas re-rendered with different pixels
    if (canvasWasStable) {
      await expect
        .poll(() => canvasSnapshot(page), { timeout: 15_000 })
        .not.toBe(before2)
    }

    // the chip shows the active state
    await expect(popover.getByRole('button', { name: 'Filter Mono' })).toHaveAttribute('aria-pressed', 'true')

    // intensity slider → 40
    const slider = popover.locator('input[aria-label="Intensity slider"]')
    await slider.fill('40')
    await slider.dispatchEvent('pointerup')
    await expect
      .poll(async () => {
        const imgs = await docImages(page, design)
        return imgs.find((e) => e.id === 'img_d4_main')?.filterIntensity
      }, { timeout: 20_000 })
      .toBe(40)

    // reload — the filter persists (stored in the element)
    await openEditor(page, design)
    await page.getByRole('button', { name: 'Tools', exact: true }).click()
    await page.getByRole('button', { name: 'Layers', exact: true }).click()
    await page.getByText('filter target img_d4_main', { exact: true }).click()
    await page.getByRole('button', { name: 'Filters', exact: true }).click()
    const popover2 = page.locator('.cv-pop').last()
    await expect(popover2.getByRole('button', { name: 'Filter Mono' })).toHaveAttribute('aria-pressed', 'true')
    // and the intensity round-tripped
    await expect(popover2.locator('input[aria-label="Intensity"]')).toHaveValue('40')

    // close the popover first — its full-screen backdrop covers the
    // Download button (the click would be intercepted)
    await page.mouse.click(30, 700)

    // export SVG → the grayscale approximation primitive is in the
    // file (and the image itself still inlines as a data URL — D1)
    await page.getByRole('button', { name: 'Download', exact: true }).click()
    await page.getByRole('button', { name: /^SVG\b/ }).click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Download 1 SVG/i }).click(),
    ])
    const svg = readFileSync((await download.path())!, 'utf8')
    expect(svg).toContain('feColorMatrix') // grayscale ≈ luma matrix
    expect(svg).toContain('data:image/png;base64,') // D1 inlining intact

    // back in the editor: Original resets the element (reopen the
    // gallery — the export dialog and the closed popover are gone)
    // the dialog auto-closes after the export (observed end state,
    // never toast timing)
    await expect(page.getByRole('button', { name: 'Close' })).toBeHidden({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Filters', exact: true }).click()
    const popover3 = page.locator('.cv-pop').last()
    await popover3.getByRole('button', { name: 'Filter Original' }).click()
    await expect
      .poll(async () => {
        const imgs = await docImages(page, design)
        return imgs.find((e) => e.id === 'img_d4_main')?.filter
      }, { timeout: 20_000 })
      .toBe('none')
  })

  test('mixed-preset designs export per-element primitives', async ({ page }) => {
    // shared account (no second registration — the PR #26 discipline)
    expect(SHARED_ACCOUNT, 'a prior test registered the shared account').not.toBeNull()
    const login = await page.request.post('/api/auth/login', {
      data: { username: SHARED_ACCOUNT!.username, password: SHARED_ACCOUNT!.password },
    })
    expect(login.status(), 'login as the shared account').toBeLessThan(300)

    const design = await createDesign(page, `cvx_d4_mix_${SHARED_ACCOUNT!.username}`, [
      imageEl('img_d4_blur', 60, { filter: 'blur', filterIntensity: 90 }),
      imageEl('img_d4_warm', 360, { filter: 'warm', filterIntensity: 70 }),
      imageEl('img_d4_vig', 660, { filter: 'vignette', filterIntensity: 60 }),
    ])
    await openEditor(page, design)

    await page.getByRole('button', { name: 'Download', exact: true }).click()
    await page.getByRole('button', { name: /^SVG\b/ }).click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Download 1 SVG/i }).click(),
    ])
    const svg = readFileSync((await download.path())!, 'utf8')
    expect(svg).toContain('feGaussianBlur') // blur el
    expect(svg).toContain('feColorMatrix') // warm el
    expect(svg).toContain('radialGradient') // vignette overlay
    expect(svg).toContain('stop-opacity') // …with real falloff stops
  })
})
