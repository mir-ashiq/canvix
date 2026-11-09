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

// ── v0.17 (Wave 2): user-saved templates ("Save as template") ──
//
//   GET    /api/templates/user        → { templates: [...] }  (caller's)
//   POST   /api/templates/user        → create from the open design
//   DELETE /api/templates/user?id=..   → remove one
//
// Attribution mirrors designs exactly: owning account OR the anon
// cookie hash. Pages pass the same structural validation as design
// saves. Quota: 50 templates per attribution (a template is a full
// document — the cap keeps Postgres jsonb honest).

const MAX_TEMPLATES = 50

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/** array of { id, background?, elements[] } — null when malformed */
function validPagesDocument(value: unknown): { id: string; background?: unknown; elements: unknown[] }[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 200) return null
  const out: { id: string; background?: unknown; elements: unknown[] }[] = []
  for (const page of value) {
    if (typeof page !== 'object' || page === null) return null
    const { id, background, elements } = page as Record<string, unknown>
    if (typeof id !== 'string' || !id.length) return null
    if (!Array.isArray(elements) || elements.length > 2000) return null
    if (elements.some((el) => typeof el !== 'object' || el === null || typeof (el as { type?: unknown }).type !== 'string')) return null
    out.push(background !== undefined ? { id, background, elements } : { id, elements })
  }
  return out
}

/** list the caller's saved templates */
async function __canvix_get(req: NextRequest) {
  try {
    const user = await getSessionUser(req)
    let anonKey: string | null = null
    if (!user) {
      const token = readAnonToken(req)
      if (!token) return NextResponse.json({ templates: [] })
      anonKey = anonKeyHash(token)
    }
    const rows = await db.userTemplate.findMany({
      where: user ? { ownerId: user.id } : { anonKey },
      orderBy: { createdAt: 'desc' },
      take: MAX_TEMPLATES,
    })
    return NextResponse.json({
      templates: rows.map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        width: t.width,
        height: t.height,
        accent: t.accent,
        pages: t.pages ?? [],
        createdAt: t.createdAt,
      })),
    })
  } catch (error) {
    return dbErrorResponse(error, 'GET /api/templates/user')
  }
}

/** save the current document as a reusable template */
async function __canvix_post(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const limit = checkRateLimit(req, 'templates:fill')
  if (!limit.ok) return rateLimitResponse(limit)
  try {
    const body = (await req.json().catch(() => ({}))) as {
      name?: unknown
      category?: unknown
      accent?: unknown
      pages?: unknown
      width?: unknown
      height?: unknown
    }
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
    const category = typeof body.category === 'string' ? body.category : 'social'
    const accent = typeof body.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.accent) ? body.accent : '#00C4CC'
    const width = Number(body.width)
    const height = Number(body.height)
    if (!name) return NextResponse.json({ error: 'Give the template a name.' }, { status: 400 })
    if (!['social', 'presentation', 'print', 'logo', 'thumbnail', 'document'].includes(category)) {
      return NextResponse.json({ error: 'Unknown category.' }, { status: 400 })
    }
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 40 || height < 40 || width > 8000 || height > 8000) {
      return NextResponse.json({ error: 'Invalid page size.' }, { status: 400 })
    }

    // structural validation — same lightweight gate as design saves:
    // array of { id, background?, elements[] }. Accepts a legacy JSON
    // string like the designs route does.
    const rawPages = typeof body.pages === 'string' ? safeJsonParse(body.pages) : body.pages
    const pages = validPagesDocument(rawPages)
    if (!pages || !pages.length) {
      return NextResponse.json({ error: 'The design has no pages to save.' }, { status: 422 })
    }
    const quota = JSON.stringify(pages).length
    if (quota > 4_000_000) {
      return NextResponse.json({ error: 'Design too large to save as a template.' }, { status: 413 })
    }

    const user = await getSessionUser(req)
    const token = readAnonToken(req) ?? newAnonToken()
    const ownerId = user?.id ?? null
    const anonKey = user ? null : anonKeyHash(token)

    // quota check (count first — the cap is small and hard)
    const existing = await db.userTemplate.count({
      where: user ? { ownerId: user.id } : { anonKey },
    })
    if (existing >= MAX_TEMPLATES) {
      return NextResponse.json(
        { error: `Template limit reached (${MAX_TEMPLATES}). Delete some templates first.` },
        { status: 413 },
      )
    }

    const saved = await db.userTemplate.create({
      data: {
        name,
        category,
        width: Math.round(width),
        height: Math.round(height),
        accent,
        pages: pages as never,
        ownerId,
        anonKey,
      },
      select: { id: true, name: true },
    })
    const res = NextResponse.json({ id: saved.id, name: saved.name }, { status: 201 })
    if (!user) setAnonCookie(res, token)
    return res
  } catch (error) {
    return dbErrorResponse(error, 'POST /api/templates/user')
  }
}

/** delete one of the caller's templates */
async function __canvix_delete(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  try {
    const id = req.nextUrl.searchParams.get('id') ?? ''
    if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 })
    const user = await getSessionUser(req)
    const token = readAnonToken(req)
    const anonKey = user ? null : token ? anonKeyHash(token) : null
    const removed = await db.userTemplate.deleteMany({
      where: user ? { id, ownerId: user.id } : { id, anonKey: anonKey ?? '__none__' },
    })
    if (!removed.count) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return dbErrorResponse(error, 'DELETE /api/templates/user')
  }
}

export const GET = withLogging('GET /api/templates/user', __canvix_get)
export const POST = withLogging('POST /api/templates/user', __canvix_post)
export const DELETE = withLogging('DELETE /api/templates/user', __canvix_delete)
