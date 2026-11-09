import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const maxDuration = 15

// ── v0.17 (Wave 2): Iconify proxy — the online half of the icon library ──
//
//   GET /api/icons?q=<query>          → { icons: string[], total, limit }
//   GET /api/icons?svg=<prefix>:<name> → image/svg+xml (colour optional)
//
// The 562-icon offline pack ships in the bundle; this route adds the
// full Iconify universe (200k+ icons, 150+ sets) on demand. It is a
// thin, strictly-validated, cacheable passthrough to the free public
// api.iconify.design — the same shape as the /api/fonts/ttf resolver:
// no auth, no key, no store. Inputs are whitelisted hard because they
// feed an upstream URL: query ≤ 60 chars of word characters, and
// prefix/name are [a-z0-9-]+ only.

const API = 'https://api.iconify.design'
const Q_RE = /^[\w +'-]{1,60}$/
const NAME_RE = /^[a-z0-9-]{1,64}$/
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/ // searchParams already URI-decodes %23

async function __canvix_get(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')
  const svg = req.nextUrl.searchParams.get('svg')
  const color = req.nextUrl.searchParams.get('color') ?? ''

  if (!q && !svg) {
    return NextResponse.json({ error: 'Provide ?q= or ?svg=.' }, { status: 400 })
  }

  // svg fetch: /api/icons?svg=mdi:home&color=%23FF0000
  if (svg) {
    const limit = checkRateLimit(req, 'icons:search')
    if (!limit.ok) return rateLimitResponse(limit)
    const [prefix, name] = svg.split(':')
    if (!prefix || !name || !NAME_RE.test(prefix) || !NAME_RE.test(name)) {
      return NextResponse.json({ error: 'Invalid icon reference.' }, { status: 400 })
    }
    if (color && !COLOR_RE.test(color)) {
      return NextResponse.json({ error: 'Invalid colour.' }, { status: 400 })
    }
    try {
      const url = `${API}/${prefix}/${name}.svg${color ? `?color=${encodeURIComponent(color)}` : ''}`
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
      if (!res.ok) return NextResponse.json({ error: 'Icon not found.' }, { status: 404 })
      const text = await res.text()
      if (!text.startsWith('<svg') || text.length > 200_000) {
        return NextResponse.json({ error: 'Invalid icon payload.' }, { status: 502 })
      }
      return new NextResponse(text, {
        status: 200,
        headers: {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          // iconify icons are immutable per name — cache hard at the edge
          'Cache-Control': 'public, max-age=86400, s-maxage=604800',
        },
      })
    } catch {
      return NextResponse.json({ error: 'Icon service unavailable.' }, { status: 504 })
    }
  }

  // search: /api/icons?q=rocket
  const query = (q ?? '').trim()
  if (!Q_RE.test(query)) {
    return NextResponse.json({ error: 'Invalid search query.' }, { status: 400 })
  }
  const limit = checkRateLimit(req, 'icons:search')
  if (!limit.ok) return rateLimitResponse(limit)
  try {
    const res = await fetch(`${API}/search?query=${encodeURIComponent(query)}&limit=60`, {
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return NextResponse.json({ error: 'Search unavailable.' }, { status: 502 })
    const body = (await res.json()) as { icons?: unknown }
    const icons = Array.isArray(body.icons)
      ? body.icons.filter((i): i is string => typeof i === 'string' && /^[a-z0-9-]+:[a-z0-9-]+$/.test(i)).slice(0, 60)
      : []
    return NextResponse.json(
      { icons, total: icons.length },
      {
        headers: {
          // searches evolve with the user's typing — short edge cache only
          'Cache-Control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=1800',
        },
      },
    )
  } catch {
    return NextResponse.json({ error: 'Icon service unavailable.' }, { status: 504 })
  }
}

// v0.12.5 (H7): opt-in request logging wrapper
export const GET = withLogging('GET /api/icons', __canvix_get)
