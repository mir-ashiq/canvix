import { test, expect, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * v0.14 (D2): the system clipboard — acceptance.
 *
 *   1. copy in TAB A pastes in TAB B (the envelope rides the OS
 *      clipboard — custom MIME on Chromium)
 *   2. an OS image (screenshot-style clipboard content) lands as an
 *      image element through the uploads-library rail (D1)
 *   3. read-only designs never paste
 */

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mM4YROAFTEMLQkAVLdVAZV719MAAAAASUVORK5CYII='

const TEXT_ELEMENT = {
  id: 'txt_clip_e2e',
  type: 'text',
  text: 'clipboard payload',
  x: 120,
  y: 90,
  width: 420,
  height: 60,
  rotation: 0,
  opacity: 1,
  locked: false,
  visible: true,
  fontSize: 40,
  fontFamily: 'Inter',
  bold: true,
  italic: false,
  underline: false,
  strike: false,
  uppercase: false,
  fill: '#1F2226',
  align: 'left',
  lineHeight: 1.25,
  letterSpacing: 0,
  shadow: { enabled: false, color: '#000000', blur: 0, offsetX: 0, offsetY: 0 },
}

async function register(page: Page, tag: string): Promise<string> {
  const username = `d2_${tag}_${Date.now().toString(36)}`
  const res = await page.request.post('/api/auth/register', {
    data: { username, password: `D2-E2e-${username}-17!q` },
  })
  expect(res.status()).toBeLessThan(300)
  return username
}

async function createDesign(page: Page, name: string, elements: unknown[]): Promise<string> {
  const res = await page.request.post('/api/designs', {
    data: { name, width: 1080, height: 720, pages: [{ id: 'p1', background: { type: 'solid', color: '#FFFFFF' }, elements }] },
  })
  expect(res.status()).toBeLessThan(300)
  return ((await res.json()) as { id: string }).id
}

async function openEditor(page: Page, designId: string) {
  await page.goto(`/design/${designId}`)
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 60_000 })
}

async function elementCount(page: Page, designId: string, pred: (e: Record<string, unknown>) => boolean): Promise<number> {
  const res = await page.request.get(`/api/designs/${designId}`)
  expect(res.status()).toBe(200)
  const doc = (await res.json()) as { pages: { elements: Record<string, unknown>[] }[] }
  return doc.pages[0].elements.filter(pred).length
}

test.describe('System clipboard (v0.14 D2)', () => {
  test('copy in tab A pastes in tab B with a fresh element id', async ({ browser }) => {
    const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
    const pageA = await ctx.newPage()
    const username = await register(pageA, 'xtab')
    const designA = await createDesign(pageA, `cvx_d2_a_${username}`, [TEXT_ELEMENT])
    await openEditor(pageA, designA)

    // select the text element through the layers tab (Konva is DOM-opaque)
    await pageA.getByRole('button', { name: 'Tools', exact: true }).click()
    await pageA.getByRole('button', { name: 'Layers', exact: true }).click()
    await pageA.getByText('clipboard payload', { exact: true }).click()

    // copy → the envelope rides the OS clipboard
    await pageA.keyboard.press('Control+c')
    await pageA.waitForTimeout(1_000) // let the async clipboard write land

    // TAB B — same browser context, so the system clipboard is shared
    const designB = await createDesign(pageA, `cvx_d2_b_${username}`, [])
    const pageB = await ctx.newPage()
    await openEditor(pageB, designB)
    await pageB.bringToFront()
    await expect
      .poll(() => elementCount(pageB, designB, () => true), { timeout: 5_000 })
      .toBe(0) // nothing yet

    await pageB.keyboard.press('Control+v')

    // the element landed — same text, and a NEW id (never reuses ids)
    await expect
      .poll(() => elementCount(pageB, designB, (e) => e.type === 'text' && e.text === 'clipboard payload'), { timeout: 15_000 })
      .toBe(1)
    const res = await pageB.request.get(`/api/designs/${designB}`)
    const doc = (await res.json()) as { pages: { elements: { id: string; type: string; text?: string; x: number }[] }[] }
    const pasted = doc.pages[0].elements.find((e) => e.type === 'text')
    expect(pasted?.id).not.toBe(TEXT_ELEMENT.id)
    expect(pasted?.x).toBe(TEXT_ELEMENT.x + 32) // paste offset
    await ctx.close()
  })

  test('an OS image on the clipboard lands as an image element (library rail)', async ({ browser }) => {
    const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
    const page = await ctx.newPage()
    const username = await register(page, 'img')
    const design = await createDesign(page, `cvx_d2_img_${username}`, [])
    await openEditor(page, design)

    // put a PNG on the OS clipboard the way a screenshot tool would
    await page.evaluate(async (b64) => {
      const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob()
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    }, PNG_B64)

    await page.keyboard.press('Control+v')

    // image element with a media-store src (the D1 rail), not a data URL
    await expect
      .poll(
        () =>
          elementCount(
            page,
            design,
            (e) => e.type === 'image' && typeof e.src === 'string' && (e.src as string).startsWith('/api/media/'),
          ),
        { timeout: 20_000 },
      )
      .toBe(1)
    await ctx.close()
  })

  test('read-only designs never paste', async ({ browser }) => {
    // owner creates a design with content…
    const ownerCtx = await browser.newContext()
    const ownerPage = await ownerCtx.newPage()
    const username = await register(ownerPage, 'owner')
    const design = await createDesign(ownerPage, `cvx_d2_ro_${username}`, [TEXT_ELEMENT])
    await ownerCtx.close()

    // …an anonymous viewer opens it (read-only)
    const viewerCtx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
    const viewer = await viewerCtx.newPage()
    await openEditor(viewer, design)

    // seed the clipboard with a valid Canvix envelope…
    await viewer.evaluate(async () => {
      const env = JSON.stringify({
        app: 'canvix',
        v: 1,
        elements: [{
          id: 'hostile', type: 'text', text: 'should not land',
          x: 10, y: 10, width: 200, height: 40, fontSize: 20, fontFamily: 'Inter',
          fill: '#000', align: 'left', lineHeight: 1.25, letterSpacing: 0,
          bold: false, italic: false, underline: false, strike: false, uppercase: false,
          rotation: 0, opacity: 1, visible: true, locked: false,
          shadow: { enabled: false, color: '#000', blur: 0, offsetX: 0, offsetY: 0 },
        }],
      })
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([env], { type: 'text/plain' }) })])
    })
    await viewer.keyboard.press('Control+v')
    await viewer.waitForTimeout(2_500)

    // …nothing was pasted (API truth — still exactly one element)
    await expect.poll(() => elementCount(viewer, design, () => true), { timeout: 5_000 }).toBe(1)
    await viewerCtx.close()
  })
})
