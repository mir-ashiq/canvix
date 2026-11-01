import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { getSessionUser } from '@/lib/auth/session'
import { anonKeyHash, newAnonToken, readAnonToken, setAnonCookie } from '@/lib/auth/anon'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const maxDuration = 30

// ── v0.11 media store: upload init ───────────────────────────
// Serverless body limits (Vercel 4.5 MB) force chunked uploads:
//   POST /api/media            { mime, size, name? } → 201 { id, chunkSize }
//   PATCH /api/media/<id>?off=  raw chunk bytes       → 200 { size }
//   PUT  /api/media/<id>        { expectedSize }      → 200 { id }
//   GET  /api/media/<id>        stream (Range-aware)  → 200/206

/** default cap: 32 MB per file (audio usually ≤ 8 MB, video ≤ 32 MB) */
const MAX_MEDIA_MB = Math.max(1, Number(process.env.CANVIX_MAX_MEDIA_MB ?? 32))

const ALLOWED_PREFIXES = ['audio/', 'video/']

async function __canvix_post(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  // v0.12.3 (H5): uploads are chunked but initiation is cheap — cap
  // the init calls, not the chunk traffic (chunks carry real bytes).
  const limit = checkRateLimit(req, 'media:init')
  if (!limit.ok) return rateLimitResponse(limit)
  try {
    const body = (await req.json().catch(() => ({}))) as { mime?: unknown; size?: unknown }
    const mime = typeof body.mime === 'string' ? body.mime.slice(0, 100) : ''
    const size = Number(body.size)

    if (!ALLOWED_PREFIXES.some((p) => mime.startsWith(p))) {
      return NextResponse.json({ error: 'Only audio and video files are supported.' }, { status: 415 })
    }
    if (!Number.isFinite(size) || size <= 0 || size > MAX_MEDIA_MB * 1024 * 1024) {
      return NextResponse.json(
        { error: `File must be between 1 byte and ${MAX_MEDIA_MB} MB.` },
        { status: 413 },
      )
    }

    // ownership stamping mirrors designs: account id or anon cookie hash
    const user = await getSessionUser(req)
    const token = readAnonToken(req) ?? newAnonToken()
    const ownerId = user?.id ?? null
    const anonKey = user ? null : anonKeyHash(token)

    // lazy GC: abandoned (never finalized) uploads die after 24 h
    await db.media
      .deleteMany({ where: { finalizedAt: null, createdAt: { lt: new Date(Date.now() - 86_400_000) } } })
      .catch(() => { /* GC is best-effort */ })

    const media = await db.media.create({
      data: {
        mime,
        size: Math.round(size),
        bytes: new Uint8Array(0),
        ownerId,
        anonKey,
      },
      select: { id: true },
    })

    const res = NextResponse.json({ id: media.id, chunkSize: 3 * 1024 * 1024 }, { status: 201 })
    if (!user) setAnonCookie(res, token)
    return res
  } catch (error) {
    console.error('[media/init] failed', error)
    return NextResponse.json({ error: 'Could not start the upload.' }, { status: 500 })
  }
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const POST = withLogging('POST /api/media', __canvix_post)
