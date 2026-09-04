import { NextRequest, NextResponse } from 'next/server'
import { withProvider } from '@/lib/ai/provider'

export const runtime = 'nodejs'
export const maxDuration = 60

interface WriteBody {
  prompt?: string
  tone?: string
  kind?: 'headline' | 'tagline' | 'body' | 'social'
}

const KIND_HINTS: Record<string, string> = {
  headline: 'a punchy headline of at most 8 words',
  tagline: 'a memorable tagline of at most 10 words',
  body: 'a short body paragraph of 2-3 sentences (max 45 words)',
  social: 'an engaging social-media caption with at most 30 words',
}

const TONES = ['bold', 'playful', 'elegant', 'minimal', 'corporate', 'warm'] as const

/** POST /api/ai/write — Magic Write: generate on-brand copy variants for designs. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as WriteBody
  const prompt = (body.prompt ?? '').trim().slice(0, 500)
  const kind = body.kind && KIND_HINTS[body.kind] ? body.kind : 'tagline'
  const tone = TONES.includes((body.tone ?? '') as (typeof TONES)[number]) ? body.tone! : 'bold'

  if (!prompt) {
    return NextResponse.json({ error: 'A prompt is required.' }, { status: 400 })
  }

  return withProvider('write', req, { limit: 20, windowSec: 60 }, async (zai) => {
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: 'assistant',
          content:
            'You are a senior brand copywriter for a design tool. Return EXACTLY 3 numbered options, one per line, ' +
            'no extra commentary, no quotes. Each option is ' +
            KIND_HINTS[kind] +
            `. Tone: ${tone}. Plain text only, ready to paste on a design.`,
        },
        { role: 'user', content: `Subject: ${prompt}` },
      ],
      thinking: { type: 'disabled' },
    })

    const raw = completion.choices[0]?.message?.content ?? ''
    const options = raw
      .split('\n')
      .map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim())
      .filter((l) => l.length > 0 && !/^here/i.test(l))
      .slice(0, 3)

    if (options.length === 0) {
      return NextResponse.json({ error: 'Generation returned no usable text. Try rephrasing.' }, { status: 502 })
    }

    return NextResponse.json({ options })
  })
}
