import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth/session'
import {
  readAnonToken,
  newAnonToken,
  anonKeyHash,
  setAnonCookie,
} from '@/lib/auth/anon'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'

// ── v0.14 (D6): dashboard folders ────────────────────────────
//   GET  /api/folders — the caller's folders, with live design counts
//   POST /api/folders { name } — create a folder
//
// Folders are PRIVATE organization: attribution mirrors the rest of
// the app (signed-in → ownerId, else the canvix_anon cookie →
// anonKey), and every query is scoped to exactly one attribution.
// The designs inside keep their own visibility — an ownerless design
// stays in the anonymous commons; the folder is just the caller's
// grouping of it. Signing in claims anonymous folders (claim-folders),
// so the tree follows the account across devices.

const FOLDERS_LIMIT = 200 // rows returned by the list
const MAX_FOLDERS = 50 // per attribution — junk ceiling
const MAX_NAME = 60

function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.replace(/[\\/]|\.\./g, '').trim().slice(0, MAX_NAME)
  return trimmed || null
}

async function __canvix_get(req: NextRequest) {
  try {
    const user = await getSessionUser(req)
    const token = readAnonToken(req)
    const ownerId = user?.id ?? null
    const anonKey = user ? null : token ? anonKeyHash(token) : null

    if (!ownerId && !anonKey) {
      // no attribution at all (fresh browser) — an honest empty tree
      return NextResponse.json({ folders: [] })
    }

    // LEFT JOIN counts only LIVE designs (trashed rows still belong to
    // their folder and return on restore, but they are not clutter for
    // the count). Attribution scoping is in the WHERE, never the join.
    const rows = await db.$queryRawUnsafe<
      { id: string; name: string; createdAt: Date; designCount: number }[]
    >(
      `SELECT f.id, f.name, f."createdAt", COUNT(d.id)::int AS "designCount"
         FROM "Folder" f
         LEFT JOIN "Design" d ON d."folderId" = f.id AND d."deletedAt" IS NULL
        WHERE (f."ownerId" = $1 AND $1 IS NOT NULL) OR (f."anonKey" = $2 AND $2 IS NOT NULL)
        GROUP BY f.id, f.name, f."createdAt"
        ORDER BY f."createdAt" ASC
        LIMIT ${FOLDERS_LIMIT}`,
      ownerId,
      anonKey,
    )
    return NextResponse.json({
      folders: rows.map((f) => ({
        id: f.id,
        name: f.name,
        createdAt: f.createdAt,
        designCount: f.designCount,
      })),
    })
  } catch (error) {
    console.error('[api/folders] list failed', error)
    return NextResponse.json({ error: 'Could not load folders.' }, { status: 500 })
  }
}

async function __canvix_post(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const limit = checkRateLimit(req, 'folders:create')
  if (!limit.ok) return rateLimitResponse(limit)
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: unknown }
    const name = sanitizeName(body.name)
    if (!name) return NextResponse.json({ error: 'A folder name is required.' }, { status: 400 })

    const user = await getSessionUser(req)

    if (user) {
      const existing = await db.folder.count({
        where: { ownerId: user.id },
      })
      if (existing >= MAX_FOLDERS) {
        return NextResponse.json(
          { error: `Folder limit reached (${MAX_FOLDERS}). Delete one first.` },
          { status: 409 },
        )
      }
      const folder = await db.folder.create({
        data: { name, ownerId: user.id },
        select: { id: true, name: true, createdAt: true },
      })
      return NextResponse.json({ folder: { ...folder, designCount: 0 } }, { status: 201 })
    }

    // Anonymous: mint/refresh this browser's attribution, stamp the row
    const token = readAnonToken(req) ?? newAnonToken()
    const existing = await db.folder.count({
      where: { anonKey: anonKeyHash(token) },
    })
    if (existing >= MAX_FOLDERS) {
      return NextResponse.json(
        { error: `Folder limit reached (${MAX_FOLDERS}). Delete one first.` },
        { status: 409 },
      )
    }
    const folder = await db.folder.create({
      data: { name, anonKey: anonKeyHash(token) },
      select: { id: true, name: true, createdAt: true },
    })
    const res = NextResponse.json({ folder: { ...folder, designCount: 0 } }, { status: 201 })
    setAnonCookie(res, token)
    return res
  } catch (error) {
    console.error('[api/folders] create failed', error)
    return NextResponse.json({ error: 'Could not create the folder.' }, { status: 500 })
  }
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const GET = withLogging('GET /api/folders', __canvix_get)
export const POST = withLogging('POST /api/folders', __canvix_post)
