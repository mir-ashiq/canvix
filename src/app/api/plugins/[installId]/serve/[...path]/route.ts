import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbErrorResponse } from '@/lib/db-errors'
import { withLogging } from '@/lib/observability'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { PLUGINS_DISABLED, pluginsEnabled } from '@/lib/plugins/flag'
import { mimeForPath } from '@/lib/plugins/install'
import { pluginServeCsp } from '@/lib/security/plugin-csp'

// ─────────────────────────────────────────────────────────────
// GET /api/plugins/<installId>/serve/<path> — the plugin asset
// route (research §4.2/§4.6). Files are served from the Postgres
// snapshot (sha256-pinned at install); the runtime never fetches.
//
// Every response carries the per-manifest CSP built by
// plugin-csp.ts from the CONSENTED network origins — an empty
// grant list collapses connect-src to 'none', which is a real
// exfiltration wall (CSP governs fetch/XHR/beacons in every
// mode, including no-cors).
//
// Auth design (deliberate, documented):
//   The route requires NO session. Plugin assets are third-party
//   code the user already consented to — not user data — and the
//   sandboxed iframe (<iframe sandbox> = opaque origin) cannot
//   reliably carry SameSite=Lax cookies on its navigation or
//   subresource loads anyway. The boundary that matters:
//     · installIds are unguessable cuids
//     · frame-ancestors 'self' — only this Canvix may embed it
//     · per-IP rate limit ('plugins:serve') bounds scraping
//     · CANVIX_PLUGINS off + enabled=false both hard-disable
//   Design data NEVER flows through this route (that is the RPC
//   broker's job, P3). If per-user asset privacy ever becomes a
//   requirement (it is not in the MVP model — plugins are public
//   URLs at install time), the upgrade path is short-lived
//   signed serve tokens minted by the mounting component.
// ─────────────────────────────────────────────────────────────

async function __canvix_get(
  req: NextRequest,
  { params }: { params: Promise<{ installId: string; path?: string[] }> },
) {
  if (!pluginsEnabled()) {
    return NextResponse.json(PLUGINS_DISABLED, { status: 503 })
  }
  const limit = checkRateLimit(req, 'plugins:serve')
  if (!limit.ok) return rateLimitResponse(limit)
  const { installId, path } = await params
  try {
    // normalize: reject traversal outright, join the segments
    const rel = (path ?? []).join('/')
    if (!rel || rel.includes('..') || rel.includes('\\') || rel.startsWith('/')) {
      return NextResponse.json({ error: 'Bad path.', code: 'E_PATH' }, { status: 400 })
    }
    const mime = mimeForPath(rel)
    if (!mime) {
      return NextResponse.json(
        { error: 'Unsupported file type.', code: 'E_MIME' },
        { status: 415 },
      )
    }

    const install = await db.pluginInstall.findUnique({
      where: { id: installId },
      select: {
        enabled: true,
        manifest: true,
        assets: { where: { path: rel }, select: { bytes: true, sha256: true }, take: 1 },
      },
    })
    if (!install || !install.enabled || install.assets.length === 0) {
      // one shape for "not yours / disabled / missing" — no oracle
      return NextResponse.json({ error: 'No such file.', code: 'E_NOT_FOUND' }, { status: 404 })
    }

    const asset = install.assets[0]
    const manifest = install.manifest as unknown as { permissions?: string[] }
    const networkOrigins = (manifest.permissions ?? [])
      .filter((p) => p.startsWith('network:'))
      .map((p) => p.slice('network:'.length))

    const etag = `"${asset.sha256}"`
    if (req.headers.get('if-none-match') === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: etag,
          'Content-Security-Policy': pluginServeCsp(networkOrigins),
        },
      })
    }

    return new NextResponse(Buffer.from(asset.bytes), {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Security-Policy': pluginServeCsp(networkOrigins),
        'Cache-Control': 'private, max-age=300, must-revalidate',
        ETag: etag,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    })
  } catch (error) {
    return dbErrorResponse(error, 'GET /api/plugins/[installId]/serve/[...path]')
  }
}

export const GET = withLogging('GET /api/plugins/[installId]/serve/[...path]', __canvix_get)
