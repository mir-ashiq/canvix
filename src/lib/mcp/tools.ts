// ─────────────────────────────────────────────────────────────
// Canvix MCP tools — every tool maps to a real subsystem
// (Design/Template/Comment tables, element factories, the SVG
// exporter, animations, the AI provider layer). No vaporware.
// ─────────────────────────────────────────────────────────────

import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { FONTS } from '@/lib/editor-utils'
import { exportPageToSVG } from '@/lib/svg-export'
import { magicAnimatePage, clearPageAnimations } from '@/lib/animations'
import { hasProvider, getZAI, recordUsage, rateLimit } from '@/lib/ai/provider'
import {
  createTextElement,
  createShapeElement,
  createImageElement,
  createTableElement,
  createEmbedElement,
  createPage,
  type AnyElement,
  type PageData,
} from '@/lib/types'

export const SERVER_VERSION = '0.6.0'

// ── tool plumbing ────────────────────────────────────────────

export interface McpContent {
  type: 'text' | 'image'
  text?: string
  data?: string
  mimeType?: string
}

export interface ToolResult {
  content: McpContent[]
  isError?: boolean
}

export interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>) => Promise<ToolResult>
}

export function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], isError }
}

function ok(data: unknown): ToolResult {
  return textResult(JSON.stringify(data, null, 2))
}

function fail(message: string): ToolResult {
  return textResult(message, true)
}

// ── validation helpers ────────────────────────────────────────

const HEX = /^#[0-9a-fA-F]{6}$/

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function asNumber(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function asInt(v: unknown, fallback: number): number {
  return Math.round(asNumber(v, fallback))
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function asHex(v: unknown, fallback: string): string {
  return typeof v === 'string' && HEX.test(v) ? v : fallback
}

function asBool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function asEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

function isHttpsUrl(u: unknown): u is string {
  if (typeof u !== 'string' || !/^https?:\/\//i.test(u)) return false
  try {
    const parsed = new URL(u)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

// ── design access + persistence (with live collab propagation) ─

const AGENT_ACTOR = 'agent:mcp'

async function getDesign(designId: string) {
  const design = await db.design.findUnique({ where: { id: designId } })
  if (!design || design.deletedAt) return null
  return design
}

async function saveDesign(designId: string, pages: PageData[]): Promise<void> {
  await db.design.update({
    where: { id: designId },
    data: {
      pages: pages as unknown as object,
      updatedAt: new Date(),
    },
  })
  // propagate to live collaborators — the same op the collab client replays
  await db.designEvent
    .create({
      data: {
        designId,
        actorId: AGENT_ACTOR,
        kind: 'pages:replace',
        payload: { kind: 'pages:replace', pages } as object,
      },
    })
    .catch(() => undefined)
}

function parsePages(design: { pages: unknown }): PageData[] {
  const raw = Array.isArray(design.pages) ? design.pages : []
  return raw as PageData[]
}

function editUrl(designId: string, origin: string): string {
  return `${origin}/?design=${designId}`
}

function pageAt(pages: PageData[], index: number): PageData | null {
  return index >= 0 && index < pages.length ? pages[index] : null
}

function summarizeElement(el: AnyElement) {
  const base: Record<string, unknown> = {
    id: el.id,
    type: el.type,
    x: Math.round(el.x),
    y: Math.round(el.y),
    width: Math.round(el.width),
    height: Math.round(el.height),
    rotation: el.rotation,
    locked: el.locked,
  }
  if (el.type === 'text') {
    base.text = el.text.slice(0, 120)
    base.fontSize = el.fontSize
    base.fontFamily = el.fontFamily
    base.fill = el.fill
    base.curve = el.curve ?? 0
  } else if (el.type === 'table') {
    base.rows = el.rows
    base.cols = el.cols
  } else if (el.type === 'embed') {
    base.url = el.url
    base.kind = el.kind
  } else if (el.type === 'frame') {
    base.hasImage = Boolean(el.src)
  }
  return base
}

/** text content of a design — like canva's get-design-content */
function pageTextContent(page: PageData): string[] {
  const out: string[] = []
  for (const el of page.elements) {
    if (!el.visible) continue
    if (el.type === 'text') out.push(el.text)
    if (el.type === 'table') out.push(...el.cells.map((c) => c.text).filter((t) => t.trim()))
    if (el.type === 'embed' && el.title) out.push(el.title)
    if (el.type === 'group') {
      for (const c of el.children) {
        if (c.type === 'text' && c.visible) out.push(c.text)
      }
    }
  }
  return out.filter((t) => t.trim().length > 0)
}

// ── SSRF-guarded image fetch → dataURL ──────────────────────

const PRIVATE_HOST =
  /^(localhost|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i

async function fetchImageAsDataUrl(url: string): Promise<{ src: string; width: number; height: number }> {
  if (!isHttpsUrl(url)) throw new Error('Only http(s) image URLs are allowed.')
  const parsed = new URL(url)
  if (PRIVATE_HOST.test(parsed.hostname)) throw new Error('Private/internal hosts are not allowed.')
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    redirect: 'follow',
    headers: { 'user-agent': 'Canvix-MCP/0.6 (image fetch)' },
  })
  if (!res.ok) throw new Error(`Fetch failed with HTTP ${res.status}.`)
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim()
  if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(type)) {
    throw new Error(`Unsupported content type "${type}" — expected an image.`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength > 8 * 1024 * 1024) throw new Error('Image exceeds the 8 MB cap.')
  const src = `data:${type.replace('jpg', 'jpeg')};base64,${buf.toString('base64')}`
  const { default: sharp } = await import('sharp')
  const meta = await sharp(buf).metadata()
  return { src, width: meta.width ?? 800, height: meta.height ?? 600 }
}

// ── origin resolution (for edit URLs) ─────────────────────────

function originOf(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') ?? 'http'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3000'
  return `${proto}://${host}`
}

// ═════════════════════════════════════════════════════════════
// tool definitions
// ═════════════════════════════════════════════════════════════

export interface ToolDeps {
  req: NextRequest
}

export function buildTools(deps: ToolDeps): ToolDef[] {
  const origin = originOf(deps.req)

  // ── discovery ─────────────────────────────────────────────

  const listTemplates: ToolDef = {
    name: 'list_templates',
    description:
      'Browse Canvix starter templates. Returns id, name, category, dimensions and page count. Use a template_id with create_design to start a design from it.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['social', 'presentation', 'print', 'document', 'logo', 'thumbnail'], description: 'Filter by category (optional)' },
        query: { type: 'string', description: 'Case-insensitive name filter (optional)' },
      },
    },
    handler: async (args) => {
      const category = asString(args.category, '')
      const query = asString(args.query, '').toLowerCase()
      const where: Record<string, unknown> = {}
      if (category) where.category = category
      const templates = await db.template.findMany({
        where,
        select: { id: true, slug: true, name: true, category: true, width: true, height: true, pages: true },
        take: 60,
        orderBy: { createdAt: 'asc' },
      })
      const filtered = query ? templates.filter((t) => t.name.toLowerCase().includes(query)) : templates
      return ok({
        count: filtered.length,
        templates: filtered.map((t) => ({
          id: t.id,
          slug: t.slug,
          name: t.name,
          category: t.category,
          width: t.width,
          height: t.height,
          pageCount: Array.isArray(t.pages) ? t.pages.length : 0,
        })),
      })
    },
  }

  const searchDesigns: ToolDef = {
    name: 'search_designs',
    description: "Search the user's Canvix designs by name. Returns id, name, dimensions, updatedAt and the edit URL.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Case-insensitive name filter (optional — omit to list recent designs)' },
      },
    },
    handler: async (args) => {
      const query = asString(args.query, '').toLowerCase()
      const designs = await db.design.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, width: true, height: true, updatedAt: true, pages: true },
        take: 40,
        orderBy: { updatedAt: 'desc' },
      })
      const filtered = query ? designs.filter((d) => d.name.toLowerCase().includes(query)) : designs
      return ok({
        count: filtered.length,
        designs: filtered.map((d) => ({
          id: d.id,
          name: d.name,
          width: d.width,
          height: d.height,
          pageCount: Array.isArray(d.pages) ? d.pages.length : 0,
          updatedAt: d.updatedAt.toISOString(),
          editUrl: editUrl(d.id, origin),
        })),
      })
    },
  }

  const getDesignTool: ToolDef = {
    name: 'get_design',
    description:
      'Get design metadata: name, dimensions, page count, per-page element summaries, edit URL and text content outline. For the full document JSON use export_design with format "json".',
    inputSchema: {
      type: 'object',
      properties: { design_id: { type: 'string', description: 'Design id (from search_designs / create_design)' } },
      required: ['design_id'],
    },
    handler: async (args) => {
      const id = asString(args.design_id)
      const design = await getDesign(id)
      if (!design) return fail(`Design "${id}" was not found.`)
      const pages = parsePages(design)
      return ok({
        id: design.id,
        name: design.name,
        width: design.width,
        height: design.height,
        pageCount: pages.length,
        updatedAt: design.updatedAt.toISOString(),
        editUrl: editUrl(design.id, origin),
        pages: pages.map((p, i) => ({
          index: i,
          id: p.id,
          background: p.background,
          elementCount: p.elements.length,
          elements: p.elements.map(summarizeElement),
          textContent: pageTextContent(p).slice(0, 30),
        })),
      })
    },
  }

  const getDesignContent: ToolDef = {
    name: 'get_design_content',
    description: 'Read the text content of a design (per page). Use this when you only need the copy, not the structure.',
    inputSchema: {
      type: 'object',
      properties: { design_id: { type: 'string' } },
      required: ['design_id'],
    },
    handler: async (args) => {
      const design = await getDesign(asString(args.design_id))
      if (!design) return fail('Design not found.')
      const pages = parsePages(design)
      return ok({
        name: design.name,
        pages: pages.map((p, i) => ({ index: i, lines: pageTextContent(p) })),
      })
    },
  }

  // ── create ────────────────────────────────────────────────

  const createDesign: ToolDef = {
    name: 'create_design',
    description:
      'Create a new, fully editable Canvix design — blank (set width/height) or from a template (pass template_id from list_templates). Returns the design id + edit URL. This does NOT use AI; for AI generation see generate_design.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Design name (default "Agent design")' },
        width: { type: 'number', minimum: 40, maximum: 8000, description: 'Page width in px (default 1080)' },
        height: { type: 'number', minimum: 40, maximum: 8000, description: 'Page height in px (default 1080)' },
        template_id: { type: 'string', description: 'Start from this template (from list_templates)' },
      },
    },
    handler: async (args) => {
      const name = asString(args.name, 'Agent design').slice(0, 80) || 'Agent design'
      const templateRef = asString(args.template_id, '')
      if (templateRef) {
        // accept a template id OR a slug (both are returned by list_templates)
        const template = (await db.template.findUnique({ where: { id: templateRef } }))
          ?? (await db.template.findUnique({ where: { slug: templateRef } }))
        if (!template) return fail(`Template "${templateRef}" was not found. Call list_templates for valid ids.`)
        const pages = (Array.isArray(template.pages) ? template.pages : []) as unknown as PageData[]
        const design = await db.design.create({
          data: {
            name,
            width: template.width,
            height: template.height,
            pages: (pages.length ? pages : [createPage()]) as object,
            source: `template:${template.slug}`,
          },
        })
        return ok({ design_id: design.id, name, width: design.width, height: design.height, fromTemplate: template.slug, editUrl: editUrl(design.id, origin) })
      }
      const width = clamp(asInt(args.width, 1080), 40, 8000)
      const height = clamp(asInt(args.height, 1080), 40, 8000)
      const design = await db.design.create({
        data: { name, width, height, pages: [createPage()] as unknown as object, source: 'mcp' },
      })
      return ok({ design_id: design.id, name, width, height, pageCount: 1, editUrl: editUrl(design.id, origin) })
    },
  }

  const generateDesign: ToolDef = {
    name: 'generate_design',
    description:
      'Generate a complete, editable design from a text description using the server AI provider (layouts, colors, typography as real Canvix elements — not a flat image). Requires an AI provider on the server; without one, use create_design with a template instead. Provide a detailed brief: purpose, headline, sub copy, palette, page size.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to design — be specific (headline text, tone, palette, purpose)' },
        width: { type: 'number', minimum: 200, maximum: 8000 },
        height: { type: 'number', minimum: 200, maximum: 8000 },
        name: { type: 'string', description: 'Design name (optional)' },
      },
      required: ['query'],
    },
    handler: async (args) => {
      const query = asString(args.query).slice(0, 2000)
      if (query.length < 4) return fail('Provide a design brief ("query"), e.g. "Instagram post for a coffee shop launch — warm palette".')
      const zai = await getZAI()
      if (!zai) {
        await recordUsage('assistant', 'local', false).catch(() => undefined)
        return fail(
          'generate_design requires an AI provider configured on the server (set ZAI_API_KEY or a .z-ai-config file). ' +
            'Without a provider you can still create designs from templates: list_templates → create_design → add_text/add_shape.'
        )
      }
      const rl = rateLimit('mcp-generate', deps.req, 6, 60)
      if (!rl.ok) return fail('Rate limit reached — try again in a minute.')

      const width = clamp(asInt(args.width, 1080), 200, 8000)
      const height = clamp(asInt(args.height, 1080), 200, 8000)
      const fontList = FONTS.slice(0, 24)
        .map((f) => (typeof f === "string" ? f : f.family))
        .join(', ')

      const system = [
        'You generate structured designs for the Canvix editor. Reply with ONLY a JSON object (no markdown fences) of shape:',
        '{"name":string,"pages":[{"background":{"type":"solid","color":"#RRGGBB"}|{"type":"gradient","from":"#RRGGBB","to":"#RRGGBB","angle":number},',
        '"elements":[ ... ]}]}',
        `Element types (all coordinates in px on a ${width}x${height} page):`,
        `{"type":"text","text":string,"x":n,"y":n,"width":n,"fontSize":n,"fontFamily":one of [${fontList}],"bold":bool,"fill":"#RRGGBB","align":"left|center|right","curve":optional number -180..180}`,
        '{"type":"rect","x":n,"y":n,"width":n,"height":n,"fill":"#RRGGBB","cornerRadius":n}',
        '{"type":"ellipse","x":n,"y":n,"width":n,"height":n,"fill":"#RRGGBB"}',
        '{"type":"table","x":n,"y":n,"width":n,"header":["col a","col b"],"rows":n,"cells":[{"text":string}]}',
        'Rules: max 1 page, max 25 elements, keep 60px margins, hex colors only, text must fit its width (estimate ~0.6*fontSize px per char), make it look professionally designed (clear hierarchy, contrast, alignment).',
      ].join('\n')

      try {
        const raw = await completeGeneration(zai, system, `Design brief: ${query}\nPage size: ${width}x${height}px`)
        if (!raw) return fail('The AI reply was not parseable JSON after one retry. Try rephrasing the brief.')
        const parsed = raw as Record<string, unknown>
        const spec = normalizeGeneratedDesign(parsed, width, height)
        const name = (asString(args.name, '') || asString(parsed.name, 'Generated design')).slice(0, 80) || 'Generated design'
        const design = await db.design.create({
          data: { name, width: spec.width, height: spec.height, pages: spec.pages as unknown as object, source: 'ai:mcp' },
        })
        await recordUsage('assistant', 'zai', true)
        return ok({
          design_id: design.id,
          name,
          width: spec.width,
          height: spec.height,
          pageCount: spec.pages.length,
          elementCount: spec.pages[0]?.elements.length ?? 0,
          editUrl: editUrl(design.id, origin),
          note: 'Fully editable native elements — open the edit URL to tweak anything.',
        })
      } catch (err) {
        await recordUsage('assistant', 'zai', false).catch(() => undefined)
        return fail(`Generation failed: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown error'}`)
      }
    },
  }

  // ── element mutations ─────────────────────────────────────

  /** shared mutation wrapper: loads design, applies fn to pages, saves, emits collab event */
  async function mutateDesign(
    designId: string,
    fn: (pages: PageData[], width: number, height: number) => { pages: PageData[]; summary: Record<string, unknown> } | null
  ): Promise<ToolResult> {
    const design = await getDesign(designId)
    if (!design) return fail(`Design "${designId}" was not found.`)
    const pages = parsePages(design)
    if (!pages.length) return fail('This design has no pages yet — call it once via the editor (or create_design from a template) so a page exists.')
    const result = fn(pages, design.width, design.height)
    if (!result) return fail('Nothing to change — check your arguments (page index, element id…).')
    await saveDesign(designId, result.pages)
    return ok({ ok: true, design_id: designId, ...result.summary })
  }

  const addText: ToolDef = {
    name: 'add_text',
    description: 'Add a text element to a design page. Font, size, color, bold, alignment, position and curvature are optional. The element is a real editable text box.',
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string' },
        page: { type: 'number', minimum: 0, description: '0-based page index (default 0)' },
        text: { type: 'string', description: 'Text content (max 400 chars)' },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number', description: 'Text box width (default: page width minus margins)' },
        fontSize: { type: 'number', minimum: 6, maximum: 400 },
        fontFamily: { type: 'string', description: 'One of the fonts from list_fonts' },
        color: { type: 'string', description: 'Hex #RRGGBB' },
        bold: { type: 'boolean' },
        align: { type: 'string', enum: ['left', 'center', 'right'] },
        curve: { type: 'number', minimum: -180, maximum: 180, description: 'Curved text arc in degrees (optional)' },
      },
      required: ['design_id', 'text'],
    },
    handler: async (args) => {
      const designId = asString(args.design_id)
      const text = asString(args.text).slice(0, 400)
      if (!text.trim()) return fail('text must not be empty.')
      const fontName = asString(args.fontFamily, '')
      const font = FONTS.some((f) => (typeof f === "string" ? f : f.family) === fontName) ? fontName : 'Poppins'
      return mutateDesign(designId, (pages, w, h) => {
        const pageIndex = clamp(asInt(args.page, 0), 0, pages.length - 1)
        const page = pageAt(pages, pageIndex)
        if (!page) return null
        const el = createTextElement({
          text,
          x: clamp(asNumber(args.x, 60), -w, w),
          y: clamp(asNumber(args.y, h * 0.4), -h, h),
          width: clamp(asNumber(args.width, w - 120), 40, w * 1.5),
          fontSize: clamp(asInt(args.fontSize, 48), 6, 400),
          fontFamily: font,
          bold: asBool(args.bold, false),
          fill: asHex(args.color, '#1F2226'),
          align: asEnum(args.align, ['left', 'center', 'right'] as const, 'center'),
          ...(typeof args.curve === 'number' && Math.abs(args.curve) > 1 ? { curve: clamp(asInt(args.curve, 0), -180, 180) } : {}),
        })
        const next = pages.map((p, i) => (i === pageIndex ? { ...p, elements: [...p.elements, el] } : p))
        return { pages: next, summary: { added: 'text', element_id: el.id, page: pageIndex } }
      })
    },
  }

  const addShape: ToolDef = {
    name: 'add_shape',
    description: 'Add a native shape (rect / ellipse / triangle / star / line) to a design page.',
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string' },
        page: { type: 'number', minimum: 0 },
        shape: { type: 'string', enum: ['rect', 'ellipse', 'triangle', 'star', 'line'] },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        fill: { type: 'string', description: 'Hex #RRGGBB' },
        stroke: { type: 'string', description: 'Hex border color (shapes) or line color' },
        strokeWidth: { type: 'number', minimum: 0, maximum: 60 },
        cornerRadius: { type: 'number', minimum: 0, maximum: 400, description: 'rect only' },
      },
      required: ['design_id', 'shape'],
    },
    handler: async (args) => {
      const designId = asString(args.design_id)
      const shape = asEnum(args.shape, ['rect', 'ellipse', 'triangle', 'star', 'line'] as const, 'rect')
      return mutateDesign(designId, (pages, w, h) => {
        const pageIndex = clamp(asInt(args.page, 0), 0, pages.length - 1)
        const page = pageAt(pages, pageIndex)
        if (!page) return null
        let el: AnyElement
        if (shape === 'line') {
          const seed = createShapeElement('rect', {})
          el = {
            id: seed.id,
            type: 'line',
            x: clamp(asNumber(args.x, 100), -w, w),
            y: clamp(asNumber(args.y, h / 2), -h, h),
            width: clamp(asNumber(args.width, 320), 12, w * 2),
            height: 0,
            rotation: 0,
            opacity: 1,
            locked: false,
            visible: true,
            shadow: { enabled: false, color: '#000000', blur: 12, offsetX: 0, offsetY: 6 },
            stroke: asHex(args.stroke, '#1F2226'),
            strokeWidth: clamp(asNumber(args.strokeWidth, 6), 1, 60),
            dashed: false,
            arrowStart: false,
            arrowEnd: false,
          }
        } else {
          el = createShapeElement(shape, {
            x: clamp(asNumber(args.x, w * 0.25), -w, w),
            y: clamp(asNumber(args.y, h * 0.25), -h, h),
            width: clamp(asNumber(args.width, Math.min(400, w * 0.4)), 8, w * 2),
            height: clamp(asNumber(args.height, Math.min(400, h * 0.3)), 8, h * 2),
            fill: asHex(args.fill, '#00C4CC'),
            stroke: asHex(args.stroke, 'transparent'),
            strokeWidth: clamp(asNumber(args.strokeWidth, 0), 0, 60),
            ...(shape === 'rect' ? { cornerRadius: clamp(asNumber(args.cornerRadius, 0), 0, 400) } : {}),
          })
        }
        const next = pages.map((p, i) => (i === pageIndex ? { ...p, elements: [...p.elements, el] } : p))
        return { pages: next, summary: { added: shape, element_id: el.id, page: pageIndex } }
      })
    },
  }

  const addImage: ToolDef = {
    name: 'add_image',
    description:
      'Add an image to a design from a public https URL. The image is fetched server-side (private hosts and files > 8 MB are rejected) and embedded as a data URL so it renders reliably in the editor.',
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string' },
        page: { type: 'number', minimum: 0 },
        url: { type: 'string', description: 'Public https image URL' },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number', description: 'Display width (default: fitted to page)' },
        height: { type: 'number', description: 'Display height (default: keeps aspect)' },
      },
      required: ['design_id', 'url'],
    },
    handler: async (args) => {
      const designId = asString(args.design_id)
      const url = asString(args.url)
      let fetched: { src: string; width: number; height: number }
      try {
        fetched = await fetchImageAsDataUrl(url)
      } catch (err) {
        return fail(err instanceof Error ? err.message : 'Image fetch failed.')
      }
      return mutateDesign(designId, (pages, w, h) => {
        const pageIndex = clamp(asInt(args.page, 0), 0, pages.length - 1)
        const page = pageAt(pages, pageIndex)
        if (!page) return null
        const dispW = asNumber(args.width, Math.round(w * 0.6))
        const dispH = asNumber(args.height, Math.round(dispW * (fetched.height / Math.max(1, fetched.width))))
        const el = createImageElement(fetched.src, fetched.width, fetched.height, {
          x: clamp(asNumber(args.x, (w - dispW) / 2), -w, w),
          y: clamp(asNumber(args.y, (h - dispH) / 2), -h, h),
          width: clamp(dispW, 8, w * 2),
          height: clamp(dispH, 8, h * 2),
        })
        const next = pages.map((p, i) => (i === pageIndex ? { ...p, elements: [...p.elements, el] } : p))
        return { pages: next, summary: { added: 'image', element_id: el.id, page: pageIndex, naturalWidth: fetched.width, naturalHeight: fetched.height } }
      })
    },
  }

  const addTable: ToolDef = {
    name: 'add_table',
    description: 'Add a native table element (editable cells) to a design page.',
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string' },
        page: { type: 'number', minimum: 0 },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        header: { type: 'array', items: { type: 'string' }, description: 'Header cell labels (column count follows this)' },
        rows: { type: 'number', minimum: 1, maximum: 20, description: 'Total rows including header (default 4)' },
      },
      required: ['design_id'],
    },
    handler: async (args) => {
      const designId = asString(args.design_id)
      const header = Array.isArray(args.header) ? args.header.map((h) => asString(h).slice(0, 60)).slice(0, 8) : undefined
      return mutateDesign(designId, (pages, w, h) => {
        const pageIndex = clamp(asInt(args.page, 0), 0, pages.length - 1)
        const page = pageAt(pages, pageIndex)
        if (!page) return null
        const cols = header?.length ?? 3
        const rows = clamp(asInt(args.rows, 4), 1, 20)
        const tableWidth = clamp(asNumber(args.width, Math.min(560, w * 0.7)), 120, w)
        const el = createTableElement({
          x: clamp(asNumber(args.x, (w - tableWidth) / 2), -w, w),
          y: clamp(asNumber(args.y, h * 0.3), -h, h),
          width: tableWidth,
          rows,
          cols,
          rowHeight: 44,
          ...(header ? { header } : {}),
        })
        const next = pages.map((p, i) => (i === pageIndex ? { ...p, elements: [...p.elements, el] } : p))
        return { pages: next, summary: { added: 'table', element_id: el.id, page: pageIndex, rows, cols } }
      })
    },
  }

  const addEmbed: ToolDef = {
    name: 'add_embed',
    description: 'Add an embed link card (YouTube / Google Maps / generic link) to a design page. The card is native vector content that opens the URL in previews and shared views.',
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string' },
        page: { type: 'number', minimum: 0 },
        url: { type: 'string', description: 'https URL (YouTube/Maps get styled cards)' },
        title: { type: 'string', description: 'Card title (optional)' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['design_id', 'url'],
    },
    handler: async (args) => {
      const designId = asString(args.design_id)
      const url = asString(args.url)
      if (!isHttpsUrl(url)) return fail('url must be a valid http(s) URL.')
      return mutateDesign(designId, (pages, w, h) => {
        const pageIndex = clamp(asInt(args.page, 0), 0, pages.length - 1)
        const page = pageAt(pages, pageIndex)
        if (!page) return null
        const el = createEmbedElement(url, {
          x: clamp(asNumber(args.x, (w - 340) / 2), -w, w),
          y: clamp(asNumber(args.y, h * 0.3), -h, h),
          width: 340,
          height: 214,
          ...(asString(args.title, '') ? { title: asString(args.title).slice(0, 80) } : {}),
        })
        const next = pages.map((p, i) => (i === pageIndex ? { ...p, elements: [...p.elements, el] } : p))
        return { pages: next, summary: { added: 'embed', element_id: el.id, kind: el.kind, page: pageIndex } }
      })
    },
  }

  const setBackground: ToolDef = {
    name: 'set_background',
    description: 'Set the background of a design page — solid color or a two-stop gradient with an angle.',
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string' },
        page: { type: 'number', minimum: 0 },
        kind: { type: 'string', enum: ['solid', 'gradient'] },
        color: { type: 'string', description: 'solid: hex #RRGGBB' },
        from: { type: 'string', description: 'gradient start hex' },
        to: { type: 'string', description: 'gradient end hex' },
        angle: { type: 'number', minimum: 0, maximum: 360 },
      },
      required: ['design_id', 'kind'],
    },
    handler: async (args) => {
      const designId = asString(args.design_id)
      const kind = asEnum(args.kind, ['solid', 'gradient'] as const, 'solid')
      return mutateDesign(designId, (pages) => {
        const pageIndex = clamp(asInt(args.page, 0), 0, pages.length - 1)
        const page = pageAt(pages, pageIndex)
        if (!page) return null
        const background =
          kind === 'gradient'
            ? {
                type: 'gradient' as const,
                from: asHex(args.from, '#7630D7'),
                to: asHex(args.to, '#02C0CC'),
                angle: clamp(asNumber(args.angle, 135), 0, 360),
              }
            : { type: 'solid' as const, color: asHex(args.color, '#FFFFFF') }
        const next = pages.map((p, i) => (i === pageIndex ? { ...p, background } : p))
        return { pages: next, summary: { background, page: pageIndex } }
      })
    },
  }

  const updateElement: ToolDef = {
    name: 'update_element',
    description:
      'Update properties of an element by id (position, size, rotation, opacity, text, colors, fontSize…). Patches are validated and clamped; unknown keys are ignored. Use get_design to find element ids.',
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string' },
        element_id: { type: 'string' },
        page: { type: 'number', minimum: 0 },
        patch: { type: 'object', description: 'Partial element properties to apply' },
      },
      required: ['design_id', 'element_id', 'patch'],
    },
    handler: async (args) => {
      const designId = asString(args.design_id)
      const elementId = asString(args.element_id)
      const patchIn = (args.patch && typeof args.patch === 'object' ? args.patch : {}) as Record<string, unknown>
      if (!Object.keys(patchIn).length) return fail('patch must contain at least one property.')
      return mutateDesign(designId, (pages, w, h) => {
        const pageIndex = clamp(asInt(args.page, 0), 0, pages.length - 1)
        const page = pageAt(pages, pageIndex)
        if (!page) return null
        const el = page.elements.find((e) => e.id === elementId)
        if (!el) return null
        const clean = sanitizePatch(patchIn, el, w, h)
        if (!Object.keys(clean).length) return null
        const updated = { ...el, ...clean } as AnyElement
        const nextPages = pages.map((p, i) =>
          i === pageIndex ? { ...p, elements: p.elements.map((e) => (e.id === elementId ? updated : e)) } : p
        )
        return { pages: nextPages, summary: { updated: elementId, applied: Object.keys(clean) } }
      })
    },
  }

  const deleteElement: ToolDef = {
    name: 'delete_element',
    description: 'Delete an element by id from a design page.',
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string' },
        element_id: { type: 'string' },
        page: { type: 'number', minimum: 0 },
      },
      required: ['design_id', 'element_id'],
    },
    handler: async (args) => {
      const designId = asString(args.design_id)
      const elementId = asString(args.element_id)
      return mutateDesign(designId, (pages) => {
        const pageIndex = clamp(asInt(args.page, 0), 0, pages.length - 1)
        const page = pageAt(pages, pageIndex)
        if (!page || !page.elements.some((e) => e.id === elementId)) return null
        const nextPages = pages.map((p, i) => (i === pageIndex ? { ...p, elements: p.elements.filter((e) => e.id !== elementId) } : p))
        return { pages: nextPages, summary: { deleted: elementId, page: pageIndex } }
      })
    },
  }

  const animatePage: ToolDef = {
    name: 'animate_page',
    description:
      'Apply or clear animations on a design page. style "magic" gives the page a tasteful animation pass (fade/rise/pan mix — the same engine as the editor Magic Animate); "clear" removes all animations.',
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string' },
        page: { type: 'number', minimum: 0 },
        style: { type: 'string', enum: ['magic', 'clear'] },
        speed: { type: 'string', enum: ['slow', 'medium', 'fast'] },
      },
      required: ['design_id'],
    },
    handler: async (args) => {
      const designId = asString(args.design_id)
      const style = asEnum(args.style, ['magic', 'clear'] as const, 'magic')
      return mutateDesign(designId, (pages, _w, h) => {
        const pageIndex = clamp(asInt(args.page, 0), 0, pages.length - 1)
        const page = pageAt(pages, pageIndex)
        if (!page) return null
        const speed = asEnum(args.speed, ['slow', 'medium', 'fast'] as const, 'medium')
        const updated = style === 'clear' ? clearPageAnimations(page) : magicAnimatePage(page, h, speed)
        const next = pages.map((p, i) => (i === pageIndex ? updated : p))
        const animatedCount = updated.elements.filter((e) => e.animation && e.animation.kind !== 'none').length
        return { pages: next, summary: { page: pageIndex, style, animatedElements: animatedCount } }
      })
    },
  }

  // ── export ─────────────────────────────────────────────────

  const exportDesign: ToolDef = {
    name: 'export_design',
    description:
      'Export a design page. format "svg" returns true vector SVG (text uses font-family references — viewers fall back gracefully); "png" rasterizes server-side (system fonts) and returns an image block; "json" returns the full editable document. page defaults to 0; use page "all" for every page (svg/json only).',
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string' },
        format: { type: 'string', enum: ['svg', 'png', 'json'] },
        page: { type: ['number', 'string'], description: '0-based page index or "all" (default 0)' },
      },
      required: ['design_id'],
    },
    handler: async (args) => {
      const designId = asString(args.design_id)
      const format = asEnum(args.format, ['svg', 'png', 'json'] as const, 'svg')
      const design = await getDesign(designId)
      if (!design) return fail(`Design "${designId}" was not found.`)
      const pages = parsePages(design)
      if (!pages.length) return fail('This design has no pages yet — add elements first.')
      const pageArg = args.page
      const indices =
        pageArg === 'all'
          ? pages.map((_, i) => i)
          : [clamp(typeof pageArg === 'number' ? Math.round(pageArg) : asInt(pageArg, 0), 0, pages.length - 1)]

      if (format === 'json') {
        return ok({ design_id: designId, name: design.name, width: design.width, height: design.height, pages: pages.filter((_, i) => indices.includes(i)) })
      }

      if (format === 'svg') {
        const svgs = indices.map((i) => exportPageToSVG(pages[i], design.width, design.height))
        if (svgs.length === 1) return textResult(svgs[0])
        return ok({ pages: indices.map((i, k) => ({ index: i, svg: svgs[k] })) })
      }

      // png — rasterize the server-side SVG with sharp
      try {
        const { default: sharp } = await import('sharp')
        const pngs: { index: number; data: string }[] = []
        for (const i of indices.slice(0, 3)) {
          const svg = exportPageToSVG(pages[i], design.width, design.height)
          const png = await sharp(Buffer.from(svg), { density: 96 })
            .resize({ width: Math.min(2000, design.width), withoutEnlargement: design.width <= 2000 })
            .png()
            .toBuffer()
          pngs.push({ index: i, data: png.toString('base64') })
        }
        const content: McpContent[] = [
          ...pngs.map((p) => ({ type: 'image' as const, data: p.data, mimeType: 'image/png' })),
          {
            type: 'text' as const,
            text: `PNG export of page${pngs.length > 1 ? 's' : ''} ${pngs.map((p) => p.index).join(', ')} (${design.width}x${design.height}). Rasterized server-side — fonts render with server-installed families.`,
          },
        ]
        return { content }
      } catch (err) {
        return fail(`PNG rasterization failed: ${err instanceof Error ? err.message.slice(0, 160) : 'unknown'}. Try format "svg".`)
      }
    },
  }

  // ── comments ──────────────────────────────────────────────

  const commentOnDesign: ToolDef = {
    name: 'comment_on_design',
    description: 'Add a comment to a design (optionally anchored to a page position, fractions 0..1). Visible to all collaborators in the editor.',
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string' },
        body: { type: 'string', description: 'Comment text (max 500 chars)' },
        page: { type: 'number', minimum: 0 },
        x: { type: 'number', minimum: 0, maximum: 1, description: 'Anchor x as fraction of page width' },
        y: { type: 'number', minimum: 0, maximum: 1, description: 'Anchor y as fraction of page height' },
        author: { type: 'string', description: 'Author display name (default "AI Agent")' },
      },
      required: ['design_id', 'body'],
    },
    handler: async (args) => {
      const designId = asString(args.design_id)
      const body = asString(args.body).slice(0, 500)
      if (!body.trim()) return fail('body must not be empty.')
      const design = await getDesign(designId)
      if (!design) return fail(`Design "${designId}" was not found.`)
      const pages = parsePages(design)
      const pageIndex = clamp(asInt(args.page, 0), 0, Math.max(0, pages.length - 1))
      const pageId = pages[pageIndex]?.id ?? 'page_0'
      const author = asString(args.author, 'AI Agent').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40) || 'AI Agent'
      const comment = await db.comment.create({
        data: {
          designId,
          pageId,
          x: clamp(asNumber(args.x, 0.5), 0, 1),
          y: clamp(asNumber(args.y, 0.5), 0, 1),
          authorId: AGENT_ACTOR,
          authorName: author,
          authorColor: '#9954FF',
          body,
        },
      })
      // notify live sessions (comment markers ride the same event stream)
      await db.designEvent
        .create({
          data: {
            designId,
            actorId: AGENT_ACTOR,
            kind: 'comment:activity',
            payload: { kind: 'comment:activity', commentId: comment.id, page: pageIndex } as object,
          },
        })
        .catch(() => undefined)
      return ok({ ok: true, comment_id: comment.id, author, page: pageIndex })
    },
  }

  const listComments: ToolDef = {
    name: 'list_comments',
    description: 'List comments on a design with resolve state and replies.',
    inputSchema: {
      type: 'object',
      properties: { design_id: { type: 'string' } },
      required: ['design_id'],
    },
    handler: async (args) => {
      const design = await getDesign(asString(args.design_id))
      if (!design) return fail('Design not found.')
      const comments = await db.comment.findMany({
        where: { designId: design.id },
        orderBy: { createdAt: 'asc' },
        take: 100,
      })
      const threads = comments.filter((c) => !c.parentId)
      const replies = comments.filter((c) => c.parentId)
      return ok({
        count: threads.length,
        threads: threads.map((t) => ({
          id: t.id,
          author: t.authorName,
          body: t.body,
          resolved: t.resolved,
          page: t.pageId,
          at: t.createdAt.toISOString(),
          replies: replies
            .filter((r) => r.parentId === t.id)
            .map((r) => ({ id: r.id, author: r.authorName, body: r.body, at: r.createdAt.toISOString() })),
        })),
      })
    },
  }

  // ── misc ───────────────────────────────────────────────────

  const listFonts: ToolDef = {
    name: 'list_fonts',
    description: 'List the font families available in the editor (use with add_text / update_element).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      return ok({ count: FONTS.length, fonts: FONTS.map((f) => (typeof f === "string" ? f : f.family)) })
    },
  }

  const getCapabilities: ToolDef = {
    name: 'get_capabilities',
    description: 'Report server capabilities: Canvix version, AI provider availability, and how the server is secured.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      return ok({
        server: 'canvix',
        version: SERVER_VERSION,
        aiProvider: hasProvider() ? 'available (generate_design works)' : 'not configured (generate_design unavailable; all other tools work)',
        transport: 'streamable-http (stateless)',
        auth: 'bearer token via CANVIX_MCP_TOKEN',
      })
    },
  }

  return [
    getCapabilities,
    listTemplates,
    searchDesigns,
    getDesignTool,
    getDesignContent,
    createDesign,
    generateDesign,
    addText,
    addShape,
    addImage,
    addTable,
    addEmbed,
    setBackground,
    updateElement,
    deleteElement,
    animatePage,
    exportDesign,
    commentOnDesign,
    listComments,
    listFonts,
  ]
}

// ── patch sanitizer (whitelist per element type) ──────────────

const COMMON_KEYS = new Set(['x', 'y', 'width', 'height', 'rotation', 'opacity', 'visible', 'locked', 'name'])
const TEXT_KEYS = new Set([...COMMON_KEYS, 'text', 'fontSize', 'fontFamily', 'bold', 'italic', 'underline', 'strike', 'uppercase', 'fill', 'align', 'lineHeight', 'letterSpacing', 'curve'])
const SHAPE_KEYS = new Set([...COMMON_KEYS, 'fill', 'stroke', 'strokeWidth', 'cornerRadius'])
const IMAGE_KEYS = new Set([...COMMON_KEYS, 'src', 'radius'])
const TABLE_KEYS = new Set([...COMMON_KEYS, 'rows', 'cols', 'cells', 'colWidths', 'rowHeight', 'borderColor', 'borderWidth', 'headerFill', 'textColor', 'fontSize', 'fontFamily'])
const FRAME_KEYS = new Set([...COMMON_KEYS, 'frameShape', 'src', 'radius'])
const EMBED_KEYS = new Set([...COMMON_KEYS, 'url', 'title', 'tint'])

function sanitizePatch(patch: Record<string, unknown>, el: AnyElement, pageW: number, pageH: number): Record<string, unknown> {
  const allowed =
    el.type === 'text' ? TEXT_KEYS
    : el.type === 'image' ? IMAGE_KEYS
    : el.type === 'table' ? TABLE_KEYS
    : el.type === 'frame' ? FRAME_KEYS
    : el.type === 'embed' ? EMBED_KEYS
    : el.type === 'line' ? new Set([...COMMON_KEYS, 'stroke', 'strokeWidth', 'dashed'])
    : SHAPE_KEYS

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.has(key)) continue
    switch (key) {
      case 'x':
        out.x = clamp(asNumber(value, el.x), -pageW * 2, pageW * 2)
        break
      case 'y':
        out.y = clamp(asNumber(value, el.y), -pageH * 2, pageH * 2)
        break
      case 'width':
      case 'height':
        out[key] = clamp(asNumber(value, (el as unknown as Record<string, number>)[key] ?? 100), 4, Math.max(pageW, pageH) * 2)
        break
      case 'rotation':
        out.rotation = ((clamp(asNumber(value, 0), -3600, 3600) % 360) + 360) % 360
        break
      case 'opacity':
        out.opacity = clamp(asNumber(value, 1), 0, 1)
        break
      case 'fontSize':
        out.fontSize = clamp(asNumber(value, 32), 6, 400)
        break
      case 'curve':
        out.curve = clamp(asNumber(value, 0), -180, 180)
        break
      case 'text':
      case 'name':
      case 'title':
        out[key] = asString(value).slice(0, 500)
        break
      case 'fill':
      case 'stroke':
      case 'borderColor':
      case 'headerFill':
      case 'textColor':
      case 'tint':
        out[key] = asHex(value, '#000000')
        break
      case 'src':
        out.src = isHttpsUrl(value) || (typeof value === 'string' && value.startsWith('data:image/')) ? value : ((el as { src?: string }).src ?? '')
        break
      case 'url':
        out.url = isHttpsUrl(value) ? value : ((el as { url?: string }).url ?? '')
        break
      case 'fontFamily': {
        const f = asString(value, '')
        out.fontFamily = FONTS.some((x) => (typeof x === "string" ? x : x.family) === f) ? f : 'Inter'
        break
      }
      case 'align':
        out.align = asEnum(value, ['left', 'center', 'right', 'justify'] as const, 'left')
        break
      default:
        if (typeof value === 'boolean') out[key] = value
        else if (typeof value === 'number' && Number.isFinite(value)) out[key] = clamp(value, 0, 5000)
        break
    }
  }
  return out
}

// ── AI design spec normalizer ─────────────────────────────────

/** Ask the model for the design JSON; repair common JSON flaws and retry once. */
async function completeGeneration(
  zai: NonNullable<Awaited<ReturnType<typeof getZAI>>>,
  system: string,
  user: string
): Promise<Record<string, unknown> | null> {
  const ask = async (extra: string) => {
    const messages = [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: extra ? `${user}\n\n${extra}` : user },
    ]
    // strict JSON mode (supported by the provider); fall back to plain text on error
    try {
      const completion = await zai.chat.completions.create({
        messages,
        thinking: { type: 'disabled' },
        response_format: { type: 'json_object' },
      } as never)
      return completion.choices[0]?.message?.content ?? ''
    } catch {
      const completion = await zai.chat.completions.create({
        messages,
        thinking: { type: 'disabled' },
      })
      return completion.choices[0]?.message?.content ?? ''
    }
  }

  const parseAttempt = (raw: string): Record<string, unknown> | null => {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start === -1 || end <= start) return null
    const candidate = raw.slice(start, end + 1)
    try {
      return JSON.parse(candidate) as Record<string, unknown>
    } catch {
      // repair pass: strip trailing commas + markdown remnants, normalize smart quotes
      const repaired = candidate
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
      try {
        return JSON.parse(repaired) as Record<string, unknown>
      } catch {
        return null
      }
    }
  }

  const first = await ask('')
  const parsed = parseAttempt(first)
  if (parsed) return parsed
  // one retry with explicit feedback
  const second = await ask('Your previous reply was not valid JSON. Reply with ONLY the raw JSON object — no markdown fences, no commentary.')
  return parseAttempt(second)
}

function normalizeGeneratedDesign(spec: Record<string, unknown>, width: number, height: number): { width: number; height: number; pages: PageData[] } {
  const pagesRaw = Array.isArray(spec.pages) ? spec.pages.slice(0, 1) : []
  const pages: PageData[] = pagesRaw.map((p) => {
    const page = (p ?? {}) as Record<string, unknown>
    const elementsRaw = Array.isArray(page.elements) ? page.elements.slice(0, 25) : []
    const elements: AnyElement[] = []
    for (const e of elementsRaw) {
      const el = (e ?? {}) as Record<string, unknown>
      const type = asString(el.type, 'text')
      if (type === 'text') {
        elements.push(
          createTextElement({
            text: asString(el.text, 'Text').slice(0, 300),
            x: clamp(asNumber(el.x, 60), 0, width),
            y: clamp(asNumber(el.y, 60), 0, height),
            width: clamp(asNumber(el.width, width - 120), 40, width * 1.2),
            fontSize: clamp(asNumber(el.fontSize, 40), 8, 300),
            fontFamily: FONTS.some((f) => (typeof f === "string" ? f : f.family) === asString(el.fontFamily, '')) ? asString(el.fontFamily) : 'Poppins',
            bold: asBool(el.bold, false),
            fill: asHex(el.fill, '#1F2226'),
            align: asEnum(el.align, ['left', 'center', 'right'] as const, 'center'),
            ...(Math.abs(asNumber(el.curve, 0)) > 2 ? { curve: clamp(asNumber(el.curve, 0), -180, 180) } : {}),
          })
        )
      } else if (type === 'rect' || type === 'ellipse' || type === 'triangle') {
        elements.push(
          createShapeElement(type, {
            x: clamp(asNumber(el.x, 40), 0, width),
            y: clamp(asNumber(el.y, 40), 0, height),
            width: clamp(asNumber(el.width, 300), 8, width * 1.5),
            height: clamp(asNumber(el.height, 200), 8, height * 1.5),
            fill: asHex(el.fill, '#00C4CC'),
            ...(type === 'rect' ? { cornerRadius: clamp(asNumber(el.cornerRadius, 0), 0, 400) } : {}),
          })
        )
      } else if (type === 'table') {
        const header = Array.isArray(el.header) ? el.header.map((h) => asString(h).slice(0, 40)).slice(0, 6) : undefined
        const cells = Array.isArray(el.cells)
          ? (el.cells as Record<string, unknown>[]).slice(0, 120).map((c) => ({ text: asString(c.text).slice(0, 60) }))
          : undefined
        const cols = header?.length ?? 3
        const rows = clamp(asInt(el.rows, 3), 1, 12)
        elements.push(
          createTableElement({
            x: clamp(asNumber(el.x, 60), 0, width),
            y: clamp(asNumber(el.y, height * 0.5), 0, height),
            width: clamp(asNumber(el.width, Math.min(560, width * 0.7)), 120, width),
            rows,
            cols,
            rowHeight: 44,
            ...(header ? { header } : {}),
            ...(cells ? { cells } : {}),
          })
        )
      }
    }
    const bg = (page.background ?? {}) as Record<string, unknown>
    const background =
      asString(bg.type, 'solid') === 'gradient'
        ? {
            type: 'gradient' as const,
            from: asHex(bg.from, '#7630D7'),
            to: asHex(bg.to, '#02C0CC'),
            angle: clamp(asNumber(bg.angle, 135), 0, 360),
          }
        : { type: 'solid' as const, color: asHex(bg.color, '#FFFFFF') }
    return { id: `page_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, background, elements }
  })
  if (!pages.length) {
    pages.push({ id: `page_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, background: { type: 'solid', color: '#FFFFFF' }, elements: [] })
  }
  return { width, height, pages }
}
