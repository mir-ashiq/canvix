import { describe, expect, it } from 'vitest'
import { runDesignAgent, type DesignRenderer } from './pipeline'
import { runDesignTool } from './tools'
import { parseCritiqueResponse, type DesignAgentModel, type CritiqueResult } from './model'
import { compileSpec } from '@/lib/design-engine/compile'

/**
 * Phase B: the autonomous pipeline proven with a SCRIPTED model —
 * the loop's self-correction, honesty, guards AND the visual
 * verification stage are deterministic behavior, so they are tested
 * without any network. The real-model acceptance run
 * (scripts/designspec-agent-run.ts + z-ai CLI) exercises the same
 * seams end-to-end.
 */

const PROMPT = [
  'Create a poster for a harvest festival.',
  'The poster must show these exact lines:',
  '"Kashmir Apple Harvest Festival 2026",',
  '"Oct 18 · Dachigam Grounds · Srinagar",',
  '"Entry Free — 10 AM to 6 PM".',
  'Use the colors #1B5E20 and #F9A825 somewhere.',
  'Size 1080x1350. Warm autumn feel, bold and inviting.',
].join(' ')

function specJson(headline: string, body: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 'v2',
    name: 'scripted poster',
    format: { width: 1080, height: 1350 },
    palette: { seeds: ['#1B5E20', '#F9A825'], mood: 'warm' },
    typography: { scale: 1.25 },
    blocks: [
      {
        kind: 'hero',
        weight: 4,
        content: [
          { role: 'headline', source: 'user-required', text: headline },
          { role: 'subline', source: 'user-required', text: body },
          { role: 'cta', source: 'user-required', text: 'Entry Free — 10 AM to 6 PM' },
        ],
        overlap: 'none',
      },
    ],
    ...extra,
  })
}

const GOOD = specJson('Kashmir Apple Harvest Festival 2026', 'Oct 18 · Dachigam Grounds · Srinagar')
// round-1 mistake: the model paraphrased the required headline
const PARAPHRASED = specJson('Kashmir Apple Harvest Festival ’26', 'Oct 18 · Dachigam Grounds · Srinagar')

/** A scripted planner: plays back replies in order, recording what
 * it was asked (so tests can assert the feedback reached the model). */
function scriptedModel(replies: string[], critiques: string[] = []) {
  const planInputs: { feedback?: { failures: string[]; priorSpec: unknown; origin?: string } }[] = []
  const critiqueInputs: { image: string }[] = []
  let critiqueIdx = 0
  const model: DesignAgentModel = {
    plan: async (req) => {
      planInputs.push({ feedback: req.feedback ? { failures: req.feedback.failures, priorSpec: req.feedback.priorSpec, origin: req.feedback.origin } : undefined })
      return replies[Math.min(planInputs.length - 1, replies.length - 1)]
    },
    critique: async (req) => {
      critiqueInputs.push({ image: req.image })
      return critiques[Math.min(critiqueIdx++, critiques.length - 1)]
    },
  }
  return { model, planInputs, critiqueInputs }
}

/** A scripted renderer: returns a fake image ref per call. */
function scriptedRenderer(images: (string | null)[] = ['render://page-1']): DesignRenderer {
  let i = 0
  return {
    render: async () => ({ image: images[Math.min(i++, images.length - 1)] ?? null }) as { image: string } | null,
  }
}

function critiqueJson(issues: { severity: string; issue: string; fix?: string }[]): string {
  return JSON.stringify({ summary: 'scripted critique', issues })
}

describe('DesignAgent pipeline: self-correction (evaluator loop)', () => {
  it('a check failure is fed back as a revision prompt and the fixed spec passes', async () => {
    const { model, planInputs } = scriptedModel([PARAPHRASED, GOOD])
    const run = await runDesignAgent({ prompt: PROMPT, model })

    expect(run.outcome).toBe('passed')
    expect(run.report.modelCalls).toBe(2)
    expect(run.report.revisionRounds).toBe(1)
    expect(run.checks?.passed).toBe(true)
    expect(run.briefConformance).toEqual([])
    // the feedback round carried the exact failure and the prior spec
    expect(planInputs).toHaveLength(2)
    expect(planInputs[1].feedback?.failures.join(' ')).toMatch(/required text missing from the spec/)
    expect(JSON.stringify(planInputs[1].feedback?.priorSpec)).toContain('Festival ’26')
    // and the final page carries the exact required texts
    const texts = run.pages?.[0].elements.filter((el) => el.type === 'text').map((el) => (el as { text: string }).text) ?? []
    expect(texts).toContain('Kashmir Apple Harvest Festival 2026')
    // the run report records both rounds — the brief-conformance
    // stage is the one that caught the paraphrase in round 1
    expect(run.report.stages.filter((s) => s.name.startsWith('brief-conformance')).map((s) => s.ok)).toEqual([false, true])
  })

  it('a parse hiccup mid-loop is recoverable: feedback on the prior spec, not a dead end', async () => {
    const { model } = scriptedModel([PARAPHRASED, 'sorry here is your spec: {"version":"v2" (oops', GOOD])
    const run = await runDesignAgent({ prompt: PROMPT, model })

    expect(run.outcome).toBe('passed')
    expect(run.report.modelCalls).toBe(3)
    expect(run.report.revisionRounds).toBe(2)
    expect(run.report.stages.some((s) => s.detail.includes('parse failed'))).toBe(true)
  })
})

describe('DesignAgent pipeline: honesty and guards', () => {
  it('repeating the same broken spec trips the cycle guard — no silent looping', async () => {
    const { model } = scriptedModel([PARAPHRASED, PARAPHRASED])
    const run = await runDesignAgent({ prompt: PROMPT, model })

    expect(run.outcome).toBe('guard-cycled')
    expect(run.report.cycleGuard).toBe(true)
    expect(run.warnings.join(' ')).toMatch(/repeated its spec verbatim/)
    // evidence is kept: the brief failure is still reported (the
    // engine's spec→page checks can be clean while the SPEC itself
    // dropped a requirement — exactly why the agent layer runs its
    // own conformance check)
    expect(run.briefConformance.join(' ')).toMatch(/required text missing from the spec/)
  })

  it('distinct-but-never-fixed specs exhaust the revision budget and fail honestly', async () => {
    const replies = [0, 1, 2, 3, 4].map((i) => specJson(`Kashmir Attempt Number ${i}`, 'Oct 18 · Dachigam Grounds · Srinagar'))
    const { model } = scriptedModel(replies)
    const run = await runDesignAgent({ prompt: PROMPT, model })

    expect(run.outcome).toBe('failed-honestly')
    expect(run.report.revisionRounds).toBe(3) // DEFAULT_LIMITS.maxRevisions
    expect(run.report.modelCalls).toBe(4) // initial plan + 3 revisions
    expect(run.warnings.join(' ')).toMatch(/revision budget exhausted/)
    // never a fake pass, and the failed pages stay as evidence
    expect(run.briefConformance.length).toBeGreaterThan(0)
    expect(run.pages?.[0].elements.length).toBeGreaterThan(0)
  })

  it('a first reply that is not JSON at all fails honestly (nothing to revise against)', async () => {
    const { model } = scriptedModel(['I will make you a beautiful poster!'])
    const run = await runDesignAgent({ prompt: PROMPT, model })

    expect(run.outcome).toBe('failed-honestly')
    expect(run.report.modelCalls).toBe(1)
    expect(run.warnings.join(' ')).toMatch(/no JSON object|parse/i)
  })

  it('caller cancellation aborts before any further model call', async () => {
    const { model, planInputs } = scriptedModel([PARAPHRASED, GOOD])
    const signal = { aborted: true }
    const run = await runDesignAgent({ prompt: PROMPT, model, signal })

    expect(run.outcome).toBe('aborted')
    expect(run.report.modelCalls).toBe(0)
    expect(planInputs).toHaveLength(0)
    expect(run.warnings.join(' ')).toMatch(/cancelled/)
  })
})

describe('DesignAgent pipeline: visual verification (P0 stage)', () => {
  it('renders, critiques, corrects once, re-renders and reports improvement', async () => {
    // plan: paraphrase → fix. critique 1: one P2; critique 2 (verify): clean.
    const { model, planInputs } = scriptedModel(
      [PARAPHRASED, GOOD, GOOD],
      [
        critiqueJson([{ severity: 'P2', issue: 'subline crowds the CTA', fix: 'raise hero weight' }]),
        critiqueJson([]),
      ],
    )
    const run = await runDesignAgent({
      prompt: PROMPT,
      model,
      renderer: scriptedRenderer(['render://page-1', 'render://page-2']),
    })

    expect(run.outcome).toBe('passed')
    expect(run.report.visualVerification).toBe('improved')
    expect(run.report.visualPasses).toHaveLength(1)
    expect(run.report.visualPasses[0].action).toBe('revised')
    // the critique-origin revision carried the finding
    const critiqueFeedback = planInputs.find((p) => p.feedback?.origin === 'critique')
    expect(critiqueFeedback?.feedback?.failures.join(' ')).toMatch(/subline crowds the CTA/)
    // plan calls: 2 (checks rounds) + 1 (critique revision) = 3; critiques: 2
    expect(run.report.modelCalls).toBe(5)
    // the revised design still passes every deterministic check
    expect(run.checks?.passed).toBe(true)
    expect(run.briefConformance).toEqual([])
  })

  it('a clean critique marks the run verified with no extra revision', async () => {
    const { model, planInputs } = scriptedModel([PARAPHRASED, GOOD], [critiqueJson([{ severity: 'P3', issue: 'minor polish' }])])
    const run = await runDesignAgent({ prompt: PROMPT, model, renderer: scriptedRenderer() })

    expect(run.outcome).toBe('passed')
    expect(run.report.visualVerification).toBe('verified')
    expect(run.report.visualPasses[0].action).toBe('accepted-as-is')
    // P3 alone is not actionable: no extra plan call beyond the 2 check rounds
    expect(run.report.modelCalls).toBe(3)
    expect(planInputs).toHaveLength(2)
  })

  it('a critique revision that breaks the deterministic checks is REJECTED — the passing design is kept', async () => {
    // round 3 (critique revision) returns a spec that drops a required text again
    const { model } = scriptedModel(
      [PARAPHRASED, GOOD, PARAPHRASED],
      [critiqueJson([{ severity: 'P1', issue: 'huge empty middle band' }])],
    )
    const run = await runDesignAgent({ prompt: PROMPT, model, renderer: scriptedRenderer() })

    expect(run.outcome).toBe('passed')
    expect(run.report.visualPasses[0].action).toBe('rejected-by-checks')
    // the KEPT design is the one that passed the checks
    const texts = run.pages?.[0].elements.filter((el) => el.type === 'text').map((el) => (el as { text: string }).text) ?? []
    expect(texts).toContain('Kashmir Apple Harvest Festival 2026')
    expect(run.report.stages.some((s) => s.detail.includes('checks outrank critique'))).toBe(true)
  })

  it('no renderer or critique seam → disclosed as unavailable, never faked', async () => {
    const { model } = scriptedModel([PARAPHRASED, GOOD])
    const run = await runDesignAgent({ prompt: PROMPT, model })

    expect(run.outcome).toBe('passed')
    expect(run.report.visualVerification).toBe('unverified')
    expect(run.warnings.join(' ')).toMatch(/visual verification unavailable/)
    expect(run.report.stages.some((s) => s.name === 'visual-verification' && s.detail.includes('unavailable'))).toBe(true)
  })

  it('an unparseable critique is discarded fail-closed — no invented issues', async () => {
    const { model } = scriptedModel([PARAPHRASED, GOOD], ['looks lovely to me!'])
    const run = await runDesignAgent({ prompt: PROMPT, model, renderer: scriptedRenderer() })

    expect(run.outcome).toBe('passed')
    expect(run.report.visualPasses[0].action).toBe('unparseable-discarded')
    expect(run.report.visualVerification).toBe('unverified')
  })
})

describe('DesignAgent toolbox', () => {
  it('every deterministic tool runs; unknown tools fail honestly', () => {
    const brief = runDesignTool('extract-brief', { prompt: PROMPT })
    expect(brief.ok).toBe(true)

    const compiled = runDesignTool('compile-spec', { spec: JSON.parse(GOOD) })
    expect(compiled.ok).toBe(true)

    const wrap = runDesignTool('wrap-estimate', { text: 'a few words to wrap here', width: 200, fontSize: 18 })
    expect(wrap.ok).toBe(true)
    expect((wrap.value as { lines: number }).lines).toBeGreaterThan(1)

    const balance = runDesignTool('balance-report', {
      pages: (compiled.value as { pages: unknown[] }).pages,
      width: 1080,
      height: 1350,
    })
    expect(balance.ok).toBe(true)

    const unknown = runDesignTool('make-it-pretty', {})
    expect(unknown.ok).toBe(false)
    expect(unknown.notes[0]).toMatch(/unknown tool/)
  })
})

describe('critique parsing (advisory, fail-closed)', () => {
  it('parses fenced JSON with issues; garbage is a null, never invented issues', () => {
    const ok = parseCritiqueResponse('```json\n{"summary":"decent","issues":[{"severity":"P2","issue":"subline crowds the CTA","fix":"raise hero weight"}]}\n```')
    expect(ok).not.toBeNull()
    expect(ok?.issues).toHaveLength(1)
    expect(ok?.issues[0].severity).toBe('P2')
    expect(ok?.advisory).toBe(true)

    expect(parseCritiqueResponse('looks great to me!')).toBeNull()
    // a missing severity degrades to P3, a missing issue is dropped
    const lax = parseCritiqueResponse('{"summary":"","issues":[{"issue":"x"},{"severity":"P1"}]}')
    expect(lax?.issues).toHaveLength(1)
    expect(lax?.issues[0].severity).toBe('P3')
  })
})

describe('the full block vocabulary compiles through the agent toolbox', () => {
  const spec = JSON.stringify({
    version: 'v2',
    name: 'vocabulary poster',
    format: { width: 1080, height: 1350 },
    palette: { seeds: ['#1B5E20', '#F9A825'], mood: 'warm' },
    typography: {},
    blocks: [
      {
        kind: 'hero',
        weight: 3,
        content: [
          { role: 'headline', source: 'user-required', text: 'Valley Runs 2026' },
          { role: 'cta', source: 'user-required', text: 'Register Free' },
        ],
        overlap: 'none',
      },
      {
        kind: 'stat-row',
        weight: 2,
        count: 3,
        content: [
          { role: 'headline', source: 'user-required', text: '12k+' },
          { role: 'label', source: 'model', text: 'runners finished' },
          { role: 'headline', source: 'user-required', text: '42' },
          { role: 'label', source: 'model', text: 'villages on the route' },
          { role: 'headline', source: 'user-required', text: '5' },
          { role: 'label', source: 'model', text: 'years running' },
        ],
      },
      {
        kind: 'timeline',
        weight: 2,
        count: 3,
        content: [
          { role: 'headline', source: 'model', text: '7 AM' },
          { role: 'label', source: 'model', text: 'start line opens' },
          { role: 'headline', source: 'model', text: '9 AM' },
          { role: 'label', source: 'model', text: 'race begins' },
          { role: 'headline', source: 'model', text: '1 PM' },
          { role: 'label', source: 'model', text: 'awards' },
        ],
      },
      {
        kind: 'mockup',
        weight: 3,
        content: [{ role: 'label', source: 'model', text: 'Last year at the finish line' }],
      },
      {
        kind: 'gallery',
        weight: 2,
        count: 2,
        content: [
          { role: 'label', source: 'model', text: 'Route through the valley' },
          { role: 'label', source: 'model', text: 'Finish festival' },
        ],
      },
      {
        kind: 'footer',
        weight: 1,
        content: [{ role: 'label', source: 'model', text: 'Organized by the Srinagar Running Club' }],
      },
    ],
  })

  it('every kind gets its dedicated builder and all checks stay green', () => {
    const result = compileSpec(JSON.parse(spec))
    expect(result.checks.passed).toBe(true)
    const texts = result.pages[0].elements.filter((el) => el.type === 'text').map((el) => (el as { text: string }).text)
    for (const t of [
      'Valley Runs 2026', 'Register Free',
      '12k+', '42', '5', 'runners finished', 'villages on the route', 'years running',
      '7 AM', '9 AM', '1 PM', 'race begins', 'awards',
      'Last year at the finish line',
      'Route through the valley', 'Finish festival',
      'Organized by the Srinagar Running Club',
    ]) {
      expect(texts).toContain(t)
    }
    // timeline route: the stop dots are small ellipses
    const dots = result.pages[0].elements.filter((el) => el.type === 'ellipse')
    expect(dots.length).toBeGreaterThanOrEqual(3)
    // stat underline: slim accent rects (height 4, narrow — the
    // timeline route is also height 4 but spans hundreds of px)
    const statRects = result.pages[0].elements.filter((el) => el.type === 'rect' && (el as { height?: number }).height === 4 && (el as { width?: number }).width !== undefined && (el as { width: number }).width < 120)
    expect(statRects.length).toBeGreaterThanOrEqual(3)
    // stat values share one underline baseline
    const baselines = new Set(statRects.map((el) => (el as { y?: number }).y))
    expect(baselines.size).toBe(1)
    // gallery frames: 2 surface cards wide enough to be real frames
    const galleryFrames = result.pages[0].elements.filter(
      (el) => el.type === 'rect' && (el as { fill?: string }).fill === result.palette.roles.surface && (el as { width?: number }).width !== undefined && (el as { width: number }).width > 200,
    )
    expect(galleryFrames.length).toBeGreaterThanOrEqual(3) // mockup frame + 2 gallery frames
  })

  it('runs through the full pipeline (scripted model) with all vocabulary accepted', async () => {
    const briefSpec = JSON.parse(spec)
    // the model always returns this spec; its user-required texts
    // differ from PROMPT's — the run must NOT fake success (the
    // identical-reply loop trips the cycle guard, which is the same
    // honesty contract: never claim a design that misses the brief)
    const model = { plan: async () => JSON.stringify(briefSpec) } as DesignAgentModel
    const run = await runDesignAgent({ prompt: PROMPT, model })
    expect(['failed-honestly', 'guard-cycled']).toContain(run.outcome)
    expect(run.outcome).not.toBe('passed')
    expect(run.briefConformance.length).toBeGreaterThan(0)
  })
})

describe('CritiqueResult shape', () => {
  it('is advisory by construction', () => {
    const c = parseCritiqueResponse('{"summary":"s","issues":[{"severity":"P1","issue":"i"}]}')
    expect((c as CritiqueResult)?.advisory).toBe(true)
  })
})
