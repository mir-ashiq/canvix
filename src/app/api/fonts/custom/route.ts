import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { getSessionUser } from '@/lib/auth/session'
import { anonKeyHash, readAnonToken, newAnonToken, setAnonCookie } from '@/lib/auth/anon'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const maxDuration = 30

// ── v0.17 (Wave 2): custom font uploads ──────────────────────
//   GET  /api/fonts/custom            → { fonts: [{ id, family, url, format }] }
//   POST /api/fonts/custom?family=..  → raw font bytes (octet-stream) → 201
//   DELETE /api/fonts/custom?id=..    → remove an uploaded font
//
// Stored in the existing Media table (bytes in Postgres, quota shared
// with the uploads library). Fonts are small (typically < 2 MB), so a
// single raw-body POST is fine — no chunking dance needed. The editor
// registers them client-side via the FontFace API.

const MAX_FONT_MB = 8
const FORMAT_BY_EXT: Record<string, string> = {
  ttf: 'truetype',
  otf: 'opentype',
  woff: 'woff',
  woff2: 'woff2',
}

/** list the caller's uploaded fonts (session or anon attribution) */
async function __canvix_get(req: NextRequest) {
  try {
    const user = await getSessionUser(req)
    let anonKey: string | null = null
    if (!user) {
      const token = readAnonToken(req)
      if (!token) return NextResponse.json({ fonts: [] })
      anonKey = anonKeyHash(token)
    }
    const rows = await db.media.findMany({
      where: {
        mime: { startsWith: 'font/' },
        keepInLibrary: true,
        ...(user ? { ownerId: user.id } : { anonKey }),
      },
      select: { id: true, name: true, size: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return NextResponse.json({
      fonts: rows.map((r) => {
        const ext = (r.name ?? '').split('.').pop()?.toLowerCase() ?? 'ttf'
        return {
          id: r.id,
          // family label = filename without extension, spaces legal in css
          family: (r.name ?? 'Custom font').replace(/\.[^.]+$/, '').slice(0, 60) || 'Custom font',
          url: `/api/media/${r.id}`,
          format: FORMAT_BY_EXT[ext] ?? 'truetype',
        }
      }),
    })
  } catch {
    return NextResponse.json({ fonts: [] })
  }
}

/** upload a font file — raw body, ?family= display name, ?ext= ttf|otf|woff|woff2 */
async function __canvix_post(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const limit = checkRateLimit(req, 'media:init')
  if (!limit.ok) return rateLimitResponse(limit)
  try {
    const family = (req.nextUrl.searchParams.get('family') ?? '').trim().slice(0, 60)
    const ext = (req.nextUrl.searchParams.get('ext') ?? 'ttf').toLowerCase()
    if (!family || !/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(family)) {
      return NextResponse.json({ error: 'Provide a font name (letters, digits, spaces).' }, { status: 400 })
    }
    if (!FORMAT_BY_EXT[ext]) {
      return NextResponse.json({ error: 'Only .ttf, .otf, .woff and .woff2 files are supported.' }, { status: 415 })
    }
    const mime = `font/${ext === 'ttf' ? 'ttf' : ext === 'otf' ? 'otf' : ext}`

    const bytes = new Uint8Array(await req.arrayBuffer())
    if (!bytes.length || bytes.length > MAX_FONT_MB * 1024 * 1024) {
      return NextResponse.json({ error: `Font must be between 1 byte and ${MAX_FONT_MB} MB.` }, { status: 413 })
    }

    const user = await getSessionUser(req)
    const token = readAnonToken(req) ?? newAnonToken()
    const ownerId = user?.id ?? null
    const anonKey = user ? null : anonKeyHash(token)

    const media = await db.media.create({
      data: {
        mime,
        size: bytes.length,
        bytes,
        ownerId,
        anonKey,
        name: `${family}.${ext}`,
        keepInLibrary: true,
        finalizedAt: new Date(),
      },
      select: { id: true },
    })
    const res = NextResponse.json(
      { id: media.id, family, url: `/api/media/${media.id}`, format: FORMAT_BY_EXT[ext] },
      { status: 201 },
    )
    if (!user) setAnonCookie(res, token)
    return res
  } catch {
    return NextResponse.json({ error: 'Upload failed — try again.' }, { status: 500 })
  }
}

/** remove an uploaded font */
async function __canvix_delete(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  try {
    const id = req.nextUrl.searchParams.get('id') ?? ''
    if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 })
    const user = await getSessionUser(req)
    const token = readAnonToken(req)
    const anonKey = user ? null : token ? anonKeyHash(token) : null
    const where = user
      ? { id, ownerId: user.id }
      : { id, anonKey: anonKey ?? '__none__' }
    const removed = await db.media.deleteMany({ where })
    if (!removed.count) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Delete failed.' }, { status: 500 })
  }
}

export const GET = withLogging('GET /api/fonts/custom', __canvix_get)
export const POST = withLogging('POST /api/fonts/custom', __canvix_post)
export const DELETE = withLogging('DELETE /api/fonts/custom', __canvix_delete)
