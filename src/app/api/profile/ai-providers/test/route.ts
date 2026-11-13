import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { rateLimit, describeProviderError } from '@/lib/ai/provider'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const maxDuration = 30
export const dynamic = 'force-dynamic'

// ─────────────────────────────────────────────────────────────
// POST /api/profile/ai-providers/test — "Test connection" (v0.23).
//
// Body: { id } — an already-saved provider of the signed-in user.
// Runs a minimal chat completion against the provider's text slot
// (one short prompt, max ~8 output tokens) and answers ok / the
// scrubbed failure reason. Never returns the key, never logs it.
//
// The probe deliberately uses the provider's OWN endpoint with its
// OWN key — same contract as the admin console's Test connection,
// so a user can verify their setup before relying on it in the
// editor. Failure reasons are scrubbed by describeProviderError.
// ─────────────────────────────────────────────────────────────

async function __canvix_post(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'Sign in to test your AI providers.' }, { status: 401 })
  // A test call is a real provider round-trip — keep the cap tight.
  const rl = rateLimit('byok:test', req, 6, 600)
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many tests — try again in ${rl.retryAfterSec}s.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    )
  }
  try {
    const body = (await req.json().catch(() => null)) as { id?: string } | null
    if (!body?.id) return NextResponse.json({ error: 'Provider id is required.' }, { status: 400 })

    // Resolve the user's row — scoped to THIS user, key never leaves the server.
    const { db } = await import('@/lib/db')
    const row = await db.userAIProvider.findFirst({ where: { id: body.id, userId: user.id } })
    if (!row) return NextResponse.json({ error: 'Provider not found.' }, { status: 404 })

    // Minimal SDK round-trip through the provider's own endpoint.
    const { makeClient } = await import('@/lib/ai/provider')
    const models = (row.models ?? {}) as Record<string, string | undefined>
    try {
      const zai = await makeClient(row.baseUrl, row.apiKey)
      const completion = await zai.chat.completions.create({
        model: models.text ?? 'glm-4.7',
        messages: [{ role: 'user', content: 'Reply with the word: ok' }],
        max_tokens: 8,
      })
      const text = completion?.choices?.[0]?.message?.content ?? ''
      return NextResponse.json({
        ok: true,
        model: models.text ?? 'glm-4.7',
        sample: String(text).slice(0, 80),
      })
    } catch (err) {
      const info = describeProviderError(err)
      return NextResponse.json({ ok: false, error: info.message }, { status: 502 })
    }
  } catch (error) {
    console.error('POST /api/profile/ai-providers/test failed', error)
    return NextResponse.json({ error: 'Test failed.' }, { status: 500 })
  }
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const POST = withLogging('POST /api/profile/ai-providers/test', __canvix_post)
