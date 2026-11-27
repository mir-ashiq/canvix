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
import { auditDesign, contrastBetween } from './audit'
import { heuristicMode, parseMode, modeAllowsWrites, MODE_TOOL_RISK } from './router'
import { DESIGN_SKILLS, selectSkills, skillsPromptSection } from './skills'
import { extractBrief, validateBrief, briefPromptSection, FORMAT_PRESETS, type DesignBrief } from './brief'
import { serializeDesignContext, contextValidIds, type AgentDesignCtx } from './context'
import type { VisionCritiqueResult } from './vision'
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

/** v0.32.6 · the same fixture compacted to the top 240px. Same
 *  ids/texts/overlaps (update flows keep their targets), but the
 *  canvas has real FREE space (y 240..1015) so a plan of additions
 *  fits the canvas map. The spread-out original left only 415px of
 *  contiguous free space — a full-composition plan on it is now
 *  (correctly) infeasible, which is what a real improve run on a
 *  nearly-full canvas should honestly say. */
const compactDesign: AgentDesignCtx = {
  ...design,
  elements: [
    { id: 'el-1', type: 'rect', x: 0, y: 0, width: 100, height: 100, fill: '#FF0000' },
    { id: 'el-2', type: 'rect', x: 40, y: 20, width: 100, height: 100, fill: '#00FF00' },
    { id: 'txt-1', type: 'text', x: 0, y: 60, width: 400, height: 60, text: 'Hello', fontSize: 48, fill: '#111111' },
    { id: 'txt-2', type: 'text', x: 0, y: 150, width: 400, height: 60, text: 'World', fontSize: 32, fill: '#222222' },
    { id: 'grp-1', type: 'group', x: 10, y: 0, width: 150, height: 100 },
    { id: 'img-1', type: 'image', x: 0, y: 140, width: 300, height: 100 },
  ],
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
      'add_stock_video', 'validate_brief', 'plan_layout', 'list_fonts',
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
  it('read tools are exactly the state/measure/validate/plan set', () => {
    const reads = AGENT_TOOLS.filter((t) => t.risk === 'read').map((t) => t.name)
    expect(reads.sort()).toEqual(['get_page_state', 'goto_page', 'list_fonts', 'measure_text', 'plan_layout', 'validate_brief'])
  })

  it('CASE G: quality audit — one self-critique fix round before done is accepted', async () => {
    const events: AgentEvent[] = []
    let auditCalls = 0
    // model: bg → text → attempt done (audit finds low contrast) → fix
    // fill → done (audit clean, accepted)
    const { chat } = scriptedChat([
      turn('set_background', { kind: 'solid', from: '#090B1A' }),
      turn('plan_layout', { background: '#090B1A', sections: [{ name: 'hero', y: 60, height: 200, contains: 'Hero' }, { name: 'body', y: 300, height: 300, contains: 'Body' }] }),
      turn('add_text', { text: 'Dark text on dark bg', fontSize: 40, color: '#111122' }),
      done('Poster complete'),
      turn('add_text', { text: 'Fixed headline', fontSize: 40, color: '#FFFFFF' }),
      done('Poster complete, contrast fixed'),
    ])
    const result = await runAgentLoop({
      chat,
      design: compactDesign,
      mode: 'create',
      request: 'Design a bold Instagram post for a coffee launch',
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

  it('CASE H: audit residue is disclosed, never looped — after the bounded fix rounds a still-failing audit accepts done', async () => {
    const events: AgentEvent[] = []
    const { chat } = scriptedChat([
      turn('set_background', { kind: 'solid', from: '#090B1A' }),
      turn('plan_layout', { background: '#090B1A', sections: [{ name: 'hero', y: 60, height: 200, contains: 'Hero' }, { name: 'body', y: 300, height: 300, contains: 'Body' }] }),
      turn('add_text', { text: 'Still dark', fontSize: 40, color: '#111122' }),
      done('Done attempt 1'),
      done('Done attempt 2'),
      done('Done attempt 3 — unfixable, disclosed'),
    ])
    const result = await runAgentLoop({
      chat,
      design: compactDesign,
      mode: 'create',
      request: 'Design a bold Instagram post for a coffee launch',
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
      turn('plan_layout', { background: '#090B1A', sections: [{ name: 'hero', y: 60, height: 200, contains: 'Hero' }, { name: 'body', y: 300, height: 300, contains: 'Body' }] }),
      turn('add_text', { text: 'Dark text', fontSize: 40, color: '#111122' }),
      done('Poster complete'),
      turn('patch_things', { nope: true }),
      turn('patch_things', { nope: true }),
      turn('patch_things', { nope: true }),
    ])
    const result = await runAgentLoop({
      chat,
      design: compactDesign,
      mode: 'create',
      request: 'Design a bold Instagram post for a coffee launch',
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
      turn('plan_layout', { background: '#090B1A', sections: [{ name: 'hero', y: 60, height: 200, contains: 'Hero' }, { name: 'body', y: 300, height: 300, contains: 'Body' }] }),
      turn('update_elements', { ids: ['txt-1'], patch: { color: '#FFFFFF' } }),
      done('Fixed contrast'),
    ])
    const result = await runAgentLoop({
      chat,
      design: compactDesign,
      mode: 'create',
      request: 'Design a bold Instagram post for a coffee launch',
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
  it('validation passes only on EXACT text, fails with the unmet item named', () => {
    const brief = extractBrief('"Design Beyond Limits" with #8B5CF6 on 1080x1080')
    const ok = validateBrief(brief, {
      texts: ['Design Beyond Limits'],
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
  it('case-insensitive hex matching; whitespace-tolerant but otherwise STRICT text matching', () => {
    const brief = extractBrief('"Hello World" #AABBCC')
    // whitespace collapse still tolerated (line-wrap artifacts)
    expect(
      validateBrief(brief, { texts: ['  Hello\nWorld  '], colors: ['#AABBCC'], width: 1080, height: 1080 }).satisfied,
    ).toBe(true)
    // v0.32.1 (review P0): appended words no longer ride through as a
    // "satisfied" requirement — strict equality, not containment
    expect(
      validateBrief(brief, { texts: ['Hello World — Special Offer'], colors: ['#AABBCC'], width: 1080, height: 1080 }).satisfied,
    ).toBe(false)
    // ...and neither do case changes: character-for-character after
    // whitespace collapse
    expect(
      validateBrief(brief, { texts: ['hello world'], colors: ['#aabbcc'], width: 1080, height: 1080 }).satisfied,
    ).toBe(false)
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
  it('thirteen skills ship, each with a complete playbook', () => {
    expect(DESIGN_SKILLS).toHaveLength(13)
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
      turn('plan_layout', { background: '#090B1A', sections: [{ name: 'hero', y: 60, height: 200, contains: 'Hero' }, { name: 'body', y: 300, height: 300, contains: 'Body' }] }),
      turn('add_text', { text: 'Design Beyond Limits', fontSize: 110, color: '#FFFFFF', bold: true }),
      turn('add_text', { text: 'Create Smarter. Design Faster.', fontSize: 40, color: '#22D3EE' }),
      turn('add_text', { text: 'Try Canvix Free', fontSize: 36, color: '#8B5CF6' }),
      done('Poster complete'),
      turn('add_text', { text: 'Free forever · canvix.app', fontSize: 22, color: '#A1A1AA' }),
      done('Poster complete with all colors'),
    ])
    const result = await runAgentLoop({
      chat,
      design: compactDesign,
      mode: 'create',
      request: 'Design a bold Instagram post for a coffee launch',
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
      turn('plan_layout', { background: '#090B1A', sections: [{ name: 'hero', y: 60, height: 200, contains: 'Hero' }, { name: 'body', y: 300, height: 300, contains: 'Body' }] }),
      turn('add_text', { text: 'Creative Pulse', fontSize: 96 }),
      done('Done'),  // rejected 1
      done('Done'),  // rejected 2
      done('Done'),  // rejected 3 → honest blocked ending
      done('Done'),  // never reached
    ])
    const events: AgentEvent[] = []
    const result = await runAgentLoop({
      chat,
      design: compactDesign,
      mode: 'create',
      request: 'Design a bold Instagram post for a coffee launch',
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
      request: 'What is wrong with this design?',
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
      request: 'What is wrong with this design?',
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
    replies.push(turn('plan_layout', { background: '#090B1A', sections: [{ name: 'hero', y: 60, height: 200, contains: 'Hero' }, { name: 'body', y: 300, height: 300, contains: 'Body' }] }))
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
    expect(replies.length).toBe(15) // v0.27's cap was 8; v0.32.3 adds the plan turn
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
      // v0.32.6: the canvas map — C builds on a canvas that already
      // has content; the compact fixture leaves real free space so
      // the plan records (the spread-out original left 415px, and a
      // 540px composition honestly did not fit)
      design: compactDesign,
      mode: 'create',
      request: 'Design a bold Instagram post for a coffee launch',
      emit: () => {},
      awaitApply: async () => ({ ok: true }),
      refreshedContext: () => refreshed,
    })
    expect(result.steps).toBe(14) // 13 tools + the plan turn (v0.32.3)
    // page switch flowed through: the model saw page 2's state
    // (call 8 = index 7, one later now that the plan turn is call 2)
    expect(calls[7].some((m) => m.content.includes('UPDATED PAGE STATE'))).toBe(true)
  })

  /** Case D: geometry repair — off-canvas + overlaps detected and
   *  fixed with fix_overlaps. */
  it('CASE D: geometry repair — fix_overlaps after placement', async () => {
    const { chat } = scriptedChat([
      turn('plan_layout', { background: '#090B1A', sections: [{ name: 'hero', y: 60, height: 200, contains: 'Hero' }, { name: 'body', y: 300, height: 300, contains: 'Body' }] }),
      turn('add_text', { text: 'Big Headline', fontSize: 140, x: 0, y: 0 }),
      turn('add_text', { text: 'Sub', fontSize: 40, x: 0, y: 20 }), // overlaps the headline
      turn('fix_overlaps'),
      turn('get_page_state'),
      done('Layout fixed — overlaps resolved.'),
    ])
    const result = await runAgentLoop({
      chat,
      design: compactDesign,
      mode: 'improve',
      request: 'Make this design more professional',
      emit: () => {},
      awaitApply: async () => ({ ok: true }),
      refreshedContext: () => compactDesign,
    })
    expect(result.toolCalls).toBe(4)
    expect(result.summary).toContain('fixed')
  })

  /** Case E: capability sweep — one valid call per v0.28 tool. */
  it('CASE E: capability sweep — every bridge tool applies cleanly in sequence', async () => {
    const valid: [string, Record<string, unknown>][] = [
      ['get_page_state', {}],
      ['set_background', { kind: 'gradient', from: '#090B1A', to: '#8B5CF6', angle: 160 }],
      ['plan_layout', { background: '#090B1A', sections: [{ name: 'hero', y: 60, height: 200, contains: 'Hero' }, { name: 'body', y: 300, height: 300, contains: 'Body' }] }],
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
      design: compactDesign,
      mode: 'create',
      request: 'Design a bold Instagram post for a coffee launch',
      emit: () => {},
      confirmed: new Set(),
      awaitConfirm: async () => {
        declined = true
        return false
      },
      awaitApply: async () => ({ ok: true }),
      refreshedContext: () => compactDesign,
      validateBriefOnClient: async () => ({ satisfied: true, unmet: [] }),
    })
    // every write tool applied except the declined clear_page; the
    // validate_brief pseudo-action applies state without an ack and is
    // not counted as a tool call (v0.28.1 live-eval fix)
    expect(result.toolCalls).toBe(valid.length - 3) // validate_brief + plan_layout are not counted
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
      request: 'Make the existing title bigger',
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
      request: 'Design a bold Instagram post for a coffee launch',
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
        if (n === 1) return turn('plan_layout', { background: '#090B1A', sections: [{ name: 'hero', y: 60, height: 200, contains: 'Hero' }, { name: 'body', y: 300, height: 300, contains: 'Body' }] })
        if (n === 5) signal.aborted = true
        return turn('add_sticker', { emoji: '⭐', n }) // distinct args — no cycle guard
      },
      design: compactDesign,
      mode: 'create',
      request: 'Design a bold Instagram post for a coffee launch',
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
      request: 'Make the existing title bigger',
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
      request: 'Design a bold Instagram post for a coffee launch',
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
      request: 'What is wrong with this design?',
      emit: () => {},
      awaitApply: async () => ({ ok: true }),
    })
    expect(result.toolCalls).toBe(1)
    expect(calls.some((c) => c.some((m) => m.content.includes('not available in review mode')))).toBe(true)
  })
  it('CASE F7: compaction folds a long conversation and emits a compact event', async () => {
    const events: AgentEvent[] = []
    const replies: string[] = []
    replies.push(turn('plan_layout', { background: '#090B1A', sections: [{ name: 'hero', y: 60, height: 200, contains: 'Hero' }, { name: 'body', y: 300, height: 300, contains: 'Body' }] }))
    for (let i = 0; i < 65; i++) replies.push(turn('add_sticker', { emoji: '⭐', n: i }))
    replies.push(done('Long run complete'))
    const result = await runAgentLoop({
      chat: scriptedChat(replies).chat,
      design: compactDesign,
      mode: 'create',
      request: 'Design a bold Instagram post for a coffee launch',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })
    expect(events.some((e) => e.type === 'compact')).toBe(true)
    expect(result.toolCalls).toBe(65) // compaction never stops the run
  })
  it('usage telemetry streams during long runs', async () => {
    const events: AgentEvent[] = []
    const replies: string[] = []
    replies.push(turn('plan_layout', { background: '#090B1A', sections: [{ name: 'hero', y: 60, height: 200, contains: 'Hero' }, { name: 'body', y: 300, height: 300, contains: 'Body' }] }))
    for (let i = 0; i < 40; i++) replies.push(turn('add_sticker', { emoji: '⭐' }))
    replies.push(done('done'))
    await runAgentLoop({
      chat: scriptedChat(replies).chat,
      design,
      mode: 'create',
      request: 'Design a bold Instagram post for a coffee launch',
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
    expect(Math.round(contrastBetween('#FFFFFF', '#000000'))).toBe(21)
    expect(contrastBetween('#111122', '#090B1A')).toBeLessThan(1.2)
    expect(contrastBetween('not-a-color', '#000000')).toBe(0)
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
    expect(joined).toContain('overflows its box')
    expect(joined).toContain('under 14')
    expect(joined).toContain('overlap')
    expect(joined).toContain('outside the canvas')
  })

  it('v0.29.3: no page background → NO fabricated dominant-color backdrop; clean canvas → no issues', () => {
    // the failed production run audited contrast against a GUESSED
    // "first hex in colorsInUse" — the wrong backdrop produced wrong
    // findings. The audit now needs the REAL page background (or a
    // card behind the text); unknown backdrop → no page-level
    // contrast claims at all.
    const issues = auditDesign({
      width: 1080,
      height: 1080,
      elements: [{ id: 'b1', type: 'text', text: 'Dark', fill: '#111122', fontSize: 48, x: 0, y: 0, width: 600, height: 90 }],
      colorsInUse: ['#090B1A'],
    })
    expect(issues.join('\n')).not.toContain('Low contrast')
    // with the real background present, the same text IS flagged
    const flagged = auditDesign({
      width: 1080,
      height: 1080,
      background: '#090B1A',
      elements: [{ id: 'b1', type: 'text', text: 'Dark', fill: '#111122', fontSize: 48, x: 0, y: 0, width: 600, height: 90 }],
    })
    expect(flagged.join('\n')).toContain('Low contrast')
    expect(auditDesign({ width: 1080, height: 1080, background: '#FFFFFF', elements: [{ id: 'c1', type: 'text', text: 'OK', fill: '#111111', fontSize: 32, x: 100, y: 100, width: 300, height: 60 }] })).toEqual([])
  })
})


// ═════════════════════════════════════════════════════════════
// v0.29.3 REGRESSION SUITE — the failed CANVIX production run
// (1080×1080 promo poster: "only:" phantom requirement, decorative
// color strips, text clipped/obscured, vision critique after the
// fact, "Music Festival" summary, reactive add/move loops)
// ═════════════════════════════════════════════════════════════

const CANVIX_PROMPT =
  'Create a premium 1080×1080 promo poster for CANVIX. Exact text only: \u201cCANVIX\u201d, \u201cDesign Beyond Limits.\u201d, \u201cYour imagination. Our canvas.\u201d, \u201cAI-Powered Design\u201d, \u201c366+ Templates\u201d, \u201cStart Creating Free\u201d, \u201ccanvix.app\u201d. Use #090B1A, #8B5CF6, #22D3EE, #F8FAFC, #A1A1AA. Add a realistic editor mockup, 3 feature cards, glassmorphism, strong spacing, no clipping, no overlaps, no decorative lines over text. Use native editable elements. Fix issues before finishing.'

describe('v0.29.3 · brief extraction (the "only:" bug)', () => {
  it('the EXACT failed production prompt yields the seven user strings — and never "only:"', () => {
    const brief = extractBrief(CANVIX_PROMPT, 1080, 1080)
    expect(brief.requiredTexts.map((t) => t.text)).toEqual([
      'CANVIX',
      'Design Beyond Limits.',
      'Your imagination. Our canvas.',
      'AI-Powered Design',
      '366+ Templates',
      'Start Creating Free',
      'canvix.app',
    ])
    expect(brief.requiredTexts.some((t) => t.text === 'only:')).toBe(false)
    expect(brief.requiredColors.map((c) => c.hex)).toEqual(['#090b1a', '#8b5cf6', '#22d3ee', '#f8fafc', '#a1a1aa'])
    expect(brief.dimensions).toEqual({ tier: 'mandatory', width: 1080, height: 1080 })
  })

  it('"Exact text only:" never manufactures a requirement — the instruction tail is not content', () => {
    for (const msg of [
      'Exact text only: "A", "B"',
      'Text only: hello world',
      'exact TEXT ONLY: "X"',
      'Copy: only the best will do', // keyword+separator, payload starts lowercase → ignored
    ]) {
      const brief = extractBrief(msg, 1080, 1080)
      expect(brief.requiredTexts.some((t) => /only/i.test(t.text))).toBe(false)
    }
  })

  it('unquoted headline patterns still extract when a real separator exists', () => {
    const brief = extractBrief('headline: Summer Sale Blast', 1080, 1080)
    expect(brief.requiredTexts.map((t) => t.text)).toContain('Summer Sale Blast')
    const brief2 = extractBrief('title = "Night Market"', 1080, 1080)
    expect(brief2.requiredTexts.map((t) => t.text)).toContain('Night Market')
  })

  it('composite deliverables become mandatory contract fields', () => {
    const brief = extractBrief(CANVIX_PROMPT, 1080, 1080)
    const kinds = brief.requiredFeatures?.map((f) => f.kind)
    expect(kinds).toContain('editor-mockup')
    expect(kinds).toContain('glassmorphism')
    const cards = brief.requiredFeatures?.find((f) => f.kind === 'feature-cards')
    expect(cards?.count).toBe(3)
  })

  it('feature validation: a structurally-correct poster passes; a bare canvas fails with fix guidance', () => {
    const brief = extractBrief(CANVIX_PROMPT, 1080, 1080)
    const good = validateBrief(brief, {
      texts: ['CANVIX', 'Design Beyond Limits.', 'Your imagination. Our canvas.', 'AI-Powered Design', '366+ Templates', 'Start Creating Free', 'canvix.app'],
      colors: ['#090b1a', '#8b5cf6', '#22d3ee', '#f8fafc', '#a1a1aa'],
      width: 1080,
      height: 1080,
      elements: [
        { type: 'rect', x: 80, y: 80, width: 420, height: 280, fill: 'rgba(248,250,252,0.08)', stroke: 'rgba(139,92,246,0.35)' },
        { type: 'rect', x: 100, y: 100, width: 300, height: 24, fill: '#8B5CF6' },
        { type: 'rect', x: 100, y: 140, width: 180, height: 90, fill: 'rgba(34,211,238,0.2)' },
        { type: 'text', x: 120, y: 250, width: 200, height: 30, text: 'Layer 1', fill: '#F8FAFC' },
        { type: 'rect', x: 560, y: 420, width: 200, height: 140, fill: 'rgba(248,250,252,0.1)', stroke: 'rgba(139,92,246,0.3)' },
        { type: 'text', x: 580, y: 470, width: 160, height: 24, text: 'AI-Powered Design', fill: '#F8FAFC' },
        { type: 'rect', x: 560, y: 600, width: 200, height: 140, fill: 'rgba(248,250,252,0.1)', stroke: 'rgba(34,211,238,0.3)' },
        { type: 'text', x: 580, y: 650, width: 160, height: 24, text: '366+ Templates', fill: '#F8FAFC' },
        { type: 'rect', x: 80, y: 600, width: 200, height: 140, fill: 'rgba(248,250,252,0.1)', stroke: 'rgba(139,92,246,0.3)' },
        { type: 'text', x: 100, y: 650, width: 160, height: 24, text: 'Start Creating Free', fill: '#22D3EE' },
      ],
    })
    expect(good.satisfied).toBe(true)
    expect(good.unmet).toEqual([])
    expect(good.checked.features?.every((f) => f.found)).toBe(true)

    const bad = validateBrief(brief, {
      texts: ['CANVIX'],
      colors: ['#090b1a'],
      width: 1080,
      height: 1080,
      elements: [{ type: 'rect', x: 0, y: 0, width: 1080, height: 40, fill: '#8B5CF6' }],
    })
    expect(bad.satisfied).toBe(false)
    expect(bad.unmet.some((u) => u.includes('editor mockup'))).toBe(true)
    expect(bad.unmet.some((u) => u.includes('feature cards'))).toBe(true)
    expect(bad.unmet.some((u) => u.includes('glassmorphism'))).toBe(true)
  })
})

describe('v0.29.3 · router (the discuss misroute)', () => {
  it('the EXACT failed prompt routes to create — brand name + "feature cards" must not trigger the product-discuss guard', () => {
    const h = heuristicMode(CANVIX_PROMPT)
    expect(h.mode).toBe('create')
    expect(h.confidence).toBe('high')
  })

  it('product questions still route to discuss/explain', () => {
    expect(heuristicMode('Why is the Canvix agent broken?').mode).toBe('discuss')
    expect(heuristicMode('How does the poster feature work?').mode).not.toBe('create')
  })
})

describe('v0.29.3 · audit geometry (structural ≠ rendered)', () => {
  it('text on a glass card is judged against the CARD, not the page — intentional layering is preserved', () => {
    const issues = auditDesign({
      width: 1080,
      height: 1080,
      background: '#090B1A',
      elements: [
        // white text on a white-glass card over dark navy: the old
        // page-bg math called this 1.0:1 — wrong backdrop
        { id: 'card', type: 'rect', x: 100, y: 100, width: 400, height: 200, fill: 'rgba(248,250,252,0.08)' },
        { id: 't1', type: 'text', x: 120, y: 150, width: 360, height: 60, text: 'Glass card text', fontSize: 32, fill: '#F8FAFC' },
      ],
    })
    expect(issues.join('\n')).not.toContain('Low contrast')
  })

  it('dark text on a light card IS flagged — the card is the real backdrop', () => {
    const issues = auditDesign({
      width: 1080,
      height: 1080,
      background: '#090B1A',
      elements: [
        { id: 'card', type: 'rect', x: 100, y: 100, width: 400, height: 200, fill: '#F8FAFC' },
        { id: 't1', type: 'text', x: 120, y: 150, width: 360, height: 60, text: 'Dark on light card', fontSize: 32, fill: '#090B1A' },
      ],
    })
    expect(issues.join('\n')).not.toContain('Low contrast') // 15:1+ — correct
    const dark = auditDesign({
      width: 1080,
      height: 1080,
      background: '#F8FAFC',
      elements: [
        { id: 'card', type: 'rect', x: 100, y: 100, width: 400, height: 200, fill: 'rgba(248,250,252,0.9)' },
        { id: 't1', type: 'text', x: 120, y: 150, width: 360, height: 60, text: 'Faint on glass', fontSize: 32, fill: '#94A3B8' },
      ],
    })
    expect(dark.join('\n')).toContain('Low contrast')
  })

  it('an opaque shape ABOVE a text that covers it is reported as obscured — present is not visible', () => {
    const issues = auditDesign({
      width: 1080,
      height: 1080,
      background: '#090B1A',
      elements: [
        { id: 't1', type: 'text', x: 100, y: 100, width: 400, height: 60, text: 'CANVIX', fontSize: 48, fill: '#F8FAFC' },
        { id: 'bar', type: 'rect', x: 0, y: 90, width: 1080, height: 40, fill: '#8B5CF6' }, // ABOVE, covers most of the text
      ],
    })
    expect(issues.join('\n')).toContain('covered by')
  })

  it('a decorative strip is the ONLY use of a required color → flagged, not accepted as compliance', () => {
    const issues = auditDesign(
      {
        width: 1080,
        height: 1080,
        background: '#090B1A',
        elements: [
          { id: 's1', type: 'text', x: 100, y: 100, width: 400, height: 60, text: 'CANVIX', fontSize: 48, fill: '#F8FAFC' },
          { id: 'strip', type: 'rect', x: 20, y: 20, width: 1040, height: 40, fill: '#A1A1AA' },
        ],
      },
      { requiredColors: [{ hex: '#a1a1aa', tier: 'mandatory' }] },
    )
    expect(issues.join('\n')).toContain('bare decorative strip')
    // the same color as a TEXT fill is real usage — no flag
    const ok = auditDesign(
      {
        width: 1080,
        height: 1080,
        background: '#090B1A',
        elements: [{ id: 's1', type: 'text', x: 100, y: 100, width: 400, height: 60, text: 'Footer', fontSize: 24, fill: '#A1A1AA' }],
      },
      { requiredColors: [{ hex: '#a1a1aa', tier: 'mandatory' }] },
    )
    expect(ok.join('\n')).not.toContain('strip')
  })

  it('overflow uses the client-measured width when present (real metrics, not glyph averages)', () => {
    const issues = auditDesign({
      width: 1080,
      height: 1080,
      background: '#090B1A',
      elements: [
        // 14 chars at 72px: the 0.58-avg estimate says ~585px (fits);
        // the REAL measured width is 900px → clips
        { id: 't1', type: 'text', x: 60, y: 100, width: 600, height: 90, text: 'Start Creating Free', fontSize: 72, fill: '#F8FAFC', measuredWidth: 900 },
      ],
    })
    expect(issues.join('\n')).toContain('measured 900px')
    expect(issues.join('\n')).toContain('overflows its box')
  })

  it('unknown page background: no page-level contrast guesses — no fabricated backdrop', () => {
    const issues = auditDesign({
      width: 1080,
      height: 1080,
      elements: [{ id: 't1', type: 'text', x: 100, y: 100, width: 400, height: 60, text: 'Plain', fontSize: 32, fill: '#F8FAFC' }],
    })
    expect(issues.join('\n')).not.toContain('Low contrast')
  })
})

describe('v0.29.3 · loop: vision critique BEFORE completion', () => {
  it('P0 findings drive ONE bounded correction round, then re-capture verifies — done only then', async () => {
    const events: AgentEvent[] = []
    const critiques: string[] = []
    const captures: string[] = []
    const { chat, calls } = scriptedChat([
      turn('set_background', { kind: 'solid', from: '#090B1A' }),
      turn('plan_layout', { background: '#090B1A', sections: [{ name: 'hero', y: 60, height: 200, contains: 'Hero' }, { name: 'body', y: 300, height: 300, contains: 'Body' }] }),
      turn('add_text', { text: 'CANVIX', fontSize: 72, color: '#F8FAFC' }),
      done('Poster complete'),
      turn('move_elements', { ids: ['txt-1'], dx: 0, dy: 40 }),
      done('Poster complete — fixed'),
    ])
    const critique = async (image: string): Promise<VisionCritiqueResult> => {
      critiques.push(image)
      return critiques.length === 1
        ? { findings: [{ severity: 'P0', issue: 'Required text "CANVIX" is missing from the rendered canvas', fix: 'Add it verbatim' }], note: 'first pass' }
        : { findings: [{ severity: 'P2', issue: 'minor spacing' }], note: 'second pass' }
    }
    const result = await runAgentLoop({
      chat,
      design: compactDesign,
      mode: 'create',
      request: 'Design a bold Instagram post for a coffee launch',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
      captureCanvas: async () => {
        captures.push('shot')
        return 'data:image/png;base64,AAA'
      },
      critique,
    })
    expect(critiques).toHaveLength(2) // initial + verification
    expect(captures).toHaveLength(2)
    expect(result.toolCalls).toBe(3) // the correction applied a 4th tool call
    // the correction message reached the model
    expect(calls.some((c) => c.some((m) => m.content.includes('VISION CRITIQUE of the RENDERED canvas')))).toBe(true)
    const finalEvent = events[events.length - 1] as { type: string; verification?: string }
    expect(finalEvent.type).toBe('done')
    expect(String(finalEvent.verification)).toMatch(/PASSED|no P0 defects/)
    expect(result.findings?.some((f) => f.severity === 'P0')).toBe(false)
  })

  it('P0 defects that SURVIVE the correction round block a success claim — summary says INCOMPLETE', async () => {
    const events: AgentEvent[] = []
    const { chat } = scriptedChat([
      turn('set_background', { kind: 'solid', from: '#090B1A' }),
      done('Poster complete'),
      turn('plan_layout', { background: '#090B1A', sections: [{ name: 'hero', y: 60, height: 200, contains: 'Hero' }, { name: 'body', y: 300, height: 300, contains: 'Body' }] }),
      turn('update_elements', { ids: ['txt-1'], fill: '#F8FAFC' }),
      done('Poster complete — attempted'),
    ])
    const result = await runAgentLoop({
      chat,
      design,
      mode: 'create',
      request: 'Design a bold Instagram post for a coffee launch',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
      captureCanvas: async () => 'data:image/png;base64,AAA',
      critique: async (): Promise<VisionCritiqueResult> => ({ findings: [{ severity: 'P0', issue: 'CANVIX still clipped to "Start Cr"' }], note: 'still broken' }),
    })
    const finalEvent = events[events.length - 1] as { type: string; summary?: string; verification?: string }
    expect(finalEvent.type).toBe('done')
    expect(String(finalEvent.summary)).toContain('INCOMPLETE')
    expect(String(finalEvent.verification)).toContain('NOT visually verified')
    expect(String(finalEvent.verification)).toContain('P0')
    expect(result.summary).toContain('INCOMPLETE')
  })

  it('no capture (timeout) → disclosed as unverified, never silently skipped', async () => {
    const events: AgentEvent[] = []
    const { chat } = scriptedChat([
      turn('set_background', { kind: 'solid', from: '#090B1A' }),
      done('Poster complete'),
    ])
    const result = await runAgentLoop({
      chat,
      design,
      mode: 'create',
      request: 'Design a bold Instagram post for a coffee launch',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
      captureCanvas: async () => null,
      critique: async () => ({ findings: [], note: 'never called' }),
    })
    expect(String(result.verification)).toContain('UNAVAILABLE')
    expect(String(result.verification)).toContain('NOT verified')
  })

  it('no vision model configured → honest disclosure, no critique call', async () => {
    const { chat } = scriptedChat([
      turn('set_background', { kind: 'solid', from: '#090B1A' }),
      done('Poster complete'),
    ])
    const result = await runAgentLoop({
      chat,
      design,
      mode: 'create',
      request: 'Design a bold Instagram post for a coffee launch',
      emit: () => {},
      awaitApply: async () => ({ ok: true }),
      captureCanvas: async () => 'data:image/png;base64,AAA',
      critique: async () => null,
    })
    expect(String(result.verification)).toContain('unavailable')
  })
})

describe('v0.29.3 · loop: planning + fail-closed acks', () => {
  it('plan_layout streams a plan event and sets the execution frame', async () => {
    const events: AgentEvent[] = []
    const { chat } = scriptedChat([
      turn('plan_layout', {
        background: '#090B1A',
        sections: [
          { name: 'headline', y: 60, height: 140, contains: 'CANVIX' },
          { name: 'tagline', y: 240, height: 80, contains: 'Design Beyond Limits.' },
        ],
      }),
      turn('set_background', { kind: 'solid', from: '#090B1A' }),
      done('Done'),
    ])
    const result = await runAgentLoop({ chat, design, mode: 'create', request: 'Design a bold Instagram post for a coffee launch', emit: (e) => events.push(e), awaitApply: async () => ({ ok: true }) })
    const planEvent = events.find((e) => e.type === 'plan') as { steps?: string[] } | undefined
    expect(planEvent).toBeTruthy()
    expect(planEvent?.steps?.join('\n')).toContain('headline')
    expect(result.steps).toBe(2) // plan_layout + set_background each count as a step
  })

  it('plan_layout AUTO-REPAIRS invalid geometry server-side (v0.32.5: the model never re-does gap arithmetic)', () => {
    const tool = AGENT_TOOL_MAP.get('plan_layout')
    expect(tool).toBeTruthy()
    // safe area on the 1080px harness canvas: y 65..1015 (950px usable)
    // a stacked plan (gap −50) is REPAIRED, not rejected: order,
    // heights and contents kept; the server computes valid positions.
    const stacked = tool!.sanitize(
      {
        sections: [
          { name: 'a', y: 100, height: 200, contains: 'x' },
          { name: 'b', y: 250, height: 200, contains: 'y' },
        ],
      },
      ctx,
    )
    expect(stacked.ok).toBe(true)
    const stackedObs = String((stacked as { observation?: string }).observation)
    expect(stackedObs).toContain('AUTO-REPAIRED')
    expect(stackedObs).toContain('do not recompute')
    const stackedBands = (stacked as { actions?: { bands?: { name: string; y: number; h: number }[] }[] }).actions?.[0]?.bands
    expect(stackedBands?.map((b) => b.name)).toEqual(['a', 'b'])
    expect(stackedBands?.[0]).toEqual({ name: 'a', y: 65, h: 200 })
    if (stackedBands) {
      expect(stackedBands[1].y - (stackedBands[0].y + stackedBands[0].h)).toBeGreaterThanOrEqual(40)
    }
    expect(stackedBands?.[1].h).toBe(200)
    expect(stackedBands![1].y + stackedBands![1].h).toBeLessThanOrEqual(1015)

    // 39px gap: REPAIRED to ≥40 — the model never re-attempts the plan
    const gap39 = tool!.sanitize(
      {
        sections: [
          { name: 'a', y: 100, height: 200, contains: 'x' },
          { name: 'b', y: 339, height: 100, contains: 'y' },
        ],
      },
      ctx,
    )
    expect(gap39.ok).toBe(true)
    const g39 = (gap39 as { actions?: { bands?: { name: string; y: number; h: number }[] }[] }).actions?.[0]?.bands
    expect(g39?.map((b) => b.name)).toEqual(['a', 'b'])
    expect(g39?.[0].h).toBe(200)
    expect(g39?.[1].h).toBe(100)
    expect(g39![1].y - (g39![0].y + g39![0].h)).toBeGreaterThanOrEqual(40)

    // a VALID plan (from the safe-area top, exact 40px gaps): accepted
    // UNCHANGED — no repair note, the model's own geometry stands.
    const valid = tool!.sanitize(
      {
        sections: [
          { name: 'a', y: 65, height: 200, contains: 'x' },
          { name: 'b', y: 305, height: 100, contains: 'y' },
        ],
      },
      ctx,
    )
    expect(valid.ok).toBe(true)
    const validObs = String((valid as { observation?: string }).observation)
    expect(validObs).toContain('Bands verified')
    expect(validObs).not.toContain('AUTO-REPAIRED')
    const validBands = (valid as { actions?: { bands?: { name: string; y: number; h: number }[] }[] }).actions?.[0]?.bands
    expect(validBands).toEqual([
      { name: 'a', y: 65, h: 200 },
      { name: 'b', y: 305, h: 100 },
    ])

    // v0.32.8: 1200px of content on a 950px usable page is no longer
    // infeasible — it SCALES (disclosed): 3×290px bands with 40px gaps.
    const oversized = tool!.sanitize(
      {
        sections: [
          { name: 'a', y: 65, height: 400, contains: 'x' },
          { name: 'b', y: 505, height: 400, contains: 'y' },
          { name: 'c', y: 945, height: 400, contains: 'z' },
        ],
      },
      ctx,
    )
    expect(oversized.ok).toBe(true)
    const ob = (oversized as { actions?: { bands?: { name: string; y: number; h: number }[] }[] }).actions?.[0]?.bands
    expect(ob?.every((b) => b.h === 290)).toBe(true)
    expect(ob![2].y + ob![2].h).toBeLessThanOrEqual(1015)
    expect(String((oversized as { observation?: string }).observation)).toContain('AUTO-REPAIRED')

    // truly INFEASIBLE remains for compositions that cannot fit even at
    // the 56px floor: 12 sections floor to 672px + 440px of gaps =
    // 1112px > the 950px safe area — rejected with the exact math. No
    // strikes: the loop's separate plan budget handles it (pinned below).
    const infeasible = tool!.sanitize(
      {
        sections: Array.from({ length: 12 }, (_, i) => ({ name: `s${i + 1}`, y: 65 + i * 100, height: 140, contains: 'x' })),
      },
      ctx,
    )
    expect(infeasible.ok).toBe(false)
    const err = String((infeasible as { error?: string }).error)
    expect(err).toContain('Infeasible plan')
    expect(err).toContain('56px minimum band')
    expect(err).toContain('at most 10 sections')
  })

  it('a failed (timed-out) apply ack tells the model the action was NOT applied — fail closed', async () => {
    const { chat, calls } = scriptedChat([
      turn('set_background', { kind: 'solid', from: '#090B1A' }),
      done('Wrapped up'),
    ])
    const result = await runAgentLoop({
      chat,
      design,
      mode: 'create',
      request: 'Design a bold Instagram post for a coffee launch',
      emit: () => {},
      // v0.29.3 route semantics: timeout resolves ok:false
      awaitApply: async () => ({ ok: false, message: 'ack timeout — the client did NOT confirm the apply' }),
    })
    expect(result.toolCalls).toBe(0) // the un-confirmed action never counts
    expect(calls.some((c) => c.some((m) => m.content.includes('NOT confirm the apply') || m.content.includes('was not verified as changed')))).toBe(true)
  })
})


// ═════════════════════════════════════════════════════════════
// v0.29.4 REGRESSION — "ask him anything and it builds sunset"
// ═════════════════════════════════════════════════════════════

describe('v0.29.4 · greetings and chitchat never trigger a build', () => {
  it.each(['hi', 'hey there', 'thanks!', 'ok cool', 'hello', 'test', 'thank you so much', 'yo!'])(
    '"%s" routes to discuss with HIGH confidence — no model router call, no invented build task',
    (msg) => {
      const h = heuristicMode(msg)
      expect(h.mode).toBe('discuss')
      expect(h.confidence).toBe('high')
    },
  )

  it('a REAL build brief still routes to create after the greeting guard', () => {
    expect(heuristicMode(CANVIX_PROMPT).mode).toBe('create')
    expect(heuristicMode('make me a poster for a pizza place').mode).toBe('create')
  })

  it('longer conversational messages are not hijacked by the greeting guard', () => {
    // not pure greeting → falls through to the normal ladder (edit here)
    expect(['edit', 'discuss', 'create']).toContain(heuristicMode('make the title bold').mode)
  })
})

describe('v0.29.4 · new skills (glassmorphism, mockups, accessibility)', () => {
  it('the failed CANVIX prompt selects glassmorphism + mockups alongside the poster skill', () => {
    const skills = selectSkills(CANVIX_PROMPT, 'create')
    const ids = skills.map((s) => s.id)
    expect(ids).toContain('poster-design')
    expect(ids).toContain('glassmorphism-ui')
    expect(ids).toContain('realistic-mockups')
  })

  it('accessibility asks select the accessibility skill', () => {
    const ids = selectSkills('improve the contrast and accessibility of this design', 'improve').map((s) => s.id)
    expect(ids).toContain('visual-accessibility')
  })

  it('the glassmorphism playbook teaches rgba fill + border + contrast on the composited backdrop', () => {
    const glass = DESIGN_SKILLS.find((s) => s.id === 'glassmorphism-ui')
    expect(glass).toBeTruthy()
    const text = JSON.stringify(glass!.playbook)
    expect(text).toContain('rgba')
    expect(text.toLowerCase()).toContain('composited')
    expect(text.toLowerCase()).toContain('contrast')
  })

  it('the mockup playbook requires a composite, never one empty rectangle', () => {
    const mock = DESIGN_SKILLS.find((s) => s.id === 'realistic-mockups')
    expect(mock).toBeTruthy()
    const text = JSON.stringify(mock!.playbook)
    expect(text).toContain('title bar')
    expect(text).toContain('sidebar')
    expect(text.toLowerCase()).toContain('composite')
    // the exact structural floor the brief validator enforces
    expect(text).toContain('160×110')
  })

  it('skillsPromptSection discloses the selected new skills', () => {
    const section = skillsPromptSection(selectSkills(CANVIX_PROMPT, 'create'))
    expect(section).toContain('Skill: Glassmorphism')
    expect(section).toContain('Skill: Realistic Product Mockups')
  })
})

// ═════════════════════════════════════════════════════════════
// v0.32.2 · THE PRODUCTION REPRODUCTION (P0: "Canvix AI ignores
// creative requests and loops on an empty canvas")
//
//   "Design a bold Instagram post for a coffee launch" in Auto mode
//   on an empty 1080×1920 canvas routed to EDIT, the model never saw
//   the request ("User request mode: edit. Begin." was the only user
//   message), looped get_page_state, and the run ended with nothing
//   created. Both defects + the honesty requirements are pinned here.
// ═════════════════════════════════════════════════════════════

describe('v0.32.2 · router: the Instagram-post misroute (defect A)', () => {
  it('the five mandatory regressions', () => {
    expect(heuristicMode('Design a bold Instagram post for a coffee launch')).toEqual({ mode: 'create', confidence: 'high' })
    expect(heuristicMode('Create a colorful social media graphic')).toEqual({ mode: 'create', confidence: 'high' })
    expect(heuristicMode('Make the existing title bold')).toEqual({ mode: 'edit', confidence: 'high' })
    expect(heuristicMode('Move the coffee cup image to the right')).toEqual({ mode: 'edit', confidence: 'high' })
    expect(heuristicMode('What is wrong with this design?')).toEqual({ mode: 'review', confidence: 'high' })
  })

  it('styling adjectives describe the requested design — they are NOT edit evidence', () => {
    for (const msg of [
      'Design a bold Instagram post for a coffee launch',
      'design a minimal instagram story',
      'make a vibrant tiktok cover',
      'create an elegant linkedin post',
      'a colorful facebook ad please',
      'Design a bold poster',
      'make me a dark moody menu',
    ]) {
      expect(heuristicMode(msg).mode, msg).toBe('create')
    }
  })

  it('an artifact noun inside an existing-element reference is still an edit', () => {
    expect(heuristicMode('Make the poster title bold').mode).toBe('edit')
    expect(heuristicMode('delete the instagram logo on page 2').mode).toBe('edit')
    expect(heuristicMode('make the existing title bold').mode).toBe('edit')
  })
})

describe('v0.32.2 · loop: the original request reaches the model (defect B)', () => {
  const emptyDesign: AgentDesignCtx = {
    name: 'Untitled',
    width: 1080,
    height: 1920,
    pageCount: 1,
    currentPageIndex: 0,
    elements: [],
    colorsInUse: [],
    otherPages: [],
  }
  const REQUEST = 'Design a bold Instagram post for a coffee launch'

  it('the FIRST model call carries the full original request as the actual user message, verbatim', async () => {
    const events: AgentEvent[] = []
    const { chat, calls } = scriptedChat([
      turn('set_background', { kind: 'solid', from: '#1B3A6B' }),
      done('Created'),
    ])
    await runAgentLoop({
      chat,
      design: emptyDesign,
      mode: 'create',
      request: REQUEST,
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })
    expect(calls.length).toBeGreaterThan(0)
    expect(calls[0]?.[0]?.role).toBe('system')
    expect(calls[0]?.[1]?.role).toBe('user')
    // the USER'S OWN WORDS — not "User request mode: create. Begin."
    expect(calls[0]?.[1]?.content).toBe(REQUEST)
  })

  it('the request survives compaction — long runs never lose what was asked', async () => {
    const events: AgentEvent[] = []
    // 70 distinct writes ≈ 140 messages → past maxMessages(120),
    // compaction fires mid-run; messages[1] must stay the request
    const replies = [
      turn('plan_layout', { background: '#090B1A', sections: [{ name: 'hero', y: 60, height: 200, contains: 'Hero' }, { name: 'body', y: 300, height: 300, contains: 'Body' }] }),
      ...Array.from({ length: 70 }, (_, i) =>
        turn('add_text', { text: `line ${i}`, y: 40 + i * 20, fontSize: 24, color: '#FFFFFF' }),
      ),
    ]
    replies.push(done('Long build complete'))
    const { chat, calls } = scriptedChat(replies)
    const result = await runAgentLoop({
      chat,
      design: emptyDesign,
      mode: 'create',
      request: REQUEST,
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })
    expect(events.some((e) => e.type === 'compact')).toBe(true)
    const lastCall = calls[calls.length - 1]
    expect(lastCall?.[1]?.role).toBe('user')
    expect(lastCall?.[1]?.content).toBe(REQUEST)
    expect(result.summary).not.toContain('INCOMPLETE')
  })
})

describe('v0.32.2 · loop: the reproduction end-to-end on an empty canvas', () => {
  const emptyDesign: AgentDesignCtx = {
    name: 'Untitled',
    width: 1080,
    height: 1920,
    pageCount: 1,
    currentPageIndex: 0,
    elements: [],
    colorsInUse: [],
    otherPages: [],
  }
  const REQUEST = 'Design a bold Instagram post for a coffee launch'

  it('creates a complete native editable design from the reproduction prompt — no get_page_state loop', async () => {
    const events: AgentEvent[] = []
    const { chat, calls } = scriptedChat([
      turn('set_background', { kind: 'gradient', from: '#120A2A', to: '#2E1A47' }),
      turn('plan_layout', { background: '#090B1A', sections: [{ name: 'hero', y: 60, height: 200, contains: 'Hero' }, { name: 'body', y: 300, height: 300, contains: 'Body' }] }),
      turn('add_text', { text: 'ARTISAN ROAST', y: 210, fontSize: 132, color: '#FFFFFF', bold: true }),
      turn('add_text', { text: 'our coffee launch — first sip free', y: 400, fontSize: 46, color: '#E8D9FF' }),
      turn('add_shape', { shape: 'rect', x: 140, y: 780, width: 800, height: 360, fill: '#2E1A47' }),
      turn('add_text', { text: 'order at canvix.coffee', y: 920, fontSize: 56, color: '#FFFFFF' }),
      done('Coffee-launch Instagram post created: bold headline, offer line and CTA card, night palette.'),
    ])
    const result = await runAgentLoop({
      chat,
      design: emptyDesign,
      mode: 'create',
      request: REQUEST,
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })

    // the model BUILT: five applied write tools
    expect(result.toolCalls).toBe(5)
    // native editable elements were emitted as real design actions
    const actions = events.filter((e) => e.type === 'action') as unknown as { tool: string; actions: unknown[] }[]
    const actionJson = JSON.stringify(actions.flatMap((a) => a.actions))
    expect(actionJson).toContain('"type":"addText"')
    expect(actionJson).toContain('"type":"addShape"')
    expect(actionJson).toContain('ARTISAN ROAST')
    // NO state-inspection loop during a successful create
    expect(actions.map((a) => a.tool)).not.toContain('get_page_state')
    // honest SUCCESS (changes were made) — not an INCOMPLETE wrap-up
    expect(result.summary).not.toContain('INCOMPLETE')
    expect(events[events.length - 1]?.type).toBe('done')
    // and the model saw what it was asked for
    expect(calls[0]?.[1]?.content).toBe(REQUEST)
  })

  it('the failure shape is bounced and reported honestly — never "successfully created"', async () => {
    const events: AgentEvent[] = []
    // the exact reproduction behavior: inspect, inspect again, then
    // claim you cannot proceed because "no design brief was provided"
    const { chat, calls } = scriptedChat([
      turn('get_page_state', {}),
      turn('get_page_state', {}),
      done('I need more information — no design brief was provided.'),
      turn('get_page_state', { page: 0 }),
      done('Still cannot proceed without requirements.'),
    ])
    const result = await runAgentLoop({
      chat,
      design: emptyDesign,
      mode: 'create',
      request: REQUEST,
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })

    // the premature done was REJECTED with build guidance
    const bounce = calls.find((c) => c.some((m) => m.role === 'user' && m.content.includes('NOT DONE — this is a create run')))
    expect(bounce).toBeDefined()
    // and the run ended HONESTLY: no design changes → not a success
    expect(result.summary).toContain('INCOMPLETE — no design changes were made')
    expect(result.verification).toContain('NOT completed')
    const final = events[events.length - 1] as { type: string; summary?: string; verification?: string }
    expect(final.type).toBe('done')
    expect(String(final.summary)).toContain('INCOMPLETE')
    expect(String(final.verification)).toContain('NOT completed')
  })

  it('a pure get_page_state cycle on an empty canvas ends INCOMPLETE — the guard stays, honestly', async () => {
    const events: AgentEvent[] = []
    const { chat } = scriptedChat([
      turn('get_page_state', {}),
      turn('get_page_state', {}),
      turn('get_page_state', {}),
    ])
    const result = await runAgentLoop({
      chat,
      design: emptyDesign,
      mode: 'create',
      request: REQUEST,
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })
    expect(result.summary).toContain('INCOMPLETE')
    expect(result.verification).toContain('NOT completed')
  })

  it('the brief gate still runs before a create run may claim completion', async () => {
    const events: AgentEvent[] = []
    const { chat, calls } = scriptedChat([
      turn('set_background', { kind: 'solid', from: '#111111' }),
      turn('plan_layout', { background: '#090B1A', sections: [{ name: 'hero', y: 60, height: 200, contains: 'Hero' }, { name: 'body', y: 300, height: 300, contains: 'Body' }] }),
      turn('add_text', { text: 'Coffee launch', fontSize: 90, color: '#FFFFFF' }),
      done('Done attempt 1 — missing the required color'),
      turn('add_text', { text: 'order at canvix.coffee', fontSize: 40, color: '#E2604F' }),
      done('Done — requirements met'),
    ])
    // validation answers unsatisfied until the model's fix round
    // (the 4th turn adds the missing required text), then passes
    let validations = 0
    const result = await runAgentLoop({
      chat,
      design: emptyDesign,
      mode: 'create',
      request: 'Coffee launch post with "Coffee launch" and the color #E2604F',
      brief: extractBrief('"Coffee launch" and the color #E2604F'),
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
      validateBriefOnClient: async () => {
        validations += 1
        return validations === 1
          ? { satisfied: false, unmet: ['Required text missing or altered: "order at canvix.coffee"'] }
          : { satisfied: true, unmet: [] }
      },
    })
    // the first done was rejected for the unmet requirement…
    expect(calls.some((c) => c.some((m) => m.role === 'user' && m.content.includes('NOT DONE (attempt 1 of 3)')))).toBe(true)
    // …the fix round added the missing text → the re-validation passed
    expect(validations).toBe(2)
    expect(result.summary).not.toContain('INCOMPLETE')
    expect(result.verification).toContain('Brief contract validated')
  })
})

// ═════════════════════════════════════════════════════════════
// v0.32.3 · plan-first + conversation memory + geometry ground
// truth (the user's architecture ask, made structural)
// ═════════════════════════════════════════════════════════════

describe('v0.32.3 · conversation history reaches the loop', () => {
  const emptyDesign: AgentDesignCtx = {
    name: 'Untitled', width: 1080, height: 1920, pageCount: 1,
    currentPageIndex: 0, elements: [], colorsInUse: [], otherPages: [],
  }

  it('the first model call carries the prior turns verbatim, before the request', async () => {
    const events: AgentEvent[] = []
    const history = [
      { role: 'user' as const, content: 'Design a bold Instagram post for a coffee launch' },
      { role: 'assistant' as const, content: 'Coffee-launch Instagram post created: bold headline, offer line and CTA card.' },
    ]
    const { chat, calls } = scriptedChat([
      turn('plan_layout', { background: '#090B1A', sections: [{ name: 'hero', y: 60, height: 200, contains: 'Hero' }] }),
      done('Adjusted per the earlier conversation.'),
    ])
    await runAgentLoop({
      chat, design: emptyDesign, mode: 'edit',
      request: 'make another one like the last one but for tea',
      history,
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })
    const first = calls[0]
    // [system, history…, request] — the conversation arrives verbatim
    expect(first?.[1]?.role).toBe('user')
    expect(first?.[1]?.content).toBe('Design a bold Instagram post for a coffee launch')
    expect(first?.[2]?.role).toBe('assistant')
    expect(first?.[2]?.content).toContain('bold headline')
    // and the CURRENT request is still the last pre-loop message
    expect(first?.[3]?.content).toBe('make another one like the last one but for tea')
  })

  it('compaction keeps the whole head — history and request survive a long run', async () => {
    const events: AgentEvent[] = []
    const history = [
      { role: 'user' as const, content: 'first request in this conversation' },
      { role: 'assistant' as const, content: 'first answer in this conversation' },
    ]
    const replies = [
      turn('plan_layout', { background: '#090B1A', sections: [{ name: 'hero', y: 60, height: 200, contains: 'Hero' }] }),
      ...Array.from({ length: 70 }, (_, i) =>
        turn('add_text', { text: `line ${i}`, y: 40 + i * 20, fontSize: 24, color: '#FFFFFF' })),
      done('Long build complete'),
    ]
    const { chat, calls } = scriptedChat(replies)
    await runAgentLoop({
      chat, design: emptyDesign, mode: 'create',
      request: 'build the long thing', history,
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })
    expect(events.some((e) => e.type === 'compact')).toBe(true)
    const last = calls[calls.length - 1]
    // the head is never compacted away: history + request stay verbatim
    const contents = last?.map((m) => m.content)
    expect(contents).toContain('first request in this conversation')
    expect(contents).toContain('build the long thing')
  })
})

describe('v0.32.3 · geometry ground truth in the system prompt', () => {
  it('states the page bounds, the safe area numbers and how to read element boxes', () => {
    const prompt = loopSystemPrompt({ design, ctx: { validIds: new Set(['el-1']), width: 1080, height: 1080, fonts: new Set(['Inter']) }, mode: 'create' })
    expect(prompt).toContain('CANVAS GEOMETRY')
    expect(prompt).toContain('1080x1080px')
    expect(prompt).toContain('origin (0,0) at the TOP-LEFT')
    expect(prompt).toContain('Safe area (6% margins): x 65..1015, y 65..1015')
    expect(prompt).toContain('@(x,y) WxH')
    expect(prompt).toContain('set_background, never with full-bleed cover rects')
  })
})

describe('v0.32.3 · plan-first gate (create runs)', () => {
  const emptyDesign: AgentDesignCtx = {
    name: 'Untitled', width: 1080, height: 1920, pageCount: 1,
    currentPageIndex: 0, elements: [], colorsInUse: [], otherPages: [],
  }

  it('a create run that writes before planning is redirected ONCE, then proceeds', async () => {
    const events: AgentEvent[] = []
    // model: tries to build immediately → PLAN FIRST bounce → plans → builds → done
    const { chat, calls } = scriptedChat([
      turn('add_text', { text: 'Too eager', fontSize: 64, y: 100 }),
      turn('plan_layout', { background: '#090B1A', sections: [{ name: 'hero', y: 60, height: 200, contains: 'Hero' }, { name: 'body', y: 300, height: 300, contains: 'Body' }] }),
      turn('set_background', { kind: 'solid', from: '#090B1A' }),
      turn('add_text', { text: 'Planned headline', fontSize: 96, y: 80, color: '#FFFFFF' }),
      done('Planned first, then built.'),
    ])
    const result = await runAgentLoop({
      chat, design: emptyDesign, mode: 'create',
      request: 'Design a bold Instagram post for a coffee launch',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })
    // the premature write was redirected with the plan-first guidance
    const bounced = calls.some((c) => c.some((m) => m.role === 'user' && m.content.startsWith('PLAN FIRST —')))
    expect(bounced).toBe(true)
    // the too-eager text was NOT applied — only the post-plan work counts
    const actionJson = JSON.stringify(events.filter((e) => e.type === 'action'))
    expect(actionJson).not.toContain('Too eager')
    expect(actionJson).toContain('Planned headline')
    // and the run completes normally (one bounce, never a block)
    expect(result.summary).not.toContain('INCOMPLETE')
  })

  it('a run that plans first never sees the bounce', async () => {
    const events: AgentEvent[] = []
    const { chat, calls } = scriptedChat([
      turn('plan_layout', { background: '#090B1A', sections: [{ name: 'hero', y: 60, height: 200, contains: 'Hero' }] }),
      turn('add_text', { text: 'Planned from the start', fontSize: 72, y: 80 }),
      done('Done.'),
    ])
    await runAgentLoop({
      chat, design: emptyDesign, mode: 'create',
      request: 'Design a poster',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })
    expect(calls.some((c) => c.some((m) => m.role === 'user' && m.content.startsWith('PLAN FIRST —')))).toBe(false)
  })

  it('edit runs are exempt — surgical edits never require a plan', async () => {
    const events: AgentEvent[] = []
    const editDesign: AgentDesignCtx = {
      ...emptyDesign,
      elements: [{ id: 'txt-1', type: 'text', x: 100, y: 100, width: 400, height: 80, text: 'Headline', fontSize: 64, fill: '#111111' }],
    }
    const { chat, calls } = scriptedChat([
      turn('update_elements', { ids: ['txt-1'], patch: { fontSize: 96 } }),
      done('Bigger headline.'),
    ])
    const result = await runAgentLoop({
      chat, design: editDesign, mode: 'edit',
      request: 'Make the existing title bigger',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })
    expect(calls.some((c) => c.some((m) => m.role === 'user' && m.content.startsWith('PLAN FIRST —')))).toBe(false)
    expect(result.toolCalls).toBe(1)
    expect(result.summary).not.toContain('INCOMPLETE')
  })
})

// ═════════════════════════════════════════════════════════════
// v0.32.4 · deterministic design correctness: hard plan validation,
// duplicate detection, plan adherence, wrap-up audit, list_fonts,
// run ledger rendering
// ═════════════════════════════════════════════════════════════

describe('v0.32.4 · duplicate detection (the live coffee-run residue, now caught)', () => {
  const base = { width: 1080, height: 1920, background: '#090B1A' }

  it('near-twin texts (same text, overlapping boxes) are flagged with both ids', () => {
    const issues = auditDesign({
      ...base,
      elements: [
        { id: 'a', type: 'text', text: 'Experience the perfect balance', fill: '#FFFFFF', fontSize: 32, x: 90, y: 186, width: 700, height: 120 },
        { id: 'b', type: 'text', text: 'experience the\nperfect balance', fill: '#FFFFFF', fontSize: 32, x: 90, y: 164, width: 700, height: 120 },
      ],
    })
    const hit = issues.find((i) => i.startsWith('Duplicate text'))
    expect(hit).toBeTruthy()
    expect(hit).toContain('#a')
    expect(hit).toContain('#b')
  })

  it('the 3-card row (same size + fill, different x) is NOT flagged — intentional repetition', () => {
    const card = (x: number, id: string) => ({ id, type: 'rect', x, y: 300, width: 280, height: 360, fill: 'rgba(255,255,255,0.08)' })
    const label = (x: number, id: string, text: string) => ({ id, type: 'text', text, fill: '#FFFFFF', fontSize: 24, x, y: 430, width: 240, height: 60 })
    const issues = auditDesign({
      ...base,
      elements: [
        card(90, 'c1'), card(400, 'c2'), card(710, 'c3'),
        label(110, 't1', 'Freshly Roasted'), label(420, 't2', 'Single Origin'), label(730, 't3', 'Smooth Crema'),
      ],
    })
    expect(issues.filter((i) => i.startsWith('Duplicate'))).toEqual([])
  })

  it('distant identical texts (page furniture) are NOT flagged', () => {
    const issues = auditDesign({
      ...base,
      elements: [
        { id: 'a', type: 'text', text: 'Shop Now', fill: '#FFFFFF', fontSize: 28, x: 100, y: 800, width: 200, height: 60 },
        { id: 'b', type: 'text', text: 'Shop Now', fill: '#FFFFFF', fontSize: 28, x: 780, y: 800, width: 200, height: 60 },
      ],
    })
    expect(issues.filter((i) => i.startsWith('Duplicate text'))).toEqual([])
  })

  it('a layered twin shape (same size + fill + position) is flagged', () => {
    const twin = (id: string, y: number) => ({ id, type: 'rect', x: 100, y, width: 280, height: 200, fill: '#8B5CF6' })
    const issues = auditDesign({
      ...base,
      elements: [twin('r1', 300), twin('r2', 296)],
    })
    const hit = issues.find((i) => i.startsWith('Duplicate shape'))
    expect(hit).toBeTruthy()
    expect(hit).toContain('#r1')
    expect(hit).toContain('#r2')
  })

  it('text deep in the page margin is disclosed (advisory), shallow bleed is not', () => {
    const issues = auditDesign({
      ...base,
      elements: [
        { id: 'deep', type: 'text', text: 'Edge hugger', fill: '#FFFFFF', fontSize: 40, x: 20, y: 54, width: 400, height: 90 },
      ],
    })
    expect(issues.some((i) => i.includes('inside the page margin') && i.includes('top') && i.includes('left'))).toBe(true)
    const shallow = auditDesign({
      ...base,
      elements: [
        { id: 'sh', type: 'text', text: 'Fine', fill: '#FFFFFF', fontSize: 40, x: 95, y: 100, width: 400, height: 90 },
      ],
    })
    expect(shallow.filter((i) => i.includes('page margin'))).toEqual([])
  })
})

describe('v0.32.4 · plan adherence (the build must fill the plan)', () => {
  const base = { width: 1080, height: 1920, background: '#090B1A' }

  it('an empty planned section is reported; filled sections pass', () => {
    const els = [
      { id: 'h', type: 'text', text: 'COFFEE', fill: '#FFFFFF', fontSize: 96, x: 90, y: 100, width: 800, height: 200 },
      { id: 'f', type: 'text', text: 'Shop Now', fill: '#FFD166', fontSize: 28, x: 90, y: 800, width: 300, height: 60 },
    ]
    const withPlan = auditDesign({ ...base, elements: els }, null, [
      { name: 'headline', y: 100, h: 200 },
      { name: 'features', y: 350, h: 400 },
      { name: 'cta', y: 800, h: 200 },
    ])
    expect(withPlan.some((i) => i.includes('Planned section "features"') && i.includes('empty'))).toBe(true)
    expect(withPlan.some((i) => i.includes('"headline"'))).toBe(false)
    // no plan → no adherence check at all
    expect(auditDesign({ ...base, elements: els }).some((i) => i.startsWith('Planned section'))).toBe(false)
  })
})

describe('v0.32.4 · guard exits audit their residue (the wrap-up hole)', () => {
  const emptyDesign: AgentDesignCtx = {
    name: 'Untitled', width: 1080, height: 1920, pageCount: 1,
    currentPageIndex: 0, elements: [], colorsInUse: [], otherPages: [],
  }

  it('a cycle-guard wrap-up runs the audit and DISCLOSES fixable residue', async () => {
    const events: AgentEvent[] = []
    // model: plan → build a duplicate text → repeat the identical call
    // 3× → the cycle guard wraps the run up
    const { chat } = scriptedChat([
      turn('plan_layout', { background: '#090B1A', sections: [{ name: 'hero', y: 130, height: 200, contains: 'Hero' }] }),
      turn('add_text', { text: 'Twin', fontSize: 64, y: 150, color: '#FFFFFF', x: 100 }),
      turn('add_text', { text: 'Twin', fontSize: 64, y: 150, color: '#FFFFFF', x: 100 }),
      turn('add_text', { text: 'Twin', fontSize: 64, y: 150, color: '#FFFFFF', x: 100 }),
      turn('add_text', { text: 'Twin', fontSize: 64, y: 150, color: '#FFFFFF', x: 100 }),
    ])
    let auditedDesign: AgentDesignCtx | null = null
    const result = await runAgentLoop({
      chat, design: emptyDesign, mode: 'create',
      request: 'Design a poster',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
      refreshedContext: () => auditedDesign ?? emptyDesign,
      auditDesign: (bands) => {
        // the audit sees what the run actually built: the twin pair
        auditedDesign = {
          ...emptyDesign,
          elements: [
            { id: 't1', type: 'text', text: 'Twin', x: 100, y: 150, width: 300, height: 90, fontSize: 64, fill: '#FFFFFF' },
            { id: 't2', type: 'text', text: 'Twin', x: 100, y: 150, width: 300, height: 90, fontSize: 64, fill: '#FFFFFF' },
          ],
        }
        return auditDesign(auditedDesign, null, bands?.length ? bands : undefined)
      },
    })
    expect(result.summary).toContain('wrapped up')
    expect(result.summary).toContain('Quality audit at wrap-up')
    expect(result.summary).toContain('Duplicate text')
    expect(result.verification).toContain('disclosed, unfixed')
  })
})

describe('v0.32.4 · list_fonts (the phantom tool, now real)', () => {
  it('lists and filters the 369-family catalog with a cap', () => {
    const tool = AGENT_TOOL_MAP.get('list_fonts')
    expect(tool).toBeTruthy()
    const all = tool!.sanitize({ limit: 10 }, ctx)
    expect(all.ok).toBe(true)
    expect(String((all as { observation?: string }).observation)).toContain('Font families')
    expect(String((all as { observation?: string }).observation)).toContain('of 369')
    const query = tool!.sanitize({ query: 'mono', limit: 20 }, ctx)
    expect(query.ok).toBe(true)
    const obs = String((query as { observation?: string }).observation)
    expect(obs).toContain('matching "mono"')
    expect(obs.toLowerCase()).toContain('mono')
    const none = tool!.sanitize({ query: 'zzzznope' }, ctx)
    expect(none.ok).toBe(true)
    expect(String((none as { observation?: string }).observation)).toContain('No font family matches')
  })
})

describe('v0.32.4 · run ledger renders into the system prompt', () => {
  it('recent runs appear as grounded history; absent ledger stays silent', () => {
    const withLedger = loopSystemPrompt({
      design, ctx, mode: 'create',
      ledger: [
        'create "Design a bold Instagram post for a coffee launch" → 24 action(s): Coffee-launch Instagram post built (brief validated).',
        'edit "Remove the duplicates" → 2 action(s): Duplicate subline and card removed.',
      ],
    })
    expect(withLedger).toContain('YOUR RECENT RUNS IN THIS DESIGN')
    expect(withLedger).toContain('coffee launch')
    expect(withLedger).toContain('Duplicate subline')
    expect(withLedger).toContain('the state above is still the authority')
    const without = loopSystemPrompt({ design, ctx, mode: 'create' })
    expect(without).not.toContain('YOUR RECENT RUNS IN THIS DESIGN')
    // the font sample now carries the real catalog size + discovery pointer
    expect(without).toContain('369 total')
    expect(without).toContain('list_fonts')
  })
})

// ═════════════════════════════════════════════════════════════
// v0.32.5 · THE P0 REGRESSION — a valid creative request must not
// die at three repairable layout calculations with ZERO elements.
// The production failure: "Design a bold Instagram post for a
// coffee launch" → three plan_layout rejections (<40px gaps) →
// "Stopped after 3 consecutive invalid tool calls" → 0 elements →
// vision critique of the EMPTY canvas.
// ═════════════════════════════════════════════════════════════

describe('v0.32.5 · the P0 regression — recoverable geometry must not kill a creative run', () => {
  const emptyDesign: AgentDesignCtx = {
    name: 'Untitled', width: 1080, height: 1080, pageCount: 1,
    currentPageIndex: 0, elements: [], colorsInUse: [], otherPages: [],
  }
  // the model's bad arithmetic from the production run: sections
  // with <40px gaps (auto-repaired now) — sent THREE times in a row
  const badGeometryPlan = (y2: number) => ({
    background: '#090B1A',
    sections: [
      { name: 'headline', y: 60, height: 200, contains: 'COFFEE' },
      { name: 'subline', y: y2, height: 120, contains: 'the launch' },
      { name: 'cta', y: 900, height: 100, contains: 'Shop Now' },
    ],
  })

  it('three bad-geometry plans in a row are AUTO-REPAIRED — the run proceeds to real elements (the exact production failure)', async () => {
    const events: AgentEvent[] = []
    const { chat, calls } = scriptedChat([
      turn('plan_layout', badGeometryPlan(220)), // gap -40 → OLD: strike 1
      turn('plan_layout', badGeometryPlan(240)), // gap 0   → OLD: strike 2
      turn('plan_layout', badGeometryPlan(259)), // gap 39  → OLD: strike 3 → DEAD
      turn('set_background', { kind: 'solid', from: '#090B1A' }),
      turn('add_text', { text: 'COFFEE LAUNCH', fontSize: 64, color: '#FFFFFF', y: 65, x: 100 }),
      done('Coffee launch post built.'),
    ])
    const result = await runAgentLoop({
      chat, design: emptyDesign, mode: 'create',
      request: 'Design a bold Instagram post for a coffee launch',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })
    // OLD code: "Stopped after 3 consecutive invalid tool calls", 0 elements.
    // NEW: every bad plan was repaired server-side; the build happened.
    expect(result.summary).toContain('Coffee launch post built')
    expect(result.steps).toBe(5) // 3 plans + set_background + add_text (done is not a step)
    expect(result.toolCalls).toBe(2) // set_background + add_text applied
    const planEvents = events.filter((e) => e.type === 'plan')
    expect(planEvents.length).toBe(3)
    // the model was never told to redo arithmetic — the server did it
    expect(calls.some((c) => c.some((m) => m.content.includes('AUTO-REPAIRED')))).toBe(true)
  })

  it('three FLOOR-INFEASIBLE plans stop honestly with the exact math — bounded, never an infinite retry', async () => {
    const events: AgentEvent[] = []
    // v0.32.8: oversized plans are SCALED, not rejected — a plan only
    // stays infeasible when it cannot fit even at the 56px floor (12
    // sections = 672px of floor + 440px of gaps > the 950px safe area).
    // Three of those still stop the run honestly.
    const infeasible = () => ({
      sections: Array.from({ length: 12 }, (_, i) => ({ name: `s${i + 1}`, y: 65 + i * 100, height: 140, contains: 'x' })),
    })
    const { chat } = scriptedChat([
      turn('plan_layout', infeasible()),
      turn('plan_layout', infeasible()),
      turn('plan_layout', infeasible()),
      // if the guard failed to fire, this would apply and the run
      // would continue — the assertion below pins that it cannot
      turn('set_background', { kind: 'solid', from: '#090B1A' }),
      done('Should not get here'),
    ])
    const result = await runAgentLoop({
      chat, design: emptyDesign, mode: 'create',
      request: 'Design a poster',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })
    expect(result.summary).toContain('rejected plan_layout calls')
    expect(result.summary).toContain('INCOMPLETE') // guardExit honesty: zero changes
    expect(result.toolCalls).toBe(0) // nothing applied after the honest stop
    const last = events[events.length - 1]
    expect(last.type).toBe('done')
  })

  it('a repaired plan flows straight into real editable element creation', async () => {
    const events: AgentEvent[] = []
    let planBandsSeen: { name: string; y: number; h: number }[] | undefined
    const { chat } = scriptedChat([
      turn('plan_layout', badGeometryPlan(220)), // −40px gap → repaired
      turn('set_background', { kind: 'solid', from: '#090B1A' }),
      turn('add_text', { text: 'COFFEE', fontSize: 64, color: '#FFFFFF', y: 70, x: 100 }),
      done('Built.'),
    ])
    const result = await runAgentLoop({
      chat, design: emptyDesign, mode: 'create',
      request: 'Design a coffee poster',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
      auditDesign: (bands) => {
        planBandsSeen = bands
        return []
      },
    })
    expect(result.summary).toContain('Built')
    // the plan event carried the REPAIRED geometry (bands start at the
    // safe-area top y=65, not the model's requested y=60)
    const plan = events.find((e) => e.type === 'plan') as { steps?: string[] } | undefined
    expect(plan?.steps?.join('\n')).toContain('y=65')
    // the audit received the repaired bands (plan-adherence wiring)
    expect(planBandsSeen?.length).toBe(3)
  })
})

describe('v0.32.5 · deterministic plan solver (plan-repair.ts)', () => {
  it('five sections fit a 1080×1080 canvas with calculated spacing', async () => {
    const { repairPlanBands } = await import('./plan-repair')
    const r = repairPlanBands(
      [
        { name: 'headline', y: 60, h: 150 },
        { name: 'subline', y: 300, h: 80 },
        { name: 'cards', y: 500, h: 300 },
        { name: 'cta', y: 900, h: 100 },
        { name: 'footer', y: 950, h: 60 },
      ],
      1080,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.bands).toHaveLength(5)
    expect(r.bands[0].y).toBe(65) // safe-area top
    for (let i = 1; i < r.bands.length; i++) {
      expect(r.bands[i].y - (r.bands[i - 1].y + r.bands[i - 1].h)).toBeGreaterThanOrEqual(40)
    }
    const last = r.bands[4]
    expect(last.y + last.h).toBeLessThanOrEqual(1015)
    expect(r.repairs.length).toBeGreaterThan(0)
  })

  it('1080×1350 and 1080×1920 canvases lay out correctly', async () => {
    const { repairPlanBands } = await import('./plan-repair')
    // 1350: safe 81..1269 (1188 usable)
    const a = repairPlanBands([
      { name: 'h', y: 100, h: 200 },
      { name: 'c', y: 320, h: 400 },
      { name: 'f', y: 900, h: 100 },
    ], 1350)
    expect(a.ok).toBe(true)
    if (a.ok) {
      expect(a.bands[0].y).toBe(81)
      expect(a.bands[2].y + a.bands[2].h).toBeLessThanOrEqual(1269)
      expect(a.bands[1].y - (a.bands[0].y + a.bands[0].h)).toBeGreaterThanOrEqual(40)
    }
    // 1920: safe 115..1805 (1690 usable)
    const b = repairPlanBands([
      { name: 'h', y: 100, h: 200 },
      { name: 's', y: 320, h: 120 },
      { name: 'cards', y: 500, h: 400 },
      { name: 'cta', y: 950, h: 150 },
      { name: 'footer', y: 1150, h: 100 },
    ], 1920)
    expect(b.ok).toBe(true)
    if (b.ok) {
      expect(b.bands[0].y).toBe(115)
      expect(b.bands[4].y + b.bands[4].h).toBeLessThanOrEqual(1805)
      for (let i = 1; i < b.bands.length; i++) {
        expect(b.bands[i].y - (b.bands[i - 1].y + b.bands[i - 1].h)).toBeGreaterThanOrEqual(40)
      }
    }
    // v0.32.8: a single oversized section is a full-bleed intent, not an
    // infeasible composition — scaled to the usable height (disclosed)
    const inf: { name: string; y: number; h: number }[] = [{ name: 'x', y: 100, h: 2000 }]
    const r1350 = repairPlanBands(inf, 1350)
    expect(r1350.ok).toBe(true)
    if (r1350.ok) {
      expect(r1350.bands[0].y).toBe(81)
      expect(r1350.bands[0].h).toBe(1188)
      expect(r1350.repairs.join(' ')).toContain('scaled')
    }
    const r1920 = repairPlanBands(inf, 1920)
    expect(r1920.ok).toBe(true)
    if (r1920.ok) expect(r1920.bands[0].h).toBe(1690)
  })

  it('a VALID plan is accepted unchanged — zero repairs', async () => {
    const { repairPlanBands } = await import('./plan-repair')
    const r = repairPlanBands([
      { name: 'a', y: 65, h: 200 },
      { name: 'b', y: 305, h: 100 },
    ], 1080)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.repairs).toEqual([])
    expect(r.bands).toEqual([
      { name: 'a', y: 65, h: 200 },
      { name: 'b', y: 305, h: 100 },
    ])
  })
})

describe('v0.32.5 · honest outcome classification (a failure is never a green check)', () => {
  it('failure markers classify as failure; clean verification as success', async () => {
    const { turnOutcome, isFailureOutcome } = await import('./outcome')
    expect(isFailureOutcome('NOT completed — the run ended without applying any design change')).toBe(true)
    expect(isFailureOutcome('Stopped after 3 infeasible plans — the exact math is in the errors above')).toBe(true)
    expect(isFailureOutcome('Quality audit at wrap-up reports 2 issue(s) — disclosed, unfixed.')).toBe(true)
    expect(isFailureOutcome('Brief contract validated against the live canvas — all mandatory items present.')).toBe(false)
    expect(turnOutcome({ mode: 'create', verification: 'Brief contract validated against the live canvas.', appliedActions: 12 })).toBe('success')
    expect(turnOutcome({ mode: 'create', verification: undefined, content: 'Stopped after 3 consecutive invalid tool calls', appliedActions: 0 })).toBe('failure')
    // the exact P0 production turn: create, 0 actions, no verification
    expect(turnOutcome({ mode: 'create', verification: undefined, content: 'Stopped after 3 infeasible plans — ask the user for a smaller composition.', appliedActions: 0 })).toBe('failure')
    // discuss/review turns apply nothing BY DESIGN — not failures
    expect(turnOutcome({ mode: 'discuss', verification: undefined, content: 'This poster uses a strong vertical hierarchy…', appliedActions: 0 })).toBe('unknown')
  })
})

// ═════════════════════════════════════════════════════════════
// v0.32.6 · the CANVAS MAP — "when the user asks it to do
// something it first maps the background and what's present and
// all that geometrically so that overlap won't happen and it will
// know where to put everything by using geometry and math and
// boundaries." Existing elements become occupied bands; plans are
// fitted into the FREE space between them, deterministically.
// ═════════════════════════════════════════════════════════════

describe('v0.32.6 · the canvas map — plans fit the FREE space, never on top', () => {
  const mapCtx = (occupied: { y: number; h: number; label?: string }[]): ToolContext => ({
    ...ctx,
    occupied,
  })
  // a 1080 canvas (safe y 65..1015) with existing content:
  // headline y 65–365, card row y 405–805 → free: 365–405 (40px,
  // unusable for two bands), 805–1015 (210px usable)
  const occupied = [
    { y: 65, h: 300, label: 'COFFEE LAUNCH' },
    { y: 405, h: 400, label: 'Artisan Roast' },
  ]

  it('the solver fits sections into the LARGEST fitting free interval', async () => {
    const { repairPlanBands } = await import('./plan-repair')
    const r = repairPlanBands(
      [
        { name: 'offer', y: 400, h: 100 },
        { name: 'fineprint', y: 950, h: 50 },
      ],
      1080,
      { occupied },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // both sections live inside 805..1015 — never on the occupied bands
    for (const b of r.bands) {
      expect(b.y).toBeGreaterThanOrEqual(805)
      expect(b.y + b.h).toBeLessThanOrEqual(1015)
    }
    expect(r.bands[0].y).toBe(805)
    expect(r.bands[1].y - (r.bands[0].y + r.bands[0].h)).toBeGreaterThanOrEqual(40)
    expect(r.repairs.join(' ')).toContain('free space')
  })

  it('sections that cannot fit the free space are INFEASIBLE with the exact map', async () => {
    const { repairPlanBands } = await import('./plan-repair')
    const r = repairPlanBands(
      [
        { name: 'offer', y: 400, h: 200 },
        { name: 'cards', y: 700, h: 300 },
        { name: 'footer', y: 950, h: 60 },
      ],
      1080,
      { occupied },
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    // the error carries the occupancy map and the largest free interval
    expect(r.infeasible).toContain('existing elements occupy y 65–365 (COFFEE LAUNCH)')
    expect(r.infeasible).toContain('y 405–805 (Artisan Roast)')
    expect(r.infeasible).toContain('largest free interval is 210px')
    expect(r.infeasible).toContain('Move or clear existing elements')
  })

  it('canvasMap merges close elements into disjoint occupied bands', async () => {
    const { canvasMap } = await import('./context')
    const d = {
      name: 'Map test', width: 1080, height: 1080, pageCount: 1, currentPageIndex: 0,
      // two elements 35px apart merge (a 40px band cannot fit between)
      elements: [
        { id: 'a', type: 'text', y: 65, height: 200, text: 'Headline' },
        { id: 'b', type: 'rect', y: 300, height: 100 },
        { id: 'c', type: 'text', y: 900, fontSize: 60, text: 'Footer line' },
      ],
      colorsInUse: [], otherPages: [],
    } as never as AgentDesignCtx
    const map = canvasMap(d)
    expect(map).toEqual([
      { y: 65, h: 335, label: 'Headline' },
      { y: 900, h: 60, label: 'Footer line' },
    ])
  })

  it('plan_layout on an occupied canvas discloses the CANVAS MAP and fits the free space', () => {
    const tool = AGENT_TOOL_MAP.get('plan_layout')
    expect(tool).toBeTruthy()
    const res = tool!.sanitize(
      { sections: [{ name: 'offer', y: 380, height: 100, contains: 'limited time' }, { name: 'legal', y: 980, height: 50, contains: 'terms' }] },
      mapCtx(occupied),
    )
    expect(res.ok).toBe(true)
    const obs = String((res as { observation?: string }).observation)
    expect(obs).toContain('CANVAS MAP')
    expect(obs).toContain('y 65–365 (COFFEE LAUNCH)')
    expect(obs).toContain('fitted into the FREE space')
    const bands = (res as { actions?: { bands?: { name: string; y: number; h: number }[] }[] }).actions?.[0]?.bands
    for (const b of bands ?? []) {
      expect(b.y).toBeGreaterThanOrEqual(805)
      expect(b.y + b.h).toBeLessThanOrEqual(1015)
    }
  })

  it('the loop maps the design it is GIVEN: plans on a design with elements avoid them', async () => {
    const events: AgentEvent[] = []
    const occupiedDesign: AgentDesignCtx = {
      name: 'Half-built poster', width: 1080, height: 1080, pageCount: 1, currentPageIndex: 0,
      elements: [
        { id: 'txt-1', type: 'text', y: 65, height: 300, text: 'EXISTING HEADLINE' },
      ],
      colorsInUse: [], otherPages: [],
    }
    const { chat } = scriptedChat([
      turn('plan_layout', { sections: [{ name: 'offer', y: 100, height: 100, contains: 'sale' }] }),
      turn('set_background', { kind: 'solid', from: '#090B1A' }),
      done('Planned around the existing headline.'),
    ])
    const result = await runAgentLoop({
      chat, design: occupiedDesign, mode: 'improve',
      request: 'Add an offer banner under the headline',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })
    expect(result.summary).toContain('Planned around')
    // the CANVAS MAP rides the OBSERVATION (disclosed to the model
    // AND the user), the fitted band rides the plan event
    const obs = events.find((e) => e.type === 'observation') as { message?: string } | undefined
    expect(obs?.message).toContain('CANVAS MAP')
    expect(obs?.message).toContain('EXISTING HEADLINE')
    const plan = events.find((e) => e.type === 'plan') as { steps?: string[] } | undefined
    // the single band was fitted BELOW the occupied headline: free
    // space starts at y=365 (headline occupies 65–365)
    expect(plan?.steps?.join('\n')).toContain('y=365')
  })
})

// ═════════════════════════════════════════════════════════════
// v0.32.8 · the NEON 2027 incident — one brief, three runs, three
// defects, all deterministic:
//   run 1: a reasonable 7-section poster plan was INFEASIBLE three
//          times → create died with ZERO elements;
//   run 2: the in-run vision critique never ran — the capture event
//          was never emitted, every run stalled the capture timeout
//          and disclosed "UNAVAILABLE"; the audit disclosed a
//          fixable residue after ONE round;
//   run 3: the "fix issues" follow-up died at 3 strikes — the model
//          passed the `text#id` notation it reads everywhere into
//          id lists.
// ═════════════════════════════════════════════════════════════

describe('v0.32.8 · oversized plans are SCALED to fit, never a dead end', () => {
  it('the incident shape: 7×140px sections on a 1080 page scale in with disclosure', async () => {
    const { repairPlanBands } = await import('./plan-repair')
    const r = repairPlanBands(
      Array.from({ length: 7 }, (_, i) => ({ name: `sec ${i + 1}`, y: 65 + i * 140, h: 140 })),
      1080,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.bands).toHaveLength(7)
    for (const b of r.bands) {
      expect(b.h).toBeGreaterThanOrEqual(56)
      expect(b.h).toBeLessThanOrEqual(140)
    }
    expect(r.bands[0].y).toBe(65)
    expect(r.bands[6].y + r.bands[6].h).toBeLessThanOrEqual(1015)
    for (let i = 1; i < r.bands.length; i++) {
      expect(r.bands[i].y - (r.bands[i - 1].y + r.bands[i - 1].h)).toBeGreaterThanOrEqual(40)
    }
    expect(r.repairs.join(' ')).toContain('scaled')
  })

  it('a composition that cannot fit even at the floor stays honestly infeasible with the max-sections math', async () => {
    const { repairPlanBands } = await import('./plan-repair')
    const r = repairPlanBands(
      Array.from({ length: 12 }, (_, i) => ({ name: `s${i + 1}`, y: 65 + i * 100, h: 140 })),
      1080,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.infeasible).toContain('56px minimum band')
    expect(r.infeasible).toContain('at most 10 sections')
  })

  it('an occupied canvas with too little free space shrinks sections into it before declaring infeasible', async () => {
    const { repairPlanBands } = await import('./plan-repair')
    // free space: a 40px sliver + one 210px interval
    const r = repairPlanBands(
      [
        { name: 'offer', y: 400, h: 120 },
        { name: 'fineprint', y: 700, h: 120 },
      ],
      1080,
      {
        occupied: [
          { y: 65, h: 300, label: 'COFFEE LAUNCH' },
          { y: 405, h: 400, label: 'Artisan Roast' },
        ],
      },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const b of r.bands) {
      expect(b.y).toBeGreaterThanOrEqual(805)
      expect(b.y + b.h).toBeLessThanOrEqual(1015)
    }
    expect(r.bands[1].y - (r.bands[0].y + r.bands[0].h)).toBeGreaterThanOrEqual(40)
    expect(r.repairs.join(' ')).toContain('scaled to fit the free space')
  })

  it('the loop accepts the scaled plan and BUILDS — the run no longer dies at planRejections', async () => {
    const events: AgentEvent[] = []
    const { chat } = scriptedChat([
      turn('plan_layout', {
        background: '#0A0A1A',
        sections: Array.from({ length: 7 }, (_, i) => ({ name: `section ${i + 1}`, y: 65 + i * 140, height: 140, contains: 'content' })),
      }),
      turn('set_background', { kind: 'solid', from: '#0A0A1A' }),
      turn('add_text', { text: 'NEON 2027', fontSize: 96, color: '#02C0CC' }),
      done('Built the NEON 2027 poster'),
    ])
    const result = await runAgentLoop({
      chat,
      design: compactDesign,
      mode: 'create',
      request: 'Create a professional promotional poster for a futuristic technology festival called NEON 2027',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })
    expect(result.toolCalls).toBe(2)
    expect(result.summary).toContain('Built')
    const plan = events.find((e) => e.type === 'plan') as { steps?: string[] } | undefined
    expect(plan?.steps?.length).toBeGreaterThanOrEqual(8) // background + 7 scaled bands
    expect(events[events.length - 1]?.type).toBe('done')
  })
})

describe('v0.32.8 · the capture event is EMITTED — the panel is actually asked', () => {
  it('a run with applied changes emits capture BEFORE the capture call — the never-ran critique regression', async () => {
    const events: AgentEvent[] = []
    const captureCallsAt: number[] = []
    const { chat } = scriptedChat([
      turn('set_background', { kind: 'solid', from: '#090B1A' }),
      done('Poster complete'),
    ])
    const result = await runAgentLoop({
      chat,
      design,
      mode: 'create',
      request: 'Design a bold Instagram post for a coffee launch',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
      captureCanvas: async () => {
        captureCallsAt.push(events.length)
        return 'data:image/png;base64,AAA'
      },
      critique: async () => ({ findings: [], note: 'clean pass' }),
    })
    // the panel was ASKED (the capture event) before the bridge waited
    const captureIdx = events.findIndex((e) => e.type === 'capture')
    expect(captureIdx).toBeGreaterThanOrEqual(0)
    expect((events[captureIdx] as { purpose?: string }).purpose).toContain('visual critique')
    expect(captureCallsAt).toHaveLength(1)
    expect(captureCallsAt[0]).toBeGreaterThan(captureIdx) // emitted first, waited second
    expect(String(result.verification)).toContain('PASSED')
  })

  it('the timeout path still fails closed (disclosed UNAVAILABLE) — but only after the ask', async () => {
    const events: AgentEvent[] = []
    const { chat } = scriptedChat([
      turn('set_background', { kind: 'solid', from: '#090B1A' }),
      done('Poster complete'),
    ])
    const result = await runAgentLoop({
      chat,
      design,
      mode: 'create',
      request: 'Design a bold Instagram post for a coffee launch',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
      captureCanvas: async () => null,
      critique: async () => ({ findings: [], note: 'never used' }),
    })
    expect(events.some((e) => e.type === 'capture')).toBe(true)
    expect(String(result.verification)).toContain('UNAVAILABLE')
  })
})

describe('v0.32.8 · a SECOND audit fix round — the residue after round one gets one more pass', () => {
  it('round 1 clears 3 issues, round 2 clears the straggler, done is accepted clean', async () => {
    const events: AgentEvent[] = []
    let auditCalls = 0
    const { chat } = scriptedChat([
      turn('set_background', { kind: 'solid', from: '#090B1A' }),
      turn('plan_layout', { background: '#090B1A', sections: [{ name: 'hero', y: 60, height: 200, contains: 'Hero' }, { name: 'body', y: 300, height: 300, contains: 'Body' }] }),
      turn('add_text', { text: 'Dark', fontSize: 40, color: '#111122' }),
      done('Done attempt 1'),
      turn('add_text', { text: 'Fix 1', fontSize: 40, color: '#FFFFFF' }),
      done('Done attempt 2'),
      turn('add_text', { text: 'Fix 2', fontSize: 40, color: '#FFFFFF' }),
      done('Done attempt 3 — residue gone'),
    ])
    const result = await runAgentLoop({
      chat,
      design: compactDesign,
      mode: 'create',
      request: 'Design a bold Instagram post for a coffee launch',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
      auditDesign: async () => {
        auditCalls += 1
        return auditCalls <= 2
          ? ['Low contrast: text "Dark" #111122 on #090B1A is 1.0:1 (needs 3:1) — change the text fill.']
          : []
      },
    })
    expect(auditCalls).toBe(3)
    expect(result.toolCalls).toBe(4)
    expect(events.filter((e) => e.type === 'observation' && e.message.includes('QUALITY AUDIT')).length).toBe(2)
    const finalEvent = events[events.length - 1] as { verification?: string }
    expect(String(finalEvent.verification)).toContain('Quality audit passed')
  })

  it('after the second round the residue is disclosed — bounded, never a loop', async () => {
    const { chat } = scriptedChat([
      turn('set_background', { kind: 'solid', from: '#090B1A' }),
      turn('plan_layout', { background: '#090B1A', sections: [{ name: 'hero', y: 60, height: 200, contains: 'Hero' }, { name: 'body', y: 300, height: 300, contains: 'Body' }] }),
      turn('add_text', { text: 'Dark', fontSize: 40, color: '#111122' }),
      done('Done 1'),
      done('Done 2'),
      done('Done 3'),
    ])
    const result = await runAgentLoop({
      chat,
      design: compactDesign,
      mode: 'create',
      request: 'Design a bold Instagram post for a coffee launch',
      emit: () => {},
      awaitApply: async () => ({ ok: true }),
      auditDesign: async () => ['Low contrast: text "Dark" #111122 on #090B1A is 1.0:1 (needs 3:1)'],
    })
    expect(result.toolCalls).toBe(2)
    expect(String(result.verification)).toContain('after the fix rounds — disclosed')
  })
})

describe('v0.32.8 · the `type#id` alias — the "fix issues" strike-out', () => {
  it('id lists accept the notation the context, findings and overlaps print everywhere', () => {
    const update = AGENT_TOOL_MAP.get('update_elements')
    expect(update).toBeTruthy()
    const r = update!.sanitize({ ids: ['text#txt-1', 'rect#el-1', 'txt-2'], patch: { fill: '#FFFFFF' } }, ctx)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect((r.actions[0] as { ids?: string[] }).ids).toEqual(['txt-1', 'el-1', 'txt-2'])
    }
    const move = AGENT_TOOL_MAP.get('move_elements')
    expect(move).toBeTruthy()
    const m = move!.sanitize({ ids: ['text#nope-xyz'], dx: 10 }, ctx)
    expect(m.ok).toBe(false) // an unknown bare id is still an honest error
  })

  it('the edit-mode flow: a "fix issues" run patches by text#id without striking', async () => {
    const events: AgentEvent[] = []
    const { chat } = scriptedChat([
      turn('update_elements', { ids: ['text#txt-1'], patch: { fill: '#FFFFFF' } }),
      done('Fixed the contrast issue'),
    ])
    const result = await runAgentLoop({
      chat,
      design: compactDesign,
      mode: 'edit',
      request: 'fix issues',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })
    expect(result.toolCalls).toBe(1)
    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(events[events.length - 1]?.type).toBe('done')
  })
})

describe('v0.32.8 · the second-strike recovery note (the "fix issues" strike-out)', () => {
  it('the second consecutive rejection carries the get_page_state note BEFORE the run can die', async () => {
    const events: AgentEvent[] = []
    const bad = turn('update_elements', { ids: ['txt-1'], patch: { font: 'Inter' } })
    const { chat, calls } = scriptedChat([
      turn('set_background', { kind: 'solid', from: '#090B1A' }),
      bad,
      bad,
      turn('update_elements', { ids: ['txt-1'], patch: { fill: '#FFFFFF' } }),
      done('Fixed'),
    ])
    const result = await runAgentLoop({
      chat,
      design: compactDesign,
      mode: 'edit',
      request: 'fix issues',
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })
    // the two rejects never struck the run dead; the recovery note rode
    // the SECOND error observation (one strike from the end)
    expect(calls.some((cs) => cs.some((m) => m.content.includes('second failed call in a row')))).toBe(true)
    expect(result.toolCalls).toBe(2)
    expect(events[events.length - 1]?.type).toBe('done')
  })
})

// ═════════════════════════════════════════════════════════════
// v0.33 · the design-quality architecture — the NEON 2027 review
// ("a coordinate-placement script that passes geometry tests")
// traced to deterministic root causes:
//   · asset tools acked ok while creating NOTHING (concepts
//     resolved client-side, no-op strings acked as success);
//   · icons that DID resolve landed at default centres — the
//     model's geometry was ignored;
//   · the native gradients / shadows / neon-glow text effects were
//     never exposed to the agent, so "use gradients, shadows"
//     briefs were physically impossible to satisfy;
//   · the feature contract knew only 3 composite kinds —
//     illustration/stickers/CTA/gradients extracted NOTHING, so
//     "brief validated" was true-and-empty;
//   · the audit never looked at non-text elements (present ≠
//     visible).
// ═════════════════════════════════════════════════════════════

describe('v0.33 · assets resolve server-side — fail-closed, placed exactly', () => {
  const call33 = (name: string, args: Record<string, unknown>) =>
    AGENT_TOOL_MAP.get(name)!.sanitize(args, ctx)

  it('add_sticker resolves the 160+ vector library and passes the model geometry', () => {
    const r = call33('add_sticker', { query: 'sparkle', x: 100, y: 200, size: 160 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const action = r.actions[0] as {
      type: string
      sticker?: { id: string; name: string; svg: string }
      x?: number
      y?: number
      size?: number
    }
    expect(action.type).toBe('addPackSticker')
    expect(action.sticker?.svg?.startsWith('<svg')).toBe(true)
    expect(action.x).toBe(100)
    expect(action.y).toBe(200)
    expect(action.size).toBe(160)
  })

  it('add_sticker still accepts emoji glyphs (back-compat: the emoji arg key)', () => {
    const r = call33('add_sticker', { emoji: '🚀', x: 10, y: 20 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect((r.actions[0] as { type: string }).type).toBe('addSticker')
    expect((r.actions[0] as { emoji?: string }).emoji).toBe('🚀')
  })

  it('the NEON incident shape: an unknown sticker CONCEPT is rejected with resolvable examples', () => {
    const r = call33('add_sticker', { query: 'laser dragon hologram' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('No sticker matches')
    expect(r.error).toContain('star')
  })

  it('add_icon resolves server-side and carries x/y/size — no more default-centred icons', () => {
    const r = call33('add_icon', { query: 'rocket', x: 40, y: 60, size: 220, stroke: '#02C0CC' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const action = r.actions[0] as {
      type: string
      d?: string
      name?: string
      x?: number
      y?: number
      size?: number
      stroke?: string
    }
    expect(action.type).toBe('addIcon')
    expect(action.d?.length ?? 0).toBeGreaterThan(20)
    expect(action.name).toBeTruthy()
    expect(action.x).toBe(40)
    expect(action.y).toBe(60)
    expect(action.size).toBe(220)
    expect(action.stroke).toBe('#02c0cc')
  })

  it('the NEON incident: an icon concept the pack lacks is rejected with real alternatives', () => {
    const r = call33('add_icon', { query: 'robot' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('No icon matches')
    expect(r.error).toContain('add_illustration')
  })

  it('add_illustration resolves and carries geometry', () => {
    const r = call33('add_illustration', { query: 'rocket launch', x: 300, y: 400, size: 500 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const action = r.actions[0] as {
      type: string
      svg?: string
      name?: string
      x?: number
      y?: number
      size?: number
    }
    expect(action.type).toBe('addIllustration')
    expect(action.svg?.startsWith('<svg')).toBe(true)
    expect(action.x).toBe(300)
    expect(action.size).toBe(500)
  })

  it('an unknown illustration is rejected with the pack themes', () => {
    const r = call33('add_illustration', { query: 'cyberpunk skyline neon city' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('No illustration matches')
    expect(r.error).toContain('tech')
  })

  it('the resolvers never throw on adversarial args (registry discipline holds)', () => {
    const cases: [string, Record<string, unknown>][] = [
      ['add_sticker', { query: { nested: true } }],
      ['add_sticker', { query: '' }],
      ['add_sticker', { query: 42 }],
      ['add_icon', { query: null }],
      ['add_illustration', { query: '   ' }],
    ]
    for (const [name, args] of cases) {
      let r: SanitizeResult | null = null
      expect(() => {
        r = call33(name, args)
      }).not.toThrow()
      expect(r).toBeTruthy()
    }
  })
})

describe('v0.33 · the native effects surface — gradients, text effects, shadows', () => {
  const call33 = (name: string, args: Record<string, unknown>) =>
    AGENT_TOOL_MAP.get(name)!.sanitize(args, ctx)

  it('add_shape takes a gradient; a half-given gradient is an error', () => {
    const ok = call33('add_shape', {
      shape: 'rect', x: 0, y: 0, width: 400, height: 200,
      gradientFrom: '#02C0CC', gradientTo: '#7630D7', gradientAngle: 45,
    })
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      const action = ok.actions[0] as { gradient?: { type: string; from: string; to: string; angle: number } }
      expect(action.gradient).toEqual({ type: 'linear', from: '#02c0cc', to: '#7630d7', angle: 45 })
    }
    const bad = call33('add_shape', { shape: 'rect', x: 0, y: 0, width: 10, height: 10, gradientFrom: '#02C0CC' })
    expect(bad.ok).toBe(false)
  })

  it('add_text takes a native text effect (neon/glow/…)', () => {
    const r = call33('add_text', { text: 'NEON 2027', fontSize: 96, color: '#02C0CC', effect: 'neon' })
    expect(r.ok).toBe(true)
    if (r.ok) expect((r.actions[0] as { effect?: string }).effect).toBe('neon')
    const bad = call33('add_text', { text: 'X', effect: 'sparkly' })
    expect(bad.ok).toBe(false)
  })

  it('update_elements patches gradient / textEffect / shadow — validated, never silent', () => {
    const g = call33('update_elements', { ids: ['txt-1'], patch: { gradientFrom: '#02C0CC', gradientTo: '#7630D7', gradientAngle: 90 } })
    expect(g.ok).toBe(true)
    if (g.ok) {
      const patch = (g.actions[0] as { patch?: Record<string, unknown> }).patch
      expect(patch?.gradient).toEqual({ type: 'linear', from: '#02c0cc', to: '#7630d7', angle: 90 })
    }
    const eff = call33('update_elements', { ids: ['txt-1'], patch: { textEffect: 'glow' } })
    expect(eff.ok).toBe(true)
    if (eff.ok) {
      expect((eff.actions[0] as { patch?: Record<string, unknown> }).patch?.textEffect).toBe('glow')
    }
    const sh = call33('update_elements', { ids: ['txt-1'], patch: { shadowColor: '#000000', shadowBlur: 24, shadowOffsetY: 8 } })
    expect(sh.ok).toBe(true)
    if (sh.ok) {
      const shadow = (sh.actions[0] as { patch?: { shadow?: Record<string, unknown> } }).patch?.shadow
      expect(shadow?.enabled).toBe(true)
      expect(shadow?.blur).toBe(24)
      expect(shadow?.offsetY).toBe(8)
    }
    expect(call33('update_elements', { ids: ['txt-1'], patch: { gradientFrom: '#02C0CC' } }).ok).toBe(false)
    expect(call33('update_elements', { ids: ['txt-1'], patch: { textEffect: 'sparkly' } }).ok).toBe(false)
  })
})

describe('v0.33 · the visual-feature contract — brief asks become checkable requirements', () => {
  it('the NEON 2027 brief extracts illustration, stickers, CTA, gradients, shadows and text effects', async () => {
    const { extractBrief } = await import('./brief')
    const brief = extractBrief(
      'Create a professional promotional poster for a futuristic technology festival called NEON 2027. Use editable text, gradients, shapes, shadows and creative typography. Include a central technology illustration, floating stickers, event information and a prominent call to action.',
      1240,
      1754,
    )
    const kinds = (brief.requiredFeatures ?? []).map((f) => f.kind)
    expect(kinds).toContain('illustration')
    expect(kinds).toContain('stickers')
    expect(kinds).toContain('cta-button')
    expect(kinds).toContain('gradients')
    expect(kinds).toContain('shadows')
    expect(kinds).toContain('text-effects')
  })

  it('the CTA check: bare text FAILS, a filled button shape + actionable text PASSES', async () => {
    const { extractBrief, validateBrief } = await import('./brief')
    const brief = extractBrief('A poster with a prominent call to action')
    const bare = validateBrief(brief, {
      texts: ['GET TICKETS NOW'],
      colors: [],
      width: 1240,
      height: 1754,
      elements: [{ type: 'text', text: 'GET TICKETS NOW', x: 400, y: 900, width: 400, height: 60 }],
    })
    expect(bare.satisfied).toBe(false)
    expect(bare.unmet.some((u) => u.includes('call-to-action'))).toBe(true)
    const button = validateBrief(brief, {
      texts: ['GET TICKETS NOW'],
      colors: [],
      width: 1240,
      height: 1754,
      elements: [
        { type: 'rect', x: 320, y: 880, width: 600, height: 120, fill: '#02C0CC' },
        { type: 'text', text: 'GET TICKETS NOW', x: 400, y: 900, width: 400, height: 60 },
      ],
    })
    expect(button.checked.features?.some((f) => f.found)).toBe(true)
    expect(button.satisfied).toBe(true)
  })

  it('the illustration check: small icons do NOT qualify, a ≥10% focal element does', async () => {
    const { extractBrief, validateBrief } = await import('./brief')
    const brief = extractBrief('a poster with a central technology illustration')
    const small = validateBrief(brief, {
      texts: [], colors: [], width: 1000, height: 1000,
      elements: [{ type: 'image', x: 480, y: 480, width: 120, height: 120 }], // 1.4%
    })
    expect(small.satisfied).toBe(false)
    const focal = validateBrief(brief, {
      texts: [], colors: [], width: 1000, height: 1000,
      elements: [{ type: 'image', x: 300, y: 300, width: 400, height: 400 }], // 16%
    })
    expect(focal.satisfied).toBe(true)
  })

  it('gradients/shadows/features validate against the real effects fields', async () => {
    const { extractBrief, validateBrief } = await import('./brief')
    const brief = extractBrief('use gradients and shadows and floating stickers')
    const withEffects = validateBrief(brief, {
      texts: [], colors: [], width: 1000, height: 1000,
      elements: [
        { type: 'rect', x: 0, y: 0, width: 200, height: 200, hasGradient: true, hasShadow: true },
        { type: 'sticker', x: 0, y: 300, width: 100, height: 100 },
        { type: 'sticker', x: 200, y: 300, width: 100, height: 100 },
      ],
    })
    expect(withEffects.satisfied).toBe(true)
  })
})

describe('v0.33 · the audit sees non-text elements — present is not visible', () => {
  it('a sticker fully covered by a higher opaque shape is reported', async () => {
    const { auditDesign } = await import('./audit')
    const issues = auditDesign({
      name: 't', width: 1080, height: 1080, pageCount: 1, currentPageIndex: 0,
      background: '#090B1A',
      elements: [
        { id: 'st-1', type: 'sticker', x: 100, y: 100, width: 160, height: 160, fill: '#FFFFFF' },
        { id: 'cover-1', type: 'rect', x: 0, y: 0, width: 1080, height: 1080, fill: '#000000' },
      ],
      colorsInUse: [], otherPages: [],
    } as never)
    expect(issues.some((i) => i.includes('sticker#st-1') && i.includes('COVERED'))).toBe(true)
  })

  it('an off-canvas sticker is reported', async () => {
    const { auditDesign } = await import('./audit')
    const issues = auditDesign({
      name: 't', width: 1080, height: 1080, pageCount: 1, currentPageIndex: 0,
      background: '#090B1A',
      elements: [{ id: 'st-2', type: 'sticker', x: 1200, y: 100, width: 160, height: 160, fill: '#FFFFFF' }],
      colorsInUse: [], otherPages: [],
    } as never)
    expect(issues.some((i) => i.includes('OFF the canvas'))).toBe(true)
  })
})

describe('v0.33 · the full-circle honesty: a run cannot claim stickers it never built', () => {
  it('done is bounced with the unmet feature, then the resolved add_sticker satisfies it', async () => {
    const events: AgentEvent[] = []
    let appliedSticker = 0
    const { chat } = scriptedChat([
      turn('set_background', { kind: 'solid', from: '#0A0A1A' }),
      turn('plan_layout', { background: '#0A0A1A', sections: [{ name: 'hero', y: 65, height: 300, contains: 'headline + focal' }, { name: 'cta', y: 805, height: 150, contains: 'button' }] }),
      turn('add_text', { text: 'NEON 2027', fontSize: 96, color: '#02C0CC' }),
      done('Built with four floating stickers'), // bounced: no stickers on the canvas
      turn('add_sticker', { query: 'sparkle', x: 120, y: 500, size: 140 }), // resolves → applied
      done('Built, stickers added'), // accepted
    ])
    const result = await runAgentLoop({
      chat,
      design: {
        name: 'Empty poster', width: 1080, height: 1080, pageCount: 1,
        currentPageIndex: 0, elements: [], colorsInUse: [], otherPages: [],
      },
      mode: 'create',
      request: 'Create a poster for NEON 2027 with floating stickers',
      // the route extracts the brief from the request; the loop consumes
      // it via deps — the stickers feature is the contract here
      brief: {
        requiredTexts: [],
        requiredColors: [],
        requiredFeatures: [
          { tier: 'mandatory', kind: 'stickers', count: 2, label: '2 floating stickers (add_sticker — the 160+ vector library or emoji glyphs)' },
        ],
        restrictions: [],
        notes: [],
        source: 'user',
      },
      emit: (e) => events.push(e),
      // 1 = set_background, 2 = add_text, 3 = add_sticker (the resolved
      // vector sticker that satisfies the feature contract)
      awaitApply: async () => {
        appliedSticker += 1
        return { ok: true }
      },
      validateBriefOnClient: async () =>
        appliedSticker >= 3
          ? { satisfied: true, unmet: [] }
          : {
              satisfied: false,
              unmet: [
                'Required element missing: 2 floating stickers (add_sticker — the 160+ vector library or emoji glyphs) — build it from NATIVE elements (rect panels, semi-transparent fills, borders, text).',
              ],
            },
    })
    expect(appliedSticker).toBe(3)
    expect(result.toolCalls).toBe(3)
    expect(String(result.verification)).toContain('Brief contract validated')
  })
})

describe('v0.33.1 · the live-repro convergence fixes', () => {
  it('the illustration default size is page-adaptive: ≥10% focal size on tall canvases', () => {
    // square 1080: the classic default already clears the threshold
    // (√(10% of 1080²) = 342 < 420)
    const square = AGENT_TOOL_MAP.get('add_illustration')!.sanitize({ query: 'rocket launch' }, ctx)
    expect(square.ok).toBe(true)
    if (square.ok) expect((square.actions[0] as { size?: number }).size).toBe(420)
    // a 1240×1754 poster: 420px was 8.1% of the page and the run churned
    // six attempts against the feature gate — the default is now ≥466
    const tall = AGENT_TOOL_MAP.get('add_illustration')!.sanitize(
      { query: 'rocket launch' },
      { ...ctx, width: 1240, height: 1754 },
    )
    expect(tall.ok).toBe(true)
    if (tall.ok) expect((tall.actions[0] as { size?: number }).size).toBeGreaterThanOrEqual(466)
  })

  it('the illustration unmet message names the exact px math and the resize path', async () => {
    const { extractBrief, validateBrief } = await import('./brief')
    const brief = extractBrief('a poster with a central technology illustration')
    const r = validateBrief(brief, {
      texts: [], colors: [], width: 1240, height: 1754,
      elements: [{ type: 'image', x: 0, y: 0, width: 300, height: 300 }],
    })
    expect(r.satisfied).toBe(false)
    expect(r.unmet.some((u) => u.includes('467×467'))).toBe(true)
    expect(r.unmet.some((u) => u.includes('update_elements'))).toBe(true)
  })
})
