import { NextRequest, NextResponse } from 'next/server'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { aiFeatureEnabled } from '@/lib/admin/config'
import { FEATURE_DISABLED } from '@/lib/ai/provider'
import { searchStockSounds, stockSoundProviders } from '@/lib/stock-sound'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const maxDuration = 30

interface SearchBody {
  query?: unknown
  count?: unknown
  includeOtherLicenses?: unknown
}

/**
 * POST /api/stock-sound/search — runtime stock SOUND search
 * (the Sound wave). The fourth stock-media connector: Freesound,
 * CC0-filtered by default, riding the same self-hoster-key
 * architecture as photos (A4) and videos (R6). Provider-gated the
 * F2b way: no key configured ⇒ 503 NO_PROVIDER and the Audio
 * panel shows the operator hint. The response is the normalized,
 * sanitized result set — preview MP3 URL + durable credit blocks;
 * the key never leaves the server (and the provider's error
 * bodies never reach the client).
 */
async function __canvix_post(req: NextRequest) {
  // stock search spends provider quota on every call — same-origin
  // only, like every other mutating POST (fail-closed default)
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  // the admin soundSearch kill switch (same semantics as photoSearch:
  // switched off ⇒ 503, everywhere)
  if (!(await aiFeatureEnabled('soundSearch'))) {
    return NextResponse.json(FEATURE_DISABLED, { status: 503 })
  }
  const limit = checkRateLimit(req, 'stocksound:search')
  if (!limit.ok) return rateLimitResponse(limit)

  const providers = await stockSoundProviders()
  if (providers.length === 0) {
    return NextResponse.json(
      {
        error: 'Sound search needs the Freesound key on the server.',
        code: 'NO_PROVIDER',
        hint: 'Store a Freesound key on the admin AI & models page (stock media card), or set FREESOUND_API_KEY — a free key from freesound.org (docs/SOUND.md). Results are Creative Commons 0 by default.',
      },
      { status: 503 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as SearchBody
  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 120) : ''
  if (!query) return NextResponse.json({ error: 'A query is required.' }, { status: 400 })
  const count = Math.min(Math.max(Number(body.count) || 24, 1), 40)
  // CC0 by default — opting into CC BY & friends is an explicit ask
  const includeOtherLicenses = body.includeOtherLicenses === true

  try {
    const results = await searchStockSounds(query, count, includeOtherLicenses ? { includeOtherLicenses } : {})
    return NextResponse.json({ query, count: results.length, results })
  } catch (error) {
    // sanitized upstream (status-only messages); NEVER echo provider
    // bodies or URLs — the freesound key rides the query string
    const message = error instanceof Error && error.message !== 'NO_PROVIDER' ? error.message : 'Sound search failed.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const POST = withLogging('POST /api/stock-sound/search', __canvix_post)
