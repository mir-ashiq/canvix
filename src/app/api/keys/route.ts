import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbErrorResponse } from '@/lib/db-errors'
import { getSessionUser } from '@/lib/auth/session'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { newApiKeyValue, apiKeyIdFor, parseScopes, API_KEY_SCOPES } from '@/lib/auth/api-key'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// /api/keys — manage the signed-in user's own API keys (v0.24).
//
//   GET    → list (masked: label, scopes, created/lastUsed/revoked)
//   POST   → create: body { label, scopes: string[] } → the RAW key is
//            returned exactly once; nothing can show it again (only
//            its sha256 is stored, same shape as Session).
//
// Session + same-origin only — key management is a browser action; the
// REST surface itself is what keys unlock. Rate-limited like auth
// routes (key creation is credential creation).

const MAX_KEYS_PER_USER = 20
const LABEL_MAX = 40

async function __canvix_get(req: NextRequest) {
  try {
    const user = await getSessionUser(req)
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    const keys = await db.apiKey.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, label: true, scopes: true, createdAt: true, lastUsedAt: true, expiresAt: true, revokedAt: true },
    })
    return NextResponse.json({ keys })
  } catch (error) {
    return dbErrorResponse(error, 'GET /api/keys')
  }
}

async function __canvix_post(req: NextRequest) {
  try {
    const user = await getSessionUser(req)
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })

    const rl = checkRateLimit(req, 'keys:create')
    if (!rl.ok) return rateLimitResponse(rl)

    const body = await req.json().catch(() => null)
    const label = typeof body?.label === 'string' ? body.label.trim().slice(0, LABEL_MAX) : ''
    if (!label) return NextResponse.json({ error: 'A label is required (what is this key for?)' }, { status: 400 })

    // scopes: array of known scopes, or 'all' (sugar for every scope)
    const raw = Array.isArray(body?.scopes) ? body.scopes.filter((s: unknown) => typeof s === 'string').join(',') : null
    const scopes = parseScopes(raw ?? 'designs:read')
    if (!scopes) {
      return NextResponse.json({ error: `Scopes must be a subset of: ${API_KEY_SCOPES.join(', ')} (or "all")` }, { status: 400 })
    }

    const count = await db.apiKey.count({ where: { userId: user.id, revokedAt: null } })
    if (count >= MAX_KEYS_PER_USER) {
      return NextResponse.json({ error: `Key limit reached (${MAX_KEYS_PER_USER} active keys). Revoke one first.` }, { status: 400 })
    }

    const token = newApiKeyValue()
    const created = await db.apiKey.create({
      data: { id: apiKeyIdFor(token), userId: user.id, label, scopes: scopes.join(',') },
      select: { id: true, label: true, scopes: true, createdAt: true },
    })
    // the only moment the raw token exists in a response body
    return NextResponse.json({ ...created, key: token }, { status: 201 })
  } catch (error) {
    return dbErrorResponse(error, 'POST /api/keys')
  }
}

export const GET = withLogging('GET /api/keys', __canvix_get)
export const POST = withLogging('POST /api/keys', __canvix_post)
