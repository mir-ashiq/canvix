import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

interface TranslateBody {
  texts?: string[]
  language?: string
}

/** Robustly extract the first JSON array of strings from an LLM reply
 *  (walks closing brackets backwards to tolerate trailing junk). */
function parseTranslations(raw: string, expected: number): string[] | null {
  // strip code fences if present
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('[')
  if (start === -1) return null
  let end = cleaned.lastIndexOf(']')
  while (end > start) {
    try {
      const arr = JSON.parse(cleaned.slice(start, end + 1))
      if (Array.isArray(arr) && arr.every((x) => typeof x === 'string') && arr.length === expected) {
        return arr
      }
    } catch {
      /* try an earlier closing bracket */
    }
    end = cleaned.lastIndexOf(']', end - 1)
  }
  return null
}

/** POST /api/ai/translate — Canva "Translate": translate an array of design texts. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as TranslateBody
    const language = (body.language ?? '').trim()
    const texts = Array.isArray(body.texts) ? body.texts.filter((t) => typeof t === 'string') : []

    if (!language) return NextResponse.json({ error: 'A target language is required.' }, { status: 400 })
    if (!texts.length) return NextResponse.json({ error: 'No texts to translate.' }, { status: 400 })
    if (texts.length > 300) return NextResponse.json({ error: 'Too many texts (max 300).' }, { status: 400 })
    if (texts.some((t) => t.length > 2000)) {
      return NextResponse.json({ error: 'One of the texts is too long (max 2000 chars).' }, { status: 400 })
    }

    const numbered = texts.map((t, i) => `${i + 1}. ${JSON.stringify(t)}`).join('\n')
    const system =
      'You are a professional design translator for a graphic-design tool. ' +
      'Translate each numbered text into the requested language, keeping the meaning, tone and style. ' +
      'Preserve line breaks, emoji and placeholders. Keep brand names, URLs and proper nouns untranslated. ' +
      'Adapt naturally (idiomatic), do not transliterate unless the language requires it. ' +
      'Respond ONLY with a JSON array of strings in the same order and same length as the input. No markdown, no numbering.'

    const user = `Target language: ${language}\n\nTexts:\n${numbered}\n\nRespond with a JSON array of ${texts.length} translated strings, same order.`

    const { default: ZAI } = await import('z-ai-web-dev-sdk')
    const zai = await ZAI.create()

    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: system },
        { role: 'user', content: user },
      ],
      thinking: { type: 'disabled' },
    })

    const reply = completion.choices[0]?.message?.content ?? ''
    const translations = parseTranslations(reply, texts.length)
    if (!translations) {
      return NextResponse.json({ error: 'Translation failed — please try again.' }, { status: 502 })
    }
    return NextResponse.json({ language, translations })
  } catch (err) {
    console.error('[api/ai/translate]', err)
    return NextResponse.json({ error: 'Translate is unavailable right now. Please try again.' }, { status: 502 })
  }
}
