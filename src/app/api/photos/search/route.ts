import { NextRequest, NextResponse } from 'next/server'
import { withProvider } from '@/lib/ai/provider'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const maxDuration = 30

interface SearchBody {
  query?: string
  count?: number
}

/** POST /api/photos/search — runtime stock-photo search (Canva-like photo search). */
async function __canvix_post(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as SearchBody
  const query = (body.query ?? '').trim().slice(0, 120)
  if (!query) return NextResponse.json({ error: 'A query is required.' }, { status: 400 })
  const count = Math.min(Math.max(Number(body.count) || 24, 1), 40)

  return withProvider('search', req, { limit: 12, windowSec: 60 }, async (zai) => {
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

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const POST = withLogging('POST /api/photos/search', __canvix_post)
