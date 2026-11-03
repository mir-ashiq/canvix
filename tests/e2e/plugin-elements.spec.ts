import { expect, test } from '@playwright/test'

/**
 * v0.13 P4 regression — plugin elements on a flag-off instance.
 *
 * The §4.9 durability promise, verified end-to-end with real
 * persistence: a design containing plugin elements from a plugin
 * that is NOT available (flag off ⇒ /api/plugins 503 ⇒ the renderer
 * cache reports "plugins are disabled on this instance") must
 *   1. open without a crash (the placeholder path is inert, not fatal)
 *   2. still be editable (the element is an ordinary element)
 *   3. round-trip through autosave with the plugin element's data
 *      byte-identical — rendering degrades, DATA NEVER DOES
 *
 * Konva canvases are opaque to DOM queries, so the durability claim
 * is asserted at the API layer where the truth lives (jsonb in/out).
 */

const PLUGIN_ELEMENT = {
  id: 'plg_e2e_1',
  type: 'plugin',
  pluginId: 'net.example.notinstalled',
  kind: 'cloud',
  pluginVersion: '1.4.2',
  data: { words: ['alpha', 'beta', 'gamma'], palette: ['#7630D7', '#02C0CC'], seed: 42 },
  x: 120,
  y: 140,
  width: 480,
  height: 320,
  rotation: 0,
  opacity: 1,
  locked: false,
  visible: true,
  name: 'E2E cloud',
  shadow: { enabled: false, color: '#000000', blur: 0, offsetX: 0, offsetY: 0 },
}

const TEXT_ELEMENT = {
  id: 'txt_e2e_1',
  type: 'text',
  text: 'plugin durability probe',
  x: 80,
  y: 60,
  width: 400,
  height: 60,
  rotation: 0,
  opacity: 1,
  locked: false,
  visible: true,
  fontSize: 36,
  fontFamily: 'Inter',
  bold: false,
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

test.describe('plugin elements with no plugin system available (P4 durability)', () => {
  test('placeholder renders inert, editing works, autosave preserves the element byte-for-byte', async ({ page, request }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))

    // an ownerless design anyone-with-the-link can edit
    const create = await request.post('/api/designs', {
      data: {
        name: 'cvx_p4_durability_probe',
        width: 1080,
        height: 720,
        pages: [
          {
            id: 'page_p4_e2e',
            background: { type: 'solid', color: '#FFFFFF' },
            elements: [TEXT_ELEMENT, PLUGIN_ELEMENT],
          },
        ],
      },
    })
    expect(create.status(), `create: ${await create.text()}`).toBeLessThan(300)
    const design = (await create.json()) as { id: string }
    expect(design.id).toBeTruthy()

    // open the editor — the plugin system is flag-off here, so the
    // element can only ever be a placeholder
    await page.goto(`/design/${design.id}`)
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
    await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })

    // the placeholder path must be inert — no page errors from the
    // renderer cache, the service layer, or the Konva node
    await page.waitForTimeout(1500)
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])

    // edit: add a page — an ordinary mutation that marks the design
    // dirty and fires the debounced autosave
    await expect(page.getByRole('button', { name: 'Add page' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Add page' }).click()
    // debounce (1.6 s) + request
    await page.waitForTimeout(4000)
    expect(errors, `page errors after edit: ${errors.join(' | ')}`).toEqual([])

    // the durability verdict: the plugin element survives the
    // load → placeholder → edit → autosave round-trip UNCHANGED
    const reread = await request.get(`/api/designs/${design.id}`)
    expect(reread.status()).toBe(200)
    const body = (await reread.json()) as {
      pages: { id: string; elements: unknown[] }[]
    }
    const page1 = body.pages.find((p) => p.id === 'page_p4_e2e')
    expect(page1, 'the original page survives the edit').toBeTruthy()
    const pluginEl = page1!.elements.find(
      (e) => (e as { id?: string }).id === 'plg_e2e_1',
    ) as typeof PLUGIN_ELEMENT | undefined
    expect(pluginEl, 'the plugin element was not dropped by the save').toBeTruthy()
    expect(pluginEl!.pluginId).toBe('net.example.notinstalled')
    expect(pluginEl!.kind).toBe('cloud')
    expect(pluginEl!.pluginVersion).toBe('1.4.2')
    expect(pluginEl!.data).toEqual(PLUGIN_ELEMENT.data)
    expect(pluginEl!.x).toBe(PLUGIN_ELEMENT.x)
    expect(pluginEl!.width).toBe(PLUGIN_ELEMENT.width)

    // cleanup: leave no probe rows behind
    const del = await request.delete(`/api/designs/${design.id}`)
    expect([200, 202, 204]).toContain(del.status())
  })
})
