import { describe, expect, it } from 'vitest'
import { runDesignAgent } from './pipeline'
import { runDesignTool } from './tools'
import { parseCritiqueResponse, type DesignAgentModel } from './model'
import { compileSpec } from '@/lib/design-engine/compile'

/**
 * Phase B: the autonomous pipeline proven with a SCRIPTED model —
 * the loop's self-correction, honesty and guards are deterministic
 * behavior, so they are tested without any network. The real-model
 * acceptance run (scripts/designspec-agent-run.ts + z-ai CLI)
 * exercises the same seams end-to-end.
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
function scriptedModel(replies: string[]) {
  const planInputs: { feedback?: { failures: string[]; priorSpec: unknown } }[] = []
  const model: DesignAgentModel = {
    plan: async (req) => {
      planInputs.push({ feedback: req.feedback ? { failures: req.feedback.failures, priorSpec: req.feedback.priorSpec } : undefined })
      return replies[Math.min(planInputs.length - 1, replies.length - 1)]
    },
  }
  return { model, planInputs }
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

describe('stat-row and mockup compile through the agent toolbox', () => {
  const spec = JSON.stringify({
    version: 'v2',
    name: 'stats + mockup',
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
        kind: 'mockup',
        weight: 3,
        content: [{ role: 'label', source: 'model', text: 'Last year at the finish line' }],
      },
    ],
  })

  it('dedicated builders emit the stats and the visual frame with all checks green', () => {
    const r = runDesignTool('compile-spec', { spec: JSON.parse(spec) })
    expect(r.ok).toBe(true)
    const result = compileSpec(JSON.parse(spec))
    expect(result.checks.passed).toBe(true)
    const texts = result.pages[0].elements.filter((el) => el.type === 'text').map((el) => (el as { text: string }).text)
    for (const t of ['12k+', '42', '5', 'runners finished', 'villages on the route', 'years running', 'Last year at the finish line']) {
      expect(texts).toContain(t)
    }
    // stat underline: slim accent rects (height 4) per stat cell
    const underlines = result.pages[0].elements.filter(
      (el) => el.type === 'rect' && (el as { height?: number }).height === 4,
    )
    expect(underlines.length).toBeGreaterThanOrEqual(3)
    // mockup frame: a surface card large enough to be a real frame
    const frame = result.pages[0].elements.find(
      (el) => el.type === 'rect' && (el as { width?: number }).width !== undefined && ((el as { width: number }).width > 300) && (el as { fill?: string }).fill === result.palette.roles.surface,
    )
    expect(frame).toBeTruthy()
  })
})
