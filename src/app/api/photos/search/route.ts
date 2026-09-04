import { NextRequest, NextResponse } from 'next/server'
import { withProvider } from '@/lib/ai/provider'

export const runtime = 'nodejs'
export const maxDuration = 30

interface SearchBody {
  query?: string
  count?: number
}

/** POST /api/photos/search — runtime stock-photo search (Canva-like photo search). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as SearchBody
  const query = (body.query ?? '').trim().slice(0, 120)
  if (!query) return NextResponse.json({ error: 'A query is required.' }, { status: 400 })
  const count = Math.min(Math.max(Number(body.count) || 24, 1), 40)

  return withProvider('search', req, { limit: 30, windowSec: 60 }, async (zai) => {
    const response = await zai.images.search.create({ query, count })

    const results = (response.results ?? []).map((r) => ({
      url: r.original_url,
      caption: r.caption ?? '',
      source: r.source ?? '',
      width: Number(r.original_width) || 0,
      height: Number(r.original_height) || 0,
    })).filter((r) => r.url)

    return NextResponse.json({ query, count: results.length, results })
  })
}
