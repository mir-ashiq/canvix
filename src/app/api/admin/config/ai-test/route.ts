import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/guard'
import { resolveProvider, getZAI, getTextModel, rateLimit } from '@/lib/ai/provider'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/admin/config/ai-test — "does the provider actually answer?"
// One minimal chat completion (thinking disabled, one-word reply) with a
// 15 s circuit breaker. Admin-only and rate-limited to one probe per 10 s
// — it is the one console action that spends real provider quota, and it
// must never become a proxy for chatty automation.

const TEST_TIMEOUT_MS = 15_000

async function __canvix_post(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.res

  const rl = rateLimit('admin:ai-test', req, 1, 10)
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: `Wait ${rl.retryAfterSec}s between provider tests.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    )
  }

  const provider = await resolveProvider()
  if (!provider) {
    return NextResponse.json(
      { ok: false, error: 'No AI provider is configured — set one on this page or via ZAI_BASE_URL/ZAI_API_KEY.' },
      { status: 503 }
    )
  }

  try {
    const zai = await getZAI()
    if (!zai) return NextResponse.json({ ok: false, error: 'Provider initialization failed.' }, { status: 502 })
    const model = await getTextModel()
    const completion = await Promise.race([
      zai.chat.completions.create({
        ...(model ? { model } : {}),
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        thinking: { type: 'disabled' },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('provider timed out')), TEST_TIMEOUT_MS)
      ),
    ])
    const reply = String(
      (completion as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? ''
    ).slice(0, 120)
    return NextResponse.json({
      ok: true,
      source: provider.source,
      model: model ?? 'sdk-default',
      reply: reply || '(empty reply)',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, error: message.slice(0, 300) }, { status: 502 })
  }
}

export const POST = withLogging('POST /api/admin/config/ai-test', __canvix_post)
