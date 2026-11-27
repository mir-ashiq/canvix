import { test, expect, type Page, type Route } from '@playwright/test'

// v0.34.2 — the AUTO-DELETE option and the STOP button, end to end in
// the real editor.
//
// AUTO-DELETE (optional, default OFF): a toggle in the composer
// pre-approves the destructive tools (delete_elements / clear_page /
// delete_page) for the whole run — the approval dialog never appears
// and the deletes apply directly. With it OFF, the per-call approval
// gate still pauses the run. "Undo agent work" and version history
// remain the safety net behind every delete.
//
// THE STOP BUTTON: the client-side abort already worked mid-stream;
// what never worked was stopping the POST-RUN VISION CRITIQUE — the
// button aborted an already-finished fetch while the critique's own
// request hung unabortable, leaving the panel busy forever. The
// critique now rides the run's AbortSignal.
//
// The agent route is MOCKED to scripted SSE streams (no provider
// credentials in CI). The vision route hangs — proving the Stop
// button releases it.

const V = 2

const ev = (e: unknown) => `data: ${JSON.stringify(e)}\n\n`

/** register a fresh user */
async function register(page: Page, tag: string): Promise<string> {
  const username = `v342_${tag}_${Date.now().toString(36)}`
  const password = `V342-E2e-${username}-19!q`
  const res = await page.request.post('/api/auth/register', { data: { username, password } })
  expect(res.status(), `register ${username}`).toBeLessThan(300)
  return username
}

/** a canvas with two named texts — the destructive target */
async function createDesignWithTexts(page: Page, name: string, texts: string[]): Promise<string> {
  const res = await page.request.post('/api/designs', {
    data: {
      name,
      width: 1080,
      height: 1080,
      pages: [
        {
          id: 'p1',
          background: { type: 'solid', color: '#FFFFFF' },
          elements: texts.map((text, i) => ({
            id: `txt-${i + 1}`,
            type: 'text',
            x: 100, y: 100 + i * 120, width: 800, height: 60,
            text, fontSize: 48, fill: '#111111',
          })),
        },
      ],
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

async function openAgentPanel(page: Page) {
  await page.getByRole('button', { name: 'Apps', exact: true }).click()
  await page.getByText('Canvix AI', { exact: true }).first().click()
}

type Doc = { pages: { elements: { id?: string; type?: string; text?: string }[] }[] }

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

/** a scripted run whose ONLY call is a destructive delete_elements.
 *  v0.34.2 test detail: the CAPTURE event after the action gives the
 *  client a real async window (canvas capture) — the approval card
 *  actually paints between the gate and the stream's end (a static
 *  fulfill body closes the stream at once, so without it React
 *  batches the pending card and its clear into one invisible flash). */
function destructiveScript(runId: string, withCapture: boolean): string {
  const events: unknown[] = [
    { v: V, type: 'start', runId },
    { v: V, type: 'mode', mode: 'edit', reason: 'a delete request' },
    { v: V, type: 'step', index: 0, thought: 'remove the stale text', tool: 'delete_elements' },
    {
      v: V, type: 'action', stepIndex: 0, callId: 'c0', risk: 'destructive', tool: 'delete_elements',
      actions: [{ type: 'deleteElements', ids: ['txt-1'] }],
    },
  ]
  if (withCapture) events.push({ v: V, type: 'capture' })
  events.push(
    { v: V, type: 'observation', stepIndex: 0, message: 'Deleted 1 element(s).' },
    { v: V, type: 'usage', turns: 1, toolCalls: 1, elapsedMs: 400, modelCalls: 1 },
    { v: V, type: 'done', steps: 1, toolCalls: 1, summary: 'Stale text removed.' },
  )
  return events.map(ev).join('')
}

test.setTimeout(120_000)

test.describe('v0.34.2 · AUTO-DELETE (optional pre-approval of destructive tools)', () => {
  test('default OFF: the gate holds — a destructive action NEVER applies without approval', async ({ page }) => {
    await register(page, 'gate')
    const designId = await createDesignWithTexts(page, 'gate canvas', ['STALE TEXT', 'KEEP ME'])
    await openEditor(page, designId)
    await openAgentPanel(page)

    await page.route('**/api/ai/agent**', async (route: Route) => {
      const req = route.request()
      if (req.method() === 'POST' && req.url().includes('bridge=')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
        return
      }
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
        body: destructiveScript('run-gate', true),
      })
    })

    // the toggle exists, defaults OFF
    const toggle = page.getByTestId('agent-autodelete')
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')

    // watch for the approval card's appearance — the card is CLEARED
    // when the mocked stream ends (a real run holds the stream open
    // until the confirmation), so a MutationObserver is the reliable
    // witness that the gate actually paused
    await page.evaluate(() => {
      ;(window as unknown as { __sawApproveCard: boolean }).__sawApproveCard = false
      const observer = new MutationObserver(() => {
        if (document.body.innerText.includes('Approve once')) {
          ;(window as unknown as { __sawApproveCard: boolean }).__sawApproveCard = true
        }
      })
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    })

    await page.getByPlaceholder('Describe what to design or change — the agent figures out the rest…').fill('Delete the stale text')
    await page.getByRole('button', { name: 'Send', exact: true }).click()

    // the run finished (the turn with the done summary is up)…
    await expect(page.getByText('Stale text removed.', { exact: false })).toBeVisible({ timeout: 15_000 })
    // …the gate PAUSED at the destructive action (the card rendered)…
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __sawApproveCard: boolean }).__sawApproveCard))
      .toBe(true)
    // …and WITHOUT an approval click, the element is STILL THERE —
    // the destructive action never applied
    const d = await doc(page, designId)
    expect(d.pages[0].elements.some((e) => e.text === 'STALE TEXT')).toBe(true)
    expect(d.pages[0].elements.some((e) => e.text === 'KEEP ME')).toBe(true)
  })

  test('toggle ON: the same run deletes WITHOUT asking (and body.confirmed pre-approves server-side)', async ({ page }) => {
    await register(page, 'auto')
    const designId = await createDesignWithTexts(page, 'auto canvas', ['STALE TEXT', 'KEEP ME'])
    await openEditor(page, designId)
    await openAgentPanel(page)

    let capturedConfirmed: string[] | null = null
    await page.route('**/api/ai/agent**', async (route: Route) => {
      const req = route.request()
      if (req.method() === 'POST' && req.url().includes('bridge=')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
        return
      }
      const body = req.postDataJSON() as { confirmed?: string[] }
      capturedConfirmed = body.confirmed ?? []
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
        body: destructiveScript('run-auto', false),
      })
    })

    // flip the toggle ON before sending
    await page.getByTestId('agent-autodelete').click()
    await expect(page.getByTestId('agent-autodelete')).toHaveAttribute('aria-checked', 'true')

    await page.getByPlaceholder('Describe what to design or change — the agent figures out the rest…').fill('Delete the stale text')
    await page.getByRole('button', { name: 'Send', exact: true }).click()

    // NO approval dialog — the delete applies directly
    const deleted = await waitForDoc(page, designId, (x) => !x.pages[0].elements.some((e) => e.text === 'STALE TEXT'), 'the auto-applied delete')
    expect(deleted.pages[0].elements.some((e) => e.text === 'KEEP ME')).toBe(true)
    await expect(page.getByRole('button', { name: 'Approve once' })).toHaveCount(0)
    // the run finished normally (the dialog never gated it)
    await expect(page.getByText('Stale text removed.', { exact: false })).toBeVisible({ timeout: 15_000 })

    // the server was pre-approved too: body.confirmed carried the tool
    expect(capturedConfirmed).toContain('delete_elements')

    // the toggle persists for the next session (localStorage)
    await expect(page.getByTestId('agent-autodelete')).toHaveAttribute('aria-checked', 'true')
  })
})

test.describe('v0.34.2 · the STOP button releases the post-run vision critique', () => {
  test('Stop during the hanging critique finalizes the run instead of leaving the panel busy forever', async ({ page }) => {
    await register(page, 'stop')
    const designId = await createDesignWithTexts(page, 'stop canvas', ['HELLO'])
    await openEditor(page, designId)
    await openAgentPanel(page)

    // a fast scripted create run that APPLIES one action and finishes
    const events: unknown[] = [
      { v: V, type: 'start', runId: 'run-stop' },
      { v: V, type: 'mode', mode: 'create', reason: 'a create request' },
      { v: V, type: 'step', index: 0, thought: 'headline', tool: 'add_text' },
      {
        v: V, type: 'action', stepIndex: 0, callId: 'c0', risk: 'write', tool: 'add_text',
        actions: [{ type: 'addText', text: 'STOP TEST', x: 100, y: 200, width: 800, fontSize: 72, bold: true, color: '#111111' }],
      },
      { v: V, type: 'observation', stepIndex: 0, message: 'Headline added.' },
      { v: V, type: 'usage', turns: 1, toolCalls: 1, elapsedMs: 300, modelCalls: 1 },
      { v: V, type: 'done', steps: 1, toolCalls: 1, summary: 'Created the STOP TEST design.' },
    ]
    // the agent stream mock (bridge POSTs included); the vision route
    // is registered AFTER so it takes precedence for vision URLs
    await page.route('**/api/ai/agent**', async (route: Route) => {
      if (route.request().method() !== 'POST' || route.request().url().includes('bridge=')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
        return
      }
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
        body: events.map(ev).join(''),
      })
    })
    // the post-run vision critique HANGS (the old unabortable fetch).
    // The hang must never outlive the test uncaught: a page-scoped
    // wait inside a route callback gets CANCELLED with "Test ended"
    // when the test finishes, and that cancellation escaping the
    // route callback fails the run (run 237's only failure) — catch
    // it and let the request die with the test.
    await page.route('**/api/ai/agent/vision**', async (route: Route) => {
      await page.waitForTimeout(60_000).catch(() => undefined) // never fulfills within the test
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }).catch(() => undefined)
    })

    await page.getByPlaceholder('Describe what to design or change — the agent figures out the rest…').fill('Create a STOP TEST design')
    await page.getByRole('button', { name: 'Send', exact: true }).click()

    // the run stream completed and applied its action — the critique
    // is now in-flight, and the panel is still busy with a Stop button
    await waitForDoc(page, designId, (x) => x.pages[0].elements.some((e) => e.text === 'STOP TEST'), 'the applied action')
    const stopButton = page.getByRole('button', { name: 'Stop', exact: true })
    await expect(stopButton).toBeVisible({ timeout: 15_000 })

    // STOP — with the fix, the abort releases the hanging critique
    // and the turn finalizes; without it, the fetch hung forever and
    // this assertion timed out with the panel stuck on "Working…"
    await stopButton.click()
    await expect(page.getByText('Created the STOP TEST design.', { exact: false })).toBeVisible({ timeout: 10_000 })
    // the panel is usable again — type a next message and the composer enables
    await page.getByPlaceholder('Describe what to design or change — the agent figures out the rest…').fill('next message')
    const send = page.getByRole('button', { name: 'Send', exact: true })
    await expect(send).toBeEnabled({ timeout: 10_000 })
  })
})
