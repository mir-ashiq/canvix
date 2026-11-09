import { NextRequest, NextResponse } from 'next/server'
import { withProvider } from '@/lib/ai/provider'
import { withLogging } from '@/lib/observability'
import { normalizeTheme, themeSystemPrompt } from '@/lib/theme'
import { FONTS } from '@/lib/editor-utils'

export const runtime = 'nodejs'
export const maxDuration = 60

interface ThemeBody {
  prompt?: string
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
 * POST /api/ai/theme — AI theme generation (Wave 4).
 *
 * The model proposes a role-tagged palette + font pairing; the client
 * previews swatches and applies them design-wide (lib/theme.ts
 * applyTheme — recolors backgrounds/text/shapes with contrast guards).
 * Slot: text. Kill switch: themeGeneration.
 */
async function __canvix_post(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as ThemeBody
  const prompt = (body.prompt ?? '').trim().slice(0, 400)
  if (!prompt) {
    return NextResponse.json({ error: 'Describe the mood you want (e.g. "warm bakery, cozy, earthy").' }, { status: 400 })
  }

  const fontList = FONTS.map((f) => (typeof f === 'string' ? f : f.family))
  return withProvider('theme', req, { limit: 6, windowSec: 60 }, async (ctx) => {
    const system = themeSystemPrompt(fontList)
    const messages = [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: `Design mood: ${prompt}` },
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
      return NextResponse.json({ error: 'The AI reply was not parseable. Try rephrasing the mood.' }, { status: 502 })
    }
    const theme = normalizeTheme(parsed, fontList)
    return NextResponse.json({ theme })
  })
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const POST = withLogging('POST /api/ai/theme', __canvix_post)
