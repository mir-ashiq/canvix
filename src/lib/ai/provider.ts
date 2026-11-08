import { NextResponse, type NextRequest } from 'next/server'
import { existsSync, readFileSync } from 'fs'
import { CSRF_REJECTED } from '@/lib/auth/csrf'
import {
  getProviderOverride,
  getProviders,
  getModels,
  aiFeatureEnabled,
  type AiFeature,
  type AiSlot,
  type StoredProvider,
  type StoredProviders,
  type StoredModels,
} from '@/lib/admin/config'
import { recordLiveAi } from '@/lib/admin/realtime'

/**
 * Canvix AI provider abstraction (v0.5, multi-provider since v0.16.2 A2).
 *
 * Single server-side entry point for every AI capability. Centralizes:
 *   - provider configuration resolution, per capability slot:
 *     multi-provider table (console) → legacy single override → env →
 *     .z-ai-config file → absent
 *   - SDK client construction
 *   - capability probing (which features can run on this server)
 *   - rate limiting + AIUsage accounting + live traffic counters
 *
 * CONTRACT: this module is SERVER-ONLY. It must never be imported from a
 * client component — the provider config contains credentials.
 */

export type AICapability =
  | 'text'        // chat completions — Magic Write, Assistant, Translate
  | 'image'       // image generation
  | 'imageEdit'   // Magic Eraser / Enhance
  | 'vision'      // image understanding — Magic Layers
// v0.16.4 (A4): imageSearch is retired — photo search runs on the
// stock-provider keys (src/lib/stock-photo.ts), not an AI model slot

export interface AIProviderConfig {
  baseUrl: string
  apiKey: string
}

/** Default multimodal model for Magic Layers analysis (v0.16 A1: overridable from /admin). */
export const DEFAULT_VISION_MODEL = 'glm-4.5v'

// ── legacy model getters (v0.16 A1) ──────────────────────────
// Still used by the legacy fallback chain (ai.models feeds every slot
// that resolves via the single override / env / file). The multi-
// provider table carries its own per-slot model ids.

export async function getTextModel(): Promise<string | undefined> {
  return (await getModels()).text
}

export async function getVisionModel(): Promise<string> {
  return (await getModels()).vision ?? DEFAULT_VISION_MODEL
}

export async function getImageModel(): Promise<string | undefined> {
  return (await getModels()).image
}

/**
 * Resolve the FILE-level provider config.
 * Priority: ZAI_BASE_URL/ZAI_API_KEY env vars → .z-ai-config file (cwd → ~ → /etc) → null.
 * Returns null when no provider is configured at this layer.
 */
export function resolveProviderConfig(): AIProviderConfig | null {
  const envUrl = process.env.ZAI_BASE_URL?.trim()
  const envKey = process.env.ZAI_API_KEY?.trim()
  if (envUrl && envKey) return { baseUrl: envUrl, apiKey: envKey }
  try {
    // the SDK resolves the config file itself; mirror its lookup here
    //
    // PORTABILITY (v0.9.3): on Cloudflare Workers there is no real fs —
    // OpenNext's unenv layer stubs node:fs so these calls either return
    // false or throw, and this try/catch swallows that, leaving env-var
    // config (ZAI_BASE_URL / ZAI_API_KEY via wrangler secrets) as the
    // only provider source on that runtime — which is the documented
    // production setup everywhere anyway.
    const candidates = [
      `${process.cwd()}/.z-ai-config`,
      `${process.env.HOME ?? ''}/.z-ai-config`,
      '/etc/.z-ai-config',
    ]
    for (const p of candidates) {
      // turbopackIgnore: these paths are only knowable at runtime (cwd/$HOME),
      // so without the opt-out Turbopack traces the WHOLE project into the
      // server output (slow, oversized Vercel deploys). The file also holds
      // credentials and must never be copied into build output — production
      // configuration is env vars (ZAI_BASE_URL / ZAI_API_KEY); the file
      // fallback is a local-development convenience only.
      if (!p || !existsSync(/*turbopackIgnore: true*/ p)) continue
      const raw = JSON.parse(readFileSync(/*turbopackIgnore: true*/ p, 'utf8')) as { baseUrl?: string; apiKey?: string }
      if (raw.baseUrl && raw.apiKey) return { baseUrl: raw.baseUrl, apiKey: raw.apiKey }
    }
  } catch {
    /* unreadable config — treat as absent */
  }
  return null
}

// ── per-slot resolution (v0.16.2 A2) ─────────────────────────

export type SlotSource = 'multi' | 'db' | 'env' | 'file'

/** What one capability slot resolved to — never the key, but enough to act. */
export interface ResolvedSlot {
  baseUrl: string
  apiKey: string
  /** Model id to request (undefined = provider default). */
  model?: string
  /** Which provider of the table answered (multi only). */
  providerId?: string
  /** Human label of the answering provider (multi only). */
  label?: string
  source: SlotSource
}

/**
 * Pure layer-picker (unit-tested): multi-provider table → legacy single
 * override → env vars → .z-ai-config file → null. Exported for tests;
 * runtime callers go through resolveSlot().
 */
export function pickSlot(
  slot: AiSlot,
  multi: StoredProviders | null,
  legacy: StoredProvider | null,
  models: StoredModels,
  env: { baseUrl?: string; apiKey?: string },
  file: StoredProvider | null
): ResolvedSlot | null {
  const tableSlot = multi?.slots[slot]
  if (multi && tableSlot) {
    const p = multi.providers.find((x) => x.id === tableSlot.providerId)
    if (p) {
      return {
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        model: tableSlot.model,
        providerId: p.id,
        label: p.label,
        source: 'multi',
      }
    }
    // slot references a provider that no longer exists — fall through
    // to the legacy chain rather than failing the feature outright
  }
  // legacy chain: the single override / env / file answers every slot,
  // with the old ai.models ids still steering text/vision/image
  const legacyModel =
    slot === 'text' ? models.text : slot === 'vision' ? models.vision : slot === 'image' ? models.image : undefined
  if (legacy) return { baseUrl: legacy.baseUrl, apiKey: legacy.apiKey, model: legacyModel, source: 'db' }
  if (env.baseUrl && env.apiKey) {
    return { baseUrl: env.baseUrl, apiKey: env.apiKey, model: legacyModel, source: 'env' }
  }
  if (file) return { baseUrl: file.baseUrl, apiKey: file.apiKey, model: legacyModel, source: 'file' }
  return null
}

/** Resolve one capability slot through every config layer. */
export async function resolveSlot(slot: AiSlot): Promise<ResolvedSlot | null> {
  const [multi, legacy, models] = await Promise.all([getProviders(), getProviderOverride(), getModels()])
  return pickSlot(
    slot,
    multi,
    legacy,
    models,
    { baseUrl: process.env.ZAI_BASE_URL?.trim(), apiKey: process.env.ZAI_API_KEY?.trim() },
    resolveProviderConfig()
  )
}

/** Feature name (withProvider's first arg) → capability slot. */
const FEATURE_SLOTS: Record<string, AiSlot> = {
  write: 'text',
  translate: 'text',
  assistant: 'text',
  image: 'image',
  'image-edit': 'imageEdit',
  'magic-layers': 'vision',
}

/** Async probe — does THIS slot have a provider behind it? */
export async function hasProviderForSlot(slot: AiSlot): Promise<boolean> {
  return (await resolveSlot(slot)) !== null
}

// ── legacy single-chain resolution (v0.16 A1) ────────────────
// Kept for the console's legacy provider card and MCP capability text.

/**
 * Full resolution with provenance (v0.16 A1): console DB override → env
 * vars → .z-ai-config file → null. With the multi-provider table (A2)
 * this is the FALLBACK chain — resolveSlot() is what features use.
 */
export async function resolveProvider(): Promise<{ baseUrl: string; apiKey: string; source: 'db' | 'env' | 'file' } | null> {
  const fromDb = await getProviderOverride()
  if (fromDb) return { ...fromDb, source: 'db' }
  const envUrl = process.env.ZAI_BASE_URL?.trim()
  const envKey = process.env.ZAI_API_KEY?.trim()
  if (envUrl && envKey) return { baseUrl: envUrl, apiKey: envKey, source: 'env' }
  const fromFile = resolveProviderConfig()
  if (fromFile) return { ...fromFile, source: 'file' }
  return null
}

/** Async probe used by MCP tools and route guards — any layer configured? */
export async function hasProvider(): Promise<boolean> {
  return (await resolveSlot('text')) !== null
}

/** What the console shows about the provider setup (never the key). */
export interface ProvidersSummary {
  configured: boolean
  source: SlotSource | null
  providerCount: number
  slotsSet: number
}
export async function providersSummary(): Promise<ProvidersSummary> {
  const multi = await getProviders()
  if (multi && multi.providers.length) {
    return {
      configured: true,
      source: 'multi',
      providerCount: multi.providers.length,
      slotsSet: Object.keys(multi.slots).length,
    }
  }
  const text = await resolveSlot('text')
  return { configured: text !== null, source: text?.source ?? null, providerCount: 0, slotsSet: 0 }
}

// ── SDK client construction ──────────────────────────────────

/** Construct an SDK client directly from resolved config (server-side only). */
export async function makeClient(baseUrl: string, apiKey: string): Promise<import('z-ai-web-dev-sdk').default> {
  const { default: ZAI } = await import('z-ai-web-dev-sdk')
  // v0.16.2 (A2): construct the SDK DIRECTLY with the resolved config.
  //
  // ZAI.create() only ever reads a .z-ai-config file (cwd → ~ → /etc) —
  // it ignores ZAI_BASE_URL / ZAI_API_KEY entirely. Every console- or
  // env-configured provider therefore failed instantiation with
  // "Configuration file not found or invalid" — the bug behind every
  // failed "Test connection" (and every 503 AI feature) since A1 on
  // hosts that don't ship a config file. The class constructor takes
  // exactly the { baseUrl, apiKey } shape we already resolved, and any
  // OpenAI-compatible endpoint works through it. Decision recorded in
  // docs/ADMIN.md.
  //
  // The SDK's .d.ts marks the constructor private (it wants you on
  // create()), but the shipped dist/index.js declares a plain public
  // `constructor(config)` — verified against the installed package.
  // Cast to a constructor signature; the runtime shape matches.
  type ZAIConstructor = new (config: { baseUrl: string; apiKey: string }) => import('z-ai-web-dev-sdk').default
  const Ctor = ZAI as unknown as ZAIConstructor
  return new Ctor({ baseUrl, apiKey })
}

/** A usable client plus the model id its slot wants (undefined = default). */
export interface ProviderContext {
  zai: import('z-ai-web-dev-sdk').default
  model?: string
  /** Which provider answered (multi table only) — for accounting labels. */
  label?: string
  /** Which config layer answered (multi/db/env/file) — the Logs view's
   * provider column when no table label applies (v0.16.3 A3). */
  source?: SlotSource
}

/** Resolve a slot and construct its client. Null when unconfigured. */
export async function getClientForSlot(slot: AiSlot): Promise<ProviderContext | null> {
  const resolved = await resolveSlot(slot)
  if (!resolved) return null
  try {
    const zai = await makeClient(resolved.baseUrl, resolved.apiKey)
    return { zai, model: resolved.model, label: resolved.label, source: resolved.source }
  } catch (err) {
    console.error(`[ai] provider initialization failed (${slot})`, err)
    return null
  }
}

/** Legacy helper — the text-slot client (MCP generate_design, older tests). */
export async function getZAI(): Promise<import('z-ai-web-dev-sdk').default | null> {
  return (await getClientForSlot('text'))?.zai ?? null
}

// ── rate limiting (in-memory sliding window; per feature+IP) ──

interface Bucket {
  hits: number[]
}

const buckets = new Map<string, Bucket>()

export interface RateLimitResult {
  ok: boolean
  retryAfterSec: number
}

/**
 * Simple sliding-window limiter. Limits are deliberately generous for a
 * self-hosted design tool but stop runaway loops and abuse.
 */
export function rateLimit(feature: string, req: Pick<NextRequest, 'headers'>, limit: number, windowSec: number): RateLimitResult {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'local'
  const key = `${feature}:${ip}`
  const now = Date.now()
  let bucket = buckets.get(key)
  if (!bucket) {
    bucket = { hits: [] }
    buckets.set(key, bucket)
  }
  bucket.hits = bucket.hits.filter((t) => now - t < windowSec * 1000)
  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0]
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((oldest + windowSec * 1000 - now) / 1000)) }
  }
  bucket.hits.push(now)
  // lazy GC: occasionally drop stale buckets so the map cannot grow unbounded
  if (buckets.size > 512) {
    for (const [k, b] of buckets) {
      if (!b.hits.length || now - b.hits[b.hits.length - 1] > windowSec * 1000 * 2) buckets.delete(k)
    }
  }
  return { ok: true, retryAfterSec: 0 }
}

// ── usage accounting (best-effort, never blocks a request) ──

/** Telemetry detail attached to one AI request row (v0.16.3 A3). */
export interface UsageDetail {
  model?: string
  status?: number
  durationMs?: number
  error?: string
}

export async function recordUsage(
  feature: string,
  provider: string,
  ok: boolean,
  detail: UsageDetail = {}
): Promise<void> {
  // live console counters first — pure in-memory, synchronous, cannot throw
  recordLiveAi(feature, ok)
  try {
    const { db } = await import('@/lib/db')
    await db.aIUsage.create({
      data: {
        feature,
        provider,
        ok,
        ...(detail.model !== undefined ? { model: detail.model } : {}),
        ...(detail.status !== undefined ? { status: detail.status } : {}),
        ...(detail.durationMs !== undefined ? { durationMs: detail.durationMs } : {}),
        ...(detail.error !== undefined ? { error: detail.error } : {}),
      },
    })
  } catch {
    /* accounting must never break the request */
  }
}

// ── provider error normalization (v0.16.3 A3) ────────────────
//
// The SDK throws `Error("API request failed with status 404: 404 page
// not found")` — the raw string ends up in server logs and nowhere
// else, which is exactly why "why is image generation broken" needed
// an SSH session to answer. These helpers turn any thrown value into
// a short, scrubbed, admin-safe reason that flows into BOTH the
// AIUsage log (→ /admin/logs) and the client's 502 body, so the
// failure explains itself wherever it is seen.

/** Never let a credential (or anything key-shaped) reach a log or client. */
export function scrubErrorText(text: string): string {
  return text
    .replace(/(nvapi-|sk-|gsk_|pk-|rk-|ak-|xai-|hf_|Bearer\s+)[A-Za-z0-9_\-]{8,}/gi, '$1***')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 240)
}

export interface ProviderErrorInfo {
  /** HTTP status the provider answered, when the error carries one. */
  status: number | null
  /** Short scrubbed human reason, safe for logs, admin UI and clients. */
  message: string
}

/** Turn any thrown value into { status?, message } — scrubbed and capped. */
export function describeProviderError(err: unknown): ProviderErrorInfo {
  const raw = err instanceof Error ? err.message : String(err)
  const m = raw.match(/status (\d{3})/i)
  const status = m ? Number(m[1]) : null
  // drop the SDK prefix — "API request failed with status 404: X" → "X (HTTP 404)"
  const body = raw.replace(/^API request failed with status \d{3}:?\s*/i, '').trim()
  const suffix = status ? ` (HTTP ${status})` : ''
  return { status, message: scrubErrorText(body ? `${body}${suffix}` : raw) }
}

// ── shared error responses ──

export const NO_PROVIDER_RESPONSE = {
  error: 'This feature requires an AI provider configured on the server.',
  code: 'NO_PROVIDER',
} as const

/** Standard structured error body — no stack traces, no provider internals. */
export function providerUnavailable(res: NextResponse): NextResponse {
  return NextResponse.json(NO_PROVIDER_RESPONSE, { status: 503 })
}

/** v0.9.2 abuse guard — strict same-origin check for AI routes. */
function isFromApp(req: NextRequest): boolean {
  const origin = req.headers.get('origin') ?? req.headers.get('referer')
  if (!origin) return false
  try {
    const parsed = new URL(origin)
    const hosts = [
      req.headers.get('host'),
      req.headers.get('x-forwarded-host')?.split(',')[0]?.trim(),
    ].filter((h): h is string => Boolean(h))
    return hosts.includes(parsed.host)
  } catch {
    return false
  }
}

/** withProvider feature name → admin console flag (src/lib/admin/config.ts). */
const FEATURE_FLAGS: Record<string, AiFeature> = {
  write: 'magicWrite',
  image: 'imageGeneration',
  'image-edit': 'imageEditing',
  'magic-layers': 'vision',
  translate: 'translation',
  assistant: 'assistant',
}

export const FEATURE_DISABLED = {
  error: 'This AI feature is disabled by the administrator.',
  code: 'FEATURE_DISABLED',
} as const

/**
 * Wrap a route's provider work. Resolves the feature's capability slot,
 * constructs THAT provider's client and hands the handler a single
 * context: { zai, model } (v0.16.2 A2 — the handler no longer resolves
 * the model itself, so a per-slot provider+model pair can never drift
 * apart between the client and the model id).
 */
export async function withProvider(
  feature: string,
  req: NextRequest,
  limits: { limit: number; windowSec: number },
  fn: (ctx: ProviderContext) => Promise<NextResponse>
): Promise<NextResponse> {
  // v0.16 (A1): per-feature kill switch from the admin console. Checked
  // before the abuse guard, rate limiting and any provider work — a
  // disabled feature costs nothing and answers like an unconfigured one.
  const flag = FEATURE_FLAGS[feature]
  if (flag && !(await aiFeatureEnabled(flag))) {
    return NextResponse.json(FEATURE_DISABLED, { status: 503 })
  }
  // v0.9.2 abuse guard: every AI route is only ever called by the app's own
  // pages (same origin). Cross-origin or Origin-less POSTs — the signature
  // of a bot hitting the public endpoint directly — are rejected before any
  // provider work. Anonymous in-app usage stays fully allowed (free forever).
  if (req.method === 'POST' && !isFromApp(req)) {
    return NextResponse.json(CSRF_REJECTED, { status: 403 })
  }
  const rl = rateLimit(feature, req, limits.limit, limits.windowSec)
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many ${feature} requests — try again in ${rl.retryAfterSec}s.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    )
  }
  const slot = FEATURE_SLOTS[feature] ?? 'text'
  const ctx = await getClientForSlot(slot)
  if (!ctx) {
    await recordUsage(feature, `no-provider (${slot})`, false, {
      status: 503,
      error: `no provider configured for the ${slot} slot`,
    })
    return providerUnavailable(NextResponse.json({}))
  }
  try {
    const started = Date.now()
    const out = await fn(ctx)
    void recordUsage(feature, ctx.label ?? ctx.source ?? slot, true, {
      model: ctx.model,
      status: out.status,
      durationMs: Date.now() - started,
    })
    return out
  } catch (err) {
    console.error(`[ai/${feature}]`, err)
    const info = describeProviderError(err)
    void recordUsage(feature, ctx.label ?? ctx.source ?? slot, false, {
      model: ctx.model,
      status: info.status ?? 502,
      durationMs: undefined,
      error: info.message,
    })
    // v0.16.3 (A3): the 502 body now carries the scrubbed reason — the
    // admin Logs view shows the same string, and end users finally see
    // "provider answered 404" instead of a generic unavailable.
    return NextResponse.json(
      {
        error: 'The AI service is unavailable right now. Please try again.',
        code: 'PROVIDER_ERROR',
        ...(info.message ? { detail: info.message } : {}),
      },
      { status: 502 }
    )
  }
}
