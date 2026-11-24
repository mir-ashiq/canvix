// ─────────────────────────────────────────────────────────────
// The v0.28 agent harness — "test it thoroughly, not one simple
// case". Layers:
//
//   1. TOOL MATRIX      — every registered tool × valid/invalid/
//                         boundary/adversarial args; registry
//                         coverage forces new tools to add cases.
//   2. MODES            — mode tool surfaces (review physically
//                         cannot write), heuristic classification.
//   3. BRIEF CONTRACT   — extraction (exact texts/colors/dims) and
//                         validation against real state.
//   4. SKILLS ENGINE    — router matching, prompt injection,
//                         progressive disclosure contract.
//   5. LIFECYCLE FLOWS  — Case A exact-copy poster; Case B review
//                         grounding; Case C long run (>8 steps, no
//                         cap); Case D geometry repair; Case E
//                         capability sweep; Case F safety (strikes,
//                         cycles, abort, decline, provider failure).
//   6. WIRE FORMAT      — SSE round-trips, parser robustness.
//
// The "LLM" is a scripted queue — deterministic, no network.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { parseAgentTurn, sseLine, AGENT_GUARDS, AGENT_PROTOCOL_VERSION, type AgentEvent } from './protocol'
import { AGENT_TOOL_MAP, AGENT_TOOLS, type ToolContext, type SanitizeResult } from './tools'
import { runAgentLoop, toolsForMode, loopSystemPrompt } from './loop'
import { auditDesign, contrastRatio } from './audit'
import { heuristicMode, parseMode, modeAllowsWrites, MODE_TOOL_RISK } from './router'
import { DESIGN_SKILLS, selectSkills, skillsPromptSection } from './skills'
import { extractBrief, validateBrief, briefPromptSection, FORMAT_PRESETS, type DesignBrief } from './brief'
import { serializeDesignContext, contextValidIds, type AgentDesignCtx } from './context'
import type { AgentMode } from './protocol'

// ── fixtures ─────────────────────────────────────────────────

const ctx: ToolContext = {
  validIds: new Set(['el-1', 'el-2', 'txt-1', 'txt-2', 'grp-1', 'img-1']),
  width: 1080,
  height: 1080,
  fonts: new Set(['Poppins', 'Inter', 'Montserrat', 'Playfair Display']),
}

const design: AgentDesignCtx = {
  name: 'Launch Poster',
  width: 1080,
  height: 1080,
  templateType: 'poster',
  pageCount: 3,
  currentPageIndex: 0,
  selectedIds: ['txt-1'],
  elements: [
    { id: 'el-1', type: 'rect', x: 0, y: 0, width: 100, height: 100, fill: '#FF0000' },
    { id: 'el-2', type: 'rect', x: 50, y: 50, width: 100, height: 100, fill: '#00FF00' },
    { id: 'txt-1', type: 'text', x: 0, y: 200, width: 400, height: 60, text: 'Hello', fontSize: 48, fill: '#111111' },
    { id: 'txt-2', type: 'text', x: 0, y: 300, width: 400, height: 60, text: 'World', fontSize: 32, fill: '#222222' },
    { id: 'grp-1', type: 'group', x: 10, y: 10, width: 200, height: 200 },
    { id: 'img-1', type: 'image', x: 0, y: 400, width: 300, height: 200 },
  ],
  colorsInUse: ['#111111', '#FF0000'],
  fontsInUse: ['Inter'],
  brand: { colors: ['#7D2AE8', '#02C0CC'], headingFont: 'Poppins', bodyFont: 'Inter' },
  overlaps: ['rect#el-1 × rect#el-2 (25%)'],
  offCanvas: [],
  otherPages: ['p1: 4 elements', 'p2: 7 elements'],
}

/** scripted chat: pops replies in order; records every request */
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
const done = (summary: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ done: true, summary, ...extra })

// ═════════════════════════════════════════════════════════════
// 1. TOOL MATRIX
// ═════════════════════════════════════════════════════════════

describe('harness · tool matrix', () => {
  const tool = (name: string) => {
    const t = AGENT_TOOL_MAP.get(name)
    if (!t) throw new Error(`tool "${name}" is not registered`)
    return t
  }
  const call = (name: string, args: Record<string, unknown>, c: ToolContext = ctx): SanitizeResult =>
    tool(name).sanitize(args, c)

  it('every tool in the registry is covered by this harness', () => {
    const covered = [
      'get_page_state', 'add_text', 'add_shape', 'add_image', 'add_stock_photo', 'add_sticker',
      'add_table', 'update_elements', 'set_text_style', 'move_elements', 'align_elements',
      'distribute_elements', 'set_background', 'set_font', 'recolor', 'add_page', 'duplicate_page',
      'goto_page', 'fix_overlaps', 'balance_layout', 'animate_page', 'translate_texts',
      'delete_elements', 'clear_page',
      // v0.28 bridge tools
      'add_line', 'add_icon', 'add_illustration', 'add_chart', 'add_qr', 'add_frame', 'add_embed',
      'duplicate_elements', 'group_elements', 'ungroup_elements', 'reorder_layers',
      'animate_elements', 'set_page_transition', 'delete_page', 'set_brand_kit', 'resize_design',
      'mask_image', 'adjust_image', 'measure_text', 'set_text_spans', 'export_design',
      'add_stock_video', 'validate_brief',
    ]
    for (const t of AGENT_TOOLS) expect(covered, `add harness cases for new tool "${t.name}"`).toContain(t.name)
    expect(covered).toHaveLength(AGENT_TOOLS.length)
    expect(AGENT_TOOLS.length).toBeGreaterThanOrEqual(46)
  })

  // ── v0.27 tools (regression) ─────────────────────────────
  it('core v0.27 tools still validate correctly', () => {
    expect(call('add_text', { text: 'Hi', fontSize: 6 }).ok).toBe(true)
    expect(call('add_text', { text: 'x', fontSize: 5 }).ok).toBe(false)
    expect(call('add_text', { text: 'x', fontFamily: 'Comic Sans' }).ok).toBe(false)
    expect(call('update_elements', { ids: ['ghost'], patch: { fill: '#123456' } }).ok).toBe(false)
    expect(call('update_elements', { ids: ['el-1'], patch: { fill: 'red' } }).ok).toBe(false)
    expect(call('distribute_elements', { ids: ['el-1', 'el-2'], axis: 'x' }).ok).toBe(false)
    expect(call('distribute_elements', { ids: ['el-1', 'el-2', 'img-1'], axis: 'x' }).ok).toBe(true)
    expect(call('goto_page', { page: 2 }).ok).toBe(true)
    expect(call('goto_page', { page: 0 }).ok).toBe(false)
    expect(tool('delete_elements').risk).toBe('destructive')
    expect(tool('clear_page').risk).toBe('destructive')
  })

  // ── extended update_elements patch surface ───────────────
  it('update_elements accepts the full v0.28 patch surface', () => {
    const r = call('update_elements', {
      ids: ['el-1'],
      patch: { rotation: 45, opacity: 0.5, italic: true, uppercase: true, curve: 30, flipH: true, locked: true, visible: false, letterSpacing: 2, lineHeight: 1.4 },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.actions[0].patch).toMatchObject({ rotation: 45, opacity: 0.5, curve: 30, locked: true })
    }
  })
  it('update_elements rejects out-of-range curve/brightness with the range echoed', () => {
    for (const [patch, hint] of [
      [{ curve: 300 }, '−180..180'],
      [{ brightness: 400 }, '−100..100'],
      [{ opacity: 2 }, '0–1'],
    ] as const) {
      const r = call('update_elements', { ids: ['el-1'], patch })
      expect(r.ok, JSON.stringify(patch)).toBe(false)
      if (!r.ok) expect(r.error).toContain(hint)
    }
  })

  // ── new v0.28 tools: valid + invalid each ────────────────
  it('add_line validates geometry and variants', () => {
    expect(call('add_line', { x: 10, y: 10, length: 200, variant: 'arrow', stroke: '#123456' }).ok).toBe(true)
    expect(call('add_line', { x: 10, length: 200 }).ok).toBe(false) // no y
    expect(call('add_line', { x: 1, y: 1, length: 4 }).ok).toBe(false) // too short
    expect(call('add_line', { x: 1, y: 1, length: 200, stroke: 'blue' }).ok).toBe(false)
  })
  it('add_icon / add_illustration require queries', () => {
    expect(call('add_icon', { query: 'arrow right' }).ok).toBe(true)
    expect(call('add_icon', { query: 'a' }).ok).toBe(false)
    expect(call('add_illustration', { query: 'waves' }).ok).toBe(true)
    expect(call('add_illustration', { query: 'x' }).ok).toBe(false)
  })
  it('add_chart validates kind + series shape', () => {
    const ok = call('add_chart', {
      kind: 'bar',
      labels: ['Q1', 'Q2'],
      series: [{ name: 'Rev', color: '#7630D7', values: [10, 20] }],
    })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.actions[0]).toMatchObject({ type: 'addChart', kind: 'bar' })
    expect(call('add_chart', { kind: 'pie' }).ok).toBe(false) // not a kind
    expect(call('add_chart', { kind: 'donut', series: [{ name: 'X', values: [1] }] }).ok).toBe(true) // 1-value series dropped → sample data
  })
  it('add_qr validates value + colors', () => {
    expect(call('add_qr', { value: 'https://canvix.app', dark: '#090B1A' }).ok).toBe(true)
    expect(call('add_qr', { value: '' }).ok).toBe(false)
    expect(call('add_qr', { value: 'x', dark: 'navy' }).ok).toBe(false)
  })
  it('add_frame / add_embed validate', () => {
    expect(call('add_frame', { frameShape: 'circle', width: 400, height: 400 }).ok).toBe(true)
    expect(call('add_frame', { frameShape: 'hexagon' }).ok).toBe(false)
    expect(call('add_embed', { url: 'https://youtu.be/x' }).ok).toBe(true)
    expect(call('add_embed', { url: 'ftp://nope' }).ok).toBe(false)
  })
  it('duplicate/group/ungroup/reorder validate id lists', () => {
    expect(call('duplicate_elements', { ids: ['el-1'] }).ok).toBe(true)
    expect(call('group_elements', { ids: ['el-1'] }).ok).toBe(false)
    expect(call('group_elements', { ids: ['el-1', 'el-2'] }).ok).toBe(true)
    expect(call('reorder_layers', { ids: ['el-1'], dir: 'front' }).ok).toBe(true)
    expect(call('reorder_layers', { ids: ['el-1'], dir: 'sideways' }).ok).toBe(false)
    expect(call('reorder_layers', { ids: ['el-1'] }).ok).toBe(false) // neither dir nor ≥2 ids
  })
  it('animate_elements + set_page_transition validate kinds', () => {
    expect(call('animate_elements', { ids: ['el-1'], kind: 'pop', duration: 0.4, direction: 'up' }).ok).toBe(true)
    expect(call('animate_elements', { ids: ['el-1'], kind: 'explode' }).ok).toBe(false)
    expect(call('set_page_transition', { kind: 'slide' }).ok).toBe(true)
    expect(call('set_page_transition', { kind: 'spin' }).ok).toBe(false)
  })
  it('delete_page is destructive and bounds-checks', () => {
    expect(tool('delete_page').risk).toBe('destructive')
    expect(call('delete_page', { page: 2 }).ok).toBe(true)
    expect(call('delete_page', { page: 0 }).ok).toBe(false)
    expect(call('delete_page', { page: 500 }).ok).toBe(false)
  })
  it('set_brand_kit validates fonts against the catalog', () => {
    expect(call('set_brand_kit', { colors: ['#090B1A', '#8B5CF6'], headingFont: 'Poppins' }).ok).toBe(true)
    expect(call('set_brand_kit', { headingFont: 'Wingdings' }).ok).toBe(false)
    expect(call('set_brand_kit', {}).ok).toBe(false)
  })
  it('resize_design validates the 50–10000 range', () => {
    expect(call('resize_design', { width: 1080, height: 1920 }).ok).toBe(true)
    expect(call('resize_design', { width: 10, height: 10 }).ok).toBe(false)
    expect(call('resize_design', { width: 99999, height: 10 }).ok).toBe(false)
  })
  it('mask_image / adjust_image validate masks and ranges', () => {
    expect(call('mask_image', { ids: ['img-1'], mask: 'circle' }).ok).toBe(true)
    expect(call('mask_image', { ids: ['img-1'], mask: 'blob' }).ok).toBe(false)
    expect(call('adjust_image', { ids: ['img-1'], brightness: 40, contrast: -20 }).ok).toBe(true)
    expect(call('adjust_image', { ids: ['img-1'], brightness: 400 }).ok).toBe(false)
    expect(call('adjust_image', { ids: ['el-1'], brightness: 10 }).ok).toBe(true) // ids valid; client filters to images
  })
  it('measure_text validates font + size and is read-only', () => {
    expect(tool('measure_text').risk).toBe('read')
    expect(call('measure_text', { text: 'Design Beyond Limits', fontSize: 96, fontFamily: 'Poppins', bold: true }).ok).toBe(true)
    expect(call('measure_text', { text: 'x', fontSize: 5 }).ok).toBe(false)
    expect(call('measure_text', { text: 'x', fontSize: 48, fontFamily: 'Nope' }).ok).toBe(false)
  })
  it('set_text_spans requires span arrays', () => {
    expect(call('set_text_spans', { ids: ['txt-1'], spans: [{ text: 'Hel' }, { text: 'lo', bold: true }] }).ok).toBe(true)
    expect(call('set_text_spans', { ids: ['txt-1'], spans: [] }).ok).toBe(false)
    expect(call('set_text_spans', { ids: ['txt-1'] }).ok).toBe(false)
  })
  it('export_design / add_stock_video / validate_brief compile', () => {
    expect(call('export_design', { format: 'png' }).ok).toBe(true)
    expect(call('export_design', { format: 'bmp' }).ok).toBe(true) // falls back to png client-side
    expect(call('add_stock_video', { query: 'city timelapse' }).ok).toBe(true)
    expect(call('add_stock_video', { query: 'ab' }).ok).toBe(false)
    expect(call('validate_brief', {}).ok).toBe(true)
  })

  // ── universal invariants ─────────────────────────────────
  it('EVERY tool: sanitizers never throw on adversarial args', () => {
    const adversarial = [
      { ids: 'not-an-array', patch: { fill: { deep: 'object' } } },
      { text: { nested: true }, fontSize: NaN },
      { header: 'string', rows: 42, series: 'no' },
      { page: Infinity, factor: 'x', spans: 7 },
      { palette: 'no', ids: [null, 123, {}], values: [{ no: 'text' }] },
      { dx: '1e999', shape: { fake: 1 }, mask: { deep: 1 } },
    ]
    for (const t of AGENT_TOOLS) {
      for (const args of adversarial) {
        expect(() => t.sanitize(args as Record<string, unknown>, ctx), `${t.name} ${JSON.stringify(args).slice(0, 40)}`).not.toThrow()
      }
    }
  })
  it('exactly three tools are destructive', () => {
    const destructive = AGENT_TOOLS.filter((t) => t.risk === 'destructive').map((t) => t.name)
    expect(destructive.sort()).toEqual(['clear_page', 'delete_elements', 'delete_page'])
  })
  it('read tools are exactly the state/measure/validate set', () => {
    const reads = AGENT_TOOLS.filter((t) => t.risk === 'read').map((t) => t.name)
    expect(reads.sort()).toEqual(['get_page_state', 'goto_page', 'measure_text', 'validate_brief'])
  })

  it('CASE G: quality audit — one self-critique fix round before done is accepted', async () => {
    const events: AgentEvent[] = []
    let auditCalls = 0
    // model: bg → text → attempt done (audit finds low contrast) → fix
    // fill → done (audit clean, accepted)
    const { chat } = scriptedChat([
      turn('set_background', { kind: 'solid', from: '#090B1A' }),
      turn('add_text', { text: 'Dark text on dark bg', fontSize: 40, color: '#111122' }),
      done('Poster complete'),
      turn('add_text', { text: 'Fixed headline', fontSize: 40, color: '#FFFFFF' }),
      done('Poster complete, contrast fixed'),
    ])
    const result = await runAgentLoop({
      chat,
      design,
      mode: 'create',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
      auditDesign: async () => {
        auditCalls++
        return auditCalls === 1
          ? ['Low contrast: text "Dark text on dark bg" #111122 on background #090B1A is 1.0:1 (needs 3:1) — change the text fill.']
          : []
      },
    })
    // 3 tool turns; the first done was rejected by the audit gate
    expect(result.toolCalls).toBe(3)
    expect(auditCalls).toBe(2)
    expect(events.some((e) => e.type === 'observation' && e.message.includes('QUALITY AUDIT'))).toBe(true)
    const finalEvent = events[events.length - 1]
    expect(finalEvent?.type).toBe('done')
    expect(String((finalEvent as { verification?: string }).verification ?? '')).toContain('Quality audit passed')
  })

  it('CASE H: audit residue is disclosed, never looped — a second failing audit still accepts done', async () => {
    const events: AgentEvent[] = []
    const { chat } = scriptedChat([
      turn('set_background', { kind: 'solid', from: '#090B1A' }),
      turn('add_text', { text: 'Still dark', fontSize: 40, color: '#111122' }),
      done('Done attempt 1'),
      done('Done attempt 2 — unfixable, disclosed'),
    ])
    const result = await runAgentLoop({
      chat,
      design,
      mode: 'create',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
      // the audit NEVER clears — the run must still terminate honestly
      auditDesign: async () => ['Low contrast: text "Still dark" #111122 on #090B1A is 1.0:1 (needs 3:1)'],
    })
    expect(result.toolCalls).toBe(2)
    expect(events.filter((e) => e.type === 'done').length).toBe(1)
    const finalEvent = events[events.length - 1] as { type: string; summary?: string }
    expect(finalEvent.type).toBe('done')
    expect(String(finalEvent.summary)).toContain('disclosed')
  })

  it('CASE I: striking out during the audit fix round discloses instead of failing', async () => {
    const events: AgentEvent[] = []
    // bg → text → done (audit finds issues) → 3 INVALID tool calls in
    // the fix round → the run must END AS DONE with disclosure, not error
    const { chat } = scriptedChat([
      turn('set_background', { kind: 'solid', from: '#090B1A' }),
      turn('add_text', { text: 'Dark text', fontSize: 40, color: '#111122' }),
      done('Poster complete'),
      turn('patch_things', { nope: true }),
      turn('patch_things', { nope: true }),
      turn('patch_things', { nope: true }),
    ])
    const result = await runAgentLoop({
      chat,
      design,
      mode: 'create',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
      auditDesign: async () => ['Low contrast: text "Dark text" #111122 on #090B1A is 1.0:1 (needs 3:1)'],
    })
    expect(result.toolCalls).toBe(2)
    expect(events.filter((e) => e.type === 'error').length).toBe(0)
    const finalEvent = events[events.length - 1] as { type: string; summary?: string }
    expect(finalEvent.type).toBe('done')
    expect(String(finalEvent.summary)).toContain('could not be applied')
  })

  it('CASE J: update_elements accepts the color alias models habitually send', async () => {
    const events: AgentEvent[] = []
    const { chat, calls } = scriptedChat([
      turn('set_background', { kind: 'solid', from: '#090B1A' }),
      turn('update_elements', { ids: ['txt-1'], patch: { color: '#FFFFFF' } }),
      done('Fixed contrast'),
    ])
    const result = await runAgentLoop({
      chat,
      design,
      mode: 'create',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })
    // the alias must sanitize cleanly (no strike observation, 2 tool calls)
    expect(result.toolCalls).toBe(2)
    expect(events.some((e) => e.type === 'observation' && /not a known tool|invalid/i.test(e.message ?? ''))).toBe(false)
    expect(events[events.length - 1]?.type).toBe('done')
  })
})

// ═════════════════════════════════════════════════════════════
// 2. MODES
// ═════════════════════════════════════════════════════════════

describe('harness · modes', () => {
  it('every mode has a risk surface', () => {
    for (const mode of Object.keys(MODE_TOOL_RISK) as AgentMode[]) {
      expect(Array.isArray(MODE_TOOL_RISK[mode])).toBe(true)
    }
  })
  it('read-only modes have ZERO write tools in their surface', () => {
    for (const mode of ['review', 'explain', 'plan', 'discuss'] as AgentMode[]) {
      const surface = toolsForMode(mode)
      expect(surface.length, mode).toBeGreaterThanOrEqual(0)
      expect(surface.every((t) => t.risk === 'read'), mode).toBe(true)
      expect(modeAllowsWrites(mode)).toBe(false)
    }
    // discuss gets NO tools at all
    expect(toolsForMode('discuss')).toHaveLength(0)
  })
  it('write modes expose the full bridge', () => {
    for (const mode of ['create', 'edit', 'improve'] as AgentMode[]) {
      const surface = toolsForMode(mode)
      expect(surface.length, mode).toBeGreaterThan(40)
      expect(modeAllowsWrites(mode)).toBe(true)
    }
  })
  it('heuristic classification: the seven mode examples from the brief', () => {
    expect(heuristicMode('Make a poster').mode).toBe('create')
    expect(heuristicMode('Move the title down').mode).toBe('edit')
    expect(heuristicMode("What's wrong with this design?").mode).toBe('review')
    expect(heuristicMode('Make this professional').mode).toBe('improve')
    expect(heuristicMode('How does gradient editing work?').confidence).toBe('high') // product question
    expect(heuristicMode('Fix the Canvix agent tool loop').mode).toBe('discuss')
    expect(heuristicMode('Propose a plan for the deck').mode).toBe('plan')
  })
  it('heuristic classification: more phrasings', () => {
    expect(heuristicMode('Design a bold poster for a coffee launch with a warm palette').mode).toBe('create')
    expect(heuristicMode('Make the title bold').mode).toBe('edit')
    expect(heuristicMode('Critique this layout').mode).toBe('review')
    expect(heuristicMode('what font is the headline?').mode).toBe('explain')
    expect(heuristicMode('Polish this design').mode).toBe('improve')
    expect(heuristicMode('lol').confidence).toBe('low')
  })
  it('parseMode reads fenced and bare JSON, rejects junk', () => {
    expect(parseMode('{"mode":"review"}')).toBe('review')
    expect(parseMode('```json\n{"mode":"create"}\n```')).toBe('create')
    expect(parseMode('sure!')).toBeNull()
  })
  it('the system prompt respects the mode surface', () => {
    const reviewPrompt = loopSystemPrompt({ design, ctx, mode: 'review' })
    expect(reviewPrompt).not.toContain('- add_text')
    expect(reviewPrompt).toContain('REVIEW')
    const createPrompt = loopSystemPrompt({ design, ctx, mode: 'create' })
    expect(createPrompt).toContain('- add_text')
  })
})

// ═════════════════════════════════════════════════════════════
// 3. BRIEF CONTRACT
// ═════════════════════════════════════════════════════════════

describe('harness · brief contract', () => {
  it('extracts exact quoted texts, hex colors and dimensions as MANDATORY', () => {
    const brief = extractBrief(
      'Make a 1080x1080 poster with navy #090B1A background, purple #8B5CF6 and cyan #22D3EE accents, saying "Design Beyond Limits", "Create Smarter. Design Faster." and "Try Canvix Free"',
    )
    expect(brief.requiredTexts.map((t) => t.text)).toEqual([
      'Design Beyond Limits',
      'Create Smarter. Design Faster.',
      'Try Canvix Free',
    ])
    expect(brief.requiredTexts.every((t) => t.tier === 'mandatory')).toBe(true)
    expect(brief.requiredColors.map((c) => c.hex)).toEqual(['#090b1a', '#8b5cf6', '#22d3ee'])
    expect(brief.dimensions).toMatchObject({ width: 1080, height: 1080, tier: 'mandatory' })
  })
  it('unquoted headline patterns still extract; restrictions too', () => {
    const brief = extractBrief('Add the headline Grand Opening Gala and no dark colors please')
    expect(brief.requiredTexts.some((t) => t.text.startsWith('Grand Opening'))).toBe(true)
    expect(brief.restrictions.length).toBeGreaterThan(0)
  })
  it('platform presets fill dimensions as preference when unspecified', () => {
    const brief = extractBrief('Design an instagram story for the launch')
    expect(brief.format).toBe('story')
    expect(brief.dimensions).toMatchObject({ width: 1080, height: 1920, tier: 'preference' })
    // explicit dims outrank the preset
    const explicit = extractBrief('Instagram post but 800x800')
    expect(explicit.dimensions).toMatchObject({ width: 800, height: 800, tier: 'mandatory' })
  })
  it('FORMAT_PRESETS covers the social formats the matrix promises', () => {
    for (const id of ['instagram-post', 'story', 'youtube-thumbnail', 'poster', 'presentation', 'business-card', 'menu', 'logo']) {
      expect(FORMAT_PRESETS[id], id).toBeTruthy()
    }
  })
  it('validation passes when exact text + colors are present, fails with the unmet item named', () => {
    const brief = extractBrief('"Design Beyond Limits" with #8B5CF6 on 1080x1080')
    const ok = validateBrief(brief, {
      texts: ['DESIGN BEYOND LIMITS — really'],
      colors: ['#8b5cf6'],
      width: 1080,
      height: 1080,
    })
    expect(ok.satisfied).toBe(true)
    const bad = validateBrief(brief, { texts: ['Creative Pulse'], colors: ['#FF0000'], width: 500, height: 500 })
    expect(bad.satisfied).toBe(false)
    expect(bad.unmet.some((u) => u.includes('Design Beyond Limits'))).toBe(true)
    expect(bad.unmet.some((u) => u.includes('8B5CF6'))).toBe(true)
    expect(bad.unmet.some((u) => u.includes('1080'))).toBe(true)
  })
  it('case-insensitive hex matching; whitespace-tolerant text matching', () => {
    const brief = extractBrief('"Hello World" #AABBCC')
    expect(
      validateBrief(brief, { texts: ['  hello\nworld  '], colors: ['#AABBCC'], width: 1080, height: 1080 }).satisfied,
    ).toBe(true)
    expect(
      validateBrief(brief, { texts: ['x'], colors: ['#aabbcc'], width: 1080, height: 1080 }).satisfied,
    ).toBe(false)
  })
  it('briefPromptSection states the verbatim rule', () => {
    const brief = extractBrief('"Try Canvix Free" #02C0CC')
    const s = briefPromptSection(brief)
    expect(s).toContain('Try Canvix Free')
    expect(s).toContain('02C0CC')
    expect(s).toContain('never substitute')
  })
})

// ═════════════════════════════════════════════════════════════
// 4. SKILLS ENGINE
// ═════════════════════════════════════════════════════════════

describe('harness · skills engine', () => {
  it('ten skills ship, each with a complete playbook', () => {
    expect(DESIGN_SKILLS).toHaveLength(10)
    for (const s of DESIGN_SKILLS) {
      expect(s.id).toBeTruthy()
      expect(s.playbook.principles.length).toBeGreaterThanOrEqual(4)
      expect(s.playbook.planning.length).toBeGreaterThanOrEqual(2)
      expect(s.playbook.validation.length).toBeGreaterThanOrEqual(2)
      expect(s.modes.length).toBeGreaterThan(0)
      expect(s.whenToUse.length).toBeGreaterThan(0)
    }
  })
  it('the router selects poster+typography+color+layout for a poster brief', () => {
    const skills = selectSkills('Design a bold poster for a coffee launch with a warm palette', 'create')
    const ids = skills.map((s) => s.id)
    expect(ids).toContain('poster-design')
    expect(ids).toContain('color')
    expect(skills.length).toBeLessThanOrEqual(3) // progressive disclosure cap
  })
  it('the critique skill owns review mode', () => {
    const skills = selectSkills('review this', 'review')
    expect(skills[0]?.id).toBe('critique')
  })
  it('brand skill ranks up when a brand kit is present', () => {
    const withBrand = selectSkills('make it on brand and consistent', 'improve', true)
    const without = selectSkills('make it on brand and consistent', 'improve', false)
    expect(withBrand.some((s) => s.id === 'brand')).toBe(true)
    expect(without.some((s) => s.id === 'brand')).toBe(false)
  })
  it('skillsPromptSection injects ONLY the selected playbooks', () => {
    const skills = selectSkills('Design a youtube thumbnail', 'create')
    const s = skillsPromptSection(skills)
    expect(s).toContain('Skill:')
    for (const skill of DESIGN_SKILLS) {
      const included = skills.some((x) => x.id === skill.id)
      // a headline principle fragment should appear only when selected
      if (!included) expect(s).not.toContain(skill.name)
    }
  })
})

// ═════════════════════════════════════════════════════════════
// 5. LIFECYCLE FLOWS (Cases A–F)
// ═════════════════════════════════════════════════════════════

describe('harness · lifecycle flows (Cases A–F)', () => {
  /** Case A: the exact promotional poster — quoted copy + hex
   *  colors must survive verbatim through a full create run. */
  it('CASE A: exact promotional design — brief texts/colors pass through and done is gated on validation', async () => {
    const brief = extractBrief(
      '1080x1080 Canvix poster, navy #090B1A background, purple #8B5CF6, cyan #22D3EE, white #FFFFFF, gray #A1A1AA, "Design Beyond Limits", "Create Smarter. Design Faster.", "Try Canvix Free"',
    )
    const events: AgentEvent[] = []
    let validationCalls = 0
    // model: bg → headline → subline → CTA → attempt done (validation
    // FAILS first: gray missing) → fix → done (passes)
    const { chat, calls } = scriptedChat([
      turn('set_background', { kind: 'solid', from: '#090B1A' }),
      turn('add_text', { text: 'Design Beyond Limits', fontSize: 110, color: '#FFFFFF', bold: true }),
      turn('add_text', { text: 'Create Smarter. Design Faster.', fontSize: 40, color: '#22D3EE' }),
      turn('add_text', { text: 'Try Canvix Free', fontSize: 36, color: '#8B5CF6' }),
      done('Poster complete'),
      turn('add_text', { text: 'Free forever · canvix.app', fontSize: 22, color: '#A1A1AA' }),
      done('Poster complete with all colors'),
    ])
    const result = await runAgentLoop({
      chat,
      design,
      mode: 'create',
      brief,
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
      validateBriefOnClient: async () => {
        validationCalls++
        // first check: gray missing; second: everything present
        if (validationCalls === 1) return { satisfied: false, unmet: ['Required color #A1A1AA not used anywhere on the page'] }
        return { satisfied: true, unmet: [] }
      },
    })
    expect(result.toolCalls).toBe(5)
    expect(result.summary).toContain('all colors')
    expect(result.verification).toContain('validated')
    // the failed done was REFUSED and the model was told what's missing
    expect(calls.some((c) => c.some((m) => m.content.includes('NOT DONE')))).toBe(true)
    expect(calls.some((c) => c.some((m) => m.content.includes('A1A1AA')))).toBe(true)
    // brief events streamed for the panel
    expect(events.some((e) => e.type === 'brief')).toBe(true)
  })

  it('CASE A (anti-substitution): a model that renames the copy cannot finish — after 3 rejected completions the run ends honestly with the unmet list', async () => {
    const brief = extractBrief('"Design Beyond Limits"')
    let validationCalls = 0
    const { chat, calls } = scriptedChat([
      turn('add_text', { text: 'Creative Pulse', fontSize: 96 }),
      done('Done'),  // rejected 1
      done('Done'),  // rejected 2
      done('Done'),  // rejected 3 → honest blocked ending
      done('Done'),  // never reached
    ])
    const events: AgentEvent[] = []
    const result = await runAgentLoop({
      chat,
      design,
      mode: 'create',
      brief,
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
      validateBriefOnClient: async () => {
        validationCalls++
        return { satisfied: false, unmet: ['Required text missing or altered: "Design Beyond Limits"'] }
      },
    })
    // every completion claim was validated and refused…
    expect(validationCalls).toBe(3)
    expect(calls.some((c) => c.some((m) => m.content.includes('NOT DONE')))).toBe(true)
    // …and the run ends HONESTLY with the unmet list — no fake success
    expect(result.summary).toContain('unmet requirements')
    expect(result.summary).toContain('Design Beyond Limits')
    expect(result.summary).not.toMatch(/^Done/)
    const last = events[events.length - 1]
    expect(last.type).toBe('done')
  })

  /** Case B: review-only grounding — a review of an incomplete
   *  poster reports what IS there; no write tool ever fires. */
  it('CASE B: review-only grounding — no writes, findings streamed', async () => {
    const events: AgentEvent[] = []
    const { chat } = scriptedChat([
      turn('get_page_state'),
      done('The poster has a headline and two rectangles but no CTA and no contact details.', {
        findings: [
          { severity: 'P1', issue: 'No call-to-action element on the page', fix: 'Add a CTA pill with the accent color' },
          { severity: 'P2', issue: 'Two rectangles overlap by 25% (el-1 × el-2)', fix: 'Separate or group them intentionally' },
        ],
      }),
    ])
    // which tools actually reached the client as actions
    const appliedTools: string[] = []
    const result = await runAgentLoop({
      chat,
      design,
      mode: 'review',
      emit: (e) => {
        if (e.type === 'action') appliedTools.push(e.tool)
        events.push(e)
      },
      awaitApply: async () => ({ ok: true }),
    })
    // review reads state (get_page_state rides the action→ack path so
    // the client pushes refreshed context) but NEVER a write tool
    expect(appliedTools.every((t) => ['get_page_state', 'validate_brief', 'measure_text', 'goto_page'].includes(t))).toBe(true)
    expect(result.toolCalls).toBe(1) // only get_page_state
    expect(result.findings).toHaveLength(2)
    expect(result.findings?.[0].severity).toBe('P1')
    // even if the model TRIES a write tool in review mode:
    const { chat: rogueChat } = scriptedChat([
      turn('get_page_state'),
      turn('add_text', { text: 'sneaky edit' }),
      done('Reviewed'),
    ])
    const rogueAppliedTools: string[] = []
    const rogue = await runAgentLoop({
      chat: rogueChat,
      design,
      mode: 'review',
      emit: (e) => {
        if (e.type === 'action') rogueAppliedTools.push(e.tool)
      },
      awaitApply: async () => ({ ok: true }),
    })
    // the write tool is not in the surface — refused before any action
    expect(rogueAppliedTools.every((t) => t !== 'add_text')).toBe(true)
    expect(rogue.toolCalls).toBe(1)
  })

  /** Case C: a long multi-page run — >8 tool calls completes with
   *  no step cap (v0.27 would have stopped at 8). */
  it('CASE C: 14-step multi-page deck build completes (no arbitrary cap)', async () => {
    const replies: string[] = []
    // page 1: bg + 2 texts; goto page 2: bg + 2 texts; verify; done
    replies.push(turn('set_background', { kind: 'solid', from: '#0D1117' }))
    replies.push(turn('add_text', { text: 'Slide One', fontSize: 90 }))
    replies.push(turn('add_text', { text: 'The vision', fontSize: 32 }))
    replies.push(turn('add_page'))
    replies.push(turn('goto_page', { page: 2 }))
    replies.push(turn('get_page_state'))
    replies.push(turn('set_background', { kind: 'solid', from: '#0D1117' }))
    replies.push(turn('add_text', { text: 'Slide Two', fontSize: 90 }))
    replies.push(turn('add_text', { text: 'The numbers', fontSize: 32 }))
    replies.push(turn('add_chart', { kind: 'bar', labels: ['22', '23', '24'], series: [{ name: 'ARR', color: '#02C0CC', values: [1, 4, 12] }] }))
    replies.push(turn('add_line', { x: 100, y: 800, length: 800, variant: 'arrow' }))
    replies.push(turn('animate_elements', { ids: ['txt-1'], kind: 'rise' }))
    replies.push(turn('get_page_state'))
    replies.push(done('Two slides built with consistent styling.'))
    expect(replies.length).toBe(14) // v0.27's cap was 8
    const { chat, calls } = scriptedChat(replies)
    // refreshed page-2 state: two fresh elements (ids the model just made)
    const refreshed: AgentDesignCtx = {
      ...design,
      currentPageIndex: 1,
      elements: [
        { id: 'txt-1', type: 'text', x: 0, y: 100, width: 800, height: 120, text: 'Slide Two', fontSize: 90, fill: '#FFFFFF' },
        { id: 'txt-2', type: 'text', x: 0, y: 260, width: 600, height: 80, text: 'The numbers', fontSize: 32, fill: '#02C0CC' },
      ],
    }
    const result = await runAgentLoop({
      chat,
      design,
      mode: 'create',
      emit: () => {},
      awaitApply: async () => ({ ok: true }),
      refreshedContext: () => refreshed,
    })
    expect(result.toolCalls).toBe(13) // every step applied — no cap hit
    expect(result.steps).toBe(13)
    // page switch flowed through: the model saw page 2's state
    expect(calls[6].some((m) => m.content.includes('UPDATED PAGE STATE'))).toBe(true)
  })

  /** Case D: geometry repair — off-canvas + overlaps detected and
   *  fixed with fix_overlaps. */
  it('CASE D: geometry repair — fix_overlaps after placement', async () => {
    const { chat } = scriptedChat([
      turn('add_text', { text: 'Big Headline', fontSize: 140, x: 0, y: 0 }),
      turn('add_text', { text: 'Sub', fontSize: 40, x: 0, y: 20 }), // overlaps the headline
      turn('fix_overlaps'),
      turn('get_page_state'),
      done('Layout fixed — overlaps resolved.'),
    ])
    const result = await runAgentLoop({
      chat,
      design,
      mode: 'improve',
      emit: () => {},
      awaitApply: async () => ({ ok: true }),
      refreshedContext: () => design,
    })
    expect(result.toolCalls).toBe(4)
    expect(result.summary).toContain('fixed')
  })

  /** Case E: capability sweep — one valid call per v0.28 tool. */
  it('CASE E: capability sweep — every bridge tool applies cleanly in sequence', async () => {
    const valid: [string, Record<string, unknown>][] = [
      ['get_page_state', {}],
      ['set_background', { kind: 'gradient', from: '#090B1A', to: '#8B5CF6', angle: 160 }],
      ['add_text', { text: 'Hello', fontSize: 64, color: '#FFFFFF' }],
      ['add_shape', { shape: 'rect', x: 10, y: 10, width: 100, height: 80 }],
      ['add_line', { x: 10, y: 200, length: 300, variant: 'arrow' }],
      ['add_icon', { query: 'rocket' }],
      ['add_illustration', { query: 'waves' }],
      ['add_chart', { kind: 'donut', labels: ['A', 'B'], series: [{ name: 'S', color: '#8B5CF6', values: [3, 7] }] }],
      ['add_qr', { value: 'https://canvix.app' }],
      ['add_frame', { frameShape: 'circle', width: 300, height: 300 }],
      ['add_embed', { url: 'https://youtu.be/demo' }],
      ['add_sticker', { emoji: '🚀', size: 120 }],
      ['add_table', { header: ['Plan', 'Price'], rows: [['Free', '$0']] }],
      ['add_stock_photo', { query: 'coffee cup', orientation: 'landscape' }],
      ['add_stock_video', { query: 'city timelapse' }],
      ['add_image', { prompt: 'abstract gradient banner' }],
      ['update_elements', { ids: ['el-1'], patch: { fill: '#8B5CF6', rotation: 15, opacity: 0.9 } }],
      ['set_text_style', { ids: ['txt-1'], fontFamily: 'Poppins', fontSize: 72, bold: true }],
      ['set_text_spans', { ids: ['txt-2'], spans: [{ text: 'Wor' }, { text: 'ld', bold: true }] }],
      ['move_elements', { ids: ['el-1'], dx: 40, dy: 20 }],
      ['align_elements', { ids: ['el-1', 'el-2'], mode: 'cx' }],
      ['distribute_elements', { ids: ['el-1', 'el-2', 'img-1'], axis: 'y' }],
      ['duplicate_elements', { ids: ['el-1'] }],
      ['group_elements', { ids: ['el-1', 'el-2'] }],
      ['reorder_layers', { ids: ['img-1'], dir: 'front' }],
      ['mask_image', { ids: ['img-1'], mask: 'circle' }],
      ['adjust_image', { ids: ['img-1'], brightness: 20, contrast: -10 }],
      ['measure_text', { text: 'Design Beyond Limits', fontSize: 96, fontFamily: 'Poppins' }],
      ['set_font', { fontFamily: 'Inter', targets: 'all' }],
      ['recolor', { color: '#02C0CC', targets: 'text' }],
      ['animate_elements', { ids: ['el-1'], kind: 'pop', duration: 0.5 }],
      ['set_page_transition', { kind: 'fade' }],
      ['add_page', {}],
      ['duplicate_page', {}],
      ['goto_page', { page: 1 }],
      ['animate_page', {}],
      ['balance_layout', {}],
      ['fix_overlaps', {}],
      ['translate_texts', { language: 'Spanish' }],
      ['set_brand_kit', { colors: ['#090B1A', '#8B5CF6', '#22D3EE'], headingFont: 'Poppins', bodyFont: 'Inter' }],
      ['resize_design', { width: 1080, height: 1350 }],
      ['validate_brief', {}],
      ['export_design', { format: 'png' }],
      // destructive last (declined — proves the gate in the sweep too)
      ['clear_page', {}],
    ]
    const { chat } = scriptedChat([...valid.map(([t, a]) => turn(t, a)), done('Sweep complete')])
    let declined = false
    const result = await runAgentLoop({
      chat,
      design,
      mode: 'create',
      emit: () => {},
      confirmed: new Set(),
      awaitConfirm: async () => {
        declined = true
        return false
      },
      awaitApply: async () => ({ ok: true }),
      refreshedContext: () => design,
      validateBriefOnClient: async () => ({ satisfied: true, unmet: [] }),
    })
    // every write tool applied except the declined clear_page; the
    // validate_brief pseudo-action applies state without an ack and is
    // not counted as a tool call (v0.28.1 live-eval fix)
    expect(result.toolCalls).toBe(valid.length - 2)
    expect(declined).toBe(true)
    expect(result.summary).toBe('Sweep complete')
  })

  /** Case F: safety — strikes, cycles, abort, decline, provider failure. */
  it('CASE F1: three consecutive invalid calls end the run with STRIKES', async () => {
    const events: AgentEvent[] = []
    const result = await runAgentLoop({
      chat: async () => turn('update_elements', { ids: ['ghost'], patch: { fill: '#123456' } }),
      design,
      mode: 'edit',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })
    expect(result.toolCalls).toBe(0)
    const err = events.find((e) => e.type === 'error')
    expect(err && err.type === 'error' && err.code).toBe('STRIKES')
  })
  it('CASE F2: an identical call repeated 3× triggers cycle wrap-up', async () => {
    const events: AgentEvent[] = []
    const result = await runAgentLoop({
      chat: async () => turn('add_sticker', { emoji: '🤖' }),
      design,
      mode: 'create',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })
    // 2 identical applies are allowed; the 3rd wraps up
    expect(result.toolCalls).toBe(2)
    const last = events[events.length - 1]
    expect(last.type).toBe('done')
  })
  it('CASE F3: abort mid-run keeps applied work and reports Stop', async () => {
    const signal = { aborted: false, reason: 'Stopped by user' }
    let n = 0
    const result = await runAgentLoop({
      chat: async () => {
        n += 1
        if (n === 4) signal.aborted = true
        return turn('add_sticker', { emoji: '⭐', n }) // distinct args — no cycle guard
      },
      design,
      mode: 'create',
      emit: () => {},
      signal,
      awaitApply: async () => ({ ok: true }),
    })
    expect(result.toolCalls).toBe(4) // the in-flight 4th applied; no 5th call
    expect(result.summary).toContain('Stopped')
  })
  it('CASE F4: a declined destructive call redirects the model, applies nothing', async () => {
    const applied: unknown[] = []
    const { chat, calls } = scriptedChat([
      turn('delete_elements', { ids: ['el-1'] }),
      turn('add_text', { text: 'Kept your content', fontSize: 40 }),
      done('Deleted nothing; added a note instead.'),
    ])
    const result = await runAgentLoop({
      chat,
      design,
      mode: 'edit',
      emit: () => {},
      confirmed: new Set(),
      awaitConfirm: async () => false,
      awaitApply: async () => {
        applied.push(1)
        return { ok: true }
      },
    })
    expect(result.toolCalls).toBe(1)
    expect(applied).toHaveLength(1)
    expect(calls[1].some((m) => m.content.includes('DECLINED'))).toBe(true)
  })
  it('CASE F5: provider failure emits PROVIDER error, keeps work', async () => {
    const events: AgentEvent[] = []
    const result = await runAgentLoop({
      chat: async () => {
        throw new Error('429 quota exceeded')
      },
      design,
      mode: 'create',
      emit: (e) => events.push(e),
    })
    expect(result.toolCalls).toBe(0)
    const err = events.find((e) => e.type === 'error')
    expect(err && err.type === 'error' && err.code).toBe('PROVIDER')
  })
  it('CASE F6: a write tool attempted in discuss-adjacent review mode is refused with guidance', async () => {
    const { chat, calls } = scriptedChat([
      turn('add_text', { text: 'nope' }),
      turn('get_page_state'),
      done('Reported.'),
    ])
    const result = await runAgentLoop({
      chat,
      design,
      mode: 'review',
      emit: () => {},
      awaitApply: async () => ({ ok: true }),
    })
    expect(result.toolCalls).toBe(1)
    expect(calls.some((c) => c.some((m) => m.content.includes('not available in review mode')))).toBe(true)
  })
  it('CASE F7: compaction folds a long conversation and emits a compact event', async () => {
    const events: AgentEvent[] = []
    const replies: string[] = []
    for (let i = 0; i < 65; i++) replies.push(turn('add_sticker', { emoji: '⭐', n: i }))
    replies.push(done('Long run complete'))
    const result = await runAgentLoop({
      chat: scriptedChat(replies).chat,
      design,
      mode: 'create',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })
    expect(events.some((e) => e.type === 'compact')).toBe(true)
    expect(result.toolCalls).toBe(65) // compaction never stops the run
  })
  it('usage telemetry streams during long runs', async () => {
    const events: AgentEvent[] = []
    const replies: string[] = []
    for (let i = 0; i < 40; i++) replies.push(turn('add_sticker', { emoji: '⭐' }))
    replies.push(done('done'))
    await runAgentLoop({
      chat: scriptedChat(replies).chat,
      design,
      mode: 'create',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })
    const usage = events.filter((e) => e.type === 'usage')
    expect(usage.length).toBeGreaterThan(0)
  })
  it('the system prompt carries the brief, skills, page rule and mode heading', () => {
    const brief = extractBrief('"Try Canvix Free"')
    const prompt = loopSystemPrompt({ design, ctx, mode: 'create', brief, skills: DESIGN_SKILLS.slice(0, 2) })
    expect(prompt).toContain('DESIGN BRIEF CONTRACT')
    expect(prompt).toContain('Try Canvix Free')
    expect(prompt).toContain('MODE: CREATE')
    expect(prompt).toContain('Skill:')
    expect(prompt).toContain('goto_page')
    expect(prompt).toContain('measure_text')
  })
})

// ═════════════════════════════════════════════════════════════
// 6. WIRE FORMAT + CONTEXT
// ═════════════════════════════════════════════════════════════

describe('harness · wire format + context', () => {
  it('every event type serializes to one data: line and round-trips', () => {
    const samples: AgentEvent[] = [
      { v: 2, type: 'start', intent: 'create', runId: 'run-x' },
      { v: 2, type: 'mode', mode: 'review', reason: 'classified' },
      { v: 2, type: 'skill', id: 'critique', name: 'Design Critique' },
      { v: 2, type: 'brief', brief: { requiredTexts: [] } },
      { v: 2, type: 'plan', steps: ['a'] },
      { v: 2, type: 'step', index: 1, thought: 't', tool: 'add_text' },
      { v: 2, type: 'action', stepIndex: 1, callId: 'c1', risk: 'write', tool: 'add_text', actions: [{ type: 'addText' }] },
      { v: 2, type: 'ack', callId: 'c1', ok: true },
      { v: 2, type: 'observation', stepIndex: 1, message: 'ok' },
      { v: 2, type: 'usage', turns: 3, toolCalls: 2, elapsedMs: 1234, modelCalls: 3 },
      { v: 2, type: 'compact', fromMessages: 60, toMessages: 12 },
      { v: 2, type: 'done', summary: 'ok', steps: 3, toolCalls: 2, verification: 'brief validated' },
      { v: 2, type: 'error', message: 'x', code: 'STRIKES' },
      { v: 2, type: 'aborted', reason: 'Stopped by user' },
    ]
    for (const ev of samples) {
      const line = sseLine(ev)
      expect(line.startsWith('data: ')).toBe(true)
      expect(line.endsWith('\n\n')).toBe(true)
      expect(JSON.parse(line.slice(6))).toEqual(ev)
    }
  })
  it('protocol version is 2 and guards are the documented values', () => {
    expect(AGENT_PROTOCOL_VERSION).toBe(2)
    expect(AGENT_GUARDS.strikes).toBe(3)
    expect(AGENT_GUARDS.cycleRepeat).toBe(3)
    expect(AGENT_GUARDS.idleMs).toBe(240_000)
    expect(AGENT_GUARDS.compactAtMessages).toBe(60)
    // NO step/tool/wall-clock caps exist anymore
    expect(AGENT_GUARDS).not.toHaveProperty('maxSteps')
    expect(AGENT_GUARDS).not.toHaveProperty('maxToolCalls')
    expect(AGENT_GUARDS).not.toHaveProperty('maxWallMs')
  })
  it('parseAgentTurn: fences, prose, nested braces, multi-object, junk', () => {
    expect(parseAgentTurn('```json\n{"tool":"add_text","args":{"text":"Hi"}}\n```')?.tool).toBe('add_text')
    expect(parseAgentTurn('Sure:\n{"thought":"a {b} c","tool":"add_text","args":{"text":"}{"}}')?.args).toEqual({ text: '}{' })
    expect(parseAgentTurn('{"a":1}\n{"tool":"get_page_state","args":{}}')?.tool).toBe('get_page_state')
    expect(parseAgentTurn('no json')).toBeNull()
    expect(parseAgentTurn('{"done":true,"findings":[{"severity":"P1","issue":"x"}]}')?.findings).toHaveLength(1)
  })
  it('context serialization covers all elements, selection, brand, pages', () => {
    const s = serializeDesignContext(design)
    for (const id of ['el-1', 'el-2', 'txt-1', 'txt-2', 'grp-1', 'img-1']) expect(s).toContain(id)
    expect(s).toContain('[SELECTED]')
    expect(s).toContain('BRAND KIT')
    expect(s).toContain('3 page(s)')
  })
})

describe('audit heuristics (v0.29)', () => {
  it('WCAG contrast math — white on black ≈ 21:1, dark on dark < 1.2:1', () => {
    expect(Math.round(contrastRatio('#FFFFFF', '#000000'))).toBe(21)
    expect(contrastRatio('#111122', '#090B1A')).toBeLessThan(1.2)
    expect(contrastRatio('not-a-color', '#000000')).toBe(0)
  })

  it('auditDesign flags low contrast, overflow, tiny text, overlaps and off-canvas', () => {
    const issues = auditDesign({
      width: 1080,
      height: 1080,
      background: '#090B1A',
      elements: [
        { id: 'a1', type: 'text', text: 'Dark headline', fill: '#111122', fontSize: 48, x: 0, y: 0, width: 600, height: 90 },
        { id: 'a2', type: 'text', text: 'A'.repeat(80), fill: '#FFFFFF', fontSize: 48, x: 0, y: 200, width: 600, height: 90 },
        { id: 'a3', type: 'text', text: 'tiny', fill: '#FFFFFF', fontSize: 10, x: 0, y: 400, width: 200, height: 30 },
      ],
      overlaps: ['headline × subline'],
      offCanvas: ['cta runs past the right edge'],
      colorsInUse: ['#090B1A', '#111122'],
    })
    const joined = issues.join('\n')
    expect(joined).toContain('Low contrast')
    expect(joined).toContain('may overflow')
    expect(joined).toContain('under 14')
    expect(joined).toContain('overlap')
    expect(joined).toContain('outside the canvas')
  })

  it('auditDesign falls back to the dominant color when background is absent; clean canvas → no issues', () => {
    const issues = auditDesign({
      width: 1080,
      height: 1080,
      elements: [{ id: 'b1', type: 'text', text: 'Dark', fill: '#111122', fontSize: 48, x: 0, y: 0, width: 600, height: 90 }],
      colorsInUse: ['#090B1A'],
    })
    expect(issues.join('\n')).toContain('Low contrast')
    expect(auditDesign({ width: 1080, height: 1080, background: '#FFFFFF', elements: [{ id: 'c1', type: 'text', text: 'OK', fill: '#111111', fontSize: 32, x: 0, y: 0, width: 300, height: 60 }] })).toEqual([])
  })
})
