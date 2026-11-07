import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/guard'
import { liveSnapshot } from '@/lib/admin/realtime'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/admin/realtime — the console's live traffic panel (v0.16.2 A2).
//
// Reads the in-memory rolling counters recorded by withLogging on every
// API request: per-second request/error buckets (last 60 s), 5-minute
// request/error/visitor/AI totals, a latency ring (p50/p95) and the
// top routes of the window. Aggregate counts only — the same no-ids/
// no-IPs/no-query-strings stance as /api/health?v=2; visitors are
// counted through per-boot salted hashes, never the IP itself.
//
// The panel polls this every 2 s; the poll is excluded from the live
// counters themselves (see observability.ts) so the dashboard never
// becomes its own top route. Counters are process-local and reset on
// restart — TrafficStat/AIUsage remain the durable record.

async function __canvix_get(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.res
  return NextResponse.json(liveSnapshot())
}

export const GET = withLogging('GET /api/admin/realtime', __canvix_get)
