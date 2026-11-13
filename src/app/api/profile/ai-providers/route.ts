import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { rateLimit } from '@/lib/ai/provider'
import { listUserProviders, validateUserProvider, saveUserProvider, updateUserProvider, deleteUserProvider } from '@/lib/ai/byok'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ─────────────────────────────────────────────────────────────
// /api/profile/ai-providers — the BYOK CRUD surface (v0.23).
//
//   GET    → the user's saved providers (keys masked — never returned)
//   POST   → save a new one { label, baseUrl, apiKey, slots, models? }
//   PUT    → edit one        { id, label, baseUrl, apiKey?, slots, models? }
//            (absent/empty apiKey KEEPS the stored key — write-only)
//   DELETE → remove one      ?id=…
//
// Signed-in users only; same-origin enforced on every mutation; a
// generous-but-bounded rate limit stops scripted abuse. Validation
// reuses the admin table's rules so both surfaces accept the same
// shapes (documented in README → "Bring your own key").
// ─────────────────────────────────────────────────────────────

const NO_SESSION = { error: 'Sign in to manage your AI providers.' } as const

async function __canvix_get(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json(NO_SESSION, { status: 401 })
  const providers = await listUserProviders(user.id)
  return NextResponse.json({ providers })
}

async function __canvix_post(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json(NO_SESSION, { status: 401 })
  const rl = rateLimit('byok:save', req, 20, 600)
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many saves — try again in ${rl.retryAfterSec}s.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    )
  }
  try {
    const body = await req.json().catch(() => null)
    const check = validateUserProvider(body)
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })
    const saved = await saveUserProvider(user.id, check.value)
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 400 })
    return NextResponse.json({ provider: saved.value }, { status: 201 })
  } catch (error) {
    console.error('POST /api/profile/ai-providers failed', error)
    return NextResponse.json({ error: 'Could not save the provider.' }, { status: 500 })
  }
}

async function __canvix_put(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json(NO_SESSION, { status: 401 })
  const rl = rateLimit('byok:save', req, 20, 600)
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many saves — try again in ${rl.retryAfterSec}s.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    )
  }
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body.id !== 'string' || !body.id) {
      return NextResponse.json({ error: 'Provider id is required.' }, { status: 400 })
    }
    // The edit path may omit the apiKey — the stored key is kept then.
    const check = validateUserProvider(body)
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })
    const saved = await updateUserProvider(user.id, body.id, check.value)
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 404 })
    return NextResponse.json({ provider: saved.value })
  } catch (error) {
    console.error('PUT /api/profile/ai-providers failed', error)
    return NextResponse.json({ error: 'Could not update the provider.' }, { status: 500 })
  }
}

async function __canvix_delete(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json(NO_SESSION, { status: 401 })
  const rl = rateLimit('byok:save', req, 20, 600)
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many requests — try again in ${rl.retryAfterSec}s.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    )
  }
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Provider id is required.' }, { status: 400 })
    const removed = await deleteUserProvider(user.id, id)
    if (!removed) return NextResponse.json({ error: 'Provider not found.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE /api/profile/ai-providers failed', error)
    return NextResponse.json({ error: 'Could not remove the provider.' }, { status: 500 })
  }
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const GET = withLogging('GET /api/profile/ai-providers', __canvix_get)
export const POST = withLogging('POST /api/profile/ai-providers', __canvix_post)
export const PUT = withLogging('PUT /api/profile/ai-providers', __canvix_put)
export const DELETE = withLogging('DELETE /api/profile/ai-providers', __canvix_delete)
