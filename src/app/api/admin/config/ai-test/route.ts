import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/guard'
import { getProviders, AI_SLOTS } from '@/lib/admin/config'
import { resolveSlot, makeClient, rateLimit, type ResolvedSlot } from '@/lib/ai/provider'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/admin/config/ai-test — "does the provider actually answer?"
// One minimal chat completion (thinking disabled, one-word reply) with a
// 15 s circuit breaker. Admin-only and rate-limited to one probe per 10 s
// — it is the one console action that spends real provider quota, and it
// must never become a proxy for chatty automation.
//
// v0.16.2 (A2) body:
//   {}                                     — test the resolved TEXT slot
//                                           (multi table → legacy → env → file)
//   { providerId: "p1…" }                  — test that provider of the table
//   { providerId?, model: "some-model" }   — override the model for this probe
//
// The test always goes through the SDK constructor with the resolved
// { baseUrl, apiKey } — never ZAI.create(), whose file-only config
// lookup was the bug behind every failed test since A1 (see
// src/lib/ai/provider.ts, makeClient).

const TEST_TIMEOUT_MS = 15_000

interface TestTarget {
  baseUrl: string
  apiKey: string
  model?: string
  label: string
  source: string
}

async function resolveTarget(body: Record<string, unknown>): Promise<
  { ok: true; target: TestTarget } | { ok: false; res: NextResponse }
> {
  const modelOverride = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : null
  const providerId = typeof body.providerId === 'string' && body.providerId.trim() ? body.providerId.trim() : null

  if (providerId) {
    const table = await getProviders()
    const entry = table?.providers.find((p) => p.id === providerId)
    if (!entry) {
      return {
        ok: false,
        res: NextResponse.json({ ok: false, error: 'Unknown provider id — save the provider first.' }, { status: 400 }),
      }
    }
    // default the probe to the model some slot already pins to this provider
    let model = modelOverride ?? undefined
    if (!model && table) {
      for (const slot of AI_SLOTS) {
        const s = table.slots[slot]
        if (s && s.providerId === providerId && s.model) {
          model = s.model
          break
        }
      }
    }
    return { ok: true, target: { baseUrl: entry.baseUrl, apiKey: entry.apiKey, model, label: entry.label, source: 'multi' } }
  }

  const resolved: ResolvedSlot | null = await resolveSlot('text')
  if (!resolved) {
    return {
      ok: false,
      res: NextResponse.json(
        { ok: false, error: 'No AI provider is configured — add one on this page or set ZAI_BASE_URL/ZAI_API_KEY.' },
        { status: 503 }
      ),
    }
  }
  return {
    ok: true,
    target: {
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
      model: modelOverride ?? resolved.model,
      label: resolved.label ?? resolved.source,
      source: resolved.source,
    },
  }
}

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

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const target = await resolveTarget(body)
  if (!target.ok) return target.res

  try {
    const zai = await makeClient(target.target.baseUrl, target.target.apiKey)
    const model = target.target.model
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
      source: target.target.source,
      providerLabel: target.target.label,
      model: model ?? 'sdk-default',
      reply: reply || '(empty reply)',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, error: message.slice(0, 300) }, { status: 502 })
  }
}

export const POST = withLogging('POST /api/admin/config/ai-test', __canvix_post)
