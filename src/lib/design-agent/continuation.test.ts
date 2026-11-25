// ─────────────────────────────────────────────────────────────
// Unified Canvix AI — the continuation acceptance (v0.32, hardened
// v0.32.1 after the external review).
//
// THE milestone acceptance test, exactly as specified:
//   a user requests an entire design → Canvix creates and verifies
//   it → the user continues refining that SAME design through
//   natural-language instructions — without losing required text,
//   colors, editability or context.
//
// All model seams are SCRIPTED (deterministic, no network, same
// style as pipeline.test.ts and harness.test.ts), but the document
// is REAL: the compiled pages are applied to the real editor store
// (appendPages), refinements execute through the REAL
// applyDesignAction (the same validated, undoable executor user
// edits ride), and the brief gate validates against the live store
// state exactly the way the Assistant panel does.
//
// v0.32.1 additions (the review's asks, as tests):
//   · strict normalized equality — appended words, case changes,
//     punctuation edits and missing spaces are REJECTIONS
//   · restrictions survive normalization ("no stock photos" persists)
//   · over-limit briefs are refused in reject mode, counted in clamp
//     mode — never silently weakened or truncated
//   · reload hydration regression (the GET payload's brief, not the
//     payload object, lands in the store)
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { runDesignAgent, type DesignAgentRun } from './pipeline'
import type { DesignAgentModel } from './model'
import { runAgentLoop } from '@/lib/agent/loop'
import { mergeBriefs, normalizeStoredBrief, validateBrief, type DesignBrief } from '@/lib/agent/brief'
import { type AgentDesignCtx, type AgentElementCtx } from '@/lib/agent/context'
import type { AgentEvent } from '@/lib/agent/protocol'
import { applyDesignAction, type DesignAction } from '@/lib/design-actions'
import { useEditorStore } from '@/store/editor-store'
import type { PageData, TextElement, AnyElement } from '@/lib/types'

// ── the prompt: an entire design, exact requirements ──────────

const PROMPT = [
  'Create a poster for a night run.',
  'The poster must show these exact lines:',
  '"Run Dal Lake 2026",',
  '"12km · Dachigam Road · 26 Jan",',
  '"Register at runwallah.example".',
  'Use the colors #1B3A6B and #E2604F somewhere.',
  'Size 1080x1350. Bold, energetic, night-sky feel.',
].join(' ')

const REQUIRED_TEXTS = ['Run Dal Lake 2026', '12km · Dachigam Road · 26 Jan', 'Register at runwallah.example']
const REQUIRED_COLORS = ['#1b3a6b', '#e2604f']

function specJson(): string {
  return JSON.stringify({
    version: 'v2',
    name: 'scripted night-run poster',
    format: { width: 1080, height: 1350 },
    palette: { seeds: ['#1B3A6B', '#E2604F'], mood: 'bold' },
    typography: { scale: 1.25 },
    blocks: [
      {
        kind: 'hero',
        weight: 4,
        content: [
          { role: 'headline', source: 'user-required', text: REQUIRED_TEXTS[0] },
          { role: 'subline', source: 'user-required', text: REQUIRED_TEXTS[1] },
          { role: 'cta', source: 'user-required', text: REQUIRED_TEXTS[2] },
        ],
        overlap: 'none',
      },
    ],
  })
}

/** the scripted planner: one call, the passing spec. */
const scriptedPlanner = (): DesignAgentModel => ({
  plan: async () => specJson(),
})

// ── store helpers (mirror what the panels do) ─────────────────

function seedStore(pages: PageData[], aiBrief: DesignBrief | null) {
  useEditorStore.getState().loadDesign({
    id: `design-continuation-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: 'Night Run Poster',
    width: 1080,
    height: 1350,
    // one blank page — the agent's page is APPENDED (the panel flow)
    pages: [{ id: 'page-blank', background: { type: 'solid', color: '#FFFFFF' }, elements: [] }],
    thumbnail: null,
    source: 'blank',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
  useEditorStore.getState().appendPages(pages)
  if (aiBrief) useEditorStore.getState().setAIBrief(aiBrief)
}

/** the design context the Assistant panel would post for this store
 *  state (tiered, with the stored brief riding along). */
function storeDesignContext(): AgentDesignCtx {
  const s = useEditorStore.getState()
  const page = s.pages[s.currentPage]
  const elements: AgentElementCtx[] = (page?.elements ?? []).map((el: AnyElement): AgentElementCtx => {
    const base: AgentElementCtx = {
      id: el.id,
      type: el.type,
      x: Math.round(el.x),
      y: Math.round(el.y),
      width: Math.round(el.width),
      height: Math.round(el.height),
    }
    if (el.type === 'text') {
      const t = el as TextElement
      base.text = t.text.slice(0, 80)
      base.fill = t.fill
      base.fontSize = Math.round(t.fontSize)
    } else if ('fill' in el && typeof (el as { fill?: unknown }).fill === 'string') {
      base.fill = (el as { fill: string }).fill
    }
    return base
  })
  return {
    name: s.designName,
    designId: s.designId,
    width: s.width,
    height: s.height,
    pageCount: s.pages.length,
    currentPageIndex: s.currentPage,
    elements,
    aiBrief: s.aiBrief ?? null,
  }
}

/** brief validation against the LIVE store — what the Assistant
 *  panel's computeBriefValidation does (flat elements included so
 *  composite features would validate too). */
function validateAgainstStore(brief: DesignBrief): { satisfied: boolean; unmet: string[] } {
  const s = useEditorStore.getState()
  const page = s.pages[s.currentPage]
  const els: AnyElement[] = []
  const flatten = (list: AnyElement[]) => {
    for (const el of list) {
      els.push(el)
      if (el.type === 'group') flatten(el.children)
    }
  }
  flatten(page?.elements ?? [])
  const texts = els.filter((e) => e.type === 'text').map((e) => (e as TextElement).text)
  const colors = new Set<string>()
  for (const el of els) {
    if ('fill' in el && typeof (el as { fill?: unknown }).fill === 'string') {
      colors.add(((el as { fill: string }).fill).toLowerCase())
    }
    if ('stroke' in el && typeof (el as { stroke?: unknown }).stroke === 'string') {
      colors.add(((el as { stroke: string }).stroke).toLowerCase())
    }
  }
  if (page?.background?.type === 'solid') colors.add(page.background.color.toLowerCase())
  const result = validateBrief(brief, {
    texts,
    colors: [...colors],
    width: s.width,
    height: s.height,
    elements: els.slice(0, 120).map((e) => ({
      type: e.type,
      x: Math.round(e.x),
      y: Math.round(e.y),
      width: Math.round(e.width),
      height: Math.round(e.height),
      ...('fill' in e && typeof (e as { fill?: unknown }).fill === 'string' ? { fill: (e as { fill: string }).fill } : {}),
      ...('stroke' in e && typeof (e as { stroke?: unknown }).stroke === 'string' ? { stroke: (e as { stroke: string }).stroke } : {}),
      ...(e.type === 'text' ? { text: (e as TextElement).text } : {}),
    })),
  })
  return { satisfied: result.satisfied, unmet: result.unmet }
}

/** find a text element's id by its exact text (on the current page). */
function textElementId(text: string): string {
  const page = useEditorStore.getState().pages[useEditorStore.getState().currentPage]
  const el = (page?.elements ?? []).find((e) => e.type === 'text' && (e as TextElement).text === text)
  if (!el) throw new Error(`no text element with "${text}" on the applied page`)
  return el.id
}

/** the panel's applyActions: run the emitted action batch through the
 *  REAL executor (same validated, undoable path user edits ride). */
async function applyForReal(actions: DesignAction[]): Promise<{ ok: boolean; message?: string }> {
  try {
    for (const a of actions) {
      if (a.type === '__validateBrief') continue
      await applyDesignAction(a, undefined)
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'action failed' }
  }
}

/** scripted chat: pops replies in order; records every request. */
function scriptedChat(replies: string[]) {
  const calls: { role: string; content: string }[][] = []
  const chat = async (messages: { role: 'system' | 'user' | 'assistant'; content: string }[]) => {
    calls.push(messages.map((m) => ({ role: m.role, content: m.content })))
    return replies.shift() ?? JSON.stringify({ done: true, summary: '(script exhausted)' })
  }
  return { chat, calls }
}
const turn = (tool: string, args: Record<string, unknown> = {}, thought = 'step') =>
  JSON.stringify({ thought, tool, args })
const done = (summary: string) => JSON.stringify({ done: true, summary })

/** run the refine loop exactly the route does it: the stored brief is
 *  normalized from the context, edit mode still gates on it, and the
 *  apply path executes for real. */
async function refineWithAgent(
  messages: string[],
  brief: DesignBrief | null,
): Promise<{ result: Awaited<ReturnType<typeof runAgentLoop>>; events: AgentEvent[]; calls: { role: string; content: string }[][] }> {
  const events: AgentEvent[] = []
  const { chat, calls } = scriptedChat(messages)
  const design = storeDesignContext()
  const storedBrief = normalizeStoredBrief(design.aiBrief)?.brief ?? brief
  let pending: DesignAction[] = []
  const result = await runAgentLoop({
    chat,
    design,
    mode: 'edit',
    brief: storedBrief,
    emit: (e) => {
      events.push(e)
      if (e.type === 'action') pending = e.actions as DesignAction[]
    },
    // the REAL executor — proving the applied pages are editable
    awaitApply: async () => applyForReal(pending),
    validateBriefOnClient: async () =>
      validateAgainstStore(storedBrief ?? { requiredTexts: [], requiredColors: [], restrictions: [], notes: [], source: 'user' }),
  })
  return { result: result as Awaited<ReturnType<typeof runAgentLoop>>, events, calls }
}

// ═════════════════════════════════════════════════════════════
// 1. the merge + hygiene units
// ═════════════════════════════════════════════════════════════

describe('mergeBriefs: the continuation contract', () => {
  const stored: DesignBrief = {
    requiredTexts: [
      { tier: 'mandatory', text: 'Run Dal Lake 2026' },
      { tier: 'mandatory', text: '12km · Dachigam Road · 26 Jan' },
    ],
    requiredColors: [{ tier: 'mandatory', hex: '#1b3a6b' }],
    restrictions: ['no stock photos'],
    notes: [],
    source: 'user',
  }
  const live: DesignBrief = {
    requiredTexts: [{ tier: 'mandatory', text: 'run dal lake 2026 ' }],
    requiredColors: [{ tier: 'mandatory', hex: '#E2604F' }],
    dimensions: { tier: 'mandatory', width: 1080, height: 1080 },
    restrictions: [],
    notes: [],
    source: 'user',
  }

  it('unions requirements — the stored contract survives refinement, deduped', () => {
    const merged = mergeBriefs(stored, live)
    expect(merged.requiredTexts.map((t) => t.text)).toEqual([
      'Run Dal Lake 2026',
      '12km · Dachigam Road · 26 Jan',
    ])
    expect(merged.requiredColors.map((c) => c.hex.toLowerCase())).toEqual(['#1b3a6b', '#e2604f'])
    expect(merged.restrictions).toEqual(['no stock photos'])
  })

  it("the live message's explicit dimensions win; without them the stored ones carry", () => {
    expect(mergeBriefs(stored, live).dimensions).toEqual({ tier: 'mandatory', width: 1080, height: 1080 })
    expect(
      mergeBriefs({ ...stored, dimensions: { tier: 'mandatory', width: 1080, height: 1350 } }, { ...live, dimensions: undefined }).dimensions,
    ).toEqual({ tier: 'mandatory', width: 1080, height: 1350 })
  })

  it('a same-kind composite feature is replaced by the live entry (newest count/intent)', () => {
    const withCards: DesignBrief = {
      ...stored,
      requiredFeatures: [{ tier: 'mandatory', kind: 'feature-cards', count: 3, label: '3 feature cards' }],
    }
    const merged = mergeBriefs(withCards, {
      ...live,
      requiredFeatures: [{ tier: 'mandatory', kind: 'feature-cards', count: 5, label: '5 feature cards' }],
    })
    expect(merged.requiredFeatures).toEqual([{ tier: 'mandatory', kind: 'feature-cards', count: 5, label: '5 feature cards' }])
  })
})

describe('normalizeStoredBrief: provenance hygiene (v0.32.1 — nothing silently weakened)', () => {
  it('keeps texts/colors, forces mandatory, drops dimensions (the design owns geometry after apply)', () => {
    const brief = normalizeStoredBrief({
      requiredTexts: [{ tier: 'preference', text: 'Run Dal Lake 2026' }],
      requiredColors: [{ tier: 'preference', hex: '#1B3A6B' }],
      dimensions: { tier: 'mandatory', width: 1080, height: 1350 },
      source: 'model-refined',
    })
    expect(brief).not.toBeNull()
    expect(brief!.brief.requiredTexts).toEqual([{ tier: 'mandatory', text: 'Run Dal Lake 2026' }])
    expect(brief!.brief.requiredColors).toEqual([{ tier: 'mandatory', hex: '#1b3a6b' }])
    expect(brief!.brief.dimensions).toBeUndefined()
  })

  it('restrictions and notes SURVIVE persistence (a "no stock photos" stays in the contract)', () => {
    const brief = normalizeStoredBrief({
      requiredTexts: [{ text: 'Run Dal Lake 2026' }],
      restrictions: ['  no   stock photos ', 'avoid cluttered layouts'],
      notes: ['night-sky feel'],
    })
    expect(brief!.brief.restrictions).toEqual(['no stock photos', 'avoid cluttered layouts'])
    expect(brief!.brief.notes).toEqual(['night-sky feel'])
  })

  it('clamp mode bounds a hostile payload and COUNTS what it dropped; junk is null', () => {
    const hostile = {
      requiredTexts: Array.from({ length: 100 }, (_, i) => ({ text: `t${i}` })),
      requiredColors: Array.from({ length: 50 }, () => ({ hex: '#123456' })),
    }
    const brief = normalizeStoredBrief(hostile)
    // generous caps — a real pipeline brief never approaches them
    expect(brief!.brief.requiredTexts).toHaveLength(64)
    expect(brief!.brief.requiredColors).toHaveLength(32)
    expect(brief!.dropped).toBe((100 - 64) + (50 - 32))
    expect(normalizeStoredBrief({ requiredTexts: [{ text: '   ' }] })).toBeNull()
    expect(normalizeStoredBrief('junk')).toBeNull()
    expect(normalizeStoredBrief(null)).toBeNull()
    expect(normalizeStoredBrief({ requiredColors: [{ hex: '#12345' }] })).toBeNull()
  })

  it('reject mode REFUSES over-limit briefs instead of storing a weakened contract — never truncation', () => {
    const overCap = {
      requiredTexts: Array.from({ length: 65 }, (_, i) => ({ text: `t${i}` })),
    }
    expect(normalizeStoredBrief(overCap, { overflow: 'reject' })).toBeNull()
    // a text LONGER than the cap is dropped in clamp mode (a truncated
    // requirement is a DIFFERENT requirement) and refused in reject
    // mode — never sliced mid-string
    const longText = { requiredTexts: [{ text: 'x'.repeat(401) }] }
    expect(normalizeStoredBrief(longText)).toBeNull()
    expect(normalizeStoredBrief(longText, { overflow: 'reject' })).toBeNull()
    // within limits, reject mode stores exactly what was given
    const fine = { requiredTexts: [{ text: 'Run Dal Lake 2026' }], restrictions: ['no stock photos'] }
    const ok = normalizeStoredBrief(fine, { overflow: 'reject' })
    expect(ok!.brief.requiredTexts).toEqual([{ tier: 'mandatory', text: 'Run Dal Lake 2026' }])
    expect(ok!.brief.restrictions).toEqual(['no stock photos'])
    expect(ok!.dropped).toBe(0)
  })
})

// ═════════════════════════════════════════════════════════════
// 2. strict normalized equality (review P0 — the regressions asked
//    for: appended words, capitalization, punctuation, spaces)
// ═════════════════════════════════════════════════════════════

describe('validateBrief: required texts are EXACT, not substrings', () => {
  const brief: DesignBrief = {
    requiredTexts: [{ tier: 'mandatory', text: 'Run Dal Lake 2026' }],
    requiredColors: [{ tier: 'mandatory', hex: '#1b3a6b' }],
    restrictions: [],
    notes: [],
    source: 'user',
  }
  const state = (texts: string[]) => ({ texts, colors: ['#1b3a6b'], width: 1080, height: 1350 })

  it('the exact string passes; whitespace wrap is tolerated', () => {
    expect(validateBrief(brief, state(['Run Dal Lake 2026'])).satisfied).toBe(true)
    expect(validateBrief(brief, state(['  Run\nDal   Lake 2026 '])).satisfied).toBe(true)
  })
  it('appended words do NOT satisfy the requirement (the review\u2019s example)', () => {
    expect(validateBrief(brief, state(['Run Dal Lake 2026 — Special Offer'])).satisfied).toBe(false)
    expect(validateBrief(brief, state(['Tonight: Run Dal Lake 2026'])).satisfied).toBe(false)
  })
  it('capitalization changes are rejections', () => {
    expect(validateBrief(brief, state(['RUN DAL LAKE 2026'])).satisfied).toBe(false)
    expect(validateBrief(brief, state(['run dal lake 2026'])).satisfied).toBe(false)
  })
  it('altered punctuation and missing spaces are rejections', () => {
    expect(validateBrief(brief, state(['Run Dal Lake 2026!'])).satisfied).toBe(false)
    expect(validateBrief(brief, state(['Run Dal Lake, 2026'])).satisfied).toBe(false)
    expect(validateBrief(brief, state(['RunDalLake 2026'])).satisfied).toBe(false)
    expect(validateBrief(brief, state(['Run Dal Lake2026'])).satisfied).toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════
// 3. reload hydration + the pending-contract lifecycle (client side)
// ═════════════════════════════════════════════════════════════

describe('provenance hydration (the reload path)', () => {
  it('the GET payload\u2019s BRIEF lands in the store — not the payload object (v0.32 regression)', () => {
    const brief: DesignBrief = {
      requiredTexts: [{ tier: 'mandatory', text: 'Run Dal Lake 2026' }],
      requiredColors: [{ tier: 'mandatory', hex: '#1b3a6b' }],
      restrictions: ['no stock photos'],
      notes: [],
      source: 'user',
    }
    useEditorStore.getState().loadDesign({
      id: `design-hydrate-${Date.now()}`,
      name: 'Night Run Poster',
      width: 1080,
      height: 1350,
      pages: [{ id: 'p1', background: { type: 'solid', color: '#FFFFFF' }, elements: [] }],
      thumbnail: null,
      source: 'blank',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // exactly what GET /api/designs/[id] returns for an editor
      aiProvenance: { brief, outcome: 'passed', verified: true, verifiedAt: '2026-11-25T00:00:00.000Z' },
    })
    const s = useEditorStore.getState()
    // the hydration bug stored the whole PAYLOAD as the brief — the
    // posted aiBrief then normalized to nothing and reload silently
    // lost the contract
    expect(s.aiBrief).toEqual(brief)
  })

  it('a design without provenance hydrates to no brief; loadDesign clears pending', () => {
    useEditorStore.getState().setAIPendingProvenance({
      prompt: 'old prompt',
      outcome: 'passed',
      brief: {
        requiredTexts: [{ tier: 'mandatory', text: 'stale' }],
        requiredColors: [],
        restrictions: [],
        notes: [],
        source: 'user',
      },
    })
    useEditorStore.getState().loadDesign({
      id: `design-hydrate-plain-${Date.now()}`,
      name: 'Plain',
      width: 1080,
      height: 1080,
      pages: [{ id: 'p1', background: { type: 'solid', color: '#FFFFFF' }, elements: [] }],
      thumbnail: null,
      source: 'blank',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    const s = useEditorStore.getState()
    expect(s.aiBrief).toBeNull()
    expect(s.aiPendingProvenance).toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════
// 4. THE acceptance: create → verify → refine on one design
// ═════════════════════════════════════════════════════════════

describe('Unified Canvix AI acceptance: create → verify → refine on ONE design', () => {
  it('the full loop — no lost text, colors, editability or context', async () => {
    // ── CREATE: one prompt in, the autonomous pipeline runs ────
    const run: DesignAgentRun = await runDesignAgent({ prompt: PROMPT, model: scriptedPlanner() })

    // ── VERIFY: the pipeline's own deterministic verdict ───────
    expect(run.outcome).toBe('passed')
    expect(run.checks?.passed).toBe(true)
    expect(run.briefConformance).toEqual([])
    expect(run.pages?.length).toBeGreaterThan(0)
    const appliedTexts = (run.pages?.[0].elements ?? []).filter((e) => e.type === 'text').map((e) => (e as TextElement).text)
    for (const t of REQUIRED_TEXTS) expect(appliedTexts).toContain(t)
    expect(run.report.brief.requiredTexts.map((t) => t.text)).toEqual(expect.arrayContaining(REQUIRED_TEXTS))

    // ── APPLY: the panel flow on the REAL store ───────────────
    seedStore(run.pages ?? [], run.report.brief)
    const s0 = useEditorStore.getState()
    expect(s0.aiBrief).not.toBeNull()
    // the applied page is current and carries every requirement
    expect(s0.pages[s0.currentPage].elements.length).toBeGreaterThan(0)

    // ── REFINE (happy path): natural-language restyling through
    // the chat agent — the REAL executor applies the patch ─────
    const headlineId = textElementId(REQUIRED_TEXTS[0])
    const before = useEditorStore.getState().pages[useEditorStore.getState().currentPage].elements.find((e) => e.id === headlineId) as TextElement
    const { result, events, calls } = await refineWithAgent(
      [
        turn('update_elements', { ids: [headlineId], patch: { fontSize: 96 } }, 'make the headline bigger'),
        done('Headline enlarged, everything else kept'),
      ],
      null,
    )

    // context: the system prompt carried the stored brief's exact
    // requirements — the refinement knew what it must not lose
    const systemPrompt = calls[0]?.[0]?.content ?? ''
    expect(systemPrompt).toContain('DESIGN BRIEF CONTRACT')
    for (const t of REQUIRED_TEXTS) expect(systemPrompt).toContain(`"${t}"`)
    expect(systemPrompt).toContain('#1B3A6B')

    // editability: the SAME executor user edits ride actually changed
    // the applied element (and it stayed a real, unlocked text element)
    const after = useEditorStore.getState().pages[useEditorStore.getState().currentPage].elements.find((e) => e.id === headlineId) as TextElement
    expect(after.fontSize).toBe(96)
    expect(after.fontSize).not.toBe(before.fontSize)
    expect(after.type).toBe('text')
    expect(after.locked).toBeFalsy()

    // the contract held: brief validation against the LIVE store
    const storedBrief = normalizeStoredBrief(run.report.brief)!.brief
    const v = validateAgainstStore(storedBrief)
    expect(v.satisfied).toBe(true)
    expect(v.unmet).toEqual([])

    // the loop's done-gate ran in EDIT mode (continuation) and the
    // run reported the validated contract
    expect(result.toolCalls).toBe(1)
    expect(result.verification).toContain('Brief contract validated')
    const finalEvent = events[events.length - 1]
    expect(finalEvent?.type).toBe('done')
  })

  it('the edit-mode brief gate REJECTS a refinement that loses a required text (enforced, not hoped)', async () => {
    const run = await runDesignAgent({ prompt: PROMPT, model: scriptedPlanner() })
    expect(run.outcome).toBe('passed')
    seedStore(run.pages ?? [], run.report.brief)
    const storedBrief = normalizeStoredBrief(run.report.brief)!.brief

    // sanity: the applied design satisfies its own contract
    expect(validateAgainstStore(storedBrief).satisfied).toBe(true)

    const headlineId = textElementId(REQUIRED_TEXTS[0])
    const { result, events, calls } = await refineWithAgent(
      [
        // the "refinement" rewrites the headline — losing the
        // required text
        turn('update_elements', { ids: [headlineId], patch: { text: 'Totally Different Headline' } }, 'retitle'),
        done('Retitled'),
        // the gate bounces it back with the unmet list; the model
        // restores the exact required string
        turn('update_elements', { ids: [headlineId], patch: { text: REQUIRED_TEXTS[0] } }, 'restore the required headline'),
        done('Restored the required headline verbatim'),
      ],
      storedBrief,
    )

    // the done-gate fired in edit mode and REJECTED the first done
    const rejection = calls.find((c) => c.some((m) => m.role === 'user' && m.content.includes('NOT DONE')))
    expect(rejection).toBeDefined()
    expect(rejection!.find((m) => m.role === 'user' && m.content.includes('NOT DONE'))!.content).toContain(REQUIRED_TEXTS[0])

    // the store ends with the requirement intact
    const restored = useEditorStore.getState().pages[useEditorStore.getState().currentPage].elements.find((e) => e.id === headlineId) as TextElement
    expect(restored.text).toBe(REQUIRED_TEXTS[0])
    expect(validateAgainstStore(storedBrief).satisfied).toBe(true)

    // and the run finished with the validated contract
    expect(result.verification).toContain('Brief contract validated')
    const finalEvent = events[events.length - 1]
    expect(finalEvent?.type).toBe('done')
  })

  it('appended words are rejected too — strict equality is what the gate enforces (review P0)', async () => {
    const run = await runDesignAgent({ prompt: PROMPT, model: scriptedPlanner() })
    expect(run.outcome).toBe('passed')
    seedStore(run.pages ?? [], run.report.brief)
    const storedBrief = normalizeStoredBrief(run.report.brief)!.brief

    const headlineId = textElementId(REQUIRED_TEXTS[0])
    const { calls, result } = await refineWithAgent(
      [
        // the "refinement" appends a promo line to the required
        // headline — a SUBSTRING match would let this ride through
        turn('update_elements', { ids: [headlineId], patch: { text: `${REQUIRED_TEXTS[0]} — Special Offer` } }, 'add a promo suffix'),
        done('Suffixed'),
        turn('update_elements', { ids: [headlineId], patch: { text: REQUIRED_TEXTS[0] } }, 'restore the exact required headline'),
        done('Restored verbatim'),
      ],
      storedBrief,
    )

    // the gate REJECTED the appended-words done: the unmet list named
    // the requirement
    const rejection = calls.find((c) => c.some((m) => m.role === 'user' && m.content.includes('NOT DONE')))
    expect(rejection).toBeDefined()
    expect(rejection!.find((m) => m.role === 'user' && m.content.includes('NOT DONE'))!.content).toContain(REQUIRED_TEXTS[0])

    const restored = useEditorStore.getState().pages[useEditorStore.getState().currentPage].elements.find((e) => e.id === headlineId) as TextElement
    expect(restored.text).toBe(REQUIRED_TEXTS[0])
    expect(result.verification).toContain('Brief contract validated')
  })
})
