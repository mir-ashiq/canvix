import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbErrorResponse } from '@/lib/db-errors'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { getSessionUser } from '@/lib/auth/session'
import { anonKeyHash, readAnonToken, newAnonToken, setAnonCookie } from '@/lib/auth/anon'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const maxDuration = 30

// ── v0.17 (Wave 2): server-side brand kits ────────────────────
//
//   GET    /api/brand-kits            → { kits: [...] }
//   POST   /api/brand-kits            → create (name, colors, palettes,
//                                        headingFont, bodyFont, logos)
//   PUT    /api/brand-kits?id=..      → update one
//   DELETE /api/brand-kits?id=..      → remove one
//
// Attribution mirrors designs (account or anon cookie). The Brand
// panel keeps its localStorage cache as an offline fallback and
// syncs through these endpoints — kits follow the account across
// devices. Caps: 10 kits, 8 colours, 8 palettes × 8 colours,
// 8 logo data URLs ≤ 512 KB each (logos are small PNG/SVGs).

const MAX_KITS = 10
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/

function validateKit(body: Record<string, unknown>): {
  name: string
  colors: string[]
  palettes: string[][]
  headingFont: string
  bodyFont: string
  logos: string[]
} | { error: string } {
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 60) : 'My brand'

  if (!Array.isArray(body.colors) || !body.colors.length || body.colors.length > 8) return { error: 'Provide 1–8 colours.' }
  const colors: string[] = []
  for (const c of body.colors) {
    if (typeof c !== 'string' || !HEX_RE.test(c)) return { error: 'Colours must be hex values.' }
    colors.push(c)
  }

  const palettes: string[][] = []
  if (body.palettes !== undefined) {
    if (!Array.isArray(body.palettes) || body.palettes.length > 8) return { error: 'At most 8 palettes.' }
    for (const pal of body.palettes) {
      if (!Array.isArray(pal) || pal.length > 8 || pal.some((c) => typeof c !== 'string' || !HEX_RE.test(c))) {
        return { error: 'Palettes must be arrays of hex colours.' }
      }
      palettes.push(pal as string[])
    }
  }

  const headingFont = typeof body.headingFont === 'string' && body.headingFont.length <= 60 ? body.headingFont : 'Montserrat'
  const bodyFont = typeof body.bodyFont === 'string' && body.bodyFont.length <= 60 ? body.bodyFont : 'Inter'

  const logos: string[] = []
  if (body.logos !== undefined) {
    if (!Array.isArray(body.logos) || body.logos.length > 8) return { error: 'At most 8 logos.' }
    for (const l of body.logos) {
      if (typeof l !== 'string' || l.length > 600_000 || !/^data:image\/(png|jpe?g|svg\+xml|webp);base64,/.test(l)) {
        return { error: 'Logos must be image data URLs (≤ 512 KB each).' }
      }
      logos.push(l)
    }
  }

  return { name, colors, palettes, headingFont, bodyFont, logos }
}

async function __canvix_get(req: NextRequest) {
  try {
    const user = await getSessionUser(req)
    let anonKey: string | null = null
    if (!user) {
      const token = readAnonToken(req)
      if (!token) return NextResponse.json({ kits: [] })
      anonKey = anonKeyHash(token)
    }
    const kits = await db.brandKitRecord.findMany({
      where: user ? { ownerId: user.id } : { anonKey },
      orderBy: { updatedAt: 'desc' },
      take: MAX_KITS,
    })
    return NextResponse.json({
      kits: kits.map((k) => ({
        id: k.id,
        name: k.name,
        colors: k.colors,
        palettes: k.palettes,
        headingFont: k.headingFont,
        bodyFont: k.bodyFont,
        logos: k.logos,
        updatedAt: k.updatedAt,
      })),
    })
  } catch (error) {
    return dbErrorResponse(error, 'GET /api/brand-kits')
  }
}

async function __canvix_post(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const limit = checkRateLimit(req, 'folders:create')
  if (!limit.ok) return rateLimitResponse(limit)
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const kit = validateKit(body)
    if ('error' in kit) return NextResponse.json({ error: kit.error }, { status: 400 })

    const user = await getSessionUser(req)
    const token = readAnonToken(req) ?? newAnonToken()
    const ownerId = user?.id ?? null
    const anonKey = user ? null : anonKeyHash(token)

    const count = await db.brandKitRecord.count({ where: user ? { ownerId: user.id } : { anonKey } })
    if (count >= MAX_KITS) {
      return NextResponse.json({ error: `Brand kit limit reached (${MAX_KITS}).` }, { status: 413 })
    }

    const created = await db.brandKitRecord.create({
      data: {
        name: kit.name,
        colors: kit.colors as never,
        palettes: kit.palettes as never,
        headingFont: kit.headingFont,
        bodyFont: kit.bodyFont,
        logos: kit.logos as never,
        ownerId,
        anonKey,
      },
      select: { id: true, name: true },
    })
    const res = NextResponse.json({ id: created.id, name: created.name }, { status: 201 })
    if (!user) setAnonCookie(res, token)
    return res
  } catch (error) {
    return dbErrorResponse(error, 'POST /api/brand-kits')
  }
}

async function __canvix_put(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const limit = checkRateLimit(req, 'folders:update')
  if (!limit.ok) return rateLimitResponse(limit)
  try {
    const id = req.nextUrl.searchParams.get('id') ?? ''
    if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 })
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const kit = validateKit(body)
    if ('error' in kit) return NextResponse.json({ error: kit.error }, { status: 400 })

    const user = await getSessionUser(req)
    const token = readAnonToken(req)
    const anonKey = user ? null : token ? anonKeyHash(token) : null
    const updated = await db.brandKitRecord.updateMany({
      where: user ? { id, ownerId: user.id } : { id, anonKey: anonKey ?? '__none__' },
      data: {
        name: kit.name,
        colors: kit.colors as never,
        palettes: kit.palettes as never,
        headingFont: kit.headingFont,
        bodyFont: kit.bodyFont,
        logos: kit.logos as never,
      },
    })
    if (!updated.count) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return dbErrorResponse(error, 'PUT /api/brand-kits')
  }
}

async function __canvix_delete(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  try {
    const id = req.nextUrl.searchParams.get('id') ?? ''
    if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 })
    const user = await getSessionUser(req)
    const token = readAnonToken(req)
    const anonKey = user ? null : token ? anonKeyHash(token) : null
    const removed = await db.brandKitRecord.deleteMany({
      where: user ? { id, ownerId: user.id } : { id, anonKey: anonKey ?? '__none__' },
    })
    if (!removed.count) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return dbErrorResponse(error, 'DELETE /api/brand-kits')
  }
}

export const GET = withLogging('GET /api/brand-kits', __canvix_get)
export const POST = withLogging('POST /api/brand-kits', __canvix_post)
export const PUT = withLogging('PUT /api/brand-kits', __canvix_put)
export const DELETE = withLogging('DELETE /api/brand-kits', __canvix_delete)
