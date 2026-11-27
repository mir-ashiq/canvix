import { test, expect, type Page } from '@playwright/test'

// v0.32.7 · PERSISTENT EXECUTION + RECOVERY, end to end in the real
// editor. The 26 Nov 2026 production incident: a mid-flight provider
// 502 killed a run with 19 actions applied; the user had no grounded
// way to continue without duplicating work.
//
// The agent route is MOCKED to scripted SSE streams (the server-side
// persistence + recovery-prompt injection is pinned by
// src/lib/agent/harness.test.ts — "recovery lines ride the system
// prompt" — and the DesignAgentRun row lifecycle is verified live by
// the benchmark in tests/benchmark/agent-benchmark.spec.ts). What
// THIS spec proves at the BROWSER level:
//
//   1. an interrupted run's error arrives as ONE honest message with
//      the applied work KEPT on the canvas (autosaved);
//   2. the follow-up (retry) message completes the design with the
//      SAME conversation and NEVER duplicates the applied elements;
//   3. the retry's request body carries the conversation history
//      (the model knows what already happened).

const V = 2
const ev = (e: unknown) => `data: ${JSON.stringify(e)}\n\n`

/** stream 1: the run dies MID-BUILD — one action applied, then the
 *  honest provider error (exactly what the loop emits on a 502). */
function interruptedStream(): string {
  return [
    { v: V, type: 'start', runId: 'mock-recovery-1' },
    { v: V, type: 'mode', mode: 'create', reason: 'classified as create' },
    { v: V, type: 'intent', intent: 'create', reason: 'empty canvas' },
    { v: V, type: 'brief', brief: { requiredTexts: [{ text: 'ARTISAN ROAST', tier: 'mandatory' }], requiredColors: [] } },
    { v: V, type: 'step', index: 0, thought: 'bold headline', tool: 'add_text' },
    {
      v: V, type: 'action', stepIndex: 0, callId: 'c0', risk: 'write', tool: 'add_text',
      actions: [{ type: 'addText', text: 'ARTISAN ROAST', y: 210, width: 1080, fontSize: 132, bold: true, color: '#FFFFFF', align: 'center' }],
    },
    { v: V, type: 'observation', stepIndex: 0, message: 'Headline added.' },
    {
      v: V, type: 'error', code: 'PROVIDER',
      message: 'The AI provider failed: API request failed with status 502: Bad Gateway. Applied work is kept — retry to continue.',
    },
  ].map(ev).join('')
}

/** stream 2: the retry COMPLETES the design — grounded in the current
 *  canvas (get_page_state first), adding only what is missing. */
function recoveryStream(): string {
  return [
    { v: V, type: 'start', runId: 'mock-recovery-2' },
    { v: V, type: 'mode', mode: 'improve', reason: 'classified as improve' },
    { v: V, type: 'intent', intent: 'refine', reason: 'fix language on an existing design' },
    { v: V, type: 'step', index: 0, thought: 'the headline is already here — do not re-add', tool: 'get_page_state' },
    { v: V, type: 'observation', stepIndex: 0, message: 'CANVAS MAP (2D) — occupied bands: y 210–342 (ARTISAN ROAST). Build the missing sections in the FREE space.' },
    { v: V, type: 'step', index: 1, thought: 'offer line — free space', tool: 'add_text' },
    {
      v: V, type: 'action', stepIndex: 1, callId: 'c1', risk: 'write', tool: 'add_text',
      actions: [{ type: 'addText', text: 'our coffee launch — first sip free', y: 500, width: 1080, fontSize: 46, color: '#E8D9FF', align: 'center' }],
    },
    { v: V, type: 'observation', stepIndex: 1, message: 'Offer line added.' },
    { v: V, type: 'step', index: 2, thought: 'CTA card — free space', tool: 'add_shape' },
    {
      v: V, type: 'action', stepIndex: 2, callId: 'c2', risk: 'write', tool: 'add_shape',
      actions: [{ type: 'addShape', shape: 'rect', x: 140, y: 900, width: 800, height: 320, fill: '#2E1A47' }],
    },
    { v: V, type: 'observation', stepIndex: 2, message: 'CTA card added.' },
    { v: V, type: 'step', index: 3, thought: 'CTA text', tool: 'add_text' },
    {
      v: V, type: 'action', stepIndex: 3, callId: 'c3', risk: 'write', tool: 'add_text',
      actions: [{ type: 'addText', text: 'order at canvix.coffee', y: 1000, width: 1080, fontSize: 56, color: '#FFFFFF', align: 'center' }],
    },
    { v: V, type: 'observation', stepIndex: 3, message: 'CTA text added.' },
    { v: V, type: 'usage', turns: 4, toolCalls: 4, elapsedMs: 1800, modelCalls: 5 },
    {
      v: V, type: 'done', steps: 4, toolCalls: 3,
      summary: 'Recovered and completed: the headline from the interrupted run was kept; the offer line and CTA were added in the free space.',
      verification: 'Brief contract validated against the live canvas — all mandatory items present.',
    },
  ].map(ev).join('')
}

async function register(page: Page, tag: string): Promise<string> {
  const username = `recov_${tag}_${Date.now().toString(36)}`
  const password = `Recov-E2e-${username}-19!q`
  const res = await page.request.post('/api/auth/register', { data: { username, password } })
  expect(res.status(), `register ${username}`).toBeLessThan(300)
  return username
}

type Doc = { pages: { elements: { text?: string; y?: number }[] }[] }

async function doc(page: Page, designId: string): Promise<Doc> {
  const res = await page.request.get(`/api/designs/${designId}`)
  expect(res.status()).toBe(200)
  return (await res.json()) as Doc
}

test.setTimeout(150_000)

test.describe('v0.32.7 · interrupted-run recovery (mocked route, real editor)', () => {
  test('a provider failure mid-build keeps applied work; the retry completes it without duplicates', async ({ page }) => {
    page.on('pageerror', (e) => console.log('[pageerror]', e.message))
    page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 300)) })
    await register(page, 'a')
    const res = await page.request.post('/api/designs', {
      data: {
        name: 'Recovery test',
        width: 1080,
        height: 1920,
        pages: [{ id: 'p1', background: { type: 'solid', color: '#FFFFFF' }, elements: [] }],
      },
    })
    expect(res.status()).toBeLessThan(300)
    const designId = ((await res.json()) as { id: string }).id
    await page.goto(`/design/${designId}`)
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
    await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 60_000 })

    // the two scripted streams, served in order
    const streams = [interruptedStream(), recoveryStream()]
    const bodies: Record<string, unknown>[] = []
    await page.route('**/api/ai/agent', (route) => {
      bodies.push(route.request().postDataJSON() as Record<string, unknown>)
      const body = streams.shift() ?? ''
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        body,
      })
    })

    // ── 1. the interrupted run ─────────────────────────────────
    await page.getByRole('button', { name: 'Apps', exact: true }).click()
    await page.getByText('Canvix AI', { exact: true }).first().click()
    const input = page.getByPlaceholder('Describe what to design or change — the agent figures out the rest…')
    await input.fill('Design a bold Instagram post for a coffee launch')
    await page.getByRole('button', { name: 'Send', exact: true }).click()

    // the honest provider failure, shown once
    await expect(page.getByText('The AI provider failed: API request failed with status 502', { exact: false })).toBeVisible({ timeout: 30_000 })

    // the applied headline is KEPT on the canvas (autosaved)
    const started = Date.now()
    let kept: Doc | null = null
    while (Date.now() - started < 20_000) {
      kept = await doc(page, designId)
      if (kept.pages[0].elements.some((e) => e.text === 'ARTISAN ROAST')) break
      await page.waitForTimeout(500)
    }
    expect(kept?.pages[0].elements.filter((e) => e.text === 'ARTISAN ROAST')).toHaveLength(1)

    // ── 2. the retry completes the design ─────────────────────
    await input.fill('Continue and finish the design')
    await page.getByRole('button', { name: 'Send', exact: true }).click()

    // the recovery summary arrives
    await expect(page.getByText('Recovered and completed', { exact: false })).toBeVisible({ timeout: 30_000 })

    // ── 3. the document truth: complete, and NOTHING duplicated ──
    // (poll — autosave lands the final actions after the done event)
    const wanted = ['ARTISAN ROAST', 'our coffee launch — first sip free', 'order at canvix.coffee']
    const started2 = Date.now()
    let final: Doc | null = null
    while (Date.now() - started2 < 20_000) {
      final = await doc(page, designId)
      const texts = final.pages[0].elements.map((e) => e.text ?? '')
      if (wanted.every((t) => texts.includes(t))) break
      await page.waitForTimeout(500)
    }
    const texts = final?.pages[0].elements.map((e) => e.text ?? '') ?? []
    expect(texts.filter((t) => t === 'ARTISAN ROAST')).toHaveLength(1)
    expect(texts.filter((t) => t === 'our coffee launch — first sip free')).toHaveLength(1)
    expect(texts.filter((t) => t === 'order at canvix.coffee')).toHaveLength(1)

    // the retry's request body carried the conversation history —
    // the model knew what already happened in this chat
    expect(bodies).toHaveLength(2)
    const history = (bodies[1].history ?? []) as { role: string; content: string }[]
    expect(history.length).toBeGreaterThan(0)
    expect(history.some((h) => h.role === 'user' && h.content.includes('coffee launch'))).toBe(true)

    // and the intent of the retry was classified, live in the panel
    await expect(page.getByText('· refine', { exact: false }).first()).toBeVisible()
  })
})
