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

/**
 * v0.22 — the PPTX-limits wave through the dialog: a page with a
 * Montserrat heading (font embedding), a fade transition, and an
 * entrance animation on the heading (timing tree). Cracks the zip:
 * embeddedFontLst + fntdata parts, the transition in the slide XML,
 * the click group in the timing tree, media under ppt/media/ — then
 * the LibreOffice round-trip (soffice converts it; a malformed
 * timing tree would repair-prompt instead).
 */
test.describe('PPTX export — v0.22 fonts/transitions/animations', () => {
  test('carries fonts, transitions and entrance timing into the file', async ({ page }) => {
    test.setTimeout(180_000)
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

    // a Montserrat heading with an entrance animation
    await page.getByRole('button', { name: 'Text', exact: true }).click()
    await page.getByRole('button', { name: 'Add a heading', exact: true }).click()
    await expect(page.getByLabel('Design canvas')).toBeVisible()

    // Animate panel — it opens on the Page tab. v0.22 SFX note: once a
    // transition is set, the section renders an "Audition Transition
    // sound" button that stays disabled until a sound is picked — so
    // tiles are targeted by their full accessible names (label + hint),
    // never by a loose /transition/ regex (that matched the disabled
    // audition button and timed out the first run of this spec).
    await page.getByRole('button', { name: 'Animate', exact: true }).click()

    // page transition: the Fade tile of the Page tab
    await page
      .getByRole('button', { name: 'Fade Crossfade between pages', exact: true })
      .click()

    // entrance animation on the selected heading: the Element tab's
    // Fade tile (its glyph prepends "Fa" — the accessible name is
    // "Fa Fade")
    await page.getByRole('button', { name: 'Element', exact: true }).click()
    await page.getByRole('button', { name: 'Fa Fade', exact: true }).click()

    // export through the dialog
    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 })
    await page.getByRole('button', { name: 'Download', exact: true }).click()
    await page.getByRole('button', { name: /^PPTX\b/ }).click()
    await page.getByRole('button', { name: /Download 1 PPTX/i }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.pptx$/)
    const path = await download.path()

    // crack the package open
    const { execFileSync } = await import('node:child_process')
    const out = execFileSync('python3', ['-c', `
import zipfile, sys
z = zipfile.ZipFile(${JSON.stringify(path)})
names = z.namelist()
slide = z.read('ppt/slides/slide1.xml').decode('utf-8')
presentation = z.read('ppt/presentation.xml').decode('utf-8')

# v0.22: transitions + entrance timing live in the slide
if '<p:transition' not in slide:
    sys.exit('no transition in slide1')
if '<p:timing>' not in slide:
    sys.exit('no timing tree in slide1')
if 'presetClass="entr"' not in slide:
    sys.exit('no entrance effect in the timing tree')

# v0.22: fonts embedded as fntdata + listed in presentation
fntdata = [n for n in names if n.endswith('.fntdata')]
if not fntdata:
    sys.exit('no embedded font parts (ladder may have failed - check network)')
if '<p:embeddedFontLst>' not in presentation:
    sys.exit('embeddedFontLst missing from presentation.xml')

# v0.22: media parts live under ppt/media/ (the placement fix)
bad = [n for n in names if n.startswith('media/')]
if bad:
    sys.exit('media at package root: ' + ','.join(bad))

# v0.22: re-wrap safety — every text body carries normAutofit
if '<a:normAutofit' not in slide:
    sys.exit('normAutofit missing from slide1')

print('PPTX v0.22 OK: %d parts, %d fonts' % (len(names), len(fntdata)))
`], { encoding: 'utf-8' })
    expect(out.trim()).toMatch(/^PPTX v0\.22 OK: \d+ parts, \d+ fonts$/)

    // LibreOffice round-trip: converts cleanly when the XML is schema-sane
    let soffice = true
    try {
      execFileSync('soffice', ['--version'])
    } catch {
      soffice = false
    }
    test.skip(!soffice, 'LibreOffice not installed on this runner')
    const fs = await import('node:fs')
    const tmp = `/tmp/pptx-v022-${Date.now()}.pptx`
    fs.copyFileSync(path!, tmp)
    execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', '/tmp', tmp], {
      timeout: 90_000,
    })
    const pdf = tmp.replace(/\.pptx$/, '.pdf')
    expect(fs.existsSync(pdf), 'soffice produced a PDF').toBe(true)
    expect(fs.statSync(pdf).size).toBeGreaterThan(2000)

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
  })
})
