import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/guard'
import {
  getModels,
  getFeatures,
  getSettings,
  getProviderOverride,
  getProviders,
  setProvider,
  clearProvider,
  setModels,
  setFeatures,
  setSettings,
  setProviders,
  clearProviders,
  importLegacyProvider,
  validateProvider,
  validateModels,
  validateFeatures,
  validateSettings,
  validateProviderList,
  validateSlots,
  validateStockKeys,
  setStockKeys,
  getStockKeys,
  effectiveStockKeys,
  STOCK_ENV_KEYS,
  maskApiKey,
  type StoredProviderEntry,
  type AiSlot,
  type StockProviderName,
} from '@/lib/admin/config'
import { resolveProvider, resolveSlot, type ResolvedSlot } from '@/lib/ai/provider'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET/PUT /api/admin/config — the console's configuration surface.
//
// GET is sanitized by construction: stored API keys only ever come
// back as masks, env vars as presence booleans, and effective base
// URLs (whatever layer they came from) — enough to operate on, never
// a credential. PUT validates section by section and returns the same
// sanitized shape back.
//
// v0.16.2 (A2) adds the multi-provider sections:
//   providers          { list: […], slots: {…} } | null — full replace /
//                      clear of the ai.providers table
//   importLegacyProvider: true — fold the A1 single override into the
//                      table and clear the legacy row

// v0.16.4 (A4): imageSearch is retired — four model slots remain;
// photo search runs on the stock-provider keys (surfaced below)
//
// v0.16.5 (A5) adds the stock section: { pexels?, pixabay? } keys
// for the Photos AND Videos search rails — write-only, null clears,
// env vars as fallback (the same precedence as every credential).
// v0.22 (Wave 4): video joined the slot universe — it was missing here,
// so the sanitized GET never reported its resolution and the console's
// video row silently lost its saved binding on every reload (the save
// path itself was fine — validateSlots already accepted 'video').
const SLOT_ORDER: AiSlot[] = ['text', 'vision', 'image', 'imageEdit', 'video']

function slotView(resolved: ResolvedSlot | null) {
  if (!resolved) return null
  return {
    providerId: resolved.providerId ?? null,
    label: resolved.label ?? null,
    baseUrl: resolved.baseUrl,
    model: resolved.model ?? null,
    source: resolved.source,
  }
}

/** One connector's sanitized state: masked stored key, which layer
 * answers, never the key itself (A5). */
function stockProviderView(name: StockProviderName, stored: string | undefined) {
  const envSet = Boolean((process.env[STOCK_ENV_KEYS[name]] ?? '').trim())
  return {
    set: Boolean(stored) || envSet,
    source: stored ? ('db' as const) : envSet ? ('env' as const) : null,
    keyMasked: stored ? maskApiKey(stored) : null,
  }
}

async function sanitizedView() {
  const [provider, stored, providers, models, features, settings, stockKeys, stockEffective] = await Promise.all([
    resolveProvider(),
    getProviderOverride(),
    getProviders(),
    getModels(),
    getFeatures(),
    getSettings(),
    getStockKeys(),
    effectiveStockKeys(),
  ])
  // per-slot resolution (multi table → legacy chain) for the slots card
  const resolved = {} as Record<AiSlot, ReturnType<typeof slotView>>
  await Promise.all(
    SLOT_ORDER.map(async (slot) => {
      resolved[slot] = slotView(await resolveSlot(slot))
    })
  )
  const list: { id: string; label: string; baseUrl: string; keyMasked: string }[] = (providers?.providers ?? []).map(
    (p: StoredProviderEntry) => ({ id: p.id, label: p.label, baseUrl: p.baseUrl, keyMasked: maskApiKey(p.apiKey) })
  )
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
    providers: {
      // the multi-provider table — null when nothing is stored yet
      set: providers !== null,
      list,
      slots: providers?.slots ?? {},
      resolved,
    },
    models,
    features,
    settings,
    // v0.16.5 (A5) + Sound wave: the stock-media card's data — per-connector
    // mask + which layer answers (console key vs env var), plus whether the
    // rails are live at all. Secret-free: masks and names only, never keys.
    stock: {
      available: Boolean(stockEffective.pexels || stockEffective.pixabay || stockEffective.freesound),
      providers: {
        pexels: stockProviderView('pexels', stockKeys.pexels),
        pixabay: stockProviderView('pixabay', stockKeys.pixabay),
        freesound: stockProviderView('freesound', stockKeys.freesound),
      },
    },
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

    // ── provider section (legacy single override, v0.16 A1) ────
    // null clears the override (fall back to env/file). An object sets
    // it: both fields together activate, both empty clears, half-empty
    // is a 400 — the operator always gets an explicit error instead of
    // a silently half-configured provider. Superseded per-slot by the
    // providers table below, kept for compat and env/file management.
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

    // ── providers section (multi-provider table, v0.16.2 A2) ───
    // Full replace: { list: [{id?, label, baseUrl, apiKey?}], slots:
    // { slot: {providerId, model?} | null } }. Keys are write-only —
    // an entry whose apiKey is empty keeps its stored key (matched by
    // id). null clears the whole table (slots fall back to the legacy
    // chain above).
    if (body.providers !== undefined) {
      if (body.providers === null) {
        await clearProviders()
      } else if (typeof body.providers === 'object' && body.providers !== null && !Array.isArray(body.providers)) {
        const raw = body.providers as Record<string, unknown>
        const current = await getProviders()
        const existing = new Map<string, StoredProviderEntry>((current?.providers ?? []).map((p) => [p.id, p]))
        const listCheck = validateProviderList(raw.list, { existing })
        if (!listCheck.ok) return NextResponse.json({ error: listCheck.error }, { status: 400 })
        const ids = new Set(listCheck.value.map((p) => p.id))
        const slotsCheck = validateSlots(raw.slots, ids)
        if (!slotsCheck.ok) return NextResponse.json({ error: slotsCheck.error }, { status: 400 })
        await setProviders({ providers: listCheck.value, slots: slotsCheck.value })
      } else {
        return NextResponse.json({ error: 'providers must be an object ({ list, slots }) or null.' }, { status: 400 })
      }
    }

    // ── importLegacyProvider (one-click migration, A2) ─────────
    if (body.importLegacyProvider === true) {
      const result = await importLegacyProvider()
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
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

    // ── stock section (stock-media keys, v0.16.5 A5) ───────────
    // Partial merge per connector: { pexels?: key | null, pixabay?:
    // key | null } — a string sets the stored key (write-only, never
    // displayed again), null clears it (env fallback restored),
    // omitted/empty leaves it untouched. The SAME two keys power the
    // Photos and Videos search rails.
    if (body.stock !== undefined) {
      if (typeof body.stock !== 'object' || body.stock === null || Array.isArray(body.stock)) {
        return NextResponse.json({ error: 'stock must be an object ({ pexels?, pixabay? }).' }, { status: 400 })
      }
      const check = validateStockKeys(body.stock)
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })
      await setStockKeys(check.value)
    }

    return NextResponse.json(await sanitizedView())
  } catch (error) {
    console.error('PUT /api/admin/config failed', error)
    return NextResponse.json({ error: 'Could not save the configuration. Please try again.' }, { status: 500 })
  }
}

export const GET = withLogging('GET /api/admin/config', __canvix_get)
export const PUT = withLogging('PUT /api/admin/config', __canvix_put)
