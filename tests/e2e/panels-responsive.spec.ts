import { test, expect, type Page } from '@playwright/test'

/**
 * v0.11.3 regression — responsive panel navigation.
 *
 * The Elements panel category strip was `grid grid-cols-4` with a fixed
 * `h-8`: 7 tabs wrapped into a second row that painted OUTSIDE the 32px
 * bar, over the panel divider and the content below (on a phone the
 * "Tables" tab floated detached mid-panel). Inactive labels also fell
 * back to the light-theme `text-foreground` (≈ #0a0a0a) because the app
 * never applies the `.dark` class — ≈ 1.3:1 on the dark bar, i.e. nearly
 * invisible.
 *
 * The strip (and the Photos / Templates filter chips, which wrapped
 * unpredictably) are now single-row, horizontally scrollable bars with
 * shared tab metrics and explicit white/65 inactive text (7.4:1).
 * These tests lock that in at the widths the bug was reported on.
 */

const MOBILE_WIDTHS = [320, 360, 390, 430] as const
const CATEGORIES = ['Shapes', 'Lines', 'Graphics', 'Stickers', 'Tables', 'Frames', 'Embeds'] as const

async function openEditorPanel(page: Page, panel: string) {
  await page.goto('/')
  // Next.js dev tools indicator (bottom-left "N" badge) overlays the first
  // rail button in dev mode — hide the portal so rail clicks stay reachable.
  // (Production builds don't mount it at all.)
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await page.getByRole('button', { name: /start designing/i }).first().click()
  await page
    .locator('section:has(h2:text("Start a new design")) [aria-label^="Create "]')
    .first()
    .click()
  await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: panel }).click()
}

for (const width of MOBILE_WIDTHS) {
  test(`Elements strip: single scrollable row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await openEditorPanel(page, 'Elements')

    const strip = page.getByRole('tablist', { name: 'Element categories' })
    await expect(strip).toBeVisible()
    const tabs = page.getByRole('tab')
    await expect(tabs).toHaveCount(CATEGORIES.length)

    // 1 ▸ every tab on ONE row, identical height + font size (was: 4+3 wrap,
    //     12px/11px mixed, second row outside the bar)
    const boxes = await tabs.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect()
        return { y: r.y, h: r.height, bottom: r.bottom, fontSize: getComputedStyle(el).fontSize }
      }),
    )
    expect([...new Set(boxes.map((b) => Math.round(b.y)))]).toHaveLength(1)
    expect([...new Set(boxes.map((b) => Math.round(b.h)))]).toHaveLength(1)
    expect([...new Set(boxes.map((b) => b.fontSize))]).toHaveLength(1)

    // 2 ▸ the strip scrolls instead of clipping — all 7 tabs live in one
    //     overflow row (nothing is hidden or dropped)
    const geom = await strip.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
    expect(geom.sw).toBeGreaterThanOrEqual(geom.cw)

    // 3 ▸ no tab may paint outside the strip (the old second row did,
    //     overlapping the divider, description and content)
    const stripBox = (await strip.boundingBox())!
    for (const b of boxes) {
      expect(b.bottom).toBeLessThanOrEqual(stripBox.y + stripBox.height + 0.5)
    }

    // 4 ▸ every category is reachable — activate the LAST tab from the strip
    await page.getByRole('tab', { name: 'Embeds' }).click()
    await expect(page.getByText('Add a link card')).toBeVisible()

    // 5 ▸ a mid-strip category swaps content without overlapping the strip
    await page.getByRole('tab', { name: 'Tables' }).click()
    const desc = await page.getByText('Tables are native elements').boundingBox()
    expect(desc!.y).toBeGreaterThanOrEqual(stripBox.y + stripBox.height - 1)

    // 6 ▸ contrast lock — inactive label ≥ 4.5:1 against bar-over-panel
    //     (was ≈ 1.3:1 via light-theme text-foreground on the dark bar)
    const contrast = await page.evaluate(() => {
      const parse = (src: string): { rgb: [number, number, number]; a: number } => {
        const s = src.trim()
        let m = /^rgba?\(([^)]+)\)$/.exec(s)
        if (m) {
          const p = m[1].split(',').map((v) => parseFloat(v))
          return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 }
        }
        m = /^oklab\(([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+)(?:\s*\/\s*([\d.]+))?\)$/.exec(s)
        if (m) {
          const [L, a, b] = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]
          const alpha = m[4] !== undefined ? parseFloat(m[4]) : 1
          const l_ = L + 0.3963377774 * a + 0.2158037573 * b
          const m_ = L - 0.1055613458 * a - 0.0638541728 * b
          const s_ = L - 0.0894841775 * a - 1.291485548 * b
          const [l, mm, ss] = [l_ ** 3, m_ ** 3, s_ ** 3]
          const lin = [
            4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * ss,
            -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * ss,
            -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * ss,
          ]
          const enc = (c: number) =>
            Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055))
          return { rgb: [enc(lin[0]), enc(lin[1]), enc(lin[2])], a: alpha }
        }
        throw new Error(`parseColor: unsupported computed color "${src}"`)
      }
      const strip = document.querySelector('[role=tablist]')!
      const tab = [...strip.querySelectorAll('[role=tab]')].find(
        (t) => t.getAttribute('aria-selected') !== 'true',
      )!
      const fg = parse(getComputedStyle(tab).color)
      const bar = parse(getComputedStyle(strip).backgroundColor)
      const panel = parse(getComputedStyle(strip.closest('aside')!).backgroundColor)
      const over = (
        f: { rgb: [number, number, number]; a: number },
        b: [number, number, number],
      ): [number, number, number] =>
        [0, 1, 2].map((i) => f.rgb[i] * f.a + b[i] * (1 - f.a)) as [number, number, number]
      const barPx = over(bar, panel.rgb)
      const textPx = over(fg, barPx)
      const lum = ([r, g, b]: [number, number, number]) => {
        const f = (c: number) => {
          const v = c / 255
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
      }
      const l1 = lum(textPx)
      const l2 = lum(barPx)
      const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
      return (hi + 0.05) / (lo + 0.05)
    })
    expect(contrast).toBeGreaterThanOrEqual(4.5)
  })
}

test('Elements strip stays a single row on desktop (320px sidebar)', async ({ page }) => {
  await openEditorPanel(page, 'Elements')
  const tabs = page.getByRole('tab')
  await expect(tabs).toHaveCount(CATEGORIES.length)
  const ys = await tabs.evaluateAll((els) => [
    ...new Set(els.map((el) => Math.round(el.getBoundingClientRect().y))),
  ])
  expect(ys).toHaveLength(1)
  // desktop panel is 320px wide — the 7 tabs still overflow into a scroll row
  const strip = page.getByRole('tablist', { name: 'Element categories' })
  const geom = await strip.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
  expect(geom.sw).toBeGreaterThan(geom.cw)
  await page.getByRole('tab', { name: 'Embeds' }).click()
  await expect(page.getByText('Add a link card')).toBeVisible()
})

test('Photos filter chips scroll in one row instead of wrapping', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await openEditorPanel(page, 'Photos')
  const chips = page.locator('aside .cv-tabscroll').first()
  await expect(chips).toBeVisible()
  const row = await chips.evaluate((el) => {
    const kids = [...el.children].map((k) => Math.round(k.getBoundingClientRect().y))
    return { ys: [...new Set(kids)], sw: el.scrollWidth, cw: el.clientWidth }
  })
  expect(row.ys).toHaveLength(1)
  expect(row.sw).toBeGreaterThanOrEqual(row.cw)
})

test('Templates category chips scroll in one row instead of wrapping', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await openEditorPanel(page, 'Templates')
  const chips = page.locator('aside .cv-tabscroll').first()
  await expect(chips).toBeVisible()
  const row = await chips.evaluate((el) => {
    const kids = [...el.children].map((k) => Math.round(k.getBoundingClientRect().y))
    return { ys: [...new Set(kids)], sw: el.scrollWidth, cw: el.clientWidth }
  })
  expect(row.ys).toHaveLength(1)
  expect(row.sw).toBeGreaterThanOrEqual(row.cw)
})
