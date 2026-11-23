// Unit tests for the v0.27 agent core — protocol parsing, tool
// sanitization, intent routing, and the loop's budget/verification
// discipline. The loop is tested with a scripted fake ChatFn so no
// network or provider is involved.

import { describe, it, expect } from 'vitest'
import { parseAgentTurn, AGENT_BUDGETS, type AgentEvent } from './protocol'
import { AGENT_TOOL_MAP, AGENT_TOOLS, fontFamilies, type ToolContext } from './tools'
import { heuristicIntent, parseIntent } from './router'
import { runAgentLoop } from './loop'
import type { AgentDesignCtx } from './context'

// ── fixtures ─────────────────────────────────────────────────

const ctx: ToolContext = {
  validIds: new Set(['el-1', 'el-2', 'txt-1']),
  width: 1080,
  height: 1080,
  fonts: new Set(['Poppins', 'Inter', 'Montserrat']),
}

const design: AgentDesignCtx = {
  name: 'Test',
  width: 1080,
  height: 1080,
  pageCount: 1,
  currentPageIndex: 0,
  selectedIds: [],
  elements: [
    { id: 'el-1', type: 'rect', x: 0, y: 0, width: 100, height: 100, fill: '#FF0000' },
    { id: 'el-2', type: 'rect', x: 50, y: 50, width: 100, height: 100, fill: '#00FF00' },
    { id: 'txt-1', type: 'text', x: 0, y: 200, width: 400, height: 60, text: 'Hello', fontSize: 48, fill: '#111111' },
  ],
}

// ── protocol ─────────────────────────────────────────────────

describe('parseAgentTurn', () => {
  it('parses a clean tool turn', () => {
    const t = parseAgentTurn('{"thought":"need state","tool":"get_page_state","args":{}}')
    expect(t?.tool).toBe('get_page_state')
  })

  it('parses through markdown fences and prose', () => {
    const t = parseAgentTurn('Sure! Here is my next step:\n```json\n{"tool":"add_text","args":{"text":"Hi"}}\n```')
    expect(t?.tool).toBe('add_text')
    expect((t?.args as { text: string }).text).toBe('Hi')
  })

  it('parses a done turn', () => {
    const t = parseAgentTurn('{"done":true,"summary":"Finished"}')
    expect(t?.done).toBe(true)
    expect(t?.summary).toBe('Finished')
  })

  it('returns null for junk', () => {
    expect(parseAgentTurn('no json here at all')).toBeNull()
    expect(parseAgentTurn('')).toBeNull()
  })
})

// ── tool sanitizers ──────────────────────────────────────────

describe('agent tool sanitizers', () => {
  const tool = (name: string) => AGENT_TOOL_MAP.get(name)!

  it('registry is complete: every tool has name/risk/sanitize', () => {
    for (const t of AGENT_TOOLS) {
      expect(t.name).toBeTruthy()
      expect(['read', 'write', 'destructive']).toContain(t.risk)
      expect(typeof t.sanitize).toBe('function')
    }
    expect(AGENT_TOOLS.length).toBeGreaterThanOrEqual(18)
  })

  it('add_text rejects a bad font with an actionable error', () => {
    const r = tool('add_text').sanitize({ text: 'Hi', fontFamily: 'Comic Sans' }, ctx)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('Comic Sans')
  })

  it('add_text rejects out-of-range fontSize with the range in the message', () => {
    const r = tool('add_text').sanitize({ text: 'Hi', fontSize: 1200 }, ctx)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('6–400')
  })

  it('add_text accepts valid args and compiles an action', () => {
    const r = tool('add_text').sanitize({ text: 'Hello', fontSize: 64, color: '#7D2AE8', bold: true, x: 100, y: 200 }, ctx)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.actions[0]).toMatchObject({ type: 'addText', text: 'Hello', bold: true, color: '#7d2ae8', x: 100, y: 200 })
    }
  })

  it('update_elements rejects unknown ids and names them', () => {
    const r = tool('update_elements').sanitize({ ids: ['nope-1'], patch: { fill: '#FF0000' } }, ctx)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('nope-1')
  })

  it('update_elements rejects a bad hex with the value echoed', () => {
    const r = tool('update_elements').sanitize({ ids: ['el-1'], patch: { fill: 'red' } }, ctx)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('red')
  })

  it('update_elements rejects an empty patch', () => {
    const r = tool('update_elements').sanitize({ ids: ['el-1'], patch: {} }, ctx)
    expect(r.ok).toBe(false)
  })

  it('delete_elements is marked destructive', () => {
    expect(tool('delete_elements').risk).toBe('destructive')
    expect(tool('clear_page').risk).toBe('destructive')
    expect(tool('get_page_state').risk).toBe('read')
    expect(tool('add_text').risk).toBe('write')
  })

  it('set_font validates against the real catalog', () => {
    const real = fontFamilies()[0]
    const r = tool('set_font').sanitize({ fontFamily: real, targets: 'headings' }, ctx)
    expect(r.ok).toBe(true)
    const bad = tool('set_font').sanitize({ fontFamily: 'Not A Font', targets: 'all' }, ctx)
    expect(bad.ok).toBe(false)
  })

  it('recolor accepts palette mode with 3–5 hex colors', () => {
    const r = tool('recolor').sanitize({ palette: ['#111111', '#222222', '#333333'] }, ctx)
    expect(r.ok).toBe(true)
    const bad = tool('recolor').sanitize({ palette: ['#111111', 'nope'] }, ctx)
    expect(bad.ok).toBe(false)
  })

  it('set_background requires to for gradients', () => {
    const bad = tool('set_background').sanitize({ kind: 'gradient', from: '#000000' }, ctx)
    expect(bad.ok).toBe(false)
    const ok = tool('set_background').sanitize({ kind: 'gradient', from: '#000000', to: '#FFFFFF', angle: 45 }, ctx)
    expect(ok.ok).toBe(true)
  })

  it('clear_page on an empty page refuses gracefully', () => {
    const r = tool('clear_page').sanitize({}, { ...ctx, validIds: new Set() })
    expect(r.ok).toBe(false)
  })
})

// ── router ───────────────────────────────────────────────────

describe('heuristicIntent', () => {
  it('routes obvious questions to ask', () => {
    expect(heuristicIntent('What do you think of this design?')).toBe('ask')
    expect(heuristicIntent('How does this look?')).toBe('ask')
  })

  it('routes surgical edits to act', () => {
    expect(heuristicIntent('Make the title bold')).toBe('act')
    expect(heuristicIntent('change all heading colors to purple')).toBe('act')
  })

  it('routes multi-goal briefs to plan', () => {
    expect(heuristicIntent('Design a bold poster for a coffee launch with a warm palette and a big headline')).toBe('plan')
  })

  it('returns null when unsure', () => {
    expect(heuristicIntent('lol')).toBeNull()
  })
})

describe('parseIntent', () => {
  it('reads the JSON intent', () => {
    expect(parseIntent('{"intent":"act"}')).toBe('act')
    expect(parseIntent('```json\n{"intent":"ask"}\n```')).toBe('ask')
  })
  it('falls back to plan on garbage', () => {
    expect(parseIntent('I think act')).toBe('plan')
  })
})

// ── the loop ─────────────────────────────────────────────────

describe('runAgentLoop', () => {
  it('applies a valid tool call, streams events, and finishes', async () => {
    const events: AgentEvent[] = []
    const replies = [
      JSON.stringify({ thought: 'add a headline', tool: 'add_text', args: { text: 'Big News', fontSize: 72, x: 100, y: 80 } }),
      JSON.stringify({ done: true, summary: 'Added the headline' }),
    ]
    const result = await runAgentLoop({
      chat: async () => replies.shift() ?? '',
      design,
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })
    expect(result.summary).toBe('Added the headline')
    expect(result.toolCalls).toBe(1)
    const actionTypes = events.filter((e) => e.type === 'action').map((e) => (e as { actions: unknown[] }).actions)
    expect(actionTypes).toHaveLength(1)
    expect(actionTypes[0][0]).toMatchObject({ type: 'addText', text: 'Big News' })
    expect(events.some((e) => e.type === 'step')).toBe(true)
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('self-corrects on a sanitize rejection without consuming the tool budget', async () => {
    const replies = [
      JSON.stringify({ thought: 'bad color', tool: 'update_elements', args: { ids: ['el-1'], patch: { fill: 'red' } } }),
      JSON.stringify({ thought: 'fixed', tool: 'update_elements', args: { ids: ['el-1'], patch: { fill: '#FF0000' } } }),
      JSON.stringify({ done: true, summary: 'Recolored' }),
    ]
    let applied = 0
    const result = await runAgentLoop({
      chat: async () => replies.shift() ?? '',
      design,
      emit: () => {},
      awaitApply: async () => {
        applied += 1
        return { ok: true }
      },
    })
    expect(result.toolCalls).toBe(1) // the rejected call did not count
    expect(applied).toBe(1)
    expect(result.summary).toBe('Recolored')
  })

  it('stops at the step budget (anti over-ambition)', async () => {
    const events: AgentEvent[] = []
    const result = await runAgentLoop({
      chat: async () => JSON.stringify({ thought: 'again', tool: 'get_page_state', args: {} }),
      design,
      emit: (e) => events.push(e),
      awaitApply: async () => ({ ok: true }),
    })
    // get_page_state is a read tool — it still counts as a step turn
    expect(result.steps).toBeLessThanOrEqual(AGENT_BUDGETS.maxSteps)
    expect(events[events.length - 1].type).toBe('done')
  })

  it('a destructive tool without confirmation is declined and not applied', async () => {
    const replies = [
      JSON.stringify({ thought: 'clean up', tool: 'delete_elements', args: { ids: ['el-1', 'el-2'] } }),
      JSON.stringify({ done: true, summary: 'Kept everything' }),
    ]
    let applied = 0
    const result = await runAgentLoop({
      chat: async () => replies.shift() ?? '',
      design,
      emit: () => {},
      confirmed: new Set(), // user has NOT approved delete_elements
      awaitConfirm: async () => false,
      awaitApply: async () => {
        applied += 1
        return { ok: true }
      },
    })
    expect(applied).toBe(0)
    expect(result.toolCalls).toBe(0)
    expect(result.summary).toBe('Kept everything')
  })

  it('a destructive tool WITH pre-approval applies', async () => {
    const replies = [
      JSON.stringify({ thought: 'clean up', tool: 'clear_page', args: {} }),
      JSON.stringify({ done: true, summary: 'Cleared' }),
    ]
    let applied = 0
    const result = await runAgentLoop({
      chat: async () => replies.shift() ?? '',
      design,
      emit: () => {},
      confirmed: new Set(['clear_page']),
      awaitApply: async () => {
        applied += 1
        return { ok: true }
      },
    })
    expect(applied).toBe(1)
    expect(result.toolCalls).toBe(1)
  })

  it('unknown tools get an actionable error observation, then the run can still finish', async () => {
    const replies = [
      JSON.stringify({ thought: 'try something', tool: 'make_coffee', args: {} }),
      JSON.stringify({ done: true, summary: 'Nothing to do' }),
    ]
    const result = await runAgentLoop({
      chat: async () => replies.shift() ?? '',
      design,
      emit: () => {},
      awaitApply: async () => ({ ok: true }),
    })
    expect(result.summary).toBe('Nothing to do')
    expect(result.toolCalls).toBe(0)
  })

  it('client abort stops the loop and reports what happened', async () => {
    const signal = { aborted: false, reason: 'Stopped by user' }
    let calls = 0
    const result = await runAgentLoop({
      chat: async () => {
        calls += 1
        if (calls === 1) {
          // the user hits Stop while the first action is in flight
          signal.aborted = true
          return JSON.stringify({ thought: 'x', tool: 'add_text', args: { text: 'Hi' } })
        }
        return JSON.stringify({ done: true, summary: 'should not reach' })
      },
      design,
      emit: () => {},
      signal,
    })
    expect(result.summary).toContain('Stopped')
  })
})
