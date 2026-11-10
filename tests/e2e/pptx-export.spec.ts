import { expect, test } from '@playwright/test'

/**
 * Wave 5 (first slice) — the PPTX export through the dialog.
 *
 * The export runs fully in the browser (pages render from DATA —
 * no stage flips): open a design, add a heading, export PPTX,
 * assert the download lands with the right name and a plausible
 * size, then crack the zip open in the test and assert the
 * OOXML skeleton + the heading text inside slide1.
 */
test.describe('PPTX export', () => {
  test('exports a valid .pptx with the heading as native text', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))

    await page.goto('/')
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
    await page.getByRole('button', { name: /start designing/i }).first().click()
    await expect(page.getByLabel('Create a design')).toBeVisible()

    await page
      .locator('section:has(h2:text("Start a new design")) [aria-label^="Create "]')
      .first()
      .click()
    await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })

    // a heading on the empty starter page
    await page.getByRole('button', { name: 'Text', exact: true }).click()
    await page.getByRole('button', { name: 'Add a heading', exact: true }).click()
    await expect(page.getByLabel('Design canvas')).toBeVisible()

    // export through the dialog (the canonical selectors)
    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
    await page.getByRole('button', { name: 'Download', exact: true }).click()
    await page.getByRole('button', { name: /^PPTX\b/ }).click()
    await page.getByRole('button', { name: /Download 1 PPTX/i }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.pptx$/)

    // crack the package open: skeleton + the heading text native
    const path = await download.path()
    const fs = await import('node:fs')
    const bytes = fs.readFileSync(path!)
    expect(bytes.length).toBeGreaterThan(2500)
    expect(bytes[0]).toBe(0x50) // 'P'
    expect(bytes[1]).toBe(0x4b) // 'K'

    // unzip through python (stable in CI, no node dep needed)
    const { execFileSync } = await import('node:child_process')
    const out = execFileSync('python3', ['-c', `
import zipfile, sys
z = zipfile.ZipFile(${JSON.stringify(path)})
names = z.namelist()
required = ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml',
            'ppt/slides/slide1.xml', 'ppt/slideMasters/slideMaster1.xml',
            'ppt/theme/theme1.xml', 'docProps/core.xml']
missing = [n for n in required if n not in names]
if missing:
    sys.exit('missing parts: ' + ', '.join(missing))
slide = z.read('ppt/slides/slide1.xml').decode('utf-8')
if 'Add a heading' not in slide:
    sys.exit('heading text missing from slide1')
if '<a:t>' not in slide:
    sys.exit('no text runs in slide1')
print('PPTX OK: ' + str(len(names)) + ' parts')
`], { encoding: 'utf-8' })
    expect(out.trim()).toMatch(/^PPTX OK: \d+ parts$/)

    // the toast reports the export — anchored: Radix's ToastProvider also
    // renders a visually-hidden announcer ("Notification PPTX downloaded…")
    // for screen readers; the ^ anchor matches only the visible title.
    await expect(page.getByText(/^PPTX downloaded/i)).toBeVisible({ timeout: 15_000 })
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
  })
})
