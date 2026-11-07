// ─────────────────────────────────────────────────────────────
// Instance configuration (v0.16 A1) — the store behind /admin's
// AI + settings pages.
//
// Four small AppConfig rows (key → JSON):
//   ai.provider  { baseUrl, apiKey }   — console-set provider, wins over env
//   ai.models    { text?, vision?, image? } — model ids passed to the SDK
//   ai.features  { magicWrite, … }     — per-feature kill switches
//   app.settings { signupsOpen, anonymousEditing }
//
// Design decisions (documented in docs/ADMIN.md):
//   • Precedence for the provider: DB (console) → env → .z-ai-config
//     file → unconfigured. The console never shows a stored API key
//     back — only a mask (write-only credential, same posture as the
//     env vars it overrides).
//   • Reads are cached in-process for 10 s (config sits on every AI
//     request path; one tiny indexed findMany per 10 s per instance is
//     the whole cost). Writes invalidate immediately — the same server
//     process sees its own change on the next request, other processes
//     within the TTL.
//   • DB read failures fall back to defaults (= pre-A1 env behaviour),
//     because these toggles are additive restrictions and a flapping
//     config read must not brick design autosave. The DB being truly
//     down breaks the app elsewhere anyway.
//
// CONTRACT: server-only. Contains credentials in memory.
// ─────────────────────────────────────────────────────────────

import type { Prisma } from '@/generated/prisma/client'

// ── keys & shapes ─────────────────────────────────────────────

export const CONFIG_KEYS = {
  provider: 'ai.provider',
  models: 'ai.models',
  features: 'ai.features',
  settings: 'app.settings',
} as const

export const AI_FEATURES = [
  'magicWrite',
  'imageGeneration',
  'imageEditing',
  'vision', // Magic Layers
  'translation',
  'assistant',
  'photoSearch',
] as const
export type AiFeature = (typeof AI_FEATURES)[number]

export interface StoredProvider {
  baseUrl: string
  apiKey: string
}
export interface StoredModels {
  text?: string
  vision?: string
  image?: string
}
export type StoredFeatures = Record<AiFeature, boolean>
export interface StoredSettings {
  signupsOpen: boolean
  anonymousEditing: boolean
}

export const DEFAULT_FEATURES: StoredFeatures = {
  magicWrite: true,
  imageGeneration: true,
  imageEditing: true,
  vision: true,
  translation: true,
  assistant: true,
  photoSearch: true,
}

export const DEFAULT_SETTINGS: StoredSettings = {
  signupsOpen: true,
  anonymousEditing: true,
}

const BASEURL_MAX = 2048
const APIKEY_MAX = 4096
const MODEL_RE = /^[A-Za-z0-9._:+-]{1,120}$/

// ── validation (pure, unit-tested) ────────────────────────────

export type Check<T> = { ok: true; value: T } | { ok: false; error: string }

/** A usable provider override: an http(s) base URL without credentials + a non-empty key. */
export function validateProvider(input: unknown): Check<StoredProvider> {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'provider must be an object.' }
  const raw = input as Record<string, unknown>
  if (typeof raw.baseUrl !== 'string' || !raw.baseUrl.trim()) return { ok: false, error: 'baseUrl is required.' }
  if (typeof raw.apiKey !== 'string' || !raw.apiKey) return { ok: false, error: 'apiKey is required.' }
  const baseUrl = raw.baseUrl.trim()
  if (baseUrl.length > BASEURL_MAX) return { ok: false, error: `baseUrl must be at most ${BASEURL_MAX} characters.` }
  if (raw.apiKey.length > APIKEY_MAX) return { ok: false, error: `apiKey must be at most ${APIKEY_MAX} characters.` }
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    return { ok: false, error: 'baseUrl must be a valid URL.' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'baseUrl must use http(s).' }
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'baseUrl must not embed credentials — put the key in the apiKey field.' }
  }
  return { ok: true, value: { baseUrl: parsed.toString(), apiKey: raw.apiKey } }
}

/** Optional model ids; unknown keys are dropped, each value must look like a model id. */
export function validateModels(input: unknown): Check<Partial<StoredModels>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, error: 'models must be an object.' }
  const raw = input as Record<string, unknown>
  const out: Partial<StoredModels> = {}
  for (const key of ['text', 'vision', 'image'] as const) {
    const v = raw[key]
    if (v === undefined || v === null || v === '') continue // clearing a model = omit it
    if (typeof v !== 'string' || !MODEL_RE.test(v)) {
      return { ok: false, error: `models.${key} must be a model id (letters, digits, . _ : + -).` }
    }
    out[key] = v
  }
  return { ok: true, value: out }
}

/** Feature flags: booleans only, unknown keys ignored. Returns only the provided subset. */
export function validateFeatures(input: unknown): Check<Partial<StoredFeatures>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, error: 'features must be an object.' }
  const raw = input as Record<string, unknown>
  const out: Partial<StoredFeatures> = {}
  for (const key of AI_FEATURES) {
    const v = raw[key]
    if (v === undefined) continue
    if (typeof v !== 'boolean') return { ok: false, error: `features.${key} must be true or false.` }
    out[key] = v
  }
  return { ok: true, value: out }
}

/** App settings: booleans only, unknown keys ignored. */
export function validateSettings(input: unknown): Check<Partial<StoredSettings>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, error: 'settings must be an object.' }
  const raw = input as Record<string, unknown>
  const out: Partial<StoredSettings> = {}
  for (const key of ['signupsOpen', 'anonymousEditing'] as const) {
    const v = raw[key]
    if (v === undefined) continue
    if (typeof v !== 'boolean') return { ok: false, error: `settings.${key} must be true or false.` }
    out[key] = v
  }
  return { ok: true, value: out }
}

/** Never echo a stored key — `sk-1…wxyz` shape with the length for a sanity check. */
export function maskApiKey(key: string): string {
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}

// ── cache + access ────────────────────────────────────────────

interface CacheEntry {
  rows: Map<string, unknown>
  at: number
}

const CACHE_TTL_MS = 10_000
let cache: CacheEntry | null = null

/** Test hook — drop the in-process cache. */
export function invalidateAdminConfig(): void {
  cache = null
}

async function readRows(): Promise<Map<string, unknown>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows
  const rows = new Map<string, unknown>()
  try {
    const { db } = await import('@/lib/db')
    const found = await db.appConfig.findMany({
      where: { key: { in: Object.values(CONFIG_KEYS) } },
      select: { key: true, value: true },
    })
    for (const row of found) rows.set(row.key, row.value)
  } catch {
    // fall back to whatever we cached before, else defaults
    if (cache) return cache.rows
  }
  cache = { rows, at: Date.now() }
  return rows
}

async function writeRow(key: string, value: Prisma.InputJsonValue): Promise<void> {
  const { db } = await import('@/lib/db')
  await db.appConfig.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  })
  invalidateAdminConfig()
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
}

// ── typed readers ─────────────────────────────────────────────

/** Console-set provider, when BOTH parts survive validation. Null = no override. */
export async function getProviderOverride(): Promise<StoredProvider | null> {
  const rows = await readRows()
  const raw = asRecord(rows.get(CONFIG_KEYS.provider))
  if (!raw.baseUrl && !raw.apiKey) return null
  const check = validateProvider({ baseUrl: raw.baseUrl, apiKey: raw.apiKey })
  return check.ok ? check.value : null
}

/** Model ids (empty strings omitted) — {} = SDK defaults. */
export async function getModels(): Promise<StoredModels> {
  const rows = await readRows()
  const raw = asRecord(rows.get(CONFIG_KEYS.models))
  const check = validateModels(raw)
  return check.ok ? check.value : {}
}

/** All seven flags, defaults for anything unset. */
export async function getFeatures(): Promise<StoredFeatures> {
  const rows = await readRows()
  const raw = asRecord(rows.get(CONFIG_KEYS.features))
  const check = validateFeatures(raw)
  return { ...DEFAULT_FEATURES, ...(check.ok ? check.value : {}) }
}

export async function aiFeatureEnabled(feature: AiFeature): Promise<boolean> {
  const flags = await getFeatures()
  return flags[feature]
}

export async function getSettings(): Promise<StoredSettings> {
  const rows = await readRows()
  const raw = asRecord(rows.get(CONFIG_KEYS.settings))
  const check = validateSettings(raw)
  return { ...DEFAULT_SETTINGS, ...(check.ok ? check.value : {}) }
}

// ── typed writers (console PUT) ───────────────────────────────

/** Write the full provider override (both fields required together). */
export async function setProvider(value: StoredProvider): Promise<void> {
  await writeRow(CONFIG_KEYS.provider, value as unknown as Prisma.InputJsonValue)
}

/** Clear the override — provider resolution falls back to env / config file. */
export async function clearProvider(): Promise<void> {
  await writeRow(CONFIG_KEYS.provider, {})
}

export async function setModels(value: StoredModels): Promise<void> {
  await writeRow(CONFIG_KEYS.models, value as unknown as Prisma.InputJsonValue)
}

export async function setFeatures(value: StoredFeatures): Promise<void> {
  await writeRow(CONFIG_KEYS.features, value as unknown as Prisma.InputJsonValue)
}

export async function setSettings(value: StoredSettings): Promise<void> {
  await writeRow(CONFIG_KEYS.settings, value as unknown as Prisma.InputJsonValue)
}
