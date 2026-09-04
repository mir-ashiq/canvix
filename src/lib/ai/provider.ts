import { NextResponse, type NextRequest } from 'next/server'
import { existsSync, readFileSync } from 'fs'

/**
 * Canvix AI provider abstraction (v0.5).
 *
 * Single server-side entry point for every AI capability. Centralizes:
 *   - provider configuration resolution (env override → .z-ai-config file → absent)
 *   - capability probing (which features can run on this server)
 *   - rate limiting + AIUsage accounting
 *
 * CONTRACT: this module is SERVER-ONLY. It must never be imported from a
 * client component — the provider config contains credentials.
 */

export type AICapability =
  | 'text'        // chat completions — Magic Write, Assistant, Translate
  | 'image'       // image generation
  | 'imageEdit'   // Magic Eraser / Enhance
  | 'vision'      // image understanding — Magic Layers
  | 'imageSearch' // Photo search

export interface AIProviderConfig {
  baseUrl: string
  apiKey: string
}

/** VISION_MODEL — the multimodal model used for Magic Layers analysis. */
export const VISION_MODEL = 'glm-4.5v'

/**
 * Resolve the provider configuration.
 * Priority: ZAI_BASE_URL/ZAI_API_KEY env vars → .z-ai-config file (cwd → ~ → /etc) → null.
 * Returns null when no provider is configured (local-only mode).
 */
export function resolveProviderConfig(): AIProviderConfig | null {
  const envUrl = process.env.ZAI_BASE_URL?.trim()
  const envKey = process.env.ZAI_API_KEY?.trim()
  if (envUrl && envKey) return { baseUrl: envUrl, apiKey: envKey }
  try {
    // the SDK resolves the config file itself at ZAI.create(); mirror its lookup here
    const candidates = [
      `${process.cwd()}/.z-ai-config`,
      `${process.env.HOME ?? ''}/.z-ai-config`,
      '/etc/.z-ai-config',
    ]
    for (const p of candidates) {
      if (!p || !existsSync(p)) continue
      const raw = JSON.parse(readFileSync(p, 'utf8')) as { baseUrl?: string; apiKey?: string }
      if (raw.baseUrl && raw.apiKey) return { baseUrl: raw.baseUrl, apiKey: raw.apiKey }
    }
  } catch {
    /* unreadable config — treat as absent */
  }
  return null
}

/** Quick boolean probe used by /api/ai/capabilities and route guards. */
export function hasProvider(): boolean {
  return resolveProviderConfig() !== null
}

/**
 * Create a ZAI SDK instance (server-side only). Lazy-imports the SDK so it
 * never lands in a client bundle. Returns null when unconfigured.
 */
export async function getZAI(): Promise<import('z-ai-web-dev-sdk').default | null> {
  const cfg = resolveProviderConfig()
  if (!cfg) return null
  try {
    const { default: ZAI } = await import('z-ai-web-dev-sdk')
    return await ZAI.create()
  } catch (err) {
    console.error('[ai] provider initialization failed', err)
    return null
  }
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
export function rateLimit(feature: string, req: NextRequest, limit: number, windowSec: number): RateLimitResult {
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

export async function recordUsage(feature: string, provider: 'zai' | 'local', ok: boolean): Promise<void> {
  try {
    const { db } = await import('@/lib/db')
    await db.aIUsage.create({ data: { feature, provider, ok } })
  } catch {
    /* accounting must never break the request */
  }
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

/** Helper: wrap a route's provider call with rate limit + usage accounting. */
export async function withProvider(
  feature: string,
  req: NextRequest,
  limits: { limit: number; windowSec: number },
  fn: (zai: NonNullable<Awaited<ReturnType<typeof getZAI>>>) => Promise<NextResponse>
): Promise<NextResponse> {
  const rl = rateLimit(feature, req, limits.limit, limits.windowSec)
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many ${feature} requests — try again in ${rl.retryAfterSec}s.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    )
  }
  const zai = await getZAI()
  if (!zai) {
    await recordUsage(feature, 'zai', false)
    return providerUnavailable(NextResponse.json({}))
  }
  try {
    const out = await fn(zai)
    void recordUsage(feature, 'zai', true)
    return out
  } catch (err) {
    console.error(`[ai/${feature}]`, err)
    void recordUsage(feature, 'zai', false)
    return NextResponse.json({ error: 'The AI service is unavailable right now. Please try again.' }, { status: 502 })
  }
}
