// ─────────────────────────────────────────────────────────────
// The comprehensive agent harness (v0.27.3) — "test it thoroughly,
// not one simple case". Four layers:
//
//   1. TOOL MATRIX   — every registered tool × valid / invalid /
//                      boundary args, asserting both the accept and
//                      the actionable-error contract.
//   2. LOOP FLOWS    — realistic multi-step runs (poster build,
//                      page-switch flow, stock-photo flow, repair,
//                      budget exhaustion, confirm gates, abort).
//   3. WIRE FORMAT   — sseLine/parseAgentTurn round-trips, event
//                      versioning, malformed-line tolerance.
//   4. ROUTER MATRIX — heuristic + parseIntent across phrasings.
//
// The "LLM" is a scripted queue — deterministic, no network. The
// harness asserts the INVARIANTS the real model relies on:
//   · every rejected call returns an error that names the fix
//   · actions the client must apply are always well-formed
//   · budgets can never be exceeded, and free retries stay free
//   · destructive tools never apply without an explicit approval
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  parseAgentTurn,
  sseLine,
  AGENT_BUDGETS,
  AGENT_PROTOCOL_VERSION,
  type AgentEvent,
} from './protocol'
import { AGENT_TOOL_MAP, AGENT_TOOLS, toolsPromptSection, type ToolContext, type SanitizeResult } from './tools'
import { runAgentLoop, loopSystemPrompt } from './loop'
import { heuristicIntent, parseIntent } from './router'
import { serializeDesignContext, contextValidIds, type AgentDesignCtx } from './context'

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
const done = (summary: string) => JSON.stringify({ done: true, summary })

// ═════════════════════════════════════════════════════════════
// 1. TOOL MATRIX — every tool, valid + invalid + boundary
// ═════════════════════════════════════════════════════════════

describe('harness · tool matrix', () => {
  const tool = (name: string) => {
    const t = AGENT_TOOL_MAP.get(name)
    if (!t) throw new Error(`tool "${name}" is not registered — harness covers every tool`)
    return t
  }
  const call = (name: string, args: Record<string, unknown>, c: ToolContext = ctx): SanitizeResult =>
    tool(name).sanitize(args, c)

  it('every tool in the registry is covered by this harness', () => {
    // the source of truth: if a tool is added without harness coverage,
    // this fails and forces the author to add cases below
    const covered = [
      'get_page_state', 'add_text', 'add_shape', 'add_image', 'add_stock_photo', 'add_sticker',
      'add_table', 'update_elements', 'set_text_style', 'move_elements', 'align_elements',
      'distribute_elements', 'set_background', 'set_font', 'recolor', 'add_page', 'duplicate_page',
      'goto_page', 'fix_overlaps', 'balance_layout', 'animate_page', 'translate_texts',
      'delete_elements', 'clear_page',
    ]
    for (const t of AGENT_TOOLS) expect(covered).toContain(t.name)
    expect(covered).toHaveLength(AGENT_TOOLS.length)
  })

  // ── add_text ─────────────────────────────────────────────
  it('add_text: valid full args', () => {
    const r = call('add_text', { text: 'Grand Opening', fontSize: 96, x: 80, y: 120, width: 900, color: '#7D2AE8', bold: true, align: 'left' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.actions[0]).toMatchObject({ type: 'addText', text: 'Grand Opening', fontSize: 96, color: '#7d2ae8', bold: true, align: 'left' })
  })
  it('add_text: yBand rides when y is absent', () => {
    const r = call('add_text', { text: 'Sub', yBand: 'bottom' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.actions[0]).toMatchObject({ y: 'bottom' })
  })
  it('add_text: exact y overrides yBand', () => {
    const r = call('add_text', { text: 'Sub', y: 500, yBand: 'top' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.actions[0]).toMatchObject({ y: 500 })
    if (r.ok) expect(r.actions[0].yBand).toBeUndefined()
  })
  it('add_text: boundary fontSize 6 and 400 pass, 5 and 401 fail with the range echoed', () => {
    expect(call('add_text', { text: 'x', fontSize: 6 }).ok).toBe(true)
    expect(call('add_text', { text: 'x', fontSize: 400 }).ok).toBe(true)
    for (const bad of [5, 401, 1200]) {
      const r = call('add_text', { text: 'x', fontSize: bad })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toContain(String(bad))
    }
  })
  it('add_text: empty text and bad color rejected with actionable errors', () => {
    expect(call('add_text', { text: '   ' }).ok).toBe(false)
    const r = call('add_text', { text: 'x', color: 'purple' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('#RRGGBB')
  })
  it('add_text: unknown font rejected with valid examples listed', () => {
    const r = call('add_text', { text: 'x', fontFamily: 'Comic Sans' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('Comic Sans')
      expect(r.error).toContain('Poppins')
    }
  })
  it('add_text: 400-char text is trimmed at the cap (no prompt injection via overflow)', () => {
    const r = call('add_text', { text: 'A'.repeat(900) })
    expect(r.ok).toBe(true)
    if (r.ok) expect((r.actions[0].text as string).length).toBeLessThanOrEqual(400)
  })

  // ── add_shape ────────────────────────────────────────────
  it('add_shape: every shape kind accepts and compiles', () => {
    for (const shape of ['rect', 'ellipse', 'triangle', 'star', 'line']) {
      const r = call('add_shape', { shape, x: 10, y: 10, width: 100, height: 80 })
      expect(r.ok, shape).toBe(true)
      if (r.ok) expect(r.actions[0]).toMatchObject({ type: 'addShape', shape })
    }
  })
  it('add_shape: missing numbers and tiny sizes rejected naming the field', () => {
    const r1 = call('add_shape', { shape: 'rect', x: 1, y: 1 })
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.error).toContain('width')
    const r2 = call('add_shape', { shape: 'rect', x: 1, y: 1, width: 2, height: 80 })
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error).toContain('≥ 4')
    expect(call('add_shape', { shape: 'hexagon', x: 1, y: 1, width: 50, height: 50 }).ok).toBe(false)
  })

  // ── add_image / add_stock_photo ──────────────────────────
  it('add_image: prompt validation + placement clamps', () => {
    expect(call('add_image', { prompt: 'ok' }).ok).toBe(false)
    const r = call('add_image', { prompt: 'an abstract gradient banner', x: -50, y: 2000, width: 5000 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.actions[0]).toMatchObject({ type: 'generateImage', prompt: 'an abstract gradient banner' })
      expect(r.actions[0].x).toBe(0)      // clamped into the page
      expect(r.actions[0].width).toBe(1080) // clamped to page width
    }
  })
  it('add_stock_photo: query + orientation validation, compiles addStockPhoto action', () => {
    expect(call('add_stock_photo', { query: 'a' }).ok).toBe(false)
    for (const orientation of ['landscape', 'portrait', 'square']) {
      const r = call('add_stock_photo', { query: 'coffee cup on a wooden table', orientation })
      expect(r.ok, orientation).toBe(true)
      if (r.ok) expect(r.actions[0]).toMatchObject({ type: 'addStockPhoto', query: 'coffee cup on a wooden table', orientation })
    }
    const bad = call('add_stock_photo', { query: 'coffee', orientation: 'diagonal' })
    expect(bad.ok).toBe(true) // unknown enum falls back — no orientation filter
    if (bad.ok) expect(bad.actions[0].orientation).toBeUndefined()
  })

  // ── add_sticker / add_table ──────────────────────────────
  it('add_sticker: emoji required, size bounds', () => {
    expect(call('add_sticker', { emoji: '' }).ok).toBe(false)
    expect(call('add_sticker', { emoji: '🚀', size: 10 }).ok).toBe(false)
    const r = call('add_sticker', { emoji: '✨', size: 200 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.actions[0]).toMatchObject({ type: 'addSticker', emoji: '✨', size: 200 })
  })
  it('add_table: header/rows validation + cell caps', () => {
    expect(call('add_table', { header: [], rows: [['a']] }).ok).toBe(false)
    expect(call('add_table', { header: ['A'], rows: [] }).ok).toBe(false)
    const r = call('add_table', {
      header: ['Plan', 'Price', 'Seats'],
      rows: [
        ['Free', '$0', '1'],
        ['Pro', '$12', '5'],
        ['Team', '$49', '25'],
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.actions[0]).toMatchObject({ type: 'addTable', header: ['Plan', 'Price', 'Seats'] })
  })

  // ── update_elements / set_text_style ─────────────────────
  it('update_elements: full patch surface, one action per call', () => {
    const r = call('update_elements', {
      ids: ['el-1', 'el-2'],
      patch: { x: 10, y: 20, width: 200, height: 100, rotation: 15, opacity: 0.5, fill: '#00AAFF', bold: true, align: 'right' },
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.actions[0]).toMatchObject({ type: 'updateElements', ids: ['el-1', 'el-2'] })
  })
  it('update_elements: every invalid patch value is named', () => {
    for (const [patch, hint] of [
      [{ fill: 'nope' }, '#RRGGBB'],
      [{ fontSize: 900 }, '6–400'],
      [{ opacity: 2 }, '0–1'],
      [{ width: 'wide' }, 'number'],
    ] as const) {
      const r = call('update_elements', { ids: ['el-1'], patch })
      expect(r.ok, JSON.stringify(patch)).toBe(false)
      if (!r.ok) expect(r.error).toContain(hint)
    }
  })
  it('update_elements: stale/foreign ids rejected, valid ones listed', () => {
    const r = call('update_elements', { ids: ['ghost-9'], patch: { fill: '#123456' } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('ghost-9')
    if (!r.ok) expect(r.error).toContain('get_page_state')
  })
  it('set_text_style: font + size + color compile to one updateElements', () => {
    const r = call('set_text_style', { ids: ['txt-1'], fontFamily: 'Poppins', fontSize: 64, bold: true, color: '#FF0055' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.actions[0]).toMatchObject({ type: 'updateElements', ids: ['txt-1'], patch: { fontFamily: 'Poppins', fontSize: 64, bold: true, fill: '#ff0055' } })
  })

  // ── move / align / distribute ────────────────────────────
  it('move_elements: deltas clamp to ±2 pages; snap bands map', () => {
    const r = call('move_elements', { ids: ['el-1'], dx: 99999, dy: -99999 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.actions[0].dx).toBe(2160) // 2 × 1080
    const snap = call('move_elements', { ids: ['el-1'], to: 'center' })
    expect(snap.ok).toBe(true)
    if (snap.ok) expect(snap.actions[0]).toMatchObject({ to: 'center' })
    expect(call('move_elements', { ids: ['el-1'] }).ok).toBe(false) // neither dx/dy nor to
  })
  it('align_elements: all six modes accept; bad mode rejects', () => {
    for (const mode of ['left', 'cx', 'right', 'top', 'cy', 'bottom']) {
      expect(call('align_elements', { ids: ['el-1', 'el-2'], mode }).ok, mode).toBe(true)
    }
    expect(call('align_elements', { ids: ['el-1'], mode: 'diagonal' }).ok).toBe(false)
  })
  it('distribute_elements: needs 3+ ids (client contract) and says what to use instead', () => {
    const two = call('distribute_elements', { ids: ['el-1', 'el-2'], axis: 'x' })
    expect(two.ok).toBe(false)
    if (!two.ok) expect(two.error).toContain('align_elements')
    const three = call('distribute_elements', { ids: ['el-1', 'el-2', 'img-1'], axis: 'y' })
    expect(three.ok).toBe(true)
  })

  // ── page-level tools ─────────────────────────────────────
  it('set_background: solid + gradient + angle clamp; bad forms rejected', () => {
    expect(call('set_background', { kind: 'solid', from: '#0D1117' }).ok).toBe(true)
    const g = call('set_background', { kind: 'gradient', from: '#7D2AE8', to: '#02C0CC', angle: 999 })
    expect(g.ok).toBe(true)
    if (g.ok) expect(g.actions[0].angle).toBe(360)
    expect(call('set_background', { kind: 'gradient', from: '#7D2AE8' }).ok).toBe(false)
    expect(call('set_background', { kind: 'plaid', from: '#000000' }).ok).toBe(false)
  })
  it('set_font: targets enum + catalog validation', () => {
    for (const targets of ['all', 'headings', 'body']) {
      expect(call('set_font', { fontFamily: 'Inter', targets }).ok, targets).toBe(true)
    }
    expect(call('set_font', { fontFamily: 'Wingdings' }).ok).toBe(false)
  })
  it('recolor: both modes + the 3-color palette floor', () => {
    expect(call('recolor', { color: '#FF0055', targets: 'text' }).ok).toBe(true)
    expect(call('recolor', { palette: ['#7D2AE8', '#02C0CC', '#FFD166'] }).ok).toBe(true)
    expect(call('recolor', { palette: ['#7D2AE8', 'nope', '#FFD166'] }).ok).toBe(false)
    expect(call('recolor', {}).ok).toBe(false)
  })
  it('add_page / duplicate_page / fix_overlaps / balance_layout / animate_page / translate_texts compile', () => {
    expect(call('add_page', {})).toMatchObject({ ok: true })
    expect(call('duplicate_page', {})).toMatchObject({ ok: true })
    expect(call('fix_overlaps', {})).toMatchObject({ ok: true })
    expect(call('balance_layout', {})).toMatchObject({ ok: true })
    expect(call('animate_page', {})).toMatchObject({ ok: true })
    expect(call('translate_texts', { language: 'Spanish' })).toMatchObject({ ok: true })
    expect(call('translate_texts', {}).ok).toBe(false)
  })

  // ── goto_page (new in v0.27.3) ───────────────────────────
  it('goto_page: 1-based integer validation', () => {
    const ok = call('goto_page', { page: 2 })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.actions[0]).toMatchObject({ type: 'gotoPage', page: 2 })
    for (const bad of [0, -1, 61, 2.5, 'two']) {
      expect(call('goto_page', { page: bad }).ok, String(bad)).toBe(false)
    }
    expect(call('goto_page', {}).ok).toBe(false)
  })

  // ── destructive ──────────────────────────────────────────
  it('delete_elements / clear_page are the only destructive tools', () => {
    for (const t of AGENT_TOOLS) {
      const shouldBeDestructive = t.name === 'delete_elements' || t.name === 'clear_page'
      expect(t.risk === 'destructive', t.name).toBe(shouldBeDestructive)
    }
  })
  it('clear_page expands to every current id and refuses an empty page', () => {
    const r = call('clear_page', {})
    expect(r.ok).toBe(true)
    if (r.ok) expect((r.actions[0].ids as string[]).sort()).toEqual([...ctx.validIds].sort())
    const empty = call('clear_page', {}, { ...ctx, validIds: new Set() })
    expect(empty.ok).toBe(false)
  })

  // ── universal invariants ─────────────────────────────────
  it('EVERY tool: accepted calls always carry ≥1 action object with a type', () => {
    // sample one valid call per tool
    const valid: Record<string, Record<string, unknown>> = {
      get_page_state: {},
      add_text: { text: 'Hi' },
      add_shape: { shape: 'rect', x: 1, y: 1, width: 50, height: 50 },
      add_image: { prompt: 'a banner' },
      add_stock_photo: { query: 'coffee' },
      add_sticker: { emoji: '🚀' },
      add_table: { header: ['A'], rows: [['1']] },
      update_elements: { ids: ['el-1'], patch: { fill: '#123456' } },
      set_text_style: { ids: ['txt-1'], fontSize: 40 },
      move_elements: { ids: ['el-1'], dx: 10 },
      align_elements: { ids: ['el-1'], mode: 'cx' },
      distribute_elements: { ids: ['el-1', 'el-2', 'img-1'], axis: 'x' },
      set_background: { kind: 'solid', from: '#0D1117' },
      set_font: { fontFamily: 'Inter' },
      recolor: { color: '#FF0055' },
      add_page: {},
      duplicate_page: {},
      goto_page: { page: 1 },
      fix_overlaps: {},
      balance_layout: {},
      animate_page: {},
      translate_texts: { language: 'French' },
      delete_elements: { ids: ['el-1'] },
      clear_page: {},
    }
    for (const t of AGENT_TOOLS) {
      const r = t.sanitize(valid[t.name], ctx)
      expect(r.ok, t.name).toBe(true)
      if (r.ok) {
        expect(r.actions.length, t.name).toBeGreaterThan(0)
        expect(typeof r.actions[0].type, t.name).toBe('string')
        expect(r.observation, t.name).toBeTruthy()
      }
    }
  })
  it('EVERY tool: rejections always produce a non-empty actionable error', () => {
    // garbage args must be rejected (never crash, never pass through)
    for (const t of AGENT_TOOLS) {
      const r = t.sanitize({ ids: [], text: '', patch: {} }, ctx)
      if (!r.ok) {
        expect(r.error.length, t.name).toBeGreaterThan(10)
      } else {
        // tools with no args (add_page etc.) legitimately accept {}
        expect(['add_page', 'duplicate_page', 'fix_overlaps', 'balance_layout', 'animate_page', 'get_page_state', 'clear_page']).toContain(t.name)
      }
    }
  })
  it('sanitizers never throw on adversarial args (wrong types everywhere)', () => {
    const adversarial = [
      { ids: 'not-an-array', patch: { fill: { deep: 'object' } } },
      { text: { nested: true }, fontSize: NaN },
      { header: 'string', rows: 42 },
      { page: Infinity, factor: 'x' },
      { palette: 'no', ids: [null, 123, {}] },
      { dx: '1e999', shape: { fake: 1 } },
    ]
    for (const t of AGENT_TOOLS) {
      for (const args of adversarial) {
        expect(() => t.sanitize(args as Record<string, unknown>, ctx), `${t.name} ${JSON.stringify(args)}`).not.toThrow()
      }
    }
  })
})

// ═════════════════════════════════════════════════════════════
// 2. LOOP FLOWS — realistic multi-step runs
// ═════════════════════════════════════════════════════════════

describe('harness · loop flows', () => {
  it('FLOW poster build: background → headline → subline → photo → verify → done (6 steps, ordered events)', async () => {
    const events: AgentEvent[] = []
    const { chat, calls } = scriptedChat([
      turn('set_background', { kind: 'gradient', from: '#1A1B2E', to: '#7D2AE8', angle: 160 }),
      turn('add_text', { text: 'GRAND OPENING', fontSize: 120, x: 60, y: 140, width: 960, bold: true, color: '#FFFFFF' }),
      turn('add_text', { text: 'Saturday · 10 AM · Free coffee all day', fontSize: 36, x: 60, y: 320, color: '#FFD166' }),
      turn('add_stock_photo', { query: 'coffee shop interior warm light', orientation: 'landscape' }),
      turn('get_page_state'),
      done('Poster built: gradient background, headline, subline and a licensed photo.'),
    ])
    const result = await runAgentLoop({
      chat,
      design,
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
      // the client pushes refreshed context with every ack — the loop
      // re-serializes it after get_page_state
      refreshedContext: () => design,
    })
    expect(result.toolCalls).toBe(5)
    expect(result.steps).toBe(6)
    expect(result.summary).toContain('Poster built')

    // event ORDER: start(implicit) → step → action → observation × N → done
    const kinds = events.map((e) => e.type)
    expect(kinds[0]).toBe('step')
    expect(kinds[kinds.length - 1]).toBe('done')
    expect(kinds.filter((k) => k === 'step')).toHaveLength(5)
    expect(kinds.filter((k) => k === 'action')).toHaveLength(5)
    // every action references its step index and carries a callId
    for (const a of events.filter((e) => e.type === 'action')) {
      const act = a as Extract<AgentEvent, { type: 'action' }>
      expect(act.callId).toMatch(/^call-/)
      expect(act.actions.length).toBeGreaterThan(0)
    }
    // the loop fed the model its observation after each apply (messages grow)
    expect(calls.length).toBe(6)
    expect(calls[5][calls[5].length - 1].content).toContain('UPDATED PAGE STATE')
  })

  it('FLOW page-switch: add_page → goto_page → get_page_state → build on the new page', async () => {
    const events: AgentEvent[] = []
    const { chat, calls } = scriptedChat([
      turn('add_page'),
      turn('goto_page', { page: 4 }), // design.pageCount=3 → new page is #4
      turn('get_page_state'),
      turn('add_text', { text: 'Page 4 headline', fontSize: 80 }),
      done('Added page 4 with its headline.'),
    ])
    // a client that refreshes context after get_page_state
    const refreshed: AgentDesignCtx = { ...design, currentPageIndex: 3, elements: [] }
    const result = await runAgentLoop({
      chat,
      design,
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
      refreshedContext: () => refreshed,
    })
    expect(result.toolCalls).toBe(4)
    // after the refresh, the loop told the model it's on page 4 and
    // validIds were recomputed from the refreshed context
    const lastCall = calls[3]
    expect(lastCall[lastCall.length - 1].content).toContain('editing page 4')
    // actions: addPage, gotoPage, __getContext, addText
    const tools = events.filter((e) => e.type === 'action').map((e) => (e as { tool: string }).tool)
    expect(tools).toEqual(['add_page', 'goto_page', 'get_page_state', 'add_text'])
  })

  it('FLOW self-correction ladder: bad hex → bad font → good call; rejections stay budget-free', async () => {
    const { chat } = scriptedChat([
      turn('update_elements', { ids: ['txt-1'], patch: { fill: 'purple' } }),
      turn('add_text', { text: 'Hi', fontFamily: 'Comic Sans' }),
      turn('update_elements', { ids: ['txt-1'], patch: { fill: '#7D2AE8' } }),
      done('Fixed the color on the third try.'),
    ])
    const result = await runAgentLoop({ chat, design, emit: () => {}, awaitApply: async () => ({ ok: true }) })
    expect(result.toolCalls).toBe(1)
    // v0.27.3: progress budget counts only productive steps — both
    // rejections were free, so the run still had full budget left
    expect(result.steps).toBe(4)
  })

  it('FLOW budget exhaustion: a model that never finishes is cut off with a done event (never a hang)', async () => {
    const events: AgentEvent[] = []
    let modelTurns = 0
    const result = await runAgentLoop({
      chat: async () => {
        modelTurns += 1
        return turn('add_sticker', { emoji: '🤖' })
      },
      design,
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })
    // maxSteps=8 productive calls cap the loop; each add_sticker is
    // productive so the loop stops at exactly 8 tool calls
    expect(modelTurns).toBe(AGENT_BUDGETS.maxSteps)
    expect(result.toolCalls).toBe(AGENT_BUDGETS.maxSteps)
    const last = events[events.length - 1]
    expect(last.type).toBe('done')
  })

  it('FLOW rejected-forever model: rejections are tool-budget-free but 3 strikes end the run (no infinite loop)', async () => {
    const events: AgentEvent[] = []
    let modelTurns = 0
    const result = await runAgentLoop({
      chat: async () => {
        modelTurns += 1
        return turn('update_elements', { ids: ['ghost'], patch: { fill: '#123456' } }) // always invalid
      },
      design,
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })
    // 3 strikes → error event, exactly 3 model turns, zero applies
    expect(modelTurns).toBe(3)
    expect(result.toolCalls).toBe(0)
    const last = events[events.length - 1]
    expect(last.type).toBe('error')
    if (last.type === 'error') expect(last.message).toContain('3 invalid tool calls')
  })

  it('FLOW strike reset: two bad calls, one good, two more bad — the run continues (strikes are consecutive)', async () => {
    const { chat } = scriptedChat([
      turn('update_elements', { ids: ['ghost'], patch: { fill: '#123456' } }), // strike 1
      turn('add_sticker', { emoji: '🚀' }),                                    // good → reset
      turn('update_elements', { ids: ['ghost'], patch: { fill: '#123456' } }), // strike 1 again
      turn('update_elements', { ids: ['ghost-2'], patch: { fill: '#123456' } }), // strike 2
      done('Mixed luck but finished.'),
    ])
    const result = await runAgentLoop({ chat, design, emit: () => {}, awaitApply: async () => ({ ok: true }) })
    expect(result.summary).toBe('Mixed luck but finished.')
    expect(result.toolCalls).toBe(1)
  })

  it('FLOW destructive decline: the model is told, adapts, and finishes — nothing was applied', async () => {
    const applied: unknown[] = []
    const { chat, calls } = scriptedChat([
      turn('clear_page'),
      turn('add_text', { text: 'Starting fresh instead', fontSize: 64 }),
      done('Kept your content and added a fresh headline.'),
    ])
    const result = await runAgentLoop({
      chat,
      design,
      emit: () => {},
      confirmed: new Set(),
      awaitConfirm: async () => false,
      awaitApply: async () => {
        applied.push('x')
        return { ok: true }
      },
    })
    expect(result.toolCalls).toBe(1) // only the add_text
    expect(applied).toHaveLength(1)  // clear_page never applied
    const declineMsg = calls[1].find((m) => m.role === 'user')
    expect(declineMsg?.content).toContain('DECLINED')
  })

  it('FLOW destructive approve-then-apply-failure: the failure feeds back (v0.27.3 fix)', async () => {
    const applied: string[] = []
    const { chat, calls } = scriptedChat([
      turn('delete_elements', { ids: ['el-1'] }),
      turn('delete_elements', { ids: ['el-2'] }),
      done('Deleted what I could.'),
    ])
    const result = await runAgentLoop({
      chat,
      design,
      emit: () => {},
      awaitConfirm: async () => true,
      awaitApply: async () => {
        applied.push('attempt')
        return applied.length === 1
          ? { ok: false, message: 'Element locked by another collaborator' }
          : { ok: true }
      },
    })
    // first delete: approved but apply FAILED → error observation, not counted
    expect(result.toolCalls).toBe(1)
    const failureMsg = calls[1].find((m) => m.role === 'user')
    expect(failureMsg?.content).toContain('locked by another collaborator')
    expect(failureMsg?.content).toContain('NOT changed')
  })

  it('FLOW abort mid-run: everything applied so far is kept and reported', async () => {
    const signal = { aborted: false, reason: 'Stopped by user' }
    let n = 0
    const result = await runAgentLoop({
      chat: async () => {
        n += 1
        if (n === 4) signal.aborted = true // user hits Stop during turn 4
        return turn('add_sticker', { emoji: '⭐' })
      },
      design,
      emit: () => {},
      signal,
      awaitApply: async () => ({ ok: true }),
    })
    // abort is checked at the TOP of the loop: turn 4 (already in
    // flight when Stop landed) still applied; there is no turn 5
    expect(result.toolCalls).toBe(4)
    expect(result.summary).toContain('Stopped')
  })

  it('FLOW JSON repair: first reply is prose, the repair turn succeeds', async () => {
    const { chat } = scriptedChat([
      'Sure! Let me add a nice headline for you. I will use a bold font.',
      turn('add_text', { text: 'Repaired', fontSize: 72 }),
      done('Recovered after the repair.'),
    ])
    const result = await runAgentLoop({ chat, design, emit: () => {}, awaitApply: async () => ({ ok: true }) })
    expect(result.toolCalls).toBe(1)
    expect(result.summary).toBe('Recovered after the repair.')
  })

  it('FLOW provider failure: a thrown chat becomes an error event, never an unhandled rejection', async () => {
    const events: AgentEvent[] = []
    const result = await runAgentLoop({
      chat: async () => {
        throw new Error('429 quota exceeded')
      },
      design,
      emit: (e) => events.push(e),
    })
    expect(result.toolCalls).toBe(0)
    const err = events.find((e) => e.type === 'error')
    expect(err).toBeTruthy()
    if (err && err.type === 'error') expect(err.message).toContain('429')
  })

  it('the system prompt carries the full tool list, the design context and the page rule', () => {
    const prompt = loopSystemPrompt(design, ctx)
    for (const t of AGENT_TOOLS) expect(prompt).toContain(t.name)
    expect(prompt).toContain('Launch Poster')
    expect(prompt).toContain('BRAND KIT')
    expect(prompt).toContain('goto_page') // the new page rule
    expect(prompt).toContain('editing page 1')
    expect(prompt).toContain('grp-1') // group ids are valid targets
  })
})

// ═════════════════════════════════════════════════════════════
// 3. WIRE FORMAT
// ═════════════════════════════════════════════════════════════

describe('harness · SSE wire format', () => {
  it('every event type serializes to exactly one `data: {json}\\n\\n` line and round-trips', () => {
    const samples: AgentEvent[] = [
      { v: 1, type: 'start', intent: 'plan' },
      { v: 1, type: 'step', index: 1, thought: 'thinking', tool: 'add_text' },
      { v: 1, type: 'plan', steps: ['a', 'b'] },
      { v: 1, type: 'action', stepIndex: 1, callId: 'call-1-ab12cd', risk: 'write', tool: 'add_text', actions: [{ type: 'addText', text: 'Hi' }] },
      { v: 1, type: 'ack', callId: 'call-1-ab12cd', ok: true },
      { v: 1, type: 'observation', stepIndex: 1, message: 'added' },
      { v: 1, type: 'done', summary: 'All set', steps: 3, toolCalls: 2 },
      { v: 1, type: 'error', message: 'provider down', code: 'PROVIDER' },
      { v: 1, type: 'aborted', reason: 'Stopped by user' },
    ]
    for (const ev of samples) {
      const line = sseLine(ev)
      expect(line.startsWith('data: ')).toBe(true)
      expect(line.endsWith('\n\n')).toBe(true)
      expect(line.split('\n\n')[0]).toBe(`data: ${JSON.stringify(ev)}`)
      expect(JSON.parse(line.slice(6))).toEqual(ev)
    }
  })
  it('the protocol version is 1 everywhere (client compat contract)', () => {
    expect(AGENT_PROTOCOL_VERSION).toBe(1)
  })
  it('parseAgentTurn: nested braces in strings survive; fences and prose tolerated', () => {
    const t = parseAgentTurn('Here you go:\n```json\n{"thought":"a {b} c","tool":"add_text","args":{"text":"}{"}}\n```')
    expect(t?.tool).toBe('add_text')
    expect((t?.args as { text: string }).text).toBe('}{')
  })
  it('parseAgentTurn: picks the LARGEST valid object (multi-object replies)', () => {
    const t = parseAgentTurn('{"a":1}\n{"thought":"x","tool":"get_page_state","args":{}}')
    expect(t?.tool).toBe('get_page_state')
  })
})

// ═════════════════════════════════════════════════════════════
// 4. ROUTER MATRIX
// ═════════════════════════════════════════════════════════════

describe('harness · router matrix', () => {
  it('asks: questions land on ask', () => {
    for (const m of [
      'What do you think of this design?',
      'How does this look?',
      'Is this font too small?',
      'Why is the text overlapping?',
    ]) {
      expect(heuristicIntent(m), m).toBe('ask')
    }
  })
  it('acts: single surgical edits land on act', () => {
    for (const m of [
      'Make the title bold',
      'change all heading colors to purple',
      'Delete the subtitle',
      'Center everything',
    ]) {
      expect(heuristicIntent(m), m).toBe('act')
    }
  })
  it('plans: multi-goal briefs land on plan', () => {
    for (const m of [
      'Design a bold poster for a coffee launch with a warm palette and a big headline',
      'complete redesign of this flyer with new colors and fonts',
      'rebrand this deck',
    ]) {
      expect(heuristicIntent(m), m).toBe('plan')
    }
  })
  it('unsure → null → the model classifier decides', () => {
    expect(heuristicIntent('lol')).toBeNull()
    expect(heuristicIntent('')).toBeNull()
  })
  it('parseIntent: fenced, bare, and garbage forms', () => {
    expect(parseIntent('{"intent":"act"}')).toBe('act')
    expect(parseIntent('```json\n{"intent":"plan"}\n```')).toBe('plan')
    expect(parseIntent('sure!')).toBe('plan') // fallback
    expect(parseIntent('')).toBe('plan')
  })
})

// ═════════════════════════════════════════════════════════════
// 5. CONTEXT SERIALIZATION
// ═════════════════════════════════════════════════════════════

describe('harness · context serialization', () => {
  it('serializes every element, selection, brand, overlaps and other pages', () => {
    const s = serializeDesignContext(design)
    for (const id of ['el-1', 'el-2', 'txt-1', 'txt-2', 'grp-1', 'img-1']) expect(s).toContain(id)
    expect(s).toContain('[SELECTED]') // txt-1 is selected
    expect(s).toContain('text="Hello"')
    expect(s).toContain('Overlapping pairs: rect#el-1 × rect#el-2')
    expect(s).toContain('Other pages')
    expect(s).toContain('1080x1080')
    expect(s).toContain('3 page(s)')
  })
  it('an empty page serializes honestly', () => {
    const s = serializeDesignContext({ elements: [] })
    expect(s).toContain('(empty page)')
    expect(s).toContain('none detected')
  })
  it('contextValidIds: groups included, selected included', () => {
    const ids = contextValidIds(design)
    expect(ids.has('grp-1')).toBe(true)
    expect(ids.has('txt-2')).toBe(true)
    expect(ids.size).toBe(6)
  })
  it('toolsPromptSection lists every tool with its risk tier', () => {
    const s = toolsPromptSection()
    for (const t of AGENT_TOOLS) {
      expect(s).toContain(`${t.name} (${t.risk})`)
    }
  })
})
