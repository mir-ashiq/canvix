import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 30

interface SearchBody {
  query?: string
  count?: number
}

/** POST /api/photos/search — runtime stock-photo search (Canva-like photo search). */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SearchBody
    const query = (body.query ?? '').trim().slice(0, 120)
    if (!query) return NextResponse.json({ error: 'A query is required.' }, { status: 400 })
    const count = Math.min(Math.max(Number(body.count) || 24, 1), 40)

    const { default: ZAI } = await import('z-ai-web-dev-sdk')
    const zai = await ZAI.create()

    const response = await zai.images.search.create({ query, count })

    const results = (response.results ?? []).map((r) => ({
      url: r.original_url,
      caption: r.caption ?? '',
      source: r.source ?? '',
      width: Number(r.original_width) || 0,
      height: Number(r.original_height) || 0,
    })).filter((r) => r.url)

    return NextResponse.json({ query, count: results.length, results })
  } catch (err) {
    console.error('[api/photos/search]', err)
    return NextResponse.json({ error: 'Photo search is unavailable right now.' }, { status: 502 })
  }
}
