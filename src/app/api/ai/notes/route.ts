import { NextRequest, NextResponse } from 'next/server'
import { withProvider } from '@/lib/ai/provider'
import { withLogging } from '@/lib/observability'
import { notesSystemPrompt, normalizeNotes, outlineToPrompt, type PageOutline } from '@/lib/notes-outline'

export const runtime = 'nodejs'
export const maxDuration = 60

interface NotesBody {
  outline?: PageOutline[]
  tone?: string
}

const TONES = ['confident', 'warm', 'formal', 'casual', 'inspirational'] as const

/** Coerce the client-supplied outline: keep only structurally valid
 *  entries (defensive — the client is trusted but the route is public
 *  same-origin). */
function sanitizeOutline(input: unknown): PageOutline[] {
  const list = Array.isArray(input) ? input.slice(0, 40) : []
  const out: PageOutline[] = []
  for (const raw of list) {
    const p = (raw ?? {}) as Record<string, unknown>
    const index = Math.round(Number(p.index))
    if (!Number.isInteger(index) || index < 0 || index > 999) continue
    out.push({
      index,
      title: typeof p.title === 'string' ? p.title.slice(0, 120) : `Page ${index + 1}`,
      bullets: Array.isArray(p.bullets)
        ? p.bullets.filter((b): b is string => typeof b === 'string').map((b) => b.slice(0, 160)).slice(0, 12)
        : [],
      media: Array.isArray(p.media)
        ? p.media.filter((m): m is string => typeof m === 'string').map((m) => m.slice(0, 60)).slice(0, 8)
        : [],
    })
  }
  return out
}

/** Parse the first {...} out of a model reply (shared repair pass). */
function parseJsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  const candidate = raw.slice(start, end + 1)
  try {
    return JSON.parse(candidate) as Record<string, unknown>
  } catch {
    try {
      return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1')) as Record<string, unknown>
    } catch {
      return null
    }
  }
}

/**
 * POST /api/ai/notes — speaker-notes generation (Wave 4).
 *
 * Input: the page outline (extracted client-side by
 * lib/notes-outline.ts extractOutlines — the model sees content, not
 * geometry). Output: {notes:[{page,text}]} which the notes panel shows
 * as an editable preview before saving per page (another review gate).
 * Slot: text. Kill switch: notesGeneration.
 */
async function __canvix_post(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as NotesBody
  const outline = sanitizeOutline(body.outline)
  if (!outline.length) {
    return NextResponse.json({ error: 'Nothing to write notes about — add content to the pages first.' }, { status: 400 })
  }
  const tone = TONES.includes((body.tone ?? '') as (typeof TONES)[number]) ? body.tone! : 'confident'

  return withProvider('notes', req, { limit: 5, windowSec: 60 }, async (ctx) => {
    const system = notesSystemPrompt(outline.length, tone)
    const user = outlineToPrompt(outline)
    const messages = [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: user },
    ]
    let raw = ''
    try {
      const completion = await ctx.zai.chat.completions.create({
        ...(ctx.model ? { model: ctx.model } : {}),
        messages,
        thinking: { type: 'disabled' },
        response_format: { type: 'json_object' },
      } as never)
      raw = completion.choices[0]?.message?.content ?? ''
    } catch {
      const completion = await ctx.zai.chat.completions.create({
        ...(ctx.model ? { model: ctx.model } : {}),
        messages,
        thinking: { type: 'disabled' },
      })
      raw = completion.choices[0]?.message?.content ?? ''
    }

    const parsed = parseJsonObject(raw)
    if (!parsed) {
      return NextResponse.json({ error: 'The AI reply was not parseable. Try again.' }, { status: 502 })
    }
    const notes = normalizeNotes(parsed, outline.length)
    if (!notes.length) {
      return NextResponse.json({ error: 'The AI produced no usable notes. Try again.' }, { status: 502 })
    }
    return NextResponse.json({ notes })
  })
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const POST = withLogging('POST /api/ai/notes', __canvix_post)
