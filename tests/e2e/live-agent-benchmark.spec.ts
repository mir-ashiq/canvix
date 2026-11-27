import { test, expect, type Page } from '@playwright/test'

// ═══════════════════════════════════════════════════════════════
// v0.32.7 · THE LIVE BENCHMARK — real provider, real browser,
// real route. NOT part of CI: runs only with CANVIX_BENCH_LIVE=1
// (a configured provider + spent budget are prerequisites; CI runs
// the mocked e2e suites instead — this file says REAL when it runs).
//
// What is measured per scenario (a design type + one honest prompt):
//   · completion   — a done turn that is NOT an INCOMPLETE wrap-up
//   · brief fidelity — the required texts present as element values
//   · geometry     — no off-canvas elements; no text-on-text overlaps
//   · latency      — wall time from send to the done turn
//   · usage        — turns, tools, model calls, tokens (from the
//                    panel's usage line; tokens only when the
//                    gateway reports them — never estimated)
//   · provider failures + RECOVERY — a run interrupted by a provider
//     failure (429/5xx — real gateways do this under sustained load)
//     is recovered with a follow-up "Continue and finish the design"
//     message (up to 2 recovery rounds; the recovery itself is one
//     of the things this benchmark measures). Recovered scenarios
//     are reported as recovered, not as clean passes.
//
// Results land in docs/BENCHMARK-v0.32.7.md (checked in, written by
// the run itself — never hand-typed). Mocked tests are a different,
// labeled thing; everything in THIS spec is live.
// ═══════════════════════════════════════════════════════════════

const LIVE = process.env.CANVIX_BENCH_LIVE === '1'
const OUT_DIR = 'docs/benchmark-runs'
const RUN_TIMEOUT_MS = 300_000
const RECOVERY_MESSAGE = 'Continue and finish the design'
/** cooldown between scenarios — real gateways rate-limit under
 *  sustained load; hammering them measures nothing but the limit */
const INTER_SCENARIO_COOLDOWN_MS = 30_000

const PROMPTS: {
  id: string
  name: string
  w: number
  h: number
  prompt: string
  requiredTexts: string[]
  /** editing scenarios start with seeded content (intent ≠ create) */
  seed?: { text: string; x: number; y: number; w: number; fontSize: number }[]
}[] = [
  {
    id: 'poster', name: 'A3 poster', w: 1080, h: 1527,
    prompt: 'Design a bold A3 poster for a summer music festival called Forest Beats on 12 July, tickets 40 euro',
    requiredTexts: ['Forest Beats'],
  },
  {
    id: 'social', name: 'Instagram story', w: 1080, h: 1920,
    prompt: 'Design a bold Instagram post for a coffee launch',
    requiredTexts: [],
  },
  {
    id: 'deck', name: 'Pitch deck (3 slides)', w: 1920, h: 1080,
    prompt: 'Build a 3-slide pitch deck for a startup called RiverPay that banks the unbanked',
    requiredTexts: ['RiverPay'],
  },
  {
    id: 'thumbnail', name: 'YouTube thumbnail', w: 1280, h: 720,
    prompt: 'Design a YouTube thumbnail for a video called "I Built a House in 7 Days" — bold, readable at small size',
    requiredTexts: ['I Built a House in 7 Days'],
  },
  {
    id: 'logo', name: 'Logo', w: 1080, h: 1080,
    prompt: 'Design a minimal logo for a bakery called Crumb in warm cream and chocolate brown',
    requiredTexts: ['Crumb'],
  },
  {
    id: 'ad', name: 'Web ad banner', w: 1200, h: 628,
    prompt: 'Design a web ad banner for 50% off winter jackets at NorthPeak this weekend only, exact text "Winter Sale"',
    requiredTexts: ['Winter Sale', 'NorthPeak'],
  },
  {
    id: 'edit-restyle', name: 'Editing: restyle an existing design', w: 1080, h: 1350,
    prompt: 'Recolor this design to warm cream and chocolate browns and increase the headline contrast',
    requiredTexts: ['Sunrise Yoga'],
    seed: [
      { text: 'Sunrise Yoga', x: 140, y: 180, w: 800, fontSize: 96 },
      { text: 'every morning at 6', x: 140, y: 320, w: 600, fontSize: 40 },
    ],
  },
]

interface Result {
  id: string
  ok: boolean
  recovered: boolean
  incomplete: boolean
  intent: string | null
  steps: number
  tools: number
  modelCalls: number
  tokens: number | null
  seconds: number
  elements: number
  requiredTextsPresent: Record<string, boolean>
  offCanvas: number
  textOverlaps: number
  providerFailures: number
  recoveryRounds: number
  error: string | null
}

type Doc = { pages: { elements: { x?: number; y?: number; width?: number; height?: number; text?: string; type?: string }[] }[] }

async function register(page: Page, tag: string): Promise<string> {
  const username = `bench_${tag}_${Date.now().toString(36)}`
  const password = `Bench-E2e-${username}-19!q`
  const res = await page.request.post('/api/auth/register', { data: { username, password } })
  expect(res.status(), `register ${username}`).toBeLessThan(300)
  return username
}

/** One run round: send `message`, wait for the usage line (a
 *  finished run) or the provider-failure message (an interrupted
 *  one). Returns what happened. */
async function oneRound(page: Page, input: ReturnType<Page['getByPlaceholder']>, message: string, timeoutMs: number): Promise<'done' | 'provider-failed' | 'timeout'> {
  await input.fill(message)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const usage = page.getByText(/turns · \d+ tools · \d+s · \d+ model calls/)
  const failure = page.getByText('The AI provider failed')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await failure.last().isVisible().catch(() => false)) return 'provider-failed'
    if (await usage.last().isVisible().catch(() => false)) return 'done'
    await page.waitForTimeout(1_000)
  }
  return 'timeout'
}

test.describe('v0.32.7 live benchmark (real provider, real browser)', () => {
  test.setTimeout(45 * 60_000)

  test('seven design types + editing, measured honestly', async ({ page }) => {
    test.skip(!LIVE, 'CANVIX_BENCH_LIVE=1 required — this spec spends a real provider budget')
    const results: Result[] = []

    for (const scenario of PROMPTS) {
      const started = Date.now()
      const r: Result = {
        id: scenario.id, ok: false, recovered: false, incomplete: false, intent: null,
        steps: 0, tools: 0, modelCalls: 0, tokens: null, seconds: 0, elements: 0,
        requiredTextsPresent: {}, offCanvas: 0, textOverlaps: 0, providerFailures: 0,
        recoveryRounds: 0, error: null,
      }
      try {
        await register(page, scenario.id)
        const res = await page.request.post('/api/designs', {
          data: {
            name: `Bench ${scenario.name}`,
            width: scenario.w,
            height: scenario.h,
            pages: [{
              id: 'p1',
              background: { type: 'solid', color: scenario.seed ? '#0D1117' : '#FFFFFF' },
              elements: (scenario.seed ?? []).map((s, i) => ({
                id: `seed-${i}`, type: 'text', x: s.x, y: s.y, width: s.w, height: Math.round(s.fontSize * 1.4),
                text: s.text, fontSize: s.fontSize, fontFamily: 'Poppins', bold: i === 0, fill: i === 0 ? '#FFFFFF' : '#C3CCDA',
              })),
            }],
          },
        })
        expect(res.status()).toBeLessThan(300)
        const designId = ((await res.json()) as { id: string }).id
        await page.goto(`/design/${designId}`)
        await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
        await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 60_000 })

        await page.getByRole('button', { name: 'Apps', exact: true }).click()
        await page.getByText('Canvix AI', { exact: true }).first().click()
        const input = page.getByPlaceholder('Describe what to design or change — the agent figures out the rest…')

        // ── the run, with bounded live recovery ────────────────────
        let outcome = await oneRound(page, input, scenario.prompt, RUN_TIMEOUT_MS)
        while (outcome === 'provider-failed' && r.recoveryRounds < 2) {
          r.providerFailures += 1
          r.recoveryRounds += 1
          await page.waitForTimeout(20_000) // let the gateway breathe
          outcome = await oneRound(page, input, RECOVERY_MESSAGE, RUN_TIMEOUT_MS)
        }
        if (outcome === 'provider-failed') r.providerFailures += 1
        r.seconds = Math.round((Date.now() - started) / 1000)

        // usage from the LAST usage line (the run's final total)
        const usageLine = page.getByText(/turns · \d+ tools · \d+s · \d+ model calls/)
        const usageText = (await usageLine.last().innerText().catch(() => '')).trim()
        const m = usageText.match(/(\d+) turns · (\d+) tools · (\d+)s · (\d+) model calls(?: · ([\d.]+)k tokens)?/)
        if (m) {
          r.steps = Number(m[1]); r.tools = Number(m[2]); r.modelCalls = Number(m[4])
          if (m[5]) r.tokens = Math.round(Number(m[5]) * 1000)
        }

        // completion honesty + the transcript facts
        const panel = page.locator('[data-testid="agent-input"]').locator('..').locator('..')
        const transcript = await panel.innerText().catch(() => '')
        r.incomplete = /INCOMPLETE —/.test(transcript)
        r.recovered = r.recoveryRounds > 0 && !r.incomplete && outcome === 'done'
        r.ok = !r.incomplete && outcome === 'done'
        const intentMatch = transcript.match(/· (create|add|replace|reposition|restyle|redesign|remove|refine|review)\b/)
        r.intent = intentMatch ? intentMatch[1] : null

        // document truth after autosave
        await page.waitForTimeout(4_000)
        const docRes = await page.request.get(`/api/designs/${designId}`)
        const doc = (await docRes.json()) as Doc
        const els = doc.pages[0].elements ?? []
        r.elements = els.length
        for (const t of scenario.requiredTexts) {
          r.requiredTextsPresent[t] = els.some((e) => e.type === 'text' && (e.text ?? '').replace(/\s+/g, ' ') === t.replace(/\s+/g, ' '))
          if (!r.requiredTextsPresent[t]) r.ok = false
        }
        // geometry: off-canvas + text-on-text overlaps (always defects)
        for (const e of els) {
          const x = e.x ?? 0, y = e.y ?? 0, w = e.width ?? 0, h = e.height ?? 0
          if (x < -2 || y < -2 || x + w > scenario.w + 2 || y + h > scenario.h + 2) r.offCanvas += 1
        }
        const texts = els.filter((e) => e.type === 'text')
        for (let i = 0; i < texts.length; i++) {
          for (let j = i + 1; j < texts.length; j++) {
            const a = texts[i], b = texts[j]
            const ix = Math.max(0, Math.min((a.x ?? 0) + (a.width ?? 0), (b.x ?? 0) + (b.width ?? 0)) - Math.max(a.x ?? 0, b.x ?? 0))
            const iy = Math.max(0, Math.min((a.y ?? 0) + (a.height ?? 0), (b.y ?? 0) + (b.height ?? 0)) - Math.max(a.y ?? 0, b.y ?? 0))
            if (ix > 0 && iy > 0) r.textOverlaps += 1
          }
        }
        if (r.offCanvas > 0 || r.textOverlaps > 0) r.ok = false

        // evidence: a screenshot of the finished design + panel
        await page.screenshot({ path: `${OUT_DIR}/${scenario.id}.png`, fullPage: false })
      } catch (err) {
        r.error = String((err as Error)?.message ?? err).slice(0, 220)
      }
      results.push(r)
      if (scenario !== PROMPTS[PROMPTS.length - 1]) {
        await page.waitForTimeout(INTER_SCENARIO_COOLDOWN_MS)
      }
    }

    // ── the honest report ────────────────────────────────────────
    const passed = results.filter((r) => r.ok && !r.recovered).length
    const recoveredPassed = results.filter((r) => r.ok && r.recovered).length
    const md = [
      '# v0.32.7 live benchmark — REAL provider, REAL browser, REAL route',
      '',
      `Run: ${new Date().toISOString()} · ${passed}/${results.length} scenarios fully passed · ${recoveredPassed} recovered after a provider failure and completed · ${results.length - passed - recoveredPassed} did not complete`,
      '("fully passed" = a non-INCOMPLETE done + every required text present + no off-canvas elements + no text-on-text overlaps. "recovered" = a provider failure interrupted the run and the recovery follow-up completed it. Everything in this table ran against the live provider through the real editor — the mocked suites are labeled separately in CI.)',
      '',
      '| scenario | outcome | intent | turns | tools | model calls | tokens | wall | elements | required texts | off-canvas | text overlaps | provider failures | recovery rounds |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      ...results.map((r) =>
        `| ${r.id} | ${r.ok ? (r.recovered ? '✅ (recovered)' : '✅') : '❌'}${r.incomplete ? ' INCOMPLETE' : ''} | ${r.intent ?? '—'} | ${r.steps} | ${r.tools} | ${r.modelCalls} | ${r.tokens !== null ? `${r.tokens}k` : 'not reported'} | ${r.seconds}s | ${r.elements} | ${Object.values(r.requiredTextsPresent).every(Boolean) ? 'all present' : Object.entries(r.requiredTextsPresent).filter(([, v]) => !v).map(([k]) => `"${k}" missing`).join(', ') || '—'} | ${r.offCanvas} | ${r.textOverlaps} | ${r.providerFailures} | ${r.recoveryRounds} |`,
      ),
      '',
      ...results.filter((r) => r.error).map((r) => `> error in ${r.id}: ${r.error}`),
      '',
      'Token counts appear only when the gateway reports usage; "not reported" is a provider limitation, never an estimate.',
    ].join('\n')
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(`${OUT_DIR}/v0.32.7-results.json`, JSON.stringify(results, null, 2))
    writeFileSync('docs/BENCHMARK-v0.32.7.md', md)

    // the benchmark itself asserts nothing beyond honest recording —
    // completion-rate claims live in the report, judged by a human
    expect(results.length).toBe(PROMPTS.length)
  })
})
