import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/guard'
import {
  getModels,
  getFeatures,
  getSettings,
  getProviderOverride,
  setProvider,
  clearProvider,
  setModels,
  setFeatures,
  setSettings,
  validateProvider,
  validateModels,
  validateFeatures,
  validateSettings,
  maskApiKey,
} from '@/lib/admin/config'
import { resolveProvider } from '@/lib/ai/provider'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET/PUT /api/admin/config — the console's configuration surface.
//
// GET is sanitized by construction: the stored API key only ever comes
// back as a mask, env vars as presence booleans, and the effective base
// URL (whatever layer it came from) — enough to operate on, never a
// credential. PUT validates section by section and returns the same
// sanitized shape back.

async function sanitizedView() {
  const [provider, stored, models, features, settings] = await Promise.all([
    resolveProvider(),
    getProviderOverride(),
    getModels(),
    getFeatures(),
    getSettings(),
  ])
  return {
    provider: {
      configured: provider !== null,
      source: provider?.source ?? null, // db | env | file | null
      activeBaseUrl: provider?.baseUrl ?? null,
      stored: stored ? { baseUrl: stored.baseUrl, keyMasked: maskApiKey(stored.apiKey) } : null,
      env: {
        urlSet: Boolean(process.env.ZAI_BASE_URL?.trim()),
        keySet: Boolean(process.env.ZAI_API_KEY?.trim()),
      },
    },
    models,
    features,
    settings,
  }
}

async function __canvix_get(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.res
  try {
    return NextResponse.json(await sanitizedView())
  } catch (error) {
    console.error('GET /api/admin/config failed', error)
    return NextResponse.json({ error: 'Configuration unavailable — database unreachable.' }, { status: 503 })
  }
}

async function __canvix_put(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.res

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

    // ── provider section ────────────────────────────────────────
    // null clears the override (fall back to env/file). An object sets
    // it: both fields together activate, both empty clears, half-empty
    // is a 400 — the operator always gets an explicit error instead of
    // a silently half-configured provider.
    if (body.provider !== undefined) {
      if (body.provider === null) {
        await clearProvider()
      } else if (typeof body.provider === 'object' && body.provider !== null) {
        const raw = body.provider as Record<string, unknown>
        const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : ''
        const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey : ''
        if (!baseUrl && !apiKey) {
          await clearProvider()
        } else if (!baseUrl || !apiKey) {
          return NextResponse.json(
            { error: 'A provider override needs both baseUrl and apiKey. Send null to clear it.' },
            { status: 400 }
          )
        } else {
          const check = validateProvider({ baseUrl, apiKey })
          if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })
          await setProvider(check.value)
        }
      } else {
        return NextResponse.json({ error: 'provider must be an object or null.' }, { status: 400 })
      }
    }

    // ── models section (full replace) ───────────────────────────
    if (body.models !== undefined) {
      const check = validateModels(body.models)
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })
      await setModels(check.value)
    }

    // ── features section (partial merge over current) ───────────
    if (body.features !== undefined) {
      const check = validateFeatures(body.features)
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })
      await setFeatures({ ...(await getFeatures()), ...check.value })
    }

    // ── settings section (partial merge over current) ───────────
    if (body.settings !== undefined) {
      const check = validateSettings(body.settings)
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })
      await setSettings({ ...(await getSettings()), ...check.value })
    }

    return NextResponse.json(await sanitizedView())
  } catch (error) {
    console.error('PUT /api/admin/config failed', error)
    return NextResponse.json({ error: 'Could not save the configuration. Please try again.' }, { status: 500 })
  }
}

export const GET = withLogging('GET /api/admin/config', __canvix_get)
export const PUT = withLogging('PUT /api/admin/config', __canvix_put)
