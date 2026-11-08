import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/guard'
import { effectiveStockKeys, STOCK_ENV_KEYS, type StockProviderName } from '@/lib/admin/config'
import { rateLimit } from '@/lib/ai/provider'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/admin/config/stock-test — "does the stock key actually
// answer?" (v0.16.5 A5). One minimal one-result search against the
// provider's real search endpoint — the same call the Photos rail
// makes, so a pass here is a pass there (and the Videos rail rides
// the same key). Admin-only and rate-limited to one probe per 10 s:
// like the AI test connection, it is one of the only console actions
// that spends real provider quota.
//
// Body: { provider: 'pexels' | 'pixabay' } — required. The key
// resolves through the same chain as search: stored console key
// first, PEXELS_API_KEY / PIXABAY_API_KEY fallback.
//
// Sanitization (the house rule, same as the search routes): the
// verdict NEVER echoes the provider's body, the request URL
// (Pixabay's key lives in the query string) or the key itself —
// our own words over the HTTP status only.

const TEST_TIMEOUT_MS = 10_000

async function __canvix_post(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.res

  const rl = rateLimit('admin:stock-test', req, 1, 10)
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: `Wait ${rl.retryAfterSec}s between stock key tests.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    )
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const provider = typeof body.provider === 'string' ? body.provider.trim() : ''
  if (provider !== 'pexels' && provider !== 'pixabay') {
    return NextResponse.json({ ok: false, error: 'provider must be "pexels" or "pixabay".' }, { status: 400 })
  }
  const name = provider as StockProviderName

  const keys = await effectiveStockKeys()
  const key = keys[name]
  if (!key) {
    return NextResponse.json(
      {
        ok: false,
        error: `No ${name} key stored and ${STOCK_ENV_KEYS[name]} is not set — save a key first.`,
      },
      { status: 400 }
    )
  }

  let url: string
  let init: RequestInit
  if (name === 'pexels') {
    const base = (process.env.PEXELS_API_BASE ?? 'https://api.pexels.com').replace(/\/+$/, '')
    url = `${base}/v1/search?query=nature&per_page=1&orientation=landscape`
    init = { headers: { Authorization: key } }
  } else {
    const base = (process.env.PIXABAY_API_BASE ?? 'https://pixabay.com/api').replace(/\/+$/, '')
    url = `${base}/?key=${encodeURIComponent(key)}&q=nature&image_type=photo&per_page=3&safesearch=true`
    init = {}
  }

  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TEST_TIMEOUT_MS) })
    if (!res.ok) {
      // status-only verdicts — the body may echo the request
      const message =
        res.status === 401 || res.status === 403
          ? `${name} rejected the key (HTTP ${res.status}) — check it and save again.`
          : res.status === 429
            ? `${name} rate-limited the probe (HTTP 429) — the key was recognized; retry in a moment.`
            : `${name} answered HTTP ${res.status}.`
      return NextResponse.json({ ok: false, provider: name, httpStatus: res.status, message })
    }
    const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null
    // Pixabay occasionally answers 200 with an error object for a bad
    // key — detect the shape, never echo it.
    if (payload && typeof payload === 'object' && 'error' in payload && !('hits' in payload)) {
      return NextResponse.json({
        ok: false,
        provider: name,
        httpStatus: 200,
        message: `${name} rejected the key — check it and save again.`,
      })
    }
    const total =
      name === 'pexels'
        ? Number((payload as { total_results?: unknown } | null)?.total_results)
        : Number((payload as { total?: unknown } | null)?.total)
    return NextResponse.json({
      ok: true,
      provider: name,
      httpStatus: 200,
      message:
        Number.isFinite(total) && total > 0
          ? `${name} answered — key valid (${total.toLocaleString('en-US')}+ results for "nature").`
          : `${name} answered — key valid.`,
    })
  } catch (error) {
    // network/timeout errors can embed the request URL — never echo
    // them raw (Pixabay's key rides it). Our words only.
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return NextResponse.json({
      ok: false,
      provider: name,
      httpStatus: 0,
      message: timedOut
        ? `${name} timed out after ${TEST_TIMEOUT_MS / 1000} s.`
        : `Could not reach ${name} (network error).`,
    })
  }
}

export const POST = withLogging('POST /api/admin/config/stock-test', __canvix_post)
