import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'

export const runtime = 'nodejs'
export const maxDuration = 30

// ── v0.11 media store: append / finalize / stream ────────────
// See POST /api/media for the protocol. The append is a single raw SQL
// UPDATE with an offset guard (`octet_length(bytes) = $offset`) so a
// retried or racing chunk can never corrupt the byte stream.

const MAX_CHUNK = 3 * 1024 * 1024 + 64 * 1024 // transport headroom over the client chunk size

/** PATCH /api/media/[id]?offset=<n> — append one chunk (raw body). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    await db.media.update({ where: { id }, data: { finalizedAt: new Date() } })
    return NextResponse.json({ id })
  } catch (error) {
    console.error('[media/finalize] failed', error)
    return NextResponse.json({ error: 'Could not finalize the upload.' }, { status: 500 })
  }
}

/** GET /api/media/[id] — stream the bytes (Range-aware for <audio>/<video>
 * seeking). Finalized media only; immutable content-addressed by id. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
