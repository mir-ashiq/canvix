// ─────────────────────────────────────────────────────────────
// Canvix agentic design planning (Wave 4 — AI Power-Up).
//
// The in-app planner asks the text-slot provider for a STRUCTURED,
// multi-page design plan, then hands it to the user as an EDITABLE
// REVIEW GATE (toggle pages/elements, rewrite copy, recolor) before a
// single element lands on the canvas. This module owns the plan data
// model and the two pure transforms the feature rides on:
//
//   normalizePlan() — hostile-input-safe coercion of whatever JSON the
//                     model actually replied with (clamped geometry,
//                     validated fonts/colors, bounded page/element
//                     counts) into a DesignPlan
//   planToPages()   — the approved plan → real PageData with real
//                     editor elements (create* factories, fresh ids)
//
// The MCP generate_design tool keeps its own single-page normalizer
// (src/lib/mcp/tools.ts) — the shapes are deliberately similar so the
// prompt engineering carries over, but this module adds the review
// semantics (enabled flags, editable text) the gate needs.
// ─────────────────────────────────────────────────────────────

import { FONTS } from '@/lib/editor-utils'
import {
  createTextElement,
  createShapeElement,
  createTableElement,
  type AnyElement,
  type PageData,
} from '@/lib/types'

/** Review-gate caps — plans are drafts, not canvases. */
export const MAX_PLAN_PAGES = 6
export const MAX_PLAN_ELEMENTS_PER_PAGE = 30

export type PlanElementType = 'text' | 'rect' | 'ellipse' | 'triangle' | 'table'

export interface PlanElementSpec {
  /** Stable within the plan (`p2e7`) — the gate's React keys + toggles. */
  id: string
  type: PlanElementType
  /** Review gate: unchecked elements are skipped on apply. */
  enabled: boolean
  // text
  text?: string
  fontSize?: number
  fontFamily?: string
  bold?: boolean
  fill?: string
  align?: 'left' | 'center' | 'right'
  curve?: number
  // geometry (px on the plan's page)
  x: number
  y: number
  width: number
  height?: number
  cornerRadius?: number
  // table
  header?: string[]
  cells?: { text: string }[]
  rows?: number
  cols?: number
}

export type PlanBackground =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; from: string; to: string; angle: number }

export interface PlanPageSpec {
  id: string
  /** Short label for the review gate card ("Cover", "Pricing"). */
  title: string
  enabled: boolean
  background: PlanBackground
  elements: PlanElementSpec[]
}

export interface DesignPlan {
  name: string
  /** One-sentence intent — shown above the gate so the user can sanity-
   *  check what the agent set out to do before applying. */
  summary: string
  width: number
  height: number
  pages: PlanPageSpec[]
}

// ── coercion primitives (same semantics as the MCP normalizer) ──

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}
function asNumber(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : fallback
}
function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}
function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
function asHex(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim() : fallback
}
function asEnum<T extends readonly string[]>(v: unknown, options: T, fallback: T[number]): T[number] {
  return typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T[number]) : fallback
}
function knownFont(v: unknown): string | undefined {
  const name = asString(v)
  return FONTS.some((f) => (typeof f === 'string' ? f : f.family) === name) ? name : undefined
}

/** Fresh page/element ids — short, unique within a normalize pass. */
let idCounter = 0
function freshId(prefix: string): string {
  idCounter = (idCounter + 1) % 1_000_000
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}`
}

// ── normalizePlan ────────────────────────────────────────────

/** Coerce one raw element into a spec (or null when unusable). */
function normalizeElement(raw: unknown, width: number, height: number, index: number): PlanElementSpec | null {
  const el = (raw ?? {}) as Record<string, unknown>
  const type = asString(el.type, 'text')
  if (!['text', 'rect', 'ellipse', 'triangle', 'table'].includes(type)) return null

  const spec: PlanElementSpec = {
    id: `e${index}_${freshId('')}`,
    type: type as PlanElementType,
    enabled: true,
    x: clamp(asNumber(el.x, 60), 0, width),
    y: clamp(asNumber(el.y, 60), 0, height),
    width: clamp(asNumber(el.width, Math.round(width * 0.7)), 24, width * 1.3),
  }

  if (type === 'text') {
    spec.text = asString(el.text, 'Text').slice(0, 400)
    spec.fontSize = clamp(asNumber(el.fontSize, 40), 10, 280)
    spec.fontFamily = knownFont(el.fontFamily) ?? 'Poppins'
    spec.bold = asBool(el.bold, false)
    spec.fill = asHex(el.fill, '#1F2226')
    spec.align = asEnum(el.align, ['left', 'center', 'right'] as const, 'center')
    const curve = asNumber(el.curve, 0)
    if (Math.abs(curve) > 2) spec.curve = clamp(curve, -180, 180)
  } else if (type === 'table') {
    const header = Array.isArray(el.header)
      ? el.header.map((h) => asString(h).slice(0, 40)).slice(0, 6)
      : undefined
    const cells = Array.isArray(el.cells)
      ? (el.cells as Record<string, unknown>[]).slice(0, 120).map((c) => ({ text: asString(c.text).slice(0, 60) }))
      : undefined
    spec.header = header && header.length ? header : undefined
    spec.cells = cells && cells.length ? cells : undefined
    spec.rows = clamp(Math.round(asNumber(el.rows, 3)), 1, 12)
    spec.cols = clamp(header?.length ?? 3, 1, 6)
    spec.height = clamp(asNumber(el.height, spec.rows * 44), 44, height)
  } else {
    spec.height = clamp(asNumber(el.height, 200), 8, height * 1.5)
    spec.fill = asHex(el.fill, '#00C4CC')
    if (type === 'rect') spec.cornerRadius = clamp(asNumber(el.cornerRadius, 0), 0, 400)
  }
  return spec
}

/**
 * Coerce raw model output into a DesignPlan. Never throws — worst case
 * (no usable pages) it returns an empty single-page plan the gate can
 * still render (and the user can still apply as a blank starting point).
 */
export function normalizePlan(raw: unknown, width: number, height: number): DesignPlan {
  const spec = (raw ?? {}) as Record<string, unknown>
  const pagesRaw = Array.isArray(spec.pages) ? spec.pages.slice(0, MAX_PLAN_PAGES) : []
  const pages: PlanPageSpec[] = []

  pagesRaw.forEach((p, pi) => {
    const page = (p ?? {}) as Record<string, unknown>
    const elementsRaw = Array.isArray(page.elements) ? page.elements.slice(0, MAX_PLAN_ELEMENTS_PER_PAGE) : []
    const elements = elementsRaw
      .map((e, i) => normalizeElement(e, width, height, i))
      .filter((e): e is PlanElementSpec => e !== null)
    if (!elements.length) return // skip element-less pages entirely

    const bg = (page.background ?? {}) as Record<string, unknown>
    const background: PlanBackground =
      asString(bg.type, 'solid') === 'gradient'
        ? {
            type: 'gradient',
            from: asHex(bg.from, '#7630D7'),
            to: asHex(bg.to, '#02C0CC'),
            angle: clamp(asNumber(bg.angle, 135), 0, 360),
          }
        : { type: 'solid', color: asHex(bg.color, '#FFFFFF') }

    pages.push({
      id: `p${pi}_${freshId('')}`,
      title: asString(page.title, `Page ${pi + 1}`).slice(0, 40),
      enabled: true,
      background,
      elements,
    })
  })

  return {
    name: asString(spec.name, 'AI plan').slice(0, 80) || 'AI plan',
    summary: asString(spec.summary, '').slice(0, 300),
    width: clamp(Math.round(asNumber(spec.width, width)), 200, 8000) || width,
    height: clamp(Math.round(asNumber(spec.height, height)), 200, 8000) || height,
    pages,
  }
}

// ── planToPages ──────────────────────────────────────────────

/** The approved plan → real pages with real editor elements. */
export function planToPages(plan: DesignPlan): PageData[] {
  return plan.pages
    .filter((p) => p.enabled)
    .map((p) => {
      const elements: AnyElement[] = []
      for (const spec of p.elements) {
        if (!spec.enabled) continue
        if (spec.type === 'text') {
          elements.push(
            createTextElement({
              text: spec.text ?? 'Text',
              x: spec.x,
              y: spec.y,
              width: spec.width,
              fontSize: spec.fontSize ?? 40,
              fontFamily: spec.fontFamily ?? 'Poppins',
              bold: spec.bold ?? false,
              fill: spec.fill ?? '#1F2226',
              align: spec.align ?? 'center',
              ...(spec.curve !== undefined ? { curve: spec.curve } : {}),
            }),
          )
        } else if (spec.type === 'table') {
          elements.push(
            createTableElement({
              x: spec.x,
              y: spec.y,
              width: spec.width,
              rows: spec.rows ?? 3,
              cols: spec.cols ?? 3,
              rowHeight: 44,
              ...(spec.header ? { header: spec.header } : {}),
              ...(spec.cells ? { cells: spec.cells } : {}),
            }),
          )
        } else {
          elements.push(
            createShapeElement(spec.type, {
              x: spec.x,
              y: spec.y,
              width: spec.width,
              height: spec.height ?? 200,
              fill: spec.fill ?? '#00C4CC',
              ...(spec.type === 'rect' && spec.cornerRadius ? { cornerRadius: spec.cornerRadius } : {}),
            }),
          )
        }
      }
      return { id: freshId('page_'), background: p.background, elements }
    })
}

// ── the planner system prompt (shared contract with the model) ──

/** Build the system prompt for /api/ai/plan. Multi-page, review-gate
 *  aware. Kept next to the normalizer so the contract cannot drift. */
export function planSystemPrompt(width: number, height: number, pageCount: number): string {
  const fontList = FONTS.slice(0, 24)
    .map((f) => (typeof f === 'string' ? f : f.family))
    .join(', ')
  return [
    'You are a senior brand designer planning a Canvix design. Reply with ONLY a JSON object (no markdown fences) of shape:',
    '{"name":string,"summary":string,"pages":[{"title":string,"background":{"type":"solid","color":"#RRGGBB"}|{"type":"gradient","from":"#RRGGBB","to":"#RRGGBB","angle":number},"elements":[ ... ]}]}',
    `Element types (all coordinates in px on a ${width}x${height}px page):`,
    `{"type":"text","text":string,"x":n,"y":n,"width":n,"fontSize":n,"fontFamily":one of [${fontList}],"bold":bool,"fill":"#RRGGBB","align":"left|center|right"}`,
    '{"type":"rect","x":n,"y":n,"width":n,"height":n,"fill":"#RRGGBB","cornerRadius":n}',
    '{"type":"ellipse","x":n,"y":n,"width":n,"height":n,"fill":"#RRGGBB"}',
    '{"type":"triangle","x":n,"y":n,"width":n,"height":n,"fill":"#RRGGBB"}',
    `Plan for ${pageCount} page(s). Rules: max ${MAX_PLAN_ELEMENTS_PER_PAGE} elements per page, 60px margins, hex colors only, text must fit its width (estimate ~0.6*fontSize px per char), clear hierarchy and contrast, professionally designed. The user reviews and edits this plan before anything is applied, so use concise, final-quality copy.`,
  ].join('\n')
}
