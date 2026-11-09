import { NextRequest, NextResponse } from 'next/server'
import { withProvider } from '@/lib/ai/provider'
import { withLogging } from '@/lib/observability'
import { normalizePlan, planSystemPrompt } from '@/lib/design-plan'

export const runtime = 'nodejs'
export const maxDuration = 60

interface PlanBody {
  prompt?: string
  width?: number
  height?: number
  pageCount?: number
}

/** Parse the first {...} JSON object out of a model reply, with a
 *  trailing-comma / smart-quote repair pass. Mirrors the MCP tool's
 *  parser (src/lib/mcp/tools.ts completeGeneration). */
function parseJsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  const candidate = raw.slice(start, end + 1)
  try {
    return JSON.parse(candidate) as Record<string, unknown>
  } catch {
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

/**
 * POST /api/ai/plan — agentic design planning (Wave 4).
 *
 * The agent replies with a STRUCTURED multi-page plan; nothing is
 * persisted. The client renders it as an editable review gate (toggle
 * pages/elements, rewrite copy) and only then applies it to the open
 * design — the "editable review gate" of the roadmap. Slot: text.
 * Kill switch: the admin console's agenticPlanning flag.
 */
async function __canvix_post(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as PlanBody
  const prompt = (body.prompt ?? '').trim().slice(0, 2000)
  if (prompt.length < 4) {
    return NextResponse.json({ error: 'Describe what you want to design.' }, { status: 400 })
  }
  const width = Math.min(8000, Math.max(200, Math.round(Number(body.width) || 1080)))
  const height = Math.min(8000, Math.max(200, Math.round(Number(body.height) || 1080)))
  const pageCount = Math.min(6, Math.max(1, Math.round(Number(body.pageCount) || 1)))

  return withProvider('plan', req, { limit: 5, windowSec: 60 }, async (ctx) => {
    const system = planSystemPrompt(width, height, pageCount)
    const user = `Design brief: ${prompt}\nPage size: ${width}x${height}px — plan exactly ${pageCount} page(s).`

    const ask = async (extra: string) => {
      const messages = [
        { role: 'system' as const, content: system },
        { role: 'user' as const, content: extra ? `${user}\n\n${extra}` : user },
      ]
      try {
        const completion = await ctx.zai.chat.completions.create({
          ...(ctx.model ? { model: ctx.model } : {}),
          messages,
          thinking: { type: 'disabled' },
          response_format: { type: 'json_object' },
        } as never)
        return completion.choices[0]?.message?.content ?? ''
      } catch {
        // strict JSON mode unsupported — plain completion
        const completion = await ctx.zai.chat.completions.create({
          ...(ctx.model ? { model: ctx.model } : {}),
          messages,
          thinking: { type: 'disabled' },
        })
        return completion.choices[0]?.message?.content ?? ''
      }
    }

    let parsed = parseJsonObject(await ask(''))
    if (!parsed) {
      parsed = parseJsonObject(
        await ask('Your previous reply was not valid JSON. Reply with ONLY the raw JSON object — no markdown fences, no commentary.'),
      )
    }
    if (!parsed) {
      return NextResponse.json(
        { error: 'The AI reply was not parseable. Try rephrasing the brief.' },
        { status: 502 },
      )
    }

    const plan = normalizePlan(parsed, width, height)
    if (!plan.pages.length) {
      return NextResponse.json(
        { error: 'The AI produced no usable pages. Try a more specific brief.' },
        { status: 502 },
      )
    }
    // the plan rides to the client ONLY — the review gate owns what lands
    return NextResponse.json({ plan })
  })
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const POST = withLogging('POST /api/ai/plan', __canvix_post)
