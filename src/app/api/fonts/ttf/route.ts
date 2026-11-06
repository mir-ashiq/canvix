// /api/fonts/ttf — resolve a Google Font family/weight/style to
// a raw TrueType URL for the vector-PDF exporter (v0.15 R4).
//
// Why a server route at all: Google's css2 API negotiates the
// font FORMAT by User-Agent, and browsers forbid setting that
// header from a page. This route performs the css2 lookup with
// a legacy Android UA (the one that yields `.ttf
// format('truetype')` responses) and returns the gstatic URL;
// the CLIENT then fetches the (large) font bytes directly from
// fonts.gstatic.com, which serves `access-control-allow-origin:
// *` — no font bandwidth crosses the Worker.
//
// Fail-closed: any miss returns 404 and the client ladder falls
// back to the documented standard-14 path. Inputs are strictly
// validated — the family feeds a Google URL, so it must be a
// known-shape name (letters, digits, single spaces), never free
// text. This resolver is a thin, cacheable, unauthenticated GET
// to a public CDN (like a static asset) — the app's rate limits
// guard expensive mutations, not passthrough lookups.

import { NextRequest, NextResponse } from 'next/server'

import { parseTtfUrlFromCss2 } from '@/lib/pdf/fonts'

const LEGACY_UA =
  'Mozilla/5.0 (Linux; U; Android 2.2; en-us; DROID2 GLOBAL Build/S273) AppleWebKit/533.1 (KHTML, like Gecko) Version/4.0 Mobile Safari/533.1'

const FAMILY_RE = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/
const WEIGHTS = new Set([400, 500, 600, 700, 800, 900])

export async function GET(req: NextRequest): Promise<NextResponse> {
  const family = (req.nextUrl.searchParams.get('family') ?? '').trim()
  const weight = Number(req.nextUrl.searchParams.get('weight') ?? '400')
  const italic = req.nextUrl.searchParams.get('italic') === '1'

  if (!family || family.length > 40 || !FAMILY_RE.test(family) || !WEIGHTS.has(weight)) {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 })
  }

  const axis = italic ? `ital,wght@1,${weight}` : `wght@${weight}`
  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:${axis}`

  try {
    const res = await fetch(cssUrl, {
      headers: { 'User-Agent': LEGACY_UA },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return NextResponse.json({ error: 'css2 lookup failed' }, { status: 404 })
    const css = await res.text()
    const url = parseTtfUrlFromCss2(css)
    if (!url) return NextResponse.json({ error: 'no truetype face' }, { status: 404 })
    // gstatic URLs embed the font release (e.g. /v24/…) — safe to
    // cache hard; a family update just means a new URL next release
    return NextResponse.json({ url, family, weight, italic }, {
      status: 200,
      headers: { 'Cache-Control': 'public, max-age=86400' },
    })
  } catch {
    return NextResponse.json({ error: 'lookup unavailable' }, { status: 404 })
  }
}
