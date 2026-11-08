import { NextRequest, NextResponse } from 'next/server'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { aiFeatureEnabled } from '@/lib/admin/config'
import { FEATURE_DISABLED } from '@/lib/ai/provider'
import { searchStockPhotos, stockPhotoProviders, type StockPhotoProvider } from '@/lib/stock-photo'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const maxDuration = 30

interface SearchBody {
  query?: unknown
  count?: unknown
  provider?: unknown
}

/**
 * POST /api/stock-photo/search — runtime stock-photo search
 * (v0.16.4 A4). Photo search LEFT the AI provider table: it is a
 * library query against licensed stock catalogs (Pexels/Pixabay),
 * not a generative one, so it rides the R6 self-hoster-key
 * architecture instead of an OpenAI-compatible model slot.
 * Provider-gated the F2b way: no key configured ⇒ 503
 * NO_PROVIDER and the panel shows the operator hint. The response
 * is the normalized, sanitized result set — provider URLs +
 * durable credit blocks; keys never leave the server (and
 * provider error bodies never reach the client).
 */
async function __canvix_post(req: NextRequest) {
  // stock search spends provider quota on every call — same-origin
  // only, like every other mutating POST (fail-closed default)
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  // the admin photoSearch kill switch still applies (same semantics
  // as every AI feature: switched off ⇒ 503, everywhere)
  if (!(await aiFeatureEnabled('photoSearch'))) {
    return NextResponse.json(FEATURE_DISABLED, { status: 503 })
  }
  const limit = checkRateLimit(req, 'stockphoto:search')
  if (!limit.ok) return rateLimitResponse(limit)

  const providers = stockPhotoProviders()
  if (providers.length === 0) {
    return NextResponse.json(
      {
        error: 'Photo search needs a stock provider key on the server.',
        code: 'NO_PROVIDER',
        hint: 'Set PEXELS_API_KEY or PIXABAY_API_KEY — free keys from each provider (docs/STOCK-PHOTO.md). The same keys also enable the Videos rail.',
      },
      { status: 503 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as SearchBody
  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 120) : ''
  if (!query) return NextResponse.json({ error: 'A query is required.' }, { status: 400 })
  const count = Math.min(Math.max(Number(body.count) || 24, 1), 40)

  let provider: StockPhotoProvider | undefined
  if (body.provider !== undefined) {
    if (typeof body.provider !== 'string' || !providers.includes(body.provider as StockPhotoProvider)) {
      return NextResponse.json(
        { error: `Unknown or unconfigured provider. Configured: ${providers.join(', ')}.` },
        { status: 400 },
      )
    }
    provider = body.provider as StockPhotoProvider
  }

  try {
    const results = await searchStockPhotos(query, count, provider ? { provider } : {})
    return NextResponse.json({ query, count: results.length, results })
  } catch (error) {
    // sanitized upstream (status-only messages); NEVER echo provider
    // bodies or URLs — pixabay's key rides the query string
    const message = error instanceof Error && error.message !== 'NO_PROVIDER' ? error.message : 'Photo search failed.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const POST = withLogging('POST /api/stock-photo/search', __canvix_post)
