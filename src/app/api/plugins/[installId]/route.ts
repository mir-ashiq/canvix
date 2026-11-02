import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbErrorResponse } from '@/lib/db-errors'
import { getSessionUser } from '@/lib/auth/session'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { withLogging } from '@/lib/observability'
import { PLUGINS_DISABLED, pluginsEnabled } from '@/lib/plugins/flag'

// ─────────────────────────────────────────────────────────────
// /api/plugins/<installId> — the user's controls on one install
// (research §4.2/§4.3):
//
//   PATCH  { enabled: boolean } → the per-plugin kill switch
//   DELETE                      → uninstall (row + assets)
//
// Uninstall NEVER deletes elements — plugin elements are plain
// elements in design jsonb; worst case they degrade to
// placeholders (P4). Data is never the price of an uninstall.
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

async function __canvix_patch(req: NextRequest, { params }: { params: Promise<{ installId: string }> }) {
  if (!pluginsEnabled()) return notEnabled()
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const user = await getSessionUser(req)
  if (!user) return unauthorized()
  const { installId } = await params
  try {
    const body = (await req.json().catch(() => ({}))) as { enabled?: unknown }
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled (boolean) is required.', code: 'E_BODY' },
        { status: 400 },
      )
    }
    const row = await db.pluginInstall.updateMany({
      where: { id: installId, userId: user.id },
      data: { enabled: body.enabled },
    })
    if (row.count === 0) {
      return NextResponse.json({ error: 'No such install.', code: 'E_NOT_FOUND' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, enabled: body.enabled })
  } catch (error) {
    return dbErrorResponse(error, 'PATCH /api/plugins/[installId]')
  }
}

async function __canvix_delete(req: NextRequest, { params }: { params: Promise<{ installId: string }> }) {
  if (!pluginsEnabled()) return notEnabled()
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const user = await getSessionUser(req)
  if (!user) return unauthorized()
  const { installId } = await params
  try {
    // assets cascade on install delete (FK onDelete: Cascade)
    const row = await db.pluginInstall.deleteMany({
      where: { id: installId, userId: user.id },
    })
    if (row.count === 0) {
      return NextResponse.json({ error: 'No such install.', code: 'E_NOT_FOUND' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return dbErrorResponse(error, 'DELETE /api/plugins/[installId]')
  }
}

export const PATCH = withLogging('PATCH /api/plugins/[installId]', __canvix_patch)
export const DELETE = withLogging('DELETE /api/plugins/[installId]', __canvix_delete)
