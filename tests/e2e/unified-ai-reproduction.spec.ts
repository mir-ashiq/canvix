import { test, expect, type Page, type Route } from '@playwright/test'

// v0.32.2 — THE production reproduction, end to end in the real editor.
//
//   "Design a bold Instagram post for a coffee launch" (the panel's
//   own suggestion) in Canvix AI → Chat → Auto on an EMPTY 1080×1920
//   canvas used to: route to edit, loop get_page_state, see a
//   synthetic "User request mode: edit. Begin." instead of the
//   request, and finish with nothing created.
//
// The agent route is MOCKED to a scripted SSE stream (no provider
// credentials in CI — the routing/loop logic itself is pinned by
// src/lib/agent/harness.test.ts, 9 new regressions). What this spec
// proves at the BROWSER level:
//
//   1. Auto mode sends the user's ORIGINAL request, unpinned, to the
//      route (the request body carries the verbatim prompt).
//   2. A create run's streamed design actions really land as native
//      editable elements on the canvas (and autosave persists them).
//   3. The created design reopens with its elements intact and the
//      user can edit them through the real properties UI.
//   4. Screenshots of the created + edited design are captured.

const PROMPT = 'Design a bold Instagram post for a coffee launch'

const V = 2

/** the scripted run the fixed route would stream for this prompt:
 *  routed to CREATE, no state-inspection loop, four writes, done. */
function sseScript(): string {
  const ev = (e: unknown) => `data: ${JSON.stringify(e)}\n\n`
  const events: unknown[] = [
    { v: V, type: 'start', runId: 'mock-repro-run' },
    { v: V, type: 'mode', mode: 'create', reason: 'classified as create' },
    { v: V, type: 'step', index: 0, thought: 'night gradient background', tool: 'set_background' },
    {
      v: V, type: 'action', stepIndex: 0, callId: 'c0', risk: 'write', tool: 'set_background',
      actions: [{ type: 'setBackground', kind: 'gradient', from: '#120a2a', to: '#2e1a47' }],
    },
    { v: V, type: 'observation', stepIndex: 0, message: 'Background set to a night gradient.' },
    { v: V, type: 'step', index: 1, thought: 'bold headline', tool: 'add_text' },
    {
      v: V, type: 'action', stepIndex: 1, callId: 'c1', risk: 'write', tool: 'add_text',
      actions: [{ type: 'addText', text: 'ARTISAN ROAST', y: 210, width: 1080, fontSize: 132, bold: true, color: '#FFFFFF', align: 'center' }],
    },
    { v: V, type: 'observation', stepIndex: 1, message: 'Headline added.' },
    { v: V, type: 'step', index: 2, thought: 'offer line', tool: 'add_text' },
    {
      v: V, type: 'action', stepIndex: 2, callId: 'c2', risk: 'write', tool: 'add_text',
      actions: [{ type: 'addText', text: 'our coffee launch — first sip free', y: 400, width: 1080, fontSize: 46, color: '#E8D9FF', align: 'center' }],
    },
    { v: V, type: 'observation', stepIndex: 2, message: 'Offer line added.' },
    { v: V, type: 'step', index: 3, thought: 'CTA card', tool: 'add_shape' },
    {
      v: V, type: 'action', stepIndex: 3, callId: 'c3', risk: 'write', tool: 'add_shape',
      actions: [{ type: 'addShape', shape: 'rect', x: 140, y: 780, width: 800, height: 360, fill: '#2E1A47' }],
    },
    { v: V, type: 'observation', stepIndex: 3, message: 'CTA card added.' },
    { v: V, type: 'step', index: 4, thought: 'CTA text', tool: 'add_text' },
    {
      v: V, type: 'action', stepIndex: 4, callId: 'c4', risk: 'write', tool: 'add_text',
      actions: [{ type: 'addText', text: 'order at canvix.coffee', y: 920, width: 1080, fontSize: 56, color: '#FFFFFF', align: 'center' }],
    },
    { v: V, type: 'observation', stepIndex: 4, message: 'CTA text added.' },
    { v: V, type: 'usage', turns: 5, toolCalls: 5, elapsedMs: 1400, modelCalls: 6 },
    {
      v: V, type: 'done', steps: 5, toolCalls: 5,
      summary: 'Coffee-launch Instagram post created: bold headline, offer line and CTA card on a night gradient.',
      verification: 'Brief contract validated against the live canvas — all mandatory items present.',
    },
  ]
  return events.map(ev).join('')
}

async function register(page: Page, tag: string): Promise<string> {
  const username = `repro_${tag}_${Date.now().toString(36)}`
  const password = `Repro-E2e-${username}-19!q`
  const res = await page.request.post('/api/auth/register', { data: { username, password } })
  expect(res.status(), `register ${username}`).toBeLessThan(300)
  return username
}

async function createEmptyDesign(page: Page, name: string): Promise<string> {
  // the reproduction canvas: EMPTY, 1080×1920
  const res = await page.request.post('/api/designs', {
    data: {
      name,
      width: 1080,
      height: 1920,
      pages: [{ id: 'p1', background: { type: 'solid', color: '#FFFFFF' }, elements: [] }],
    },
  })
  expect(res.status(), `create design: ${await res.text()}`).toBeLessThan(300)
  return ((await res.json()) as { id: string }).id
}

async function openEditor(page: Page, designId: string) {
  await page.goto(`/design/${designId}`)
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 60_000 })
}

type Doc = { pages: { elements: Record<string, unknown>[] }[] }

async function doc(page: Page, designId: string): Promise<Doc> {
  const res = await page.request.get(`/api/designs/${designId}`)
  expect(res.status()).toBe(200)
  return (await res.json()) as Doc
}

async function waitForDoc(page: Page, designId: string, predicate: (d: Doc) => boolean, what: string, timeoutMs = 20_000) {
  const started = Date.now()
  let last: Doc | null = null
  while (Date.now() - started < timeoutMs) {
    last = await doc(page, designId)
    if (predicate(last)) return last
    await page.waitForTimeout(500)
  }
  throw new Error(`document never showed ${what} within ${timeoutMs}ms — last: ${JSON.stringify(last?.pages[0]).slice(0, 300)}`)
}

/** select an element through the Layers tab (Konva is DOM-opaque) */
async function selectViaLayers(page: Page, label: string) {
  const layersTab = page.getByRole('button', { name: 'Layers', exact: true })
  if (!(await layersTab.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Tools', exact: true }).click()
    await layersTab.click()
  }
  await page.getByText(label, { exact: true }).click()
}

test.setTimeout(120_000)

test.describe('Unified Canvix AI reproduction (v0.32.2 fix)', () => {
  test('the coffee-launch suggestion works in Auto mode from an empty canvas', async ({ page }) => {
    await register(page, 'repro')
    const designId = await createEmptyDesign(page, 'AI repro canvas')
    await openEditor(page, designId)

    // ── the agent route: scripted create-run stream + request capture ──
    let capturedBody: Record<string, unknown> | null = null
    await page.route('**/api/ai/agent**', async (route: Route) => {
      const req = route.request()
      if (req.method() === 'POST' && req.url().includes('bridge=')) {
        // bridge acks from the panel — the scripted stream ignores them
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
        return
      }
      capturedBody = req.postDataJSON() as Record<string, unknown>
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
        body: sseScript(),
      })
    })

    // ── Canvix AI → Chat (default tab) → the reproduction prompt ──
    await page.getByRole('button', { name: 'Apps', exact: true }).click()
    await page.getByText('Canvix AI', { exact: true }).first().click()
    await page.getByPlaceholder('Describe what to design or change…').fill(PROMPT)
    await page.getByRole('button', { name: 'Send', exact: true }).click()

    // the ORIGINAL request reached the route, verbatim, UNPINNED (Auto)
    expect((capturedBody as { message?: string } | null)?.message).toBe(PROMPT)
    expect((capturedBody as Record<string, unknown> | null)?.mode).toBeUndefined()

    // ── document truth: the streamed writes landed as native elements ──
    const created = await waitForDoc(
      page,
      designId,
      (d) => (d.pages[0]?.elements ?? []).some((e) => (e as { text?: string }).text === 'ARTISAN ROAST'),
      'the AI-created headline',
    )
    const texts = created.pages[0].elements.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text)
    expect(texts).toEqual(expect.arrayContaining([
      'ARTISAN ROAST',
      'our coffee launch — first sip free',
      'order at canvix.coffee',
    ]))
    expect(created.pages[0].elements.some((e) => e.type === 'rect')).toBe(true)

    // the chat reports the create run honestly (a normal done, no INCOMPLETE)
    await expect(page.getByText('Coffee-launch Instagram post created', { exact: false })).toBeVisible({ timeout: 10_000 })

    await page.screenshot({ path: '/home/z/my-project/download/repro-created.png', fullPage: false })

    // ── reopen: the created design survives with its elements ──
    await openEditor(page, designId)
    await selectViaLayers(page, 'ARTISAN ROAST')

    // ── edit through the REAL properties UI (font size) ──
    const sizeInput = page.getByRole('spinbutton', { name: 'Font size' })
    await expect(sizeInput).toBeVisible()
    await sizeInput.fill('96')
    await sizeInput.press('Enter')

    const edited = await waitForDoc(
      page,
      designId,
      (d) => (d.pages[0]?.elements ?? []).some((e) => (e as { text?: string; fontSize?: number }).text === 'ARTISAN ROAST' && (e as { fontSize?: number }).fontSize === 96),
      'the edited font size',
    )
    // the edit landed on the AI-CREATED element — native editable, proven
    const headline = edited.pages[0].elements.find((e) => (e as { text?: string }).text === 'ARTISAN ROAST') as { fontSize?: number; locked?: boolean }
    expect(headline.fontSize).toBe(96)
    expect(headline.locked).toBeFalsy()

    await page.screenshot({ path: '/home/z/my-project/download/repro-edited.png', fullPage: false })
  })
})
