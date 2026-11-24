// ─────────────────────────────────────────────────────────────
// DesignAgent · the toolbox (Phase B, 24 Nov 2026).
//
// Every function the autonomous design agent can use, as a typed
// registry — the ReAct tool-registry discipline (name + one-line
// description + inputs) applied to a code-orchestrated pipeline.
// The registry is the CAPABILITY SURFACE: what the model may choose
// semantically (blocks, copy, seeds, kinds) and what the engine
// executes deterministically (geometry, color math, type scale,
// checks). Mirrors src/lib/agent/tools.ts (AGENT_TOOLS) in style.
//
// Design principles are EMBEDDED in the executors (the PosterGen
// lesson): the compiler carries the composition vocabulary, the
// checks carry the quality bar. The model cannot reach past either.
// ─────────────────────────────────────────────────────────────

import { extractBrief, type DesignBrief } from '@/lib/agent/brief'
import { type DesignSpec } from '@/lib/design-spec/types'
import { parseSpecResponse } from '@/lib/design-spec/parse'
import {
  compileSpec,
  type CompileResult,
  type CompileChecks,
} from '@/lib/design-engine/compile'
import { wrapLines, estimateTextWidth } from '@/lib/design-engine/compositions'
import type { PageData } from '@/lib/types'

export interface ToolRunResult {
  ok: boolean
  /** the tool's typed output (serializable for reports) */
  value: unknown
  /** non-fatal notes */
  notes: string[]
}

export interface DesignTool {
  name: string
  /** one sentence: what it does and when the pipeline uses it */
  description: string
  /** compact input schema for prompts and the run report */
  inputs: string
  run: (args: Record<string, unknown>) => ToolRunResult
}

// ── deterministic executors (pure, testable, no model I/O) ────

const extractBriefTool: DesignTool = {
  name: 'extract-brief',
  description: 'Extracts the structured brief from the user prompt: required verbatim texts, colors, dimensions, format preset.',
  inputs: '{ prompt: string }',
  run: ({ prompt }) => {
    if (typeof prompt !== 'string' || !prompt.trim()) return { ok: false, value: null, notes: ['no prompt'] }
    const brief = extractBrief(prompt)
    const notes: string[] = []
    if (brief.requiredTexts.length === 0) notes.push('no verbatim texts required — planner copy is free')
    return { ok: true, value: brief, notes }
  },
}

const parseSpecTool: DesignTool = {
  name: 'parse-spec',
  description: 'Validates model output into a DesignSpec: kind vocabulary, roles, hexes, format bounds. Honest failure object, never a silently-emptied spec.',
  inputs: '{ raw: string }',
  run: ({ raw }) => {
    const r = parseSpecResponse(typeof raw === 'string' ? raw : '')
    return r.ok
      ? { ok: true, value: r.spec, notes: [] }
      : { ok: false, value: null, notes: [r.error] }
  },
}

const compileSpecTool: DesignTool = {
  name: 'compile-spec',
  description: 'The design engine: expands the palette, assigns the type scale, lays out blocks into editable elements, runs every check (exact texts, required colors, wrap-aware fit, overlap, contrast) and guarantees required colors reach the page.',
  inputs: '{ spec: DesignSpec }',
  run: ({ spec }) => {
    if (!spec || typeof spec !== 'object') return { ok: false, value: null, notes: ['no spec'] }
    const result = compileSpec(spec as DesignSpec)
    return {
      ok: result.checks.passed,
      value: { pages: result.pages, checks: result.checks, warnings: result.warnings },
      notes: result.checks.failures,
    }
  },
}

const wrapEstimateTool: DesignTool = {
  name: 'wrap-estimate',
  description: 'Greedy word-wrap estimate for a text at a box width/font size — how many lines the renderer will need (never truncates; the estimate is conservative).',
  inputs: '{ text: string, width: number, fontSize: number }',
  run: ({ text, width, fontSize }) => {
    const t = String(text ?? '')
    const w = Number(width) || 1
    const s = Number(fontSize) || 1
    const lines = wrapLines(t, w, s)
    return {
      ok: true,
      value: { lines: lines.length, widest: Math.max(...lines.map((l) => estimateTextWidth(l, s))) },
      notes: [],
    }
  },
}

const balanceReportTool: DesignTool = {
  name: 'balance-report',
  description: 'Composition balance diagnostics (advisory, warning-level): vertical coverage of the content, the PosterGen utilization-band analog — sparse (<60%) or crowded (>98%) compositions get a note.',
  inputs: '{ pages: PageData[], width: number, height: number }',
  run: ({ pages, width, height }) => {
    const pgs = Array.isArray(pages) ? (pages as PageData[]) : []
    const W = Number(width) || 1
    const H = Number(height) || 1
    if (!pgs[0]?.elements?.length) return { ok: true, value: { coverage: 0 }, notes: ['empty page'] }
    let minY = Infinity
    let maxY = -Infinity
    for (const el of pgs[0].elements) {
      const r = el as unknown as { x: number; y: number; width: number; height: number }
      minY = Math.min(minY, r.y)
      maxY = Math.max(maxY, r.y + r.height)
    }
    const coverage = Math.max(0, Math.min(1, (maxY - minY) / H))
    const notes: string[] = []
    if (coverage < 0.6) notes.push(`composition covers ${(coverage * 100).toFixed(0)}% of the height — sparse; consider more weight on content blocks`)
    if (coverage > 0.98) notes.push(`composition covers ${(coverage * 100).toFixed(0)}% of the height — crowded; tighten weights`)
    return { ok: true, value: { coverage: Number(coverage.toFixed(3)), width: W, height: H }, notes }
  },
}

/** The registry — every function the autonomous agent can use. The
 * MODEL seams (plan / revise / critique) are listed in
 * toolboxPromptSection() but executed by the pipeline through the
 * DesignAgentModel interface, never through this registry. */
export const DESIGN_TOOLS: readonly DesignTool[] = [
  extractBriefTool,
  parseSpecTool,
  compileSpecTool,
  wrapEstimateTool,
  balanceReportTool,
] as const

export const DESIGN_TOOL_MAP: ReadonlyMap<string, DesignTool> = new Map(DESIGN_TOOLS.map((t) => [t.name, t]))

/** The prompt catalog: what the planner is told it can do. Mirrors
 * toolsPromptSection() in the shipped agent. */
export function toolboxPromptSection(): string {
  const tools = DESIGN_TOOLS.map((t) => `  · ${t.name} (${t.inputs}) — ${t.description}`).join('\n')
  return [
    'The deterministic toolbox executing your plan (you choose semantics; the engine owns geometry, color and type):',
    tools,
    'Model seams the pipeline drives for you: plan (this call), revise (after check failures), critique (a vision model reviews the real render — advisory only).',
  ].join('\n')
}

/** Run a tool by name (registry discipline: unknown names fail
 * honestly, never guess). Exported for the pipeline and tests. */
export function runDesignTool(name: string, args: Record<string, unknown>): ToolRunResult {
  const tool = DESIGN_TOOL_MAP.get(name)
  if (!tool) return { ok: false, value: null, notes: [`unknown tool: ${name}`] }
  return tool.run(args)
}

// ── shared result types re-exported for the pipeline ─────────
export type { DesignBrief, DesignSpec, CompileResult, CompileChecks, PageData }
