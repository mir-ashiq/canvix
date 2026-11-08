import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/guard'
import { resolveSlot } from '@/lib/ai/provider'
import { parseLogWindow, parseOutcome, parseLimit, queryAiLogs } from '@/lib/admin/logs'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/admin/logs — the console's Logs view (v0.16.3 A3).
//
// Two payloads in one response:
//   slots  — what each of the four capability slots currently resolves
//            to (provider label, base URL, model, config source) or
//            null when unconfigured. Never the key — resolveSlot's
//            apiKey is dropped before serialization.
//   log    — recent AI request rows from AIUsage with filters:
//            ?window=15m|1h|6h|24h|7d (default 24h)
//            ?feature=assistant|write|translate|image|image-edit|magic-layers|search
//            ?outcome=all|errors|ok (default all)
//            ?limit=20..400 (default 150)
//
// The Logs page polls this every few seconds when live-tailing; the
// poll itself is a plain admin GET, excluded from nothing — it is
// cheap (indexed createdAt range + groupBy) and admin-only.

// v0.16.4 (A4): imageSearch is retired — photo search runs on the
// stock-provider keys, not on an AI slot (its searches are not AIUsage
// rows; historical 'search' rows keep rendering in the log below)
const SLOT_ORDER = ['text', 'vision', 'image', 'imageEdit'] as const

async function __canvix_get(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.res

  const q = req.nextUrl.searchParams
  const log = await queryAiLogs({
    window: parseLogWindow(q.get('window')),
    feature: q.get('feature'),
    outcome: parseOutcome(q.get('outcome')),
    limit: parseLimit(q.get('limit')),
  })

  const slots = await Promise.all(
    SLOT_ORDER.map(async (slot) => {
      const r = await resolveSlot(slot)
      if (!r) return { slot, configured: false as const }
      return {
        slot,
        configured: true as const,
        providerId: r.providerId ?? null,
        label: r.label ?? null,
        baseUrl: r.baseUrl,
        model: r.model ?? null,
        source: r.source,
      }
    })
  )

  return NextResponse.json({ log, slots })
}

export const GET = withLogging('GET /api/admin/logs', __canvix_get)
