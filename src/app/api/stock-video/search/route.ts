import { NextRequest, NextResponse } from 'next/server'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { searchStockVideos, stockVideoProviders, type StockVideoProvider } from '@/lib/stock-video'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const maxDuration = 30

interface SearchBody {
  query?: unknown
  count?: unknown
  provider?: unknown
}

/**
 * POST /api/stock-video/search — runtime stock-video search
 * (v0.15 R6). Provider-gated the F2b way: no self-hoster key
 * configured ⇒ 503 NO_PROVIDER, and the panel/rail stay hidden
 * client-side. The response is the normalized, sanitized result
 * set — provider URLs + durable credit blocks; keys never leave
 * the server (and provider error bodies never reach the client).
 */
async function __canvix_post(req: NextRequest) {
  // stock search spends provider quota on every call — same-origin
  // only, like every other mutating POST (fail-closed default)
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const limit = checkRateLimit(req, 'stockvideo:search')
  if (!limit.ok) return rateLimitResponse(limit)

  const providers = await stockVideoProviders()
  if (providers.length === 0) {
    return NextResponse.json(
      {
        error: 'Stock video search needs a provider key on the server.',
        code: 'NO_PROVIDER',
        hint: 'Set PEXELS_API_KEY or PIXABAY_API_KEY — free keys from each provider (docs/STOCK-VIDEO.md).',
      },
      { status: 503 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as SearchBody
  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 120) : ''
  if (!query) return NextResponse.json({ error: 'A query is required.' }, { status: 400 })
  const count = Math.min(Math.max(Number(body.count) || 24, 1), 40)

  let provider: StockVideoProvider | undefined
  if (body.provider !== undefined) {
    if (typeof body.provider !== 'string' || !providers.includes(body.provider as StockVideoProvider)) {
      return NextResponse.json(
        { error: `Unknown or unconfigured provider. Configured: ${providers.join(', ')}.` },
        { status: 400 },
      )
    }
    provider = body.provider as StockVideoProvider
  }

  try {
    const results = await searchStockVideos(query, count, provider ? { provider } : {})
    return NextResponse.json({ query, count: results.length, results })
  } catch (error) {
    // sanitized upstream (status-only messages); NEVER echo provider
    // bodies or URLs — pixabay's key rides the query string
    const message = error instanceof Error && error.message !== 'NO_PROVIDER' ? error.message : 'Stock video search failed.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const POST = withLogging('POST /api/stock-video/search', __canvix_post)
