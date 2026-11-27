import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { templatesAsRecords } from '@/lib/templates'
import { withLogging } from '@/lib/observability'

// The built-in library is shipped with the app. The database copy is an
// optional persisted catalogue, not a prerequisite for browsing templates.
const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
}

async function __tea_g3_get(_req: NextRequest) {
  try {
    const templates = await db.template.findMany({
      orderBy: { createdAt: 'asc' },
    })
    if (templates.length > 0) {
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
          ...(t.fields ? { fields: t.fields } : {}),
        })),
        { headers: CACHE_HEADERS }
      )
    }
  } catch {
    // Fall through to the deploy-bundled catalogue. Saving designs still
    // requires the database; this fallback only keeps template browsing alive.
  }

  return NextResponse.json(templatesAsRecords(), {
    headers: {
      ...CACHE_HEADERS,
      'X-TEaG3-Template-Source': 'built-in',
    },
  })
}

export const GET = withLogging('GET /api/templates', __tea_g3_get)
