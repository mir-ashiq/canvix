import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const maxDuration = 30

// ── v0.11 media store: append / finalize / stream ────────────
// See POST /api/media for the protocol. The append is a single raw SQL
// UPDATE with an offset guard (`octet_length(bytes) = $offset`) so a
// retried or racing chunk can never corrupt the byte stream.

const MAX_CHUNK = 3 * 1024 * 1024 + 64 * 1024 // transport headroom over the client chunk size

/** PATCH /api/media/[id]?offset=<n> — append one chunk (raw body). */
async function __canvix_patch(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const { id } = await params
  try {
    const offset = Number(req.nextUrl.searchParams.get('offset'))
    if (!Number.isFinite(offset) || offset < 0 || offset > 2 ** 31) {
      return NextResponse.json({ error: 'Bad offset.' }, { status: 400 })
    }
    const chunk = new Uint8Array(await req.arrayBuffer())
    if (!chunk.length) return NextResponse.json({ error: 'Empty chunk.' }, { status: 400 })
    if (chunk.length > MAX_CHUNK) return NextResponse.json({ error: 'Chunk too large.' }, { status: 413 })

    // offset-guarded append: the UPDATE only lands when the stored length
    // matches — a replayed/racing chunk is rejected instead of interleaved
    const updated = await db.$executeRawUnsafe(
      `UPDATE "Media" SET bytes = bytes || $1 WHERE id = $2 AND "finalizedAt" IS NULL AND octet_length(bytes) = $3`,
      Buffer.from(chunk),
      id,
      Math.round(offset),
    )
    if (updated === 0) {
      return NextResponse.json({ error: 'Offset mismatch — restart the upload.' }, { status: 409 })
    }
    const len = await db.$queryRawUnsafe<{ len: number }[]>(
      `SELECT octet_length(bytes)::int AS len FROM "Media" WHERE id = $1`,
      id,
    )
    return NextResponse.json({ size: len[0]?.len ?? offset + chunk.length })
  } catch (error) {
    console.error('[media/append] failed', error)
    return NextResponse.json({ error: 'Could not store the chunk.' }, { status: 500 })
  }
}

/** PUT /api/media/[id] — finalize: verify length, mark complete. */
async function __canvix_put(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const { id } = await params
  try {
    const body = (await req.json().catch(() => ({}))) as { expectedSize?: unknown }
    const expected = Number(body.expectedSize)
    if (!Number.isFinite(expected) || expected <= 0) {
      return NextResponse.json({ error: 'Bad expectedSize.' }, { status: 400 })
    }
    const rows = await db.$queryRawUnsafe<{ len: number }[]>(
      `SELECT octet_length(bytes)::int AS len FROM "Media" WHERE id = $1 AND "finalizedAt" IS NULL`,
      id,
    )
    if (!rows.length) return NextResponse.json({ error: 'Not found or already finalized.' }, { status: 404 })
    if (rows[0].len !== Math.round(expected)) {
      return NextResponse.json(
        { error: `Upload incomplete (${rows[0].len}/${Math.round(expected)} bytes).` },
        { status: 409 },
      )
    }
    // v0.14 (D1): finalize = hash the bytes, dedupe within the SAME
    // attribution (account or anon cookie — never across accounts, so
    // one user's uploads can't be probed through another's), then keep
    // the row in the persistent uploads library.
    const byteRows = await db.$queryRawUnsafe<{ bytes: Buffer; ownerId: string | null; anonKey: Buffer | null }[]>(
      `SELECT bytes, "ownerId", "anonKey" FROM "Media" WHERE id = $1 AND "finalizedAt" IS NULL`,
      id,
    )
    if (!byteRows.length) return NextResponse.json({ error: 'Not found or already finalized.' }, { status: 404 })
    const { ownerId, anonKey } = byteRows[0]
    const contentHash = createHash('sha256').update(byteRows[0].bytes).digest('hex')

    const dupe = await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "Media"
        WHERE "contentHash" = $1 AND "finalizedAt" IS NOT NULL AND id != $2 AND (
          ("ownerId" = $3 AND $3 IS NOT NULL) OR ("anonKey" = $4 AND $4 IS NOT NULL))
        ORDER BY "createdAt" ASC LIMIT 1`,
      contentHash,
      id,
      ownerId,
      anonKey,
    )
    if (dupe.length) {
      // identical bytes already in this attribution's library — the new
      // row is redundant: point the caller at the old id and drop it
      await db.media.delete({ where: { id } }).catch(() => { /* already gone */ })
      return NextResponse.json({ id: dupe[0].id, deduplicated: true })
    }

    await db.media.update({
      where: { id },
      data: { finalizedAt: new Date(), contentHash, keepInLibrary: true },
    })
    return NextResponse.json({ id })
  } catch (error) {
    console.error('[media/finalize] failed', error)
    return NextResponse.json({ error: 'Could not finalize the upload.' }, { status: 500 })
  }
}

/** GET /api/media/[id] — stream the bytes (Range-aware for <audio>/<video>
 * seeking). Finalized media only; immutable content-addressed by id. */
async function __canvix_get(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const rows = await db.$queryRawUnsafe<{ bytes: Buffer; mime: string }[]>(
      `SELECT bytes, mime FROM "Media" WHERE id = $1 AND "finalizedAt" IS NOT NULL`,
      id,
    )
    if (!rows.length) return new Response('Not found', { status: 404 })
    const buf = rows[0].bytes
    const mime = rows[0].mime || 'application/octet-stream'
    const total = buf.length

    const range = req.headers.get('range')
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range)
      if (m) {
        const start = m[1] ? Number(m[1]) : 0
        const end = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1
        if (Number.isFinite(start) && start <= end && start < total) {
          const slice = buf.subarray(start, end + 1)
          return new Response(new Uint8Array(slice), {
            status: 206,
            headers: {
              'Content-Type': mime,
              'Content-Length': String(slice.length),
              'Content-Range': `bytes ${start}-${end}/${total}`,
              'Accept-Ranges': 'bytes',
              'Cache-Control': 'public, max-age=31536000, immutable',
            },
          })
        }
      }
      // malformed / out-of-range → 416 per RFC
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${total}` },
      })
    }

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(total),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    console.error('[media/get] failed', error)
    return new Response('Media unavailable', { status: 500 })
  }
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const PATCH = withLogging('PATCH /api/media/[id]', __canvix_patch)
export const PUT = withLogging('PUT /api/media/[id]', __canvix_put)
export const GET = withLogging('GET /api/media/[id]', __canvix_get)
