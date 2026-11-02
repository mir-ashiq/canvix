import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { dbErrorResponse } from '@/lib/db-errors'
import { getSessionUser } from '@/lib/auth/session'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { withLogging, APP_VERSION } from '@/lib/observability'
import { PLUGINS_DISABLED, pluginsEnabled } from '@/lib/plugins/flag'
import { collectBundle } from '@/lib/plugins/install'
import { describePermission, parsePermission } from '@/lib/plugins/permissions'

// ─────────────────────────────────────────────────────────────
// /api/plugins — list + install (research §4.2).
//
//   GET  /api/plugins          → this user's installs (metadata +
//                                consent-screen payload, never bytes)
//   POST /api/plugins          → install from a manifest URL:
//                                safeFetch → validate → pin → store
//
// Gating: CANVIX_PLUGINS (default off) → 503 for every method.
// Auth: installs are per-user rows — a signed-in session is
// required (401 otherwise). CSRF: same-origin on the POST (the
// existing discipline). Rate: 'plugins:install' per IP.
//
// Consent happens CLIENT-side between POST and use: the response
// carries the full manifest + plain-language permission lines so
// the UI can show exactly what is being granted before the first
// iframe ever mounts. The install row is the grant of record.
// ─────────────────────────────────────────────────────────────

function notEnabled() {
  return NextResponse.json(PLUGINS_DISABLED, { status: 503 })
}

function unauthorized() {
  return NextResponse.json(
    { error: 'Sign in to manage plugins.', code: 'AUTH_REQUIRED' },
    { status: 401 },
  )
}

/** The client-facing projection of an install row (no bytes, no userId). */
function installSummary(row: {
  id: string
  pluginId: string
  version: string
  enabled: boolean
  createdAt: Date
  manifest: Prisma.JsonValue
}) {
  const m = row.manifest as unknown as {
    name?: string
    description?: string
    author?: { name?: string }
    permissions?: string[]
    entry?: { panel?: string }
  }
  const permissions = (m.permissions ?? []).map((p) => {
    const parsed = parsePermission(p)
    return parsed
      ? { permission: parsed.permission, description: describePermission(parsed) }
      : { permission: p, description: p }
  })
  return {
    id: row.id,
    pluginId: row.pluginId,
    name: m.name ?? row.pluginId,
    description: m.description ?? null,
    author: m.author?.name ?? null,
    version: row.version,
    enabled: row.enabled,
    entry: m.entry ?? {},
    permissions,
    createdAt: row.createdAt,
  }
}

async function __canvix_get(req: NextRequest) {
  if (!pluginsEnabled()) return notEnabled()
  const user = await getSessionUser(req)
  if (!user) return unauthorized()
  try {
    const rows = await db.pluginInstall.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        pluginId: true,
        version: true,
        enabled: true,
        createdAt: true,
        manifest: true,
      },
    })
    return NextResponse.json({ installs: rows.map(installSummary) })
  } catch (error) {
    return dbErrorResponse(error, 'GET /api/plugins')
  }
}

async function __canvix_post(req: NextRequest) {
  if (!pluginsEnabled()) return notEnabled()
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const limit = checkRateLimit(req, 'plugins:install')
  if (!limit.ok) return rateLimitResponse(limit)
  const user = await getSessionUser(req)
  if (!user) return unauthorized()
  try {
    const body = (await req.json().catch(() => ({}))) as { manifestUrl?: unknown }
    const manifestUrl = typeof body.manifestUrl === 'string' ? body.manifestUrl.trim() : ''
    if (!manifestUrl) {
      return NextResponse.json(
        { error: 'manifestUrl is required.', code: 'E_URL' },
        { status: 400 },
      )
    }

    const hostVersion = APP_VERSION.includes('.') ? APP_VERSION : '0.13.0'
    const collected = await collectBundle(manifestUrl, {
      hostAppVersion: hostVersion,
    })
    if (!collected.ok) {
      const status =
        collected.error.code === 'E_MANIFEST' || collected.error.code === 'E_URL' ? 422 : 502
      return NextResponse.json(
        { error: collected.error.message, code: collected.error.code },
        { status },
      )
    }

    const { manifest, networkOrigins, assets, totalBytes } = collected.bundle

    // one row per (userId, pluginId): a reinstall atomically replaces
    // the previous snapshot — no version mixing, no orphan assets
    const row = await db.$transaction(async (tx) => {
      await tx.pluginAsset.deleteMany({
        where: { install: { userId: user.id, pluginId: manifest.id } },
      })
      await tx.pluginInstall.deleteMany({
        where: { userId: user.id, pluginId: manifest.id },
      })
      return tx.pluginInstall.create({
        data: {
          userId: user.id,
          pluginId: manifest.id,
          version: manifest.version,
          manifest: manifest as unknown as Prisma.InputJsonValue,
          enabled: true,
          assets: {
            create: assets.map((a) => ({
              path: a.path,
              mime: a.mime,
              bytes: Buffer.from(a.bytes),
              sha256: a.sha256,
            })),
          },
        },
        include: { assets: { select: { path: true, sha256: true } } },
      })
    })

    return NextResponse.json(
      {
        install: installSummary(row),
        files: row.assets.map((a) => ({ path: a.path, sha256: a.sha256 })),
        networkOrigins,
        totalBytes,
      },
      { status: 201 },
    )
  } catch (error) {
    return dbErrorResponse(error, 'POST /api/plugins')
  }
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const GET = withLogging('GET /api/plugins', __canvix_get)
export const POST = withLogging('POST /api/plugins', __canvix_post)
