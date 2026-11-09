import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbErrorResponse } from '@/lib/db-errors'
import { withLogging } from '@/lib/observability'

// GET /api/templates — built-in template library (from DB, falls back empty)
//
// v0.9.2 cost fix: this payload is ~0.7 MB of public, deploy-stable data
// that was re-fetched (and re-serialized from Postgres) on every hit —
// an open faucet for both Fluid CPU and Fast Origin Transfer. It now
// carries explicit CDN cache headers: first hit per region serves from
// the function, everything after that is an edge HIT for 24 h (and a
// stale-while-revalidate revalidation window of 7 d).
// (_req: Next always passes the request; the handler just ignores it —
// the logging wrapper wants it)
async function __canvix_get(_req: NextRequest) {
  try {
    const templates = await db.template.findMany({
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json(
      templates.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        category: t.category,
        width: t.width,
        height: t.height,
        accent: t.accent,
        pages: t.pages ?? [],
        // v0.17 (Wave 2): smart-template fields (null on plain templates)
        ...(t.fields ? { fields: t.fields } : {}),
      })),
      {
        headers: {
          // public + immutable-enough: content only changes with a new
          // deploy or a re-seed, both of which ship a fresh deployment.
          'Cache-Control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
        },
      }
    )
  } catch (error) {
    return dbErrorResponse(error, 'GET /api/templates')
  }
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const GET = withLogging('GET /api/templates', __canvix_get)
