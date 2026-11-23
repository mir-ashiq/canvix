import { NextRequest, NextResponse } from 'next/server'
import { withProvider } from '@/lib/ai/provider'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const maxDuration = 60

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Compact design context sent by the client (already summarized). */
interface DesignContext {
  name?: string
  width?: number
  height?: number
  templateType?: string
  pageCount?: number
  currentPageIndex?: number
  selectedIds?: string[]
  /** summarized elements of the current page */
  elements?: {
    id: string
    type: string
    x?: number
    y?: number
    width?: number
    height?: number
    text?: string
    fill?: string
    fontSize?: number
    bold?: boolean
    fontFamily?: string
    name?: string
    locked?: boolean
  }[]
  colorsInUse?: string[]
  fontsInUse?: string[]
}

interface AssistantBody {
  message?: string
  history?: ChatMessage[]
  design?: DesignContext
}

/** DesignAction — structured, validated editor mutations (v0.5 Assistant 2.0). */
export type DesignAction =
  | { type: 'addText'; text: string; fontSize?: number; bold?: boolean; color?: string; align?: string; width?: number; y?: 'top' | 'center' | 'bottom' }
  | { type: 'updateElements'; ids: string[]; patch: Record<string, unknown> }
  | { type: 'deleteElements'; ids: string[] }
  | { type: 'moveElements'; ids: string[]; dx?: number; dy?: number; to?: 'top' | 'middle' | 'bottom' | 'left' | 'center' | 'right' }
  | { type: 'scaleElements'; ids: string[]; factor: number }
  | { type: 'setHeadingsColor'; color: string }
  | { type: 'setTextColor'; color: string }
  | { type: 'setFont'; fontFamily: string; targets?: 'all' | 'headings' | 'body' }
  | { type: 'setBackground'; kind: 'solid' | 'gradient'; from: string; to?: string; angle?: number }
  | { type: 'alignElements'; ids: string[]; mode: 'left' | 'cx' | 'right' | 'top' | 'cy' | 'bottom' }
  | { type: 'distributeElements'; ids: string[]; axis: 'x' | 'y' }
  /** v0.26: nudge overlapping elements apart / pull off-canvas elements back in */
  | { type: 'fixOverlaps' }
  | { type: 'addPage' }
  | { type: 'duplicatePage' }
  | { type: 'generateImage'; prompt: string }
  | { type: 'suggestPalette'; colors: string[] }
  | { type: 'translate'; language: string }
  | { type: 'magicAnimate' }
  | { type: 'magicLayout' }
  | { type: 'balanceLayout' }

interface AssistantReply {
  reply: string
  actions: DesignAction[]
}

const HEX = /^#[0-9a-fA-F]{6}$/

/** Robust JSON object extraction from an LLM reply (handles trailing junk). */
function parseReply(raw: string): AssistantReply | null {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('{')
  if (start === -1) return null
  let end = cleaned.lastIndexOf('}')
  while (end > start) {
    let obj: AssistantReply | null = null
    try {
      obj = JSON.parse(cleaned.slice(start, end + 1)) as AssistantReply
    } catch {
      obj = null
    }
    if (obj && typeof obj.reply === 'string') {
      return { reply: obj.reply.slice(0, 2000), actions: sanitizeActions(obj.actions) }
    }
    end = cleaned.lastIndexOf('}', end - 1)
  }
  return null
}

/** Validate + clamp every action — never trust model output raw. */
function sanitizeActions(input: unknown): DesignAction[] {
  if (!Array.isArray(input)) return []
  const out: DesignAction[] = []
  for (const a of input.slice(0, 6)) {
    if (!a || typeof a !== 'object') continue
    const act = a as Record<string, unknown>
    const type = String(act.type ?? '')
    const ids = Array.isArray(act.ids) ? act.ids.filter((i) => typeof i === 'string').slice(0, 60).map((i) => String(i).slice(0, 40)) : []

    switch (type) {
      case 'addText': {
        const text = String(act.text ?? '').slice(0, 400).trim()
        if (!text) break
        out.push({
          type: 'addText',
          text,
          fontSize: Math.min(300, Math.max(8, Number(act.fontSize) || 32)),
          bold: act.bold === true,
          color: typeof act.color === 'string' && HEX.test(act.color) ? act.color : undefined,
          align: ['left', 'center', 'right'].includes(String(act.align)) ? (String(act.align) as string) : undefined,
          width: Math.min(2000, Math.max(60, Number(act.width) || 0)) || undefined,
          y: ['top', 'center', 'bottom'].includes(String(act.y)) ? (String(act.y) as 'top' | 'center' | 'bottom') : undefined,
        })
        break
      }
      case 'updateElements': {
        if (!ids.length) break
        const patch: Record<string, unknown> = {}
        const p = (act.patch ?? {}) as Record<string, unknown>
        if (typeof p.fill === 'string' && HEX.test(p.fill)) patch.fill = p.fill
        if (typeof p.text === 'string' && p.text.length <= 400) patch.text = p.text
        if (Number.isFinite(Number(p.fontSize))) patch.fontSize = Math.min(300, Math.max(6, Number(p.fontSize)))
        if (p.bold === true || p.bold === false) patch.bold = p.bold
        if (typeof p.fontFamily === 'string' && p.fontFamily.length <= 60) patch.fontFamily = p.fontFamily
        if (Number.isFinite(Number(p.x))) patch.x = Number(p.x)
        if (Number.isFinite(Number(p.y))) patch.y = Number(p.y)
        if (Number.isFinite(Number(p.width))) patch.width = Math.max(8, Number(p.width))
        if (Number.isFinite(Number(p.height))) patch.height = Math.max(8, Number(p.height))
        if (Number.isFinite(Number(p.letterSpacing))) patch.letterSpacing = Number(p.letterSpacing)
        if (Number.isFinite(Number(p.lineHeight))) patch.lineHeight = Math.min(3, Math.max(0.8, Number(p.lineHeight)))
        if (Object.keys(patch).length) out.push({ type: 'updateElements', ids, patch })
        break
      }
      case 'deleteElements':
        if (ids.length) out.push({ type: 'deleteElements', ids })
        break
      case 'moveElements': {
        if (!ids.length) break
        const to = String(act.to ?? '')
        out.push({
          type: 'moveElements',
          ids,
          dx: Number.isFinite(Number(act.dx)) ? Number(act.dx) : undefined,
          dy: Number.isFinite(Number(act.dy)) ? Number(act.dy) : undefined,
          to: ['top', 'middle', 'bottom', 'left', 'center', 'right'].includes(to)
            ? (to as 'top' | 'middle' | 'bottom' | 'left' | 'center' | 'right')
            : undefined,
        })
        break
      }
      case 'scaleElements':
        if (ids.length && Number.isFinite(Number(act.factor)) && (Number(act.factor) > 0.1) && Number(act.factor) < 5) {
          out.push({ type: 'scaleElements', ids, factor: Number(act.factor) })
        }
        break
      case 'setHeadingsColor':
      case 'setTextColor':
        if (typeof act.color === 'string' && HEX.test(act.color)) out.push({ type, color: act.color })
        break
      case 'setFont':
        if (typeof act.fontFamily === 'string' && act.fontFamily.length <= 60) {
          const t = String(act.targets ?? 'all')
          out.push({ type: 'setFont', fontFamily: act.fontFamily, targets: (['all', 'headings', 'body'].includes(t) ? t : 'all') as 'all' | 'headings' | 'body' })
        }
        break
      case 'setBackground': {
        const kind = String(act.kind ?? 'solid')
        if (kind === 'gradient') {
          if (typeof act.from === 'string' && HEX.test(act.from) && typeof act.to === 'string' && HEX.test(act.to)) {
            out.push({ type: 'setBackground', kind: 'gradient', from: act.from, to: act.to, angle: Math.min(360, Math.max(0, Number(act.angle) || 135)) })
          }
        } else if (typeof act.from === 'string' && HEX.test(act.from)) {
          out.push({ type: 'setBackground', kind: 'solid', from: act.from })
        }
        break
      }
      case 'alignElements':
        if (ids.length && ['left', 'cx', 'right', 'top', 'cy', 'bottom'].includes(String(act.mode))) {
          out.push({ type: 'alignElements', ids, mode: String(act.mode) as 'left' | 'cx' | 'right' | 'top' | 'cy' | 'bottom' })
        }
        break
      case 'distributeElements':
        if (ids.length >= 3 && ['x', 'y'].includes(String(act.axis))) {
          out.push({ type: 'distributeElements', ids, axis: String(act.axis) as 'x' | 'y' })
        }
        break
      case 'addPage':
      case 'duplicatePage':
      case 'magicAnimate':
      case 'magicLayout':
      case 'balanceLayout':
      case 'fixOverlaps': // v0.26 — no parameters; operates on the current page
        out.push({ type })
        break
      case 'generateImage': {
        const prompt = String(act.prompt ?? '').slice(0, 400).trim()
        if (prompt) out.push({ type: 'generateImage', prompt })
        break
      }
      case 'suggestPalette': {
        const colors = Array.isArray(act.colors)
          ? act.colors.filter((c) => typeof c === 'string' && HEX.test(c)).slice(0, 5) as string[]
          : []
        if (colors.length >= 3) out.push({ type: 'suggestPalette', colors })
        break
      }
      case 'translate': {
        const language = String(act.language ?? '').slice(0, 40).trim()
        if (language) out.push({ type: 'translate', language })
        break
      }
      default:
        break // unknown action — dropped
    }
  }
  return out.slice(0, 5)
}

/** POST /api/ai/assistant — Canva AI 2.0-style design-aware assistant. */
async function __canvix_post(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as AssistantBody
  const message = (body.message ?? '').trim().slice(0, 1500)
  if (!message) return NextResponse.json({ error: 'A message is required.' }, { status: 400 })

  return withProvider('assistant', req, { limit: 20, windowSec: 60 }, async (ctx) => {
    const d = body.design ?? {}
    const els = (d.elements ?? []).slice(0, 80)
    const elementSummary = els
      .map((e) => {
        const parts = [`${e.type}#${e.id}`]
        if (e.name) parts.push(`"${e.name.slice(0, 24)}"`)
        if (e.text) parts.push(`text="${e.text.slice(0, 60).replace(/\n/g, ' ')}"`)
        if (e.fill) parts.push(e.fill)
        if (e.fontSize) parts.push(`${Math.round(e.fontSize)}px`)
        if (e.bold) parts.push('bold')
        if (e.fontFamily) parts.push(e.fontFamily)
        if (Number.isFinite(e.x) && Number.isFinite(e.y)) parts.push(`@(${Math.round(e.x!)},${Math.round(e.y!)}) ${Math.round(e.width ?? 0)}x${Math.round(e.height ?? 0)}`)
        if (e.locked) parts.push('locked')
        return parts.join(' ')
      })
      .join('\n')

    const selection = (d.selectedIds ?? []).slice(0, 20)

    // ── v0.26 spatial awareness: precomputed overlap + bounds analysis ──
    // Text elements over their own background/frame pairs are usual in
    // design (that's composition, not a bug), so a pair only counts as an
    // overlap when BOTH boxes are substantive and neither contains the
    // other's center (the "text sits on a card" pattern). Keep it compact —
    // this is model context, not a debug dump.
    const boxes = els
      .filter((e) => Number.isFinite(e.x) && Number.isFinite(e.y) && (e.width ?? 0) > 0 && (e.height ?? 0) > 0)
      .map((e) => ({ id: e.id, type: e.type, x: e.x!, y: e.y!, w: e.width ?? 0, h: e.height ?? 0 }))
    const overlaps: string[] = []
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
        const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
        const inter = ix * iy
        if (inter <= 0) continue
        const minArea = Math.min(a.w * a.h, b.w * b.h)
        if (minArea > 0 && inter / minArea > 0.55) {
          // one box mostly inside the other — the text-on-card pattern,
          // only report when the SMALLER element is not a text box
          const smallerIsText = (a.w * a.h <= b.w * b.h ? a : b).type === 'text'
          if (smallerIsText) continue
        }
        if (minArea > 0 && inter / minArea > 0.08) {
          overlaps.push(`${a.type}#${a.id} × ${b.type}#${b.id} (${Math.round((inter / minArea) * 100)}% of the smaller)`)
        }
        if (overlaps.length >= 12) break
      }
      if (overlaps.length >= 12) break
    }
    const pw = Number(d.width) || 0
    const ph = Number(d.height) || 0
    const offCanvas = boxes
      .filter((b) => pw > 0 && ph > 0 && (b.x < -8 || b.y < -8 || b.x + b.w > pw + 8 || b.y + b.h > ph + 8))
      .slice(0, 8)
      .map((b) => `${b.type}#${b.id} @(${Math.round(b.x)},${Math.round(b.y)}) ${Math.round(b.w)}x${Math.round(b.h)} outside the ${pw}x${ph} page`)

    const designContext = [
      `Design: "${d.name ?? 'Untitled'}" — ${d.width ?? '?'}x${d.height ?? '?'}px (${d.templateType ?? 'custom'}), ${d.pageCount ?? 1} page(s), currently editing page ${(d.currentPageIndex ?? 0) + 1}.`,
      `Selected element ids: ${selection.length ? selection.join(', ') : 'none'}.`,
      `Elements on the current page (${els.length}):`,
      elementSummary || '(empty page)',
      `Colors in use: ${(d.colorsInUse ?? []).slice(0, 12).join(', ') || 'none'}`,
      `Fonts in use: ${(d.fontsInUse ?? []).slice(0, 8).join(', ') || 'none'}`,
      `Overlapping element pairs (spatial analysis): ${overlaps.length ? overlaps.join('; ') : 'none detected'}`,
      `Off-canvas elements (partly outside the page): ${offCanvas.length ? offCanvas.join('; ') : 'none detected'}`,
    ].join('\n')

    const system =
      'You are the Canvix AI assistant — a design-aware copilot embedded in a graphic-design editor ' +
      '(similar to Canva AI). You understand the CURRENT design: its elements, colors, typography, layout and page size. ' +
      'You help users improve their design through STRUCTURED EDITOR ACTIONS, not code.\n\n' +
      'Respond ONLY with a JSON object: {"reply": string, "actions": DesignAction[]}\n\n' +
      'reply: concise (max 90 words), plain text, warm and practical. Say what you did / will do.\n\n' +
      'Available DesignAction types:\n' +
      '- {"type":"addText","text":str,"fontSize":px,"bold":bool,"color":"#hex","y":"top|center|bottom"} — adds a styled text box\n' +
      '- {"type":"updateElements","ids":[...],"patch":{"fill"|"text"|"fontSize"|"bold"|"fontFamily"|"x"|"y"|"width"|"height"|"lineHeight"|"letterSpacing":value}}\n' +
      '- {"type":"deleteElements","ids":[...]}\n' +
      '- {"type":"moveElements","ids":[...],"dx":px,"dy":px,"to":"top|middle|bottom|left|center|right"}\n' +
      '- {"type":"scaleElements","ids":[...],"factor":1.2}\n' +
      '- {"type":"setHeadingsColor","color":"#hex"} / {"type":"setTextColor","color":"#hex"}\n' +
      '- {"type":"setFont","fontFamily":str,"targets":"all|headings|body"}\n' +
      '- {"type":"setBackground","kind":"solid|gradient","from":"#hex","to":"#hex","angle":deg}\n' +
      '- {"type":"alignElements","ids":[...],"mode":"left|cx|right|top|cy|bottom"}\n' +
      '- {"type":"distributeElements","ids":[...],"axis":"x|y"}\n' +
      '- {"type":"fixOverlaps"} — automatically separates overlapping elements and pulls off-canvas elements back onto the page (v0.26)\n' +
      '- {"type":"addPage"} / {"type":"duplicatePage"}\n' +
      '- {"type":"generateImage","prompt":str} — generates an AI image and adds it\n' +
      '- {"type":"suggestPalette","colors":["#hex",...3-5]}\n' +
      '- {"type":"translate","language":str}\n' +
      '- {"type":"magicAnimate"} — one-click tasteful animations\n' +
      '- {"type":"balanceLayout"} / {"type":"magicLayout"} — improve spacing/alignment/balance\n\n' +
      'SPATIAL AWARENESS (v0.26): the context includes each element\'s box `@(x,y) WxH` on a page of the given size, ' +
      'plus a precomputed list of overlapping pairs and off-canvas elements. USE IT:\n' +
      '- When elements overlap unintentionally or sit off the page edge, prefer {"type":"fixOverlaps"} (it handles both).\n' +
      '- For precise fixes, use updateElements/moveElements with exact pixel coordinates that respect the page bounds and avoid other elements\' boxes.\n' +
      '- When the user asks to "move X next to Y", compute coordinates from the listed boxes (e.g. below Y: y = Y.y + Y.height + 24).\n' +
      'If the context says overlaps/offCanvas lists are empty, the layout is already clean — do not emit fixOverlaps.\n\n' +
      'RULES:\n' +
      '1. Only reference element ids that exist in the provided context. Use the ids of SELECTED elements when the user says "this/these/the title".\n' +
      '2. "Make this more modern" → setFont (heading font), maybe setTextColor + balanceLayout. "Move the title to the top" → moveElements {to:"top"} on the title id.\n' +
      '3. "Change all heading colors to purple" → setHeadingsColor. "Replace the background" → setBackground (or generateImage when they want a photo).\n' +
      '4. "Add a CTA" → addText with bold + short text. "Instagram-ready" → suggest a 1080x1350 resize + magicAnimate in the reply (resize is manual).\n' +
      '5. Create a second variation → duplicatePage + updateElements recolor on the duplicated page is NOT possible (actions apply to the current page) — explain instead.\n' +
      '6. At most 3 actions per reply, only when clearly useful. Empty array otherwise. Actions are applied automatically (v0.26) — only emit them when the user clearly asked for a change; otherwise describe the plan in "reply" and emit [].\n' +
      '7. Never invent element ids. Never output code. Plain text in "reply".'

    const history = (body.history ?? [])
      .slice(-8)
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }))

    // v0.26 fix: the system prompt + design context used to ride as TWO
    // extra `assistant` messages (pre-API-normalization leftovers) — most
    // OpenAI-compatible providers ignore instructions that arrive as
    // assistant turns. They are now a single proper system message.
    const completion = await ctx.zai.chat.completions.create({
      model: ctx.model,
      messages: [
        { role: 'system', content: `${system}\n\nCurrent design context:\n${designContext}` },
        ...history,
        { role: 'user', content: message },
      ],
      thinking: { type: 'disabled' },
    })

    const raw = completion.choices[0]?.message?.content ?? ''
    const parsed = parseReply(raw)
    if (!parsed) {
      // graceful fallback: treat the whole reply as plain text
      return NextResponse.json({ reply: raw.slice(0, 1500) || 'Sorry, I could not answer that. Try rephrasing.', actions: [] })
    }
    return NextResponse.json(parsed)
  })
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const POST = withLogging('POST /api/ai/assistant', __canvix_post)
