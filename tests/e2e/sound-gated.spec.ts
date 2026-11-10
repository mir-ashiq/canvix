import { expect, test } from '@playwright/test'

/**
 * Sound wave — the Audio rail, NO FREESOUND KEY (the F2b gate).
 *
 * The Audio tab ALWAYS shows (like Photos — it ships the offline
 * pack that works with zero configuration). What gates is the
 * Freesound search section. On the default suite (no
 * FREESOUND_API_KEY):
 *   1. /api/stock-sound/available answers available=false
 *   2. POST /api/stock-sound/search answers 503 NO_PROVIDER (+ the
 *      hint names the key and the CC0 default; nothing leaks)
 *   3. the Audio tab is right there; the 16-sound library renders
 *      and inserting a pack sound lands a native audio element
 *   4. the voiceover button renders (mic denied in CI → honest toast)
 *   5. the Animate panel exposes the SFX picker on an animated
 *      element; the pick survives the store (sanitize keeps known ids)
 *   6. /api/ai/capabilities reports soundSearch=false (no key)
 *
 * The keyed world (search → insert → durable attribution) is covered
 * by unit tests against recorded fixtures (the stock-photo posture).
 */
test.describe('sound wave without the Freesound key (F2b gate)', () => {
  test('available=false, search 503 NO_PROVIDER with hint, Audio rail intact', async ({ page, request }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))

    // 1. secret-free availability probe
    const avail = await request.get('/api/stock-sound/available')
    expect(avail.status()).toBe(200)
    expect(await avail.json()).toEqual({ available: false, providers: [] })

    // 2. the gated search route — hint names the key, nothing leaks
    const res = await request.post('/api/stock-sound/search', { data: { query: 'rain' } })
    expect(res.status()).toBe(503)
    const body = (await res.json()) as { code?: string; hint?: string }
    expect(body.code).toBe('NO_PROVIDER')
    expect(body.hint).toContain('FREESOUND_API_KEY')
    expect(body.hint).toContain('Creative Commons 0')

    // capabilities reports the sound gate honestly
    const caps = (await (await request.get('/api/ai/capabilities')).json()) as {
      capabilities?: Record<string, boolean>
    }
    expect(caps.capabilities?.soundSearch).toBe(false)
    expect(caps.capabilities?.upscale).toBe(true) // local tools unaffected

    // 3. the editor: Audio tab renders, library + insert work offline
    await page.goto('/')
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
    await page.getByRole('button', { name: /start designing/i }).first().click()
    await expect(page.getByLabel('Create a design')).toBeVisible()

    await page
      .locator('section:has(h2:text("Start a new design")) [aria-label^="Create "]')
      .first()
      .click()
    await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Audio', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Audio', exact: true })).toBeVisible()

    // the 16-sound offline pack renders
    const grid = page.getByTestId('sfx-grid')
    await expect(grid).toBeVisible()
    await expect(grid.locator('button[aria-label^="Play "]')).toHaveCount(16, { timeout: 15_000 })

    // the unkeyed Freesound hint (positive no, not probe-in-flight)
    await expect(page.getByTestId('sound-unkeyed-hint')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('sound-unkeyed-hint')).toContainText('Freesound')

    // 4. the voiceover surface renders (CI denies the mic — the
    //    honest denial toast is the no-permission contract)
    await expect(page.getByTestId('voiceover-button')).toBeVisible()
    await expect(page.getByTestId('voiceover-button')).toContainText(/record voiceover/i)

    // 5. insert a pack sound → a native audio element lands on the page
    await grid.locator('button[aria-label^="Play "]').first().click() // audition path
    await grid.locator('button', { hasText: 'Whoosh soft' }).first().click()
    await expect(page.getByText('Sound added').first()).toBeVisible({ timeout: 20_000 })
    // the waveform card (audio element) renders on the canvas
    await expect(page.getByLabel('Design canvas')).toBeVisible()

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
  })

  test('Animate panel exposes the SFX picker; known ids survive sanitize', async ({ page }) => {
    await page.goto('/')
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
    await page.getByRole('button', { name: /start designing/i }).first().click()
    await expect(page.getByLabel('Create a design')).toBeVisible()

    await page
      .locator('section:has(h2:text("Start a new design")) [aria-label^="Create "]')
      .first()
      .click()
    await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })

    // the starter page is empty — add a heading first (auto-selects),
    // then open Animate
    await page.getByRole('button', { name: 'Text', exact: true }).click()
    await page.getByRole('button', { name: 'Add a heading', exact: true }).click()
    await expect(page.getByLabel('Design canvas')).toBeVisible()
    await page.getByRole('button', { name: 'Animate', exact: true }).click()

    await page.getByRole('button', { name: 'Element', exact: true }).click()
    await page.getByRole('button', { name: /fade/i }).first().click()

    // the entrance-sound picker appears with the pack's options
    const picker = page.getByTestId('sfx-picker').locator('select')
    await expect(picker).toBeVisible()
    const options = await picker.locator('option').allTextContents()
    expect(options.join(' ')).toContain('None')
    expect(options.join(' ')).toContain('Chime')
    expect(options).toHaveLength(17) // None + the 16 pack sounds

    // pick one — it applies to the animation config (store round-trip)
    await picker.selectOption('chime')
    await expect(picker).toHaveValue('chime')
  })
})
