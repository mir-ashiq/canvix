// ─────────────────────────────────────────────────────────────
// Agent tools (v0.27) — the registry the agent loop draws from.
//
// Every tool is PURE: a name, a human/model-facing description, a risk
// tier, an args sanitizer, and a compiler that emits one or more
// DesignActions. The client executes those through applyDesignAction —
// the same double-validated, undoable, collab-synced path a user action
// rides (docs/AGENT-ARCHITECTURE.md §7). Nothing here touches the store,
// the network, or the document.
//
// Sanitizer discipline (tldraw's sanitizeAction + Loomic's actionable
// errors): a rejection returns a message that TELLS THE MODEL HOW TO
// FIX THE CALL ("fontSize must be 6–400; you sent 1200") so the next
// step self-corrects instead of flailing.
// ─────────────────────────────────────────────────────────────

import { FONTS } from '@/lib/fonts/catalog'
import type { ToolRisk } from './protocol'
import { repairPlanBands } from './plan-repair'

export interface AgentTool {
  name: string
  /** one-line description for the system prompt */
  description: string
  risk: ToolRisk
  /** JSON-ish arg spec shown to the model (keys, types, enums). */
  argsSpec: string
  /**
   * Validate + normalize raw model args. Returns
   *   { ok: true, actions, observation } — actions are DesignAction
   *   objects (untyped here: the client's applyDesignAction re-validates
   *   everything again before touching the document)
   *   { ok: false, error } — an actionable message for the model.
   */
  sanitize: (args: Record<string, unknown>, ctx: ToolContext) => SanitizeResult
}

export interface ToolContext {
  /** ids that exist on the current page (flattened, groups included) */
  validIds: Set<string>
  /** the page dimensions */
  width: number
  height: number
  /** fonts available in the catalog (family names) */
  fonts: Set<string>
  /** v0.32.6 · the CANVAS MAP: existing elements' occupied vertical
   *  bands (merged, disjoint — see plan-repair.ts). The plan solver
   *  fits new sections into the FREE space between them so nothing
   *  is planned on top of existing content. */
  occupied?: { y: number; h: number; label?: string }[]
}

export type SanitizeResult =
  | { ok: true; actions: Record<string, unknown>[]; observation: string }
  | { ok: false; error: string }

// ── shared arg readers ───────────────────────────────────────

function str(args: Record<string, unknown>, key: string, max = 400): string {
  const v = args[key]
  return typeof v === 'string' ? v.slice(0, max) : ''
}

function num(args: Record<string, unknown>, key: string): number | null {
  const v = args[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

function bool(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

function hex(args: Record<string, unknown>, key: string, fallback: string | null = null): string | null {
  const v = args[key]
  return typeof v === 'string' && HEX_RE.test(v.trim()) ? v.trim().toLowerCase() : fallback
}

function idList(args: Record<string, unknown>, ctx: ToolContext, key = 'ids'): { ids: string[]; error?: string } {
  const raw = args[key]
  if (!Array.isArray(raw)) {
    return { ids: [], error: `"${key}" must be an array of element ids.` }
  }
  const ids: string[] = []
  const invalid: string[] = []
  for (const v of raw.slice(0, 60)) {
    if (typeof v !== 'string') continue
    if (ctx.validIds.has(v)) {
      ids.push(v)
      continue
    }
    // v0.32.8 · the `type#id` alias. The serialized context, the audit
    // findings and the overlap reports all print ids as `text#abc123`;
    // an edit run that copies that notation verbatim was rejected
    // three times in a row and died at STRIKES (the "fix issues"
    // incident). Strip the prefix and accept the bare id — the same
    // alias discipline as the color/fontColor/textColor patch aliases.
    const bare = v.includes('#') ? v.slice(v.indexOf('#') + 1) : ''
    if (bare && ctx.validIds.has(bare)) ids.push(bare)
    else invalid.push(v)
  }
  if (ids.length === 0) {
    return {
      ids: [],
      error:
        invalid.length > 0
          ? `None of those element ids exist on the current page (invalid: ${invalid.slice(0, 3).join(', ')}). Call get_page_state first and use the exact ids it returns.`
          : `"${key}" is empty — pass element ids from get_page_state.`,
    }
  }
  return { ids }
}

function enumVal<T extends string>(args: Record<string, unknown>, key: string, allowed: readonly T[], fallback: T): T {
  const v = args[key]
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

/** Strict enum: either a valid member or an actionable error (the
 *  silent fallback would let "hexagon" silently become "rect" —
 *  caught by the v0.28 harness). */
function enumStrict<T extends string>(args: Record<string, unknown>, key: string, allowed: readonly T[]): { value: T } | { error: string } {
  const v = args[key]
  if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return { value: v as T }
  return { error: `"${key}" must be one of ${allowed.join('|')}; you sent ${JSON.stringify(v) ?? 'nothing'}.` }
}

// ── the registry ─────────────────────────────────────────────

export const AGENT_TOOLS: AgentTool[] = [
  // ── read-only ──────────────────────────────────────────────
  {
    name: 'get_page_state',
    description: 'Re-read the current page: elements (id, type, bbox, text, fill), selection, spatial analysis (overlaps, off-canvas). Use after edits to verify, or when your element ids may be stale.',
    risk: 'read',
    argsSpec: '{}',
    sanitize: (_args, _ctx) => ({
      ok: true,
      actions: [{ type: '__getContext' }],
      observation: 'Fresh page state attached as the next observation.',
    }),
  },
  {
    // v0.32.4: the sanitizer's font errors have pointed at
    // "list_fonts" since v0.29 — but the tool never existed, so the
    // model was directed at a phantom. The catalog holds 369
    // families; the system prompt shows a sample, this tool streams
    // the rest (searchable, capped) — progressive capability
    // discovery without bloating every turn.
    name: 'list_fonts',
    description: `List available font families (${FONTS.length} in the catalog). Optional {query} filters by substring (case-insensitive); {limit} caps the count (default 60, max 120). Use EXACT names in add_text/set_text_style.`,
    risk: 'read',
    argsSpec: '{query?: string, limit?: 1-120}',
    sanitize: (args, _ctx) => {
      const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
      const limitRaw = num(args, 'limit')
      const limit = limitRaw === null ? 60 : Math.max(1, Math.min(120, Math.round(limitRaw)))
      let families = FONTS.map((f) => f.family)
      if (query) families = families.filter((f) => f.toLowerCase().includes(query))
      const slice = families.slice(0, limit)
      const head = query
        ? `Fonts matching "${query}" (${slice.length}${families.length > slice.length ? ` of ${families.length}` : ''}):`
        : `Font families (${slice.length}${families.length > slice.length ? ` of ${families.length} — refine with {query}` : ''}):`
      return {
        ok: true,
        actions: [],
        observation: families.length
          ? `${head} ${slice.join(', ')}.`
          : `No font family matches "${query}". Try the system prompt's sample, or query a shorter substring.`,
      }
    },
  },
  {
    // v0.29.3: brief-to-layout planning. The model reserves the
    // composition BEFORE building — the failed production runs
    // placed text reactively (add → overlap → move → overlap…) for
    // 40+ steps. A plan is displayed to the user and echoed back.
    name: 'plan_layout',
    description:
      'Plan the composition before building: page background, sections with y-ranges and heights, and what each section contains. REQUIRED as the first call of a create run — reserve a vertical band per section (headline, tagline, features, mockup, CTA, footer). The SERVER computes the exact y-positions: with ≥40px gaps into the safe area, and on a canvas that already has content, into the FREE space between existing elements (never on top of them) — supply names, heights and order; approximate y is fine.',
    risk: 'read',
    argsSpec: '{background?: "#RRGGBB", sections: [{name: string, y: number, height: number, contains: string}], notes?: string}',
    sanitize: (args, ctx) => {
      const sectionsRaw = args.sections
      if (!Array.isArray(sectionsRaw) || sectionsRaw.length === 0) {
        return { ok: false, error: '"sections" must be a non-empty array: [{name, y, height, contains}].' }
      }
      const H = ctx.height
      // parse the requested sections (name + numeric y/height + the
      // model's own `contains` notes). Malformed entries are hard
      // errors — GEOMETRY, however, is no longer the model's job.
      const parsed: { name: string; y: number; h: number; contains: string }[] = []
      for (const s of sectionsRaw.slice(0, 12)) {
        if (!s || typeof s !== 'object') continue
        const sec = s as Record<string, unknown>
        const name = typeof sec.name === 'string' ? sec.name.trim().slice(0, 40) : ''
        const y = num(sec, 'y')
        const height = num(sec, 'height')
        const contains = typeof sec.contains === 'string' ? sec.contains.trim().slice(0, 80) : ''
        if (!name) return { ok: false, error: 'Each section needs a "name".' }
        if (y === null || height === null || height <= 0) {
          return { ok: false, error: `Section "${name}" needs numeric y and height (> 0).` }
        }
        parsed.push({ name, y, h: Math.round(height), contains })
      }
      if (!parsed.length) return { ok: false, error: '"sections" contained no usable entries.' }

      // v0.32.5 · THE P0 REGRESSION FIX: the v0.32.4 validator
      // rejected bad geometry and told the model to redo the gap
      // arithmetic. A model that could NOT do that arithmetic failed
      // plan_layout three times in a row and the run died with ZERO
      // elements — on the panel's own coffee-launch suggestion.
      // Forcing the model to compute geometry was the bug: the
      // SERVER computes it now (plan-repair.ts, pure + deterministic).
      //   · valid plan          → accepted unchanged
      //   · invalid but fitting → AUTO-REPAIRED y-positions and gaps
      //                           (heights, order, contents kept) and
      //                           the repair is DISCLOSED — the model
      //                           builds from the repaired bands
      //   · cannot fit          → honest infeasibility with the exact
      //                           math (the model shrinks or drops
      //                           sections — never a fabrication)
      // v0.32.6 · the CANVAS MAP: on a canvas that already has
      // content, ctx.occupied carries the existing elements' bands;
      // the solver fits the requested sections into the FREE space
      // between them — the plan can never reserve space on top of
      // something that is already there.
      const repair = repairPlanBands(
        parsed.map((p) => ({ name: p.name, y: p.y, h: p.h })),
        H,
        { occupied: ctx.occupied },
      )
      if (!repair.ok) {
        return {
          ok: false,
          error: `${repair.infeasible} Resend plan_layout with smaller section heights (keep the names and order).`,
        }
      }

      // the plan lines are the REPAIRED geometry — the authoritative
      // bands the model must build inside (no model arithmetic).
      const lines: string[] = []
      const bg = hex(args, 'background')
      if (bg) lines.push(`page background ${bg}`)
      for (const b of repair.bands) {
        const c = parsed.find((p) => p.name === b.name)
        lines.push(`${b.name}: y=${Math.round(b.y)} h=${Math.round(b.h)}${c?.contains ? ` — ${c.contains}` : ''}`)
      }
      const notes = typeof args.notes === 'string' ? args.notes.trim().slice(0, 200) : ''
      if (notes) lines.push(`notes: ${notes}`)

      // the canvas map disclosure: what is already on the page and
      // where the free space is — visible to the user AND the model
      const occupied = ctx.occupied ?? []
      const mapNote = occupied.length
        ? `CANVAS MAP — existing elements occupy y ${occupied.map((o) => `${Math.round(o.y)}–${Math.round(o.y + o.h)}${o.label ? ` (${o.label})` : ''}`).join(', ')}; your sections were fitted into the FREE space (never on top of them).`
        : ''
      const repairedNote = repair.repairs.length
        ? `PLAN AUTO-REPAIRED (your heights, order and contents were kept; the SERVER computed valid positions): ${repair.repairs.join('; ')}. Build inside these exact bands — do not recompute them.`
        : 'Bands verified: non-overlapping, ≥40px gaps, inside the safe area. Build inside these exact bands.'
      const observation = `${mapNote ? `${mapNote}\n` : ''}PLAN RECORDED (${lines.length} lines):\n${lines.join('\n')}\n${repairedNote}`
      return {
        ok: true,
        actions: [{ type: '__planLayout', lines, bands: repair.bands }],
        observation,
      }
    },
  },

  // ── add elements ───────────────────────────────────────────
  {
    name: 'add_text',
    description: 'Add a text box. Positions are px on the page; estimate width ≈ 0.6 × fontSize × chars.',
    risk: 'write',
    argsSpec: '{text: string, x?: number, y?: number, width?: number, fontSize?: 6-400, fontFamily?: string, bold?: bool, color?: "#RRGGBB", align?: "left"|"center"|"right", yBand?: "top"|"center"|"bottom"}',
    sanitize: (args, ctx) => {
      const text = str(args, 'text', 400).trim()
      if (!text) return { ok: false, error: 'text must be a non-empty string (max 400 chars).' }
      const fontSize = num(args, 'fontSize')
      if (fontSize !== null && (fontSize < 6 || fontSize > 400)) {
        return { ok: false, error: `fontSize must be 6–400; you sent ${fontSize}.` }
      }
      const font = str(args, 'fontFamily', 60)
      if (font && !ctx.fonts.has(font)) {
        return { ok: false, error: `Unknown fontFamily "${font}". Valid examples: ${[...ctx.fonts].slice(0, 6).join(', ')}. (Full list via list_fonts.)` }
      }
      const color = hex(args, 'color')
      if (args.color !== undefined && !color) {
        return { ok: false, error: 'color must be a #RRGGBB hex string, e.g. "#7D2AE8".' }
      }
      const x = num(args, 'x')
      const y = num(args, 'y')
      const width = num(args, 'width')
      if (width !== null && (width < 24 || width > ctx.width * 1.5)) {
        return { ok: false, error: `width must be 24–${Math.round(ctx.width * 1.5)}px on this page; you sent ${Math.round(width)}.` }
      }
      const yBand = enumVal(args, 'yBand', ['top', 'center', 'bottom'] as const, 'center')
      return {
        ok: true,
        actions: [
          {
            type: 'addText',
            text,
            ...(fontSize !== null ? { fontSize: clamp(fontSize, 6, 400) } : {}),
            ...(font ? { font: fontFamilyOf(font) } : {}),
            ...(bool(args, 'bold') ? { bold: true } : {}),
            ...(color ? { color } : {}),
            ...(x !== null ? { x: clamp(x, -ctx.width, ctx.width) } : {}),
            ...(y !== null ? { y: clamp(y, -ctx.height, ctx.height) } : {}),
            ...(width !== null ? { width: clamp(width, 24, ctx.width * 1.5) } : {}),
            align: enumVal(args, 'align', ['left', 'center', 'right'] as const, 'center'),
            // the y band only rides along when no exact y was given
            ...(y === null ? { y: yBand } : {}),
          },
        ],
        observation: `Text box "${text.slice(0, 40)}" added.`,
      }
    },
  },
  {
    name: 'add_shape',
    description: 'Add a shape: rect, ellipse, triangle, star, line, or rounded rect with a fill.',
    risk: 'write',
    argsSpec: '{shape: "rect"|"ellipse"|"triangle"|"star"|"line", x: number, y: number, width: number, height: number, fill?: "#RRGGBB", cornerRadius?: number, rotation?: deg}',
    sanitize: (args, ctx) => {
      const shape = enumVal(args, 'shape', ['rect', 'ellipse', 'triangle', 'star', 'line'] as const, '' as never)
      if (!shape) return { ok: false, error: 'shape must be one of: rect, ellipse, triangle, star, line.' }
      const x = num(args, 'x')
      const y = num(args, 'y')
      const w = num(args, 'width')
      const h = num(args, 'height')
      if (x === null || y === null || w === null || h === null) {
        return { ok: false, error: 'x, y, width and height are required numbers (px on the page).' }
      }
      if (w < 4 || h < 4) return { ok: false, error: `width/height must be ≥ 4px; you sent ${Math.round(w)}×${Math.round(h)}.` }
      const fill = hex(args, 'fill')
      if (args.fill !== undefined && !fill) return { ok: false, error: 'fill must be #RRGGBB, e.g. "#FF5C8A".' }
      const rotation = num(args, 'rotation')
      const cornerRadius = num(args, 'cornerRadius')
      return {
        ok: true,
        actions: [
          {
            type: 'addShape',
            shape,
            x: clamp(x, -ctx.width, ctx.width),
            y: clamp(y, -ctx.height, ctx.height),
            width: clamp(w, 4, ctx.width * 2),
            height: clamp(h, 4, ctx.height * 2),
            ...(fill ? { fill } : {}),
            ...(cornerRadius !== null ? { cornerRadius: clamp(cornerRadius, 0, 200) } : {}),
            ...(rotation !== null ? { rotation: clamp(rotation, -360, 360) } : {}),
          },
        ],
        observation: `${shape} added at (${Math.round(x)},${Math.round(y)}) ${Math.round(w)}×${Math.round(h)}.`,
      }
    },
  },
  {
    name: 'add_image',
    description: 'Add an image: generate one with AI (prompt) — the only mode in v0.27. A placeholder appears immediately; the image swaps in when ready. For real photos prefer add_stock_photo.',
    risk: 'write',
    argsSpec: '{prompt: string, x?: number, y?: number, width?: number}',
    sanitize: (args, ctx) => {
      const prompt = str(args, 'prompt', 400).trim()
      if (prompt.length < 4) return { ok: false, error: 'prompt must describe the image (min 4 chars).' }
      const x = num(args, 'x')
      const y = num(args, 'y')
      const width = num(args, 'width')
      return {
        ok: true,
        actions: [
          {
            type: 'generateImage',
            prompt,
            ...(x !== null ? { x: clamp(x, 0, ctx.width) } : {}),
            ...(y !== null ? { y: clamp(y, 0, ctx.height) } : {}),
            ...(width !== null ? { width: clamp(width, 40, ctx.width) } : {}),
          },
        ],
        observation: `Image generation started for: "${prompt.slice(0, 60)}".`,
      }
    },
  },
  {
    // v0.27.3: the stock-photo rail (Pexels/Pixabay) existed as an app
    // but the agent couldn't reach it — "add a photo of a coffee shop"
    // forced AI generation. The client action runs the SAME search +
    // download + media-store path PhotosPanel uses (licensed, credited,
    // deduped), so the agent gets real photography with zero new trust
    // surface: the server never calls the stock APIs.
    name: 'add_stock_photo',
    description: 'Search licensed stock photography (Pexels/Pixabay) and place the best match: real photos, correct aspect ratio, attribution stored on the element. Use for concrete subjects (a coffee cup, a laptop, a mountain); use add_image for abstract/stylized art.',
    risk: 'write',
    argsSpec: '{query: string, orientation?: "landscape"|"portrait"|"square", x?: number, y?: number, width?: number}',
    sanitize: (args, ctx) => {
      const query = str(args, 'query', 120).trim()
      if (query.length < 2) return { ok: false, error: 'query must describe the photo (min 2 chars), e.g. "coffee cup on table".' }
      const orientation = enumVal(args, 'orientation', ['landscape', 'portrait', 'square'] as const, '' as never)
      const x = num(args, 'x')
      const y = num(args, 'y')
      const width = num(args, 'width')
      return {
        ok: true,
        actions: [
          {
            type: 'addStockPhoto',
            query,
            ...(orientation ? { orientation } : {}),
            ...(x !== null ? { x: clamp(x, 0, ctx.width) } : {}),
            ...(y !== null ? { y: clamp(y, 0, ctx.height) } : {}),
            ...(width !== null ? { width: clamp(width, 40, ctx.width) } : {}),
          },
        ],
        observation: `Stock photo search queued for "${query.slice(0, 60)}" — it downloads and appears in place.`,
      }
    },
  },
  {
    name: 'add_sticker',
    description: 'Add an emoji sticker (e.g. "🚀", "✨"). Fast, no AI generation.',
    risk: 'write',
    argsSpec: '{emoji: string, x?: number, y?: number, size?: 24-400}',
    sanitize: (args, ctx) => {
      const emoji = str(args, 'emoji', 8).trim()
      if (!emoji) return { ok: false, error: 'emoji is required, e.g. "🚀".' }
      const x = num(args, 'x')
      const y = num(args, 'y')
      const size = num(args, 'size')
      if (size !== null && (size < 24 || size > 400)) return { ok: false, error: `size must be 24–400; you sent ${size}.` }
      return {
        ok: true,
        actions: [
          {
            type: 'addSticker',
            emoji,
            ...(x !== null ? { x: clamp(x, -ctx.width, ctx.width) } : {}),
            ...(y !== null ? { y: clamp(y, -ctx.height, ctx.height) } : {}),
            ...(size !== null ? { size: clamp(size, 24, 400) } : {}),
          },
        ],
        observation: `Sticker ${emoji} added.`,
      }
    },
  },
  {
    name: 'add_table',
    description: 'Add a data table with a header row.',
    risk: 'write',
    argsSpec: '{header: string[], rows: string[][], x?: number, y?: number, width?: number}',
    sanitize: (args, ctx) => {
      const header = Array.isArray(args.header) ? args.header.map((h) => String(h).slice(0, 40)).slice(0, 6) : []
      const rows = Array.isArray(args.rows)
        ? args.rows.slice(0, 12).map((r) => (Array.isArray(r) ? r.map((c) => String(c).slice(0, 40)) : []))
        : []
      if (header.length < 1) return { ok: false, error: 'header must be a non-empty array of column names (max 6).' }
      if (rows.length < 1) return { ok: false, error: 'rows must be an array of arrays (max 12 rows).' }
      const x = num(args, 'x')
      const y = num(args, 'y')
      const width = num(args, 'width')
      return {
        ok: true,
        actions: [
          {
            type: 'addTable',
            header,
            rows,
            ...(x !== null ? { x: clamp(x, 0, ctx.width) } : {}),
            ...(y !== null ? { y: clamp(y, 0, ctx.height) } : {}),
            ...(width !== null ? { width: clamp(width, 120, ctx.width) } : {}),
          },
        ],
        observation: `Table ${header.length}×${rows.length + 1} added.`,
      }
    },
  },

  // ── edit elements ──────────────────────────────────────────
  {
    name: 'update_elements',
    description: 'Patch properties of elements by id: geometry (x,y,width,height,rotation), style (fill,fontSize,bold,italic,underline,strike,uppercase,align,lineHeight,letterSpacing,curve,text), image (flipH,flipV,brightness,contrast,saturation), layer (locked,visible,opacity).',
    risk: 'write',
    argsSpec: '{ids: string[], patch: {x?, y?, width?, height?, rotation?, text?, fill?, fontSize?, bold?, italic?, underline?, strike?, uppercase?, align?, lineHeight?, letterSpacing?, curve?, flipH?, flipV?, brightness?, contrast?, saturation?, locked?, visible?, opacity?}}',
    sanitize: (args, ctx) => {
      const { ids, error } = idList(args, ctx)
      if (error) return { ok: false, error }
      const patchRaw = args.patch
      if (!patchRaw || typeof patchRaw !== 'object' || Array.isArray(patchRaw)) {
        return { ok: false, error: 'patch must be an object of property → value, e.g. {"fill":"#7D2AE8"}.' }
      }
      const patch: Record<string, unknown> = {}
      const p = patchRaw as Record<string, unknown>
      // v0.29.2 (prod eval): models habitually spell the text colour
      // `color` / `fontColor` / `textColor`. Map the aliases instead of
      // striking — a rejected patch burned three strikes on canvix.app
      // and killed an otherwise-complete design.
      for (const alias of ['color', 'fontColor', 'textColor'] as const) {
        if (p[alias] !== undefined && p.fill === undefined) p.fill = p[alias]
      }
      for (const key of ['x', 'y', 'width', 'height', 'rotation', 'lineHeight', 'letterSpacing', 'curve'] as const) {
        if (p[key] !== undefined) {
          const v = num(p as Record<string, unknown>, key)
          if (v === null) return { ok: false, error: `patch.${key} must be a number; you sent ${JSON.stringify(p[key])}.` }
          patch[key] = v
        }
      }
      if (p.curve !== undefined && (Number(p.curve) < -180 || Number(p.curve) > 180)) {
        return { ok: false, error: `patch.curve must be −180..180 degrees; you sent ${JSON.stringify(p.curve)}.` }
      }
      for (const key of ['brightness', 'contrast', 'saturation'] as const) {
        if (p[key] !== undefined) {
          const v = num(p, key)
          if (v === null || v < -100 || v > 100) return { ok: false, error: `patch.${key} must be −100..100; you sent ${JSON.stringify(p[key])}.` }
          patch[key] = v
        }
      }
      if (p.fontSize !== undefined) {
        const v = num(p as Record<string, unknown>, 'fontSize')
        if (v === null || v < 6 || v > 400) return { ok: false, error: `patch.fontSize must be 6–400; you sent ${JSON.stringify(p.fontSize)}.` }
        patch.fontSize = v
      }
      if (p.opacity !== undefined) {
        const v = num(p as Record<string, unknown>, 'opacity')
        if (v === null || v < 0 || v > 1) return { ok: false, error: `patch.opacity must be 0–1; you sent ${JSON.stringify(p.opacity)}.` }
        patch.opacity = v
      }
      if (p.text !== undefined) patch.text = String(p.text).slice(0, 400)
      if (p.fill !== undefined) {
        const c = hex(p as Record<string, unknown>, 'fill')
        if (!c) return { ok: false, error: `patch.fill must be #RRGGBB; you sent ${JSON.stringify(p.fill)}.` }
        patch.fill = c
      }
      for (const flag of ['bold', 'italic', 'underline', 'strike', 'uppercase', 'flipH', 'flipV', 'locked', 'visible'] as const) {
        if (p[flag] !== undefined) patch[flag] = p[flag] === true
      }
      if (p.align !== undefined) patch.align = enumVal(p as Record<string, unknown>, 'align', ['left', 'center', 'right'] as const, 'center')
      if (Object.keys(patch).length === 0) {
        const sent = Object.keys(p).filter((k) => k !== 'ids')
        const valid = ['x', 'y', 'width', 'height', 'rotation', 'text', 'fill', 'fontSize', 'bold', 'italic', 'underline', 'strike', 'uppercase', 'align', 'lineHeight', 'letterSpacing', 'curve', 'flipH', 'flipV', 'brightness', 'contrast', 'saturation', 'locked', 'visible', 'opacity']
        return {
          ok: false,
          error: `patch had no supported property. You sent: [${sent.join(', ')}]. Valid properties: [${valid.join(', ')}]. The text colour property is named fill.`,
        }
      }
      return {
        ok: true,
        actions: [{ type: 'updateElements', ids, patch }],
        observation: `Updated ${ids.length} element${ids.length > 1 ? 's' : ''}: ${Object.keys(patch).join(', ')}.`,
      }
    },
  },
  {
    name: 'set_text_style',
    description: 'Restyle text elements: font family, size, bold, color — per id list. For "all headings" prefer recolor/set_font.',
    risk: 'write',
    argsSpec: '{ids: string[], fontFamily?: string, fontSize?: 6-400, bold?: bool, color?: "#RRGGBB"}',
    sanitize: (args, ctx) => {
      const { ids, error } = idList(args, ctx)
      if (error) return { ok: false, error }
      const patch: Record<string, unknown> = {}
      const font = str(args, 'fontFamily', 60)
      if (font) {
        if (!ctx.fonts.has(font)) return { ok: false, error: `Unknown fontFamily "${font}". Examples: ${[...ctx.fonts].slice(0, 6).join(', ')}.` }
        patch.fontFamily = font
      }
      const fontSize = num(args, 'fontSize')
      if (fontSize !== null) {
        if (fontSize < 6 || fontSize > 400) return { ok: false, error: `fontSize must be 6–400; you sent ${fontSize}.` }
        patch.fontSize = fontSize
      }
      if (bool(args, 'bold')) patch.bold = true
      else if (args.bold === false) patch.bold = false
      const color = hex(args, 'color')
      if (color) patch.fill = color
      if (Object.keys(patch).length === 0) return { ok: false, error: 'Set at least one of fontFamily, fontSize, bold, color.' }
      return {
        ok: true,
        actions: [{ type: 'updateElements', ids, patch }],
        observation: `Restyled ${ids.length} text element(s): ${Object.keys(patch).join(', ')}.`,
      }
    },
  },
  {
    name: 'move_elements',
    description: 'Move elements by delta (dx/dy px) or snap to a band: top/middle/bottom/left/center/right.',
    risk: 'write',
    argsSpec: '{ids: string[], dx?: number, dy?: number, to?: "top"|"middle"|"bottom"|"left"|"center"|"right"}',
    sanitize: (args, ctx) => {
      const { ids, error } = idList(args, ctx)
      if (error) return { ok: false, error }
      const dx = num(args, 'dx')
      const dy = num(args, 'dy')
      const to = enumVal(args, 'to', ['top', 'middle', 'bottom', 'left', 'center', 'right'] as const, '' as never)
      if (!to && dx === null && dy === null) {
        return { ok: false, error: 'Pass dx/dy (px deltas) or to (a snap band: top/middle/bottom/left/center/right).' }
      }
      return {
        ok: true,
        actions: [
          {
            type: 'moveElements',
            ids,
            ...(dx !== null ? { dx: clamp(dx, -ctx.width * 2, ctx.width * 2) } : {}),
            ...(dy !== null ? { dy: clamp(dy, -ctx.height * 2, ctx.height * 2) } : {}),
            ...(to ? { to } : {}),
          },
        ],
        observation: to ? `Moved ${ids.length} element(s) to ${to}.` : `Moved ${ids.length} element(s) by (${dx ?? 0},${dy ?? 0}).`,
      }
    },
  },
  {
    name: 'align_elements',
    description: 'Align elements to each other or the page: left|cx|right|top|cy|bottom.',
    risk: 'write',
    argsSpec: '{ids: string[], mode: "left"|"cx"|"right"|"top"|"cy"|"bottom"}',
    sanitize: (args, ctx) => {
      const { ids, error } = idList(args, ctx)
      if (error) return { ok: false, error }
      const mode = enumVal(args, 'mode', ['left', 'cx', 'right', 'top', 'cy', 'bottom'] as const, '' as never)
      if (!mode) return { ok: false, error: 'mode must be one of left, cx, right, top, cy, bottom.' }
      return {
        ok: true,
        actions: [{ type: 'alignElements', ids, mode }],
        observation: `Aligned ${ids.length} element(s) ${mode}.`,
      }
    },
  },
  {
    name: 'distribute_elements',
    description: 'Distribute ≥3 elements evenly along an axis.',
    risk: 'write',
    argsSpec: '{ids: string[], axis: "x"|"y"}',
    sanitize: (args, ctx) => {
      const { ids, error } = idList(args, ctx)
      if (error) return { ok: false, error }
      // the client's distributeElements needs ≥3 boxes — 2 has no gap
      // to even out (use align_elements or move_elements instead)
      if (ids.length < 3) {
        return {
          ok: false,
          error:
            ids.length === 2
              ? 'distribute needs 3+ element ids — with 2, use align_elements (e.g. mode "cy") or move_elements instead.'
              : 'distribute needs at least 3 element ids.',
        }
      }
      const axis = enumVal(args, 'axis', ['x', 'y'] as const, 'x')
      return {
        ok: true,
        actions: [{ type: 'distributeElements', ids, axis }],
        observation: `Distributed ${ids.length} elements evenly on ${axis}.`,
      }
    },
  },

  // ── page-level ─────────────────────────────────────────────
  {
    name: 'set_background',
    description: 'Set the page background: solid color or a two-stop gradient.',
    risk: 'write',
    argsSpec: '{kind: "solid"|"gradient", from: "#RRGGBB", to?: "#RRGGBB", angle?: deg}',
    sanitize: (args) => {
      const kind = enumVal(args, 'kind', ['solid', 'gradient'] as const, '' as never)
      if (!kind) return { ok: false, error: 'kind must be "solid" or "gradient".' }
      const from = hex(args, 'from')
      if (!from) return { ok: false, error: 'from must be a #RRGGBB color, e.g. "#0D1117".' }
      const to = hex(args, 'to')
      if (kind === 'gradient' && !to) return { ok: false, error: 'gradient needs "to" as #RRGGBB.' }
      if (args.to !== undefined && !to) return { ok: false, error: 'to must be #RRGGBB.' }
      const angle = num(args, 'angle')
      return {
        ok: true,
        actions: [
          {
            type: 'setBackground',
            kind,
            from,
            ...(to ? { to } : {}),
            ...(angle !== null ? { angle: clamp(angle, 0, 360) } : {}),
          },
        ],
        observation: `Background set to ${kind} ${from}${to ? ` → ${to}` : ''}.`,
      }
    },
  },
  {
    name: 'set_font',
    description: 'Swap fonts across the page: all text, or only headings (fontSize ≥ 32), or only body.',
    risk: 'write',
    argsSpec: '{fontFamily: string, targets: "all"|"headings"|"body"}',
    sanitize: (args, ctx) => {
      const font = str(args, 'fontFamily', 60)
      if (!ctx.fonts.has(font)) {
        return { ok: false, error: `Unknown fontFamily "${font || '(missing)'}". Examples: ${[...ctx.fonts].slice(0, 8).join(', ')}. Use list_fonts for the full set.` }
      }
      const targets = enumVal(args, 'targets', ['all', 'headings', 'body'] as const, 'all')
      return {
        ok: true,
        actions: [{ type: 'setFont', fontFamily: font, targets }],
        observation: `Font ${targets} → ${font}.`,
      }
    },
  },
  {
    name: 'recolor',
    description: 'Recolor: all headings, all text, or a suggested palette for the whole page.',
    risk: 'write',
    argsSpec: '{color: "#RRGGBB", targets: "headings"|"text"} | {palette: ["#RRGGBB" × 3-5]}',
    sanitize: (args) => {
      const color = hex(args, 'color')
      if (color) {
        const targets = enumVal(args, 'targets', ['headings', 'text'] as const, 'headings')
        return {
          ok: true,
          actions: [{ type: targets === 'headings' ? 'setHeadingsColor' : 'setTextColor', color }],
          observation: `${targets === 'headings' ? 'Headings' : 'All text'} → ${color}.`,
        }
      }
      const paletteRaw = args.palette
      if (Array.isArray(paletteRaw)) {
        const palette = paletteRaw.filter((c): c is string => typeof c === 'string' && HEX_RE.test(c)).slice(0, 5)
        if (palette.length < 3) {
          return { ok: false, error: 'palette must be 3–5 #RRGGBB colors, e.g. ["#7D2AE8","#02C0CC","#FFD166"].' }
        }
        return {
          ok: true,
          actions: [{ type: 'suggestPalette', colors: palette }],
          observation: `Palette suggested: ${palette.join(' ')}.`,
        }
      }
      return { ok: false, error: 'Pass color (#RRGGBB) with targets, or a palette array of 3–5 colors.' }
    },
  },
  {
    name: 'add_page',
    description: 'Append a new blank page, then goto_page to edit it.',
    risk: 'write',
    argsSpec: '{}',
    sanitize: () => ({ ok: true, actions: [{ type: 'addPage' }], observation: 'New page appended (last page). Use goto_page to switch to it before adding elements.' }),
  },
  {
    name: 'duplicate_page',
    description: 'Duplicate the current page (then edit the copy).',
    risk: 'write',
    argsSpec: '{}',
    sanitize: () => ({ ok: true, actions: [{ type: 'duplicatePage' }], observation: 'Current page duplicated (the copy is the last page). Use goto_page to switch to it.' }),
  },
  {
    // v0.27.3: without page navigation, add_page was a dead end — the
    // agent could append a page but every subsequent tool still edited
    // the OLD page. goto_page closes the loop; the client action is
    // bounds-checked against the live document.
    name: 'goto_page',
    description: 'Switch the editor to a page by 1-based number, then call get_page_state — element ids are per-page and change with the switch. The context lists "editing page N" and one-line summaries of the others.',
    risk: 'read',
    argsSpec: '{page: number (1-based)}',
    sanitize: (args) => {
      const page = num(args, 'page')
      if (page === null || !Number.isInteger(page) || page < 1 || page > 60) {
        return { ok: false, error: 'page must be an integer 1–60 (1-based; the context shows how many pages exist).' }
      }
      return {
        ok: true,
        actions: [{ type: 'gotoPage', page }],
        observation: `Switched to page ${page}. The next get_page_state returns that page's elements — ids from other pages are invalid now.`,
      }
    },
  },

  // ── compound layout intelligence ───────────────────────────
  {
    name: 'fix_overlaps',
    description: 'One call: separate overlapping elements and pull off-canvas elements back onto the page. Respects text-on-card composition.',
    risk: 'write',
    argsSpec: '{}',
    sanitize: () => ({ ok: true, actions: [{ type: 'fixOverlaps' }], observation: 'Overlap/bounds fix pass scheduled.' }),
  },
  {
    name: 'balance_layout',
    description: 'Deterministic layout balance: safe margins, centering, spacing cleanup.',
    risk: 'write',
    argsSpec: '{}',
    sanitize: () => ({ ok: true, actions: [{ type: 'balanceLayout' }], observation: 'Layout balance pass scheduled.' }),
  },
  {
    name: 'animate_page',
    description: 'Apply tasteful one-click entry animations to the current page.',
    risk: 'write',
    argsSpec: '{}',
    sanitize: () => ({ ok: true, actions: [{ type: 'magicAnimate' }], observation: 'Magic Animate scheduled.' }),
  },
  {
    name: 'translate_texts',
    description: 'Translate every text element on the page to a language.',
    risk: 'write',
    argsSpec: '{language: string}',
    sanitize: (args) => {
      const language = str(args, 'language', 40).trim()
      if (!language) return { ok: false, error: 'language is required, e.g. "Spanish".' }
      return { ok: true, actions: [{ type: 'translate', language }], observation: `Translation to ${language} scheduled.` }
    },
  },

  // ── destructive (confirm gate) ─────────────────────────────
  {
    // v0.28 (Phase 3): the full capability bridge — every gap the
    // audit found (docs/AI-CAPABILITY-MATRIX.md) becomes a tool.
    // All compile to DesignActions the CLIENT validates + applies.
    name: 'add_line',
    description: 'Add a line: solid, dashed, arrow, or double-headed arrow.',
    risk: 'write',
    argsSpec: '{x: number, y: number, length: number, variant?: "solid"|"dashed"|"arrow"|"arrowBoth", stroke?: "#RRGGBB", strokeWidth?: 1-40, rotation?: 0-359}',
    sanitize: (args, ctx) => {
      const x = num(args, 'x')
      const y = num(args, 'y')
      const length = num(args, 'length')
      if (x === null || y === null) return { ok: false, error: 'x and y are required numbers (the line\'s start point).' }
      if (length === null || length < 8) return { ok: false, error: 'length must be ≥ 8 px.' }
      const variant = enumVal(args, 'variant', ['solid', 'dashed', 'arrow', 'arrowBoth'] as const, 'solid' as never)
      // a PRESENT-but-invalid stroke errors; an absent stroke is fine
      if (args.stroke !== undefined && !hex(args, 'stroke')) {
        return { ok: false, error: `stroke must be #RRGGBB; you sent ${JSON.stringify(args.stroke)}.` }
      }
      return {
        ok: true,
        actions: [{
          type: 'addLine',
          x: clamp(x, -ctx.width, ctx.width),
          y: clamp(y, -ctx.height, ctx.height),
          length,
          variant,
          ...(hex(args, 'stroke') ? { stroke: hex(args, 'stroke')! } : {}),
          ...(num(args, 'strokeWidth') !== null ? { strokeWidth: clamp(num(args, 'strokeWidth')!, 1, 40) } : {}),
          ...(num(args, 'rotation') !== null ? { rotation: clamp(num(args, 'rotation')!, 0, 359) } : {}),
        }],
        observation: `Line (${variant}) added.`,
      }
    },
  },
  {
    name: 'add_icon',
    description: 'Search the icon pack by keyword (arrow, check, star, heart, cart…) and place the best match as a stroke icon.',
    risk: 'write',
    argsSpec: '{query: string, stroke?: "#RRGGBB", size?: 24-600}',
    sanitize: (args) => {
      const query = str(args, 'query', 60).trim()
      if (query.length < 2) return { ok: false, error: 'query must name the icon concept, e.g. "arrow-right", "check".' }
      return {
        ok: true,
        actions: [{ type: 'addIcon', query, ...(hex(args, 'stroke') ? { stroke: hex(args, 'stroke')! } : {}), ...(num(args, 'size') !== null ? { size: clamp(num(args, 'size')!, 24, 600) } : {}) }],
        observation: `Icon search queued for "${query}".`,
      }
    },
  },
  {
    name: 'add_illustration',
    description: 'Place a decorative SVG illustration by keyword (abstract/nature/business/decoration scenes).',
    risk: 'write',
    argsSpec: '{query: string}',
    sanitize: (args) => {
      const query = str(args, 'query', 60).trim()
      if (query.length < 3) return { ok: false, error: 'query must describe the scene, e.g. "waves", "mountain scene".' }
      return { ok: true, actions: [{ type: 'addIllustration', query }], observation: `Illustration search queued for "${query}".` }
    },
  },
  {
    name: 'add_chart',
    description: 'Add a data-bound chart: bar, line, donut, or scatter. Provide labels + series for real data; omit for editable sample data.',
    risk: 'write',
    argsSpec: '{kind: "bar"|"line"|"donut"|"scatter", labels?: string[], series?: [{name, color, values: number[]}], x?: number, y?: number}',
    sanitize: (args, ctx) => {
      const kind = enumVal(args, 'kind', ['bar', 'line', 'donut', 'scatter'] as const, '' as never)
      if (!kind) return { ok: false, error: 'kind must be bar, line, donut, or scatter.' }
      const labels = Array.isArray(args.labels) ? args.labels.map((l) => String(l).slice(0, 24)).slice(0, 24) : undefined
      let series: unknown
      if (Array.isArray(args.series)) {
        series = args.series
          .filter((s) => !!s && typeof s === 'object')
          .slice(0, 6)
          .map((s) => {
            const so = s as { name?: unknown; color?: unknown; values?: unknown }
            return {
              name: String(so.name ?? 'Series').slice(0, 24),
              color: typeof so.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(so.color) ? so.color : '#7630D7',
              values: Array.isArray(so.values) ? so.values.map((v) => Number(v) || 0).slice(0, 24) : [],
            }
          })
          .filter((s) => s.values.length >= 2)
        if (!(series as unknown[]).length) series = undefined
      }
      return {
        ok: true,
        actions: [{
          type: 'addChart',
          kind,
          ...(labels?.length ? { labels } : {}),
          ...(series ? { series } : {}),
          ...(num(args, 'x') !== null ? { x: clamp(num(args, 'x')!, 0, ctx.width) } : {}),
          ...(num(args, 'y') !== null ? { y: clamp(num(args, 'y')!, 0, ctx.height) } : {}),
        }],
        observation: `Chart (${kind}) queued.`,
      }
    },
  },
  {
    name: 'add_qr',
    description: 'Generate and place a QR code for a URL or text.',
    risk: 'write',
    argsSpec: '{value: string, size?: 96-800, dark?: "#RRGGBB", light?: "#RRGGBB", x?: number, y?: number}',
    sanitize: (args, ctx) => {
      const value = str(args, 'value', 500).trim()
      if (value.length < 2) return { ok: false, error: 'value is required (the URL or text the QR encodes).' }
      return {
        ok: true,
        actions: [{
          type: 'addQr',
          value,
          ...(num(args, 'size') !== null ? { size: clamp(num(args, 'size')!, 96, 800) } : {}),
          ...(hex(args, 'dark') ? { dark: hex(args, 'dark')! } : {}),
          ...(hex(args, 'light') ? { light: hex(args, 'light')! } : {}),
          ...(num(args, 'x') !== null ? { x: clamp(num(args, 'x')!, 0, ctx.width) } : {}),
          ...(num(args, 'y') !== null ? { y: clamp(num(args, 'y')!, 0, ctx.height) } : {}),
        }],
        observation: 'QR code queued.',
      }
    },
  },
  {
    name: 'add_frame',
    description: 'Add an image frame (rect/rounded/circle/star/polygon) — a placeholder you later fill with fill_frame or that auto-fills on image drop.',
    risk: 'write',
    argsSpec: '{frameShape?: "rect"|"rounded"|"circle"|"star"|"polygon", width?: 80-1200, height?: 80-1200, x?: number, y?: number}',
    sanitize: (args, ctx) => {
      const shape = enumStrict(args, 'frameShape', ['rect', 'rounded', 'circle', 'star', 'polygon'] as const)
      if ('error' in shape) return { ok: false, error: shape.error }
      const frameShape = shape.value
      return {
        ok: true,
        actions: [{
          type: 'addFrame',
          frameShape,
          ...(num(args, 'width') !== null ? { width: clamp(num(args, 'width')!, 80, 1200) } : {}),
          ...(num(args, 'height') !== null ? { height: clamp(num(args, 'height')!, 80, 1200) } : {}),
          ...(num(args, 'x') !== null ? { x: clamp(num(args, 'x')!, 0, ctx.width) } : {}),
          ...(num(args, 'y') !== null ? { y: clamp(num(args, 'y')!, 0, ctx.height) } : {}),
        }],
        observation: `Frame (${frameShape}) queued.`,
      }
    },
  },
  {
    name: 'add_embed',
    description: 'Embed a YouTube video, Google Map, or generic link as a card.',
    risk: 'write',
    argsSpec: '{url: string}',
    sanitize: (args) => {
      const url = str(args, 'url', 400).trim()
      if (!/^https?:\/\//.test(url)) return { ok: false, error: 'url must start with http:// or https://.' }
      return { ok: true, actions: [{ type: 'addEmbed', url }], observation: 'Embed card queued.' }
    },
  },
  {
    name: 'duplicate_elements',
    description: 'Duplicate elements by id (copies land 24px offset).',
    risk: 'write',
    argsSpec: '{ids: string[]}',
    sanitize: (args, ctx) => {
      const { ids, error } = idList(args, ctx)
      if (error) return { ok: false, error }
      if (!ids.length) return { ok: false, error: 'ids must include at least one existing element id.' }
      return { ok: true, actions: [{ type: 'duplicateElements', ids }], observation: `Duplicating ${ids.length} element(s).` }
    },
  },
  {
    name: 'group_elements',
    description: 'Group 2+ elements so they move/transform together.',
    risk: 'write',
    argsSpec: '{ids: string[]}',
    sanitize: (args, ctx) => {
      const { ids, error } = idList(args, ctx)
      if (error) return { ok: false, error }
      if (ids.length < 2) return { ok: false, error: 'group needs 2+ element ids.' }
      return { ok: true, actions: [{ type: 'groupElements', ids }], observation: `Grouping ${ids.length} elements.` }
    },
  },
  {
    name: 'ungroup_elements',
    description: 'Ungroup group elements by id (children become editable individually).',
    risk: 'write',
    argsSpec: '{ids: string[]}',
    sanitize: (args, ctx) => {
      const { ids, error } = idList(args, ctx)
      if (error) return { ok: false, error }
      if (!ids.length) return { ok: false, error: 'ids must include at least one group element id.' }
      return { ok: true, actions: [{ type: 'ungroupElements', ids }], observation: 'Ungrouping.' }
    },
  },
  {
    name: 'reorder_layers',
    description: 'Change stacking: move ids up/down/front/back, or pass ≥2 ids in the desired z-order.',
    risk: 'write',
    argsSpec: '{ids: string[], dir?: "up"|"down"|"front"|"back"}',
    sanitize: (args, ctx) => {
      const { ids, error } = idList(args, ctx)
      if (error) return { ok: false, error }
      if (!ids.length) return { ok: false, error: 'ids must include at least one existing element id.' }
      const dir = enumVal(args, 'dir', ['up', 'down', 'front', 'back'] as const, '' as never)
      if (!dir && ids.length < 2) return { ok: false, error: 'Pass dir (up|down|front|back) for single moves, or ≥2 ids for an explicit z order.' }
      return { ok: true, actions: [{ type: 'reorderLayers', ids, ...(dir ? { dir } : {}) }], observation: dir ? `Layer(s) moved ${dir}.` : 'Reordering layers.' }
    },
  },
  {
    name: 'animate_elements',
    description: 'Set an entry animation on elements: fade, rise, pan, pop, wipe, zoom, rotate, breathe (or none to clear).',
    risk: 'write',
    argsSpec: '{ids: string[], kind: "none"|"fade"|"rise"|"pan"|"pop"|"wipe"|"zoom"|"rotate"|"breathe", duration?: 0.2-5s, delay?: 0-10s, easing?: "linear"|"easeIn"|"easeOut"|"easeInOut"|"spring", direction?: "left"|"right"|"up"|"down"}',
    sanitize: (args, ctx) => {
      const { ids, error } = idList(args, ctx)
      if (error) return { ok: false, error }
      if (!ids.length) return { ok: false, error: 'ids must include at least one existing element id.' }
      const kind = enumVal(args, 'kind', ['none', 'fade', 'rise', 'pan', 'pop', 'wipe', 'zoom', 'rotate', 'breathe'] as const, '' as never)
      if (!kind) return { ok: false, error: 'kind must be one of none|fade|rise|pan|pop|wipe|zoom|rotate|breathe.' }
      return {
        ok: true,
        actions: [{
          type: 'animateElements',
          ids,
          kind,
          ...(num(args, 'duration') !== null ? { duration: clamp(num(args, 'duration')!, 0.2, 5) } : {}),
          ...(num(args, 'delay') !== null ? { delay: clamp(num(args, 'delay')!, 0, 10) } : {}),
          ...(enumVal(args, 'easing', ['linear', 'easeIn', 'easeOut', 'easeInOut', 'spring'] as const, '' as never) ? { easing: enumVal(args, 'easing', ['linear', 'easeIn', 'easeOut', 'easeInOut', 'spring'] as const, '' as never) } : {}),
          ...(enumVal(args, 'direction', ['left', 'right', 'up', 'down'] as const, '' as never) ? { direction: enumVal(args, 'direction', ['left', 'right', 'up', 'down'] as const, '' as never) } : {}),
        }],
        observation: `Animation ${kind} queued on ${ids.length} element(s).`,
      }
    },
  },
  {
    name: 'set_page_transition',
    description: 'Set how the CURRENT page enters in playback: fade, slide, zoom, flip (or none).',
    risk: 'write',
    argsSpec: '{kind: "none"|"fade"|"slide"|"zoom"|"flip", duration?: 0.2-2s}',
    sanitize: (args) => {
      const kind = enumVal(args, 'kind', ['none', 'fade', 'slide', 'zoom', 'flip'] as const, '' as never)
      if (!kind) return { ok: false, error: 'kind must be none|fade|slide|zoom|flip.' }
      return { ok: true, actions: [{ type: 'setPageTransition', kind, ...(num(args, 'duration') !== null ? { duration: clamp(num(args, 'duration')!, 0.2, 2) } : {}) }], observation: `Page transition ${kind} queued.` }
    },
  },
  {
    name: 'delete_page',
    description: 'Delete a page by 1-based number (default: current). Destructive — a non-empty page needs confirmed:true.',
    risk: 'destructive',
    argsSpec: '{page?: number, confirmed?: boolean}',
    sanitize: (args) => {
      const page = num(args, 'page')
      if (page !== null && (!Number.isInteger(page) || page < 1 || page > 200)) return { ok: false, error: 'page must be an integer 1–200 (1-based).' }
      return {
        ok: true,
        actions: [{ type: 'deletePage', ...(page !== null ? { page } : {}), ...(args.confirmed === true ? { confirmed: true } : {}) }],
        observation: 'Page delete queued (the client confirms non-empty pages).',
      }
    },
  },
  {
    name: 'set_brand_kit',
    description: 'Save design tokens to the Brand Kit: colors[], headingFont, bodyFont. The kit then guides every later run.',
    risk: 'write',
    argsSpec: '{colors?: ["#RRGGBB"…], headingFont?: string, bodyFont?: string}',
    sanitize: (args, ctx) => {
      const colors = Array.isArray(args.colors)
        ? args.colors.filter((c): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)).map((c) => c.toLowerCase()).slice(0, 10)
        : []
      const headingFont = str(args, 'headingFont', 60)
      const bodyFont = str(args, 'bodyFont', 60)
      if (headingFont && !ctx.fonts.has(headingFont)) return { ok: false, error: `Unknown headingFont "${headingFont}". Examples: ${[...ctx.fonts].slice(0, 6).join(', ')}.` }
      if (bodyFont && !ctx.fonts.has(bodyFont)) return { ok: false, error: `Unknown bodyFont "${bodyFont}". Examples: ${[...ctx.fonts].slice(0, 6).join(', ')}.` }
      if (!colors.length && !headingFont && !bodyFont) return { ok: false, error: 'Set at least one of colors[], headingFont, bodyFont.' }
      return { ok: true, actions: [{ type: 'setBrandKit', ...(colors.length ? { colors } : {}), ...(headingFont ? { headingFont } : {}), ...(bodyFont ? { bodyFont } : {}) }], observation: 'Brand kit update queued.' }
    },
  },
  {
    name: 'resize_design',
    description: 'Resize the whole canvas (all pages, elements re-laid out proportionally). Use when the brief demands other dimensions than the current page.',
    risk: 'write',
    argsSpec: '{width: 50-10000, height: 50-10000}',
    sanitize: (args) => {
      const width = num(args, 'width')
      const height = num(args, 'height')
      if (width === null || height === null || width < 50 || width > 10000 || height < 50 || height > 10000) {
        return { ok: false, error: 'width and height must be 50–10000 px.' }
      }
      return { ok: true, actions: [{ type: 'resizeDesign', width: Math.round(width), height: Math.round(height) }], observation: `Canvas resize to ${Math.round(width)}×${Math.round(height)} queued.` }
    },
  },
  {
    name: 'mask_image',
    description: 'Clip image elements to a shape: circle, rounded, star, polygon, heart, hexagon (or none to clear).',
    risk: 'write',
    argsSpec: '{ids: string[], mask: "none"|"circle"|"rounded"|"star"|"polygon"|"heart"|"hexagon", sides?: 3-12}',
    sanitize: (args, ctx) => {
      const { ids, error } = idList(args, ctx)
      if (error) return { ok: false, error }
      if (!ids.length) return { ok: false, error: 'ids must include at least one IMAGE element id.' }
      const mask = enumVal(args, 'mask', ['none', 'circle', 'rounded', 'star', 'polygon', 'heart', 'hexagon'] as const, '' as never)
      if (!mask) return { ok: false, error: 'mask must be none|circle|rounded|star|polygon|heart|hexagon.' }
      return { ok: true, actions: [{ type: 'maskImage', ids, mask, ...(mask === 'polygon' && num(args, 'sides') !== null ? { sides: clamp(num(args, 'sides')!, 3, 12) } : {}) }], observation: `Mask ${mask} queued on ${ids.length} image(s).` }
    },
  },
  {
    name: 'adjust_image',
    description: 'Adjust image elements: brightness, contrast, saturation (−100..100) or a filter preset.',
    risk: 'write',
    argsSpec: '{ids: string[], brightness?: -100..100, contrast?: -100..100, saturation?: -100..100, filter?: string|"none"}',
    sanitize: (args, ctx) => {
      const { ids, error } = idList(args, ctx)
      if (error) return { ok: false, error }
      if (!ids.length) return { ok: false, error: 'ids must include at least one IMAGE element id.' }
      const adj = (k: string): number | null => {
        const v = num(args, k)
        if (v === null) return null
        if (v < -100 || v > 100) throw new Error(`${k} must be −100..100; you sent ${v}.`)
        return Math.round(v)
      }
      try {
        const patch: Record<string, unknown> = {}
        for (const k of ['brightness', 'contrast', 'saturation']) {
          const v = adj(k)
          if (v !== null) patch[k] = v
        }
        const filter = str(args, 'filter', 40)
        if (filter) patch.filter = filter
        if (!Object.keys(patch).length) return { ok: false, error: 'Set at least one of brightness, contrast, saturation, filter.' }
        return { ok: true, actions: [{ type: 'adjustImage', ids, ...patch }], observation: `Image adjustments queued on ${ids.length} image(s).` }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'Bad image adjustments.' }
      }
    },
  },
  {
    name: 'measure_text',
    description: 'REAL text metrics (canvas measureText): returns the pixel width of a string at a given font/size — use before finalizing headings so nothing clips. The 0.6×size estimate is only a fallback.',
    risk: 'read',
    argsSpec: '{text: string, fontSize: 6-400, fontFamily?: string, bold?: boolean, lineHeight?: number}',
    sanitize: (args, ctx) => {
      const text = str(args, 'text', 200)
      if (!text) return { ok: false, error: 'text is required.' }
      const fontSize = num(args, 'fontSize')
      if (fontSize === null || fontSize < 6 || fontSize > 400) return { ok: false, error: 'fontSize must be 6–400.' }
      const fontFamily = str(args, 'fontFamily', 60) || 'Poppins'
      if (!ctx.fonts.has(fontFamily)) return { ok: false, error: `Unknown fontFamily "${fontFamily}". Examples: ${[...ctx.fonts].slice(0, 6).join(', ')}.` }
      return {
        ok: true,
        actions: [{ type: 'measureText', text, fontSize, fontFamily, bold: args.bold === true, ...(num(args, 'lineHeight') !== null ? { lineHeight: num(args, 'lineHeight')! } : {}) }],
        observation: 'Measuring text with real font metrics.',
      }
    },
  },
  {
    name: 'set_text_spans',
    description: 'Rich-text: style PARTS of a text element. Spans must concatenate EXACTLY to the element text. [{text, bold?, italic?, underline?, strike?, color?}]',
    risk: 'write',
    argsSpec: '{ids: string[], spans: [{text: string, bold?: boolean, italic?: boolean, color?: "#RRGGBB"}]}',
    sanitize: (args, ctx) => {
      const { ids, error } = idList(args, ctx)
      if (error) return { ok: false, error }
      if (!ids.length) return { ok: false, error: 'ids must include at least one TEXT element id.' }
      const spans = Array.isArray(args.spans) ? args.spans.filter((s) => !!s && typeof s === 'object' && typeof (s as { text?: unknown }).text === 'string').slice(0, 20) : []
      if (!spans.length) return { ok: false, error: 'spans must be a non-empty array of {text, bold?, italic?, color?}.' }
      return { ok: true, actions: [{ type: 'setTextSpans', ids, spans }], observation: 'Rich-text styling queued (validated against the element text).' }
    },
  },
  {
    name: 'export_design',
    description: 'Export the current page as PNG or JPG — downloads in the browser. Use when the user asks to save/export.',
    risk: 'write',
    argsSpec: '{format?: "png"|"jpg"}',
    sanitize: (args) => {
      const format = enumVal(args, 'format', ['png', 'jpg'] as const, 'png' as never)
      return { ok: true, actions: [{ type: 'exportDesign', format }], observation: `Export (${format}) queued — the download starts on the user's machine.` }
    },
  },
  {
    name: 'add_stock_video',
    description: 'Search licensed stock video (Pexels/Pixabay) and place the best match on the canvas.',
    risk: 'write',
    argsSpec: '{query: string}',
    sanitize: (args) => {
      const query = str(args, 'query', 120).trim()
      if (query.length < 3) return { ok: false, error: 'query must describe the footage (min 3 chars).' }
      return { ok: true, actions: [{ type: 'addStockVideo', query }], observation: `Stock video search queued for "${query}".` }
    },
  },
  {
    name: 'validate_brief',
    description: 'Validate the run against the Design Brief Contract using REAL page state: required texts verbatim, required colors, dimensions. Returns the unmet items — run before claiming done.',
    risk: 'read',
    argsSpec: '{}',
    sanitize: () => ({ ok: true, actions: [{ type: '__validateBrief' }], observation: 'Brief validation queued (computed on the client against the live document).' }),
  },

  // ── destructive ────────────────────────────────────────────
  {
    name: 'delete_elements',

    description: 'DELETE elements by id. Destructive: needs the user confirmation gate.',
    risk: 'destructive',
    argsSpec: '{ids: string[]}',
    sanitize: (args, ctx) => {
      const { ids, error } = idList(args, ctx)
      if (error) return { ok: false, error }
      return {
        ok: true,
        actions: [{ type: 'deleteElements', ids }],
        observation: `Deleted ${ids.length} element(s).`,
      }
    },
  },
  {
    name: 'clear_page',
    description: 'DELETE EVERY element on the current page. Destructive: needs the user confirmation gate. Prefer update_elements/move for reflows.',
    risk: 'destructive',
    argsSpec: '{}',
    sanitize: (_args, ctx) => {
      if (ctx.validIds.size === 0) return { ok: false, error: 'The page is already empty.' }
      return {
        ok: true,
        actions: [{ type: 'deleteElements', ids: [...ctx.validIds] }],
        observation: `Cleared ${ctx.validIds.size} elements.`,
      }
    },
  },
]

/** name → tool map for the loop. */
export const AGENT_TOOL_MAP: ReadonlyMap<string, AgentTool> = new Map(AGENT_TOOLS.map((t) => [t.name, t]))

/** The tool list as it appears in the system prompt (compact). */
export function toolsPromptSection(): string {
  return AGENT_TOOLS.map((t) => `- ${t.name} (${t.risk}): ${t.description}\n  args: ${t.argsSpec}`).join('\n')
}

/** add_text carries a font hint the client maps to fontFamily — resolve
 *  here so both sides speak family names. */
function fontFamilyOf(family: string): string {
  return family
}

/** Font families from the catalog (for ToolContext). */
export function fontFamilies(): string[] {
  return FONTS.map((f) => f.family)
}
