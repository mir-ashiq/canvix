import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth/session'
import { anonKeyHash, readAnonToken } from '@/lib/auth/anon'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'

// ── v0.14 (D1): the persistent uploads library ───────────────
// GET /api/media/library — the caller's kept uploads (images, audio,
// video), projection only (never the bytes):
//
//   { items: [{ id, mime, name, size, createdAt }], usedBytes, quotaBytes }
//
// Attribution mirrors the media store itself: signed-in → ownerId,
// otherwise the canvix_anon cookie → anonKey. Anonymous visitors get
// their own session library (uploads survive reloads in that browser);
// signing in claims the rows (see src/lib/auth/claim-media.ts), so the
// library follows the account across devices.

const QUOTA_MB = Math.max(8, Number(process.env.CANVIX_UPLOAD_QUOTA_MB ?? 256))
const LIST_LIMIT = 100

async function __canvix_get(req: NextRequest) {
  try {
    const user = await getSessionUser(req)
    const token = readAnonToken(req)
    const ownerId = user?.id ?? null
    const anonKey = user ? null : token ? anonKeyHash(token) : null

    if (!ownerId && !anonKey) {
      // no attribution at all (fresh browser, nothing uploaded yet) —
      // an honest empty library rather than an error
      return NextResponse.json({ items: [], usedBytes: 0, quotaBytes: QUOTA_MB * 1024 * 1024 })
    }

    const items = await db.$queryRawUnsafe<
      { id: string; mime: string; name: string | null; size: number; createdAt: Date }[]
    >(
      `SELECT id, mime, name, size, "createdAt" FROM "Media"
        WHERE "keepInLibrary" = true AND "finalizedAt" IS NOT NULL AND (
          ("ownerId" = $1 AND $1 IS NOT NULL) OR ("anonKey" = $2 AND $2 IS NOT NULL))
        ORDER BY "createdAt" DESC LIMIT ${LIST_LIMIT}`,
      ownerId,
      anonKey,
    )
    const usedRows = await db.$queryRawUnsafe<{ used: bigint | number }[]>(
      `SELECT COALESCE(SUM(size), 0)::bigint AS used FROM "Media"
        WHERE "keepInLibrary" = true AND "finalizedAt" IS NOT NULL AND (
          ("ownerId" = $1 AND $1 IS NOT NULL) OR ("anonKey" = $2 AND $2 IS NOT NULL))`,
      ownerId,
      anonKey,
    )
    return NextResponse.json({
      items: items.map((m) => ({
        id: m.id,
        mime: m.mime,
        name: m.name,
        size: m.size,
        createdAt: m.createdAt,
      })),
      usedBytes: Number(usedRows[0]?.used ?? 0),
      quotaBytes: QUOTA_MB * 1024 * 1024,
    })
  } catch (error) {
    console.error('[media/library] failed', error)
    return NextResponse.json({ error: 'Could not load the uploads library.' }, { status: 500 })
  }
}

export const GET = withLogging('GET /api/media/library', __canvix_get)
