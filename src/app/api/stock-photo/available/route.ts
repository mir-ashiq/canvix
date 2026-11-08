import { NextResponse } from 'next/server'
import { stockPhotoProviders } from '@/lib/stock-photo'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/stock-photo/available — public, secret-free feature
 * detection for the Photos panel's web-search section (v0.16.4
 * A4, the F2b pattern): the panel queries this to know whether
 * stock photo search is keyed before the first search runs.
 * Exposes WHICH connectors are keyed, never the keys themselves.
 */
async function __canvix_get() {
  return NextResponse.json({
    available: stockPhotoProviders().length > 0,
    providers: stockPhotoProviders(),
  })
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const GET = withLogging('GET /api/stock-photo/available', __canvix_get)
