import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface AssistantBody {
  message?: string
  history?: ChatMessage[]
  design?: {
    name?: string
    width?: number
    height?: number
    pageCount?: number
    currentPageElements?: number
    textContents?: string[]
  }
}

type AssistantAction =
  | { type: 'addText'; text: string; fontSize?: number; bold?: boolean }
  | { type: 'generateImage'; prompt: string }
  | { type: 'suggestPalette'; colors: string[] }
  | { type: 'translate'; language: string }

interface AssistantReply {
  reply: string
  actions: AssistantAction[]
}

/** Robust JSON object extraction from an LLM reply (handles trailing junk). */
function parseReply(raw: string): AssistantReply | null {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('{')
  if (start === -1) return null
  // walk closing braces backwards — LLMs sometimes emit trailing "}"/junk
  let end = cleaned.lastIndexOf('}')
  while (end > start) {
    let obj: AssistantReply | null = null
    try {
      obj = JSON.parse(cleaned.slice(start, end + 1)) as AssistantReply
    } catch {
      obj = null
    }
    if (obj && typeof obj.reply === 'string') {
      const actions = Array.isArray(obj.actions) ? obj.actions : []
      const valid: AssistantAction[] = []
      for (const a of actions) {
        if (!a || typeof a !== 'object' || typeof a.type !== 'string') continue
        if (a.type === 'addText' && typeof a.text === 'string' && a.text.trim()) {
          valid.push({ type: 'addText', text: a.text.slice(0, 400), fontSize: Number(a.fontSize) || undefined, bold: Boolean(a.bold) })
        } else if (a.type === 'generateImage' && typeof a.prompt === 'string' && a.prompt.trim()) {
          valid.push({ type: 'generateImage', prompt: a.prompt.slice(0, 400) })
        } else if (a.type === 'suggestPalette' && Array.isArray(a.colors)) {
          const colors = a.colors.filter((c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)).slice(0, 5)
          if (colors.length >= 3) valid.push({ type: 'suggestPalette', colors })
        } else if (a.type === 'translate' && typeof a.language === 'string' && a.language.trim()) {
          valid.push({ type: 'translate', language: a.language.slice(0, 40) })
        }
      }
      return { reply: obj.reply.slice(0, 1500), actions: valid.slice(0, 4) }
    }
    end = cleaned.lastIndexOf('}', end - 1)
  }
  return null
}

/** POST /api/ai/assistant — Canva AI-style conversational design assistant. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AssistantBody
    const message = (body.message ?? '').trim().slice(0, 1500)
    if (!message) return NextResponse.json({ error: 'A message is required.' }, { status: 400 })

    const d = body.design ?? {}
    const texts = (d.textContents ?? []).slice(0, 40).map((t) => JSON.stringify(t.slice(0, 120))).join(', ')
    const designSummary = [
      `Design name: ${d.name ?? 'Untitled'}`,
      `Canvas: ${d.width ?? '?'}x${d.height ?? '?'}px`,
      `Pages: ${d.pageCount ?? 1} (assistant sees page ${1})`,
      `Elements on the current page: ${d.currentPageElements ?? 0}`,
      texts ? `Text content in the design: ${texts}` : 'No text yet',
    ].join('\n')

    const system =
      'You are the Canvix AI assistant — a friendly, expert graphic-design copilot embedded in a ' +
      'design editor (similar to Canva AI). You help users ideate copy, pick colours, plan layouts, and ' +
      'improve designs. You are concise (max 120 words), warm and practical.\n' +
      'You can attach actions the app will offer as one-tap buttons. Respond ONLY with a JSON object: ' +
      '{"reply": string, "actions": [{"type": "addText", "text": string, "fontSize"?: number, "bold"?: boolean} | ' +
      '{"type": "generateImage", "prompt": string} | {"type": "suggestPalette", "colors": string[] (3-5 hex)} | ' +
      '{"type": "translate", "language": string}]}\n' +
      'Rules: attach at most 2 actions and only when clearly useful (e.g. the user asks for a headline -> addText; ' +
      'asks for visuals -> generateImage; asks about colours -> suggestPalette). If no action applies, use an empty array. ' +
      'addText text should be short & design-ready. generateImage prompt must be a rich visual description. ' +
      'No markdown in "reply" — plain text only.'

    const history = (body.history ?? []).slice(-8)
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }))

    const { default: ZAI } = await import('z-ai-web-dev-sdk')
    const zai = await ZAI.create()

    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: system },
        { role: 'assistant', content: `Current design context:\n${designSummary}` },
        ...history,
        { role: 'user', content: message },
      ],
      thinking: { type: 'disabled' },
    })

    const raw = completion.choices[0]?.message?.content ?? ''
    const parsed = parseReply(raw)
    if (!parsed) {
      // graceful fallback: treat the whole reply as plain text
      return NextResponse.json({ reply: raw.slice(0, 1200) || 'Sorry, I could not answer that. Try rephrasing.', actions: [] })
    }
    return NextResponse.json(parsed)
  } catch (err) {
    console.error('[api/ai/assistant]', err)
    return NextResponse.json({ error: 'The AI assistant is unavailable right now. Please try again.' }, { status: 502 })
  }
}
