import { NextResponse } from 'next/server'
import { stockVideoProviders } from '@/lib/stock-video'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/stock-video/available — public, secret-free feature
 * detection for the v0.15 R6 stock-video rail: the LeftRail shows
 * the Videos tab only when this answers available=true (the F2b
 * pattern — no provider key configured = feature hidden, the rest
 * of the editor untouched). Exposes WHICH connectors are keyed,
 * never the keys themselves.
 */
async function __canvix_get() {
  return NextResponse.json({
    available: stockVideoProviders().length > 0,
    providers: stockVideoProviders(),
  })
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const GET = withLogging('GET /api/stock-video/available', __canvix_get)
