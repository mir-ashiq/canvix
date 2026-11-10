import { NextResponse } from 'next/server'
import { stockSoundProviders } from '@/lib/stock-sound'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/stock-sound/available — public, secret-free feature
 * detection for the Audio panel's web-search section (the Sound
 * wave, the F2b pattern): the panel queries this to know whether
 * stock sound search is keyed before the first search runs.
 * Exposes WHICH connector is keyed, never the key itself.
 */
async function __canvix_get() {
  // keys resolve console-first (stored → env), so this reads the
  // AppConfig cache — one findMany per 10 s per instance at most.
  const providers = await stockSoundProviders()
  return NextResponse.json({
    available: providers.length > 0,
    providers,
  })
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const GET = withLogging('GET /api/stock-sound/available', __canvix_get)
