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
    if (typeof v === 'string' && ctx.validIds.has(v)) ids.push(v)
    else if (typeof v === 'string') invalid.push(v)
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
    description: 'Patch properties of elements by id: x, y, width, height, text, fill, fontSize, bold, align, rotation, opacity, radius, lineHeight, letterSpacing.',
    risk: 'write',
    argsSpec: '{ids: string[], patch: {x?, y?, width?, height?, text?, fill?, fontSize?, bold?, align?, rotation?, opacity?}}',
    sanitize: (args, ctx) => {
      const { ids, error } = idList(args, ctx)
      if (error) return { ok: false, error }
      const patchRaw = args.patch
      if (!patchRaw || typeof patchRaw !== 'object' || Array.isArray(patchRaw)) {
        return { ok: false, error: 'patch must be an object of property → value, e.g. {"fill":"#7D2AE8"}.' }
      }
      const patch: Record<string, unknown> = {}
      const p = patchRaw as Record<string, unknown>
      for (const key of ['x', 'y', 'width', 'height', 'rotation', 'lineHeight', 'letterSpacing'] as const) {
        if (p[key] !== undefined) {
          const v = num(p as Record<string, unknown>, key)
          if (v === null) return { ok: false, error: `patch.${key} must be a number; you sent ${JSON.stringify(p[key])}.` }
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
      if (p.bold !== undefined) patch.bold = p.bold === true
      if (p.align !== undefined) patch.align = enumVal(p as Record<string, unknown>, 'align', ['left', 'center', 'right'] as const, 'center')
      if (Object.keys(patch).length === 0) {
        return { ok: false, error: 'patch is empty — set at least one supported property (x, y, width, height, text, fill, fontSize, bold, align, rotation, opacity).' }
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
