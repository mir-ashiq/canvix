// ─────────────────────────────────────────────────────────────
// Instance configuration (v0.16 A1, extended in v0.16.2 A2,
// v0.16.5 A5) — the store behind /admin's AI + settings pages.
//
// AppConfig rows (key → JSON):
//   ai.provider  { baseUrl, apiKey }   — legacy single override (v0.16 A1)
//   ai.providers { providers: […], slots: {…} } — multi-provider table (A2)
//   ai.models    { text?, vision?, image? } — legacy model ids (A1)
//   ai.features  { magicWrite, … }     — per-feature kill switches
//   app.settings { signupsOpen, anonymousEditing }
//   stock.providers { pexels?, pixabay? } — stock-media keys (A5)
//
// Design decisions (documented in docs/ADMIN.md):
//   • Precedence per capability slot: multi-provider table (ai.providers)
//     → legacy single override (ai.provider) → env → .z-ai-config file
//     → unconfigured. The console never shows a stored API key
//     back — only a mask (write-only credential, same posture as the
//     env vars it overrides).
//   • Multi-provider keys are write-only too: saving a provider without
//     re-entering its key keeps the stored one (matched by id), so
//     editing a label or model never demands the credential again.
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
  providers: 'ai.providers',
  models: 'ai.models',
  features: 'ai.features',
  settings: 'app.settings',
  stock: 'stock.providers',
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

/**
 * Capability slots (v0.16.2 A2) — what a provider can be assigned to.
 * v0.16.4 (A4): imageSearch is GONE — photo search is not a model
 * capability; it runs on the stock-provider keys (Pexels/Pixabay,
 * src/lib/stock-photo.ts), like the R6 stock-video rail. Stored
 * tables that still carry an imageSearch slot are read fine:
 * validateSlots only reads known slot keys, so the stale entry is
 * dropped on the next read and disappears on the next save.
 */
export const AI_SLOTS = ['text', 'vision', 'image', 'imageEdit'] as const
export type AiSlot = (typeof AI_SLOTS)[number]

export interface StoredProvider {
  baseUrl: string
  apiKey: string
}
export interface StoredModels {
  text?: string
  vision?: string
  image?: string
}
/** One entry of the multi-provider table. */
export interface StoredProviderEntry {
  /** Stable client-visible id (`p` + alphanumerics) — slots reference it. */
  id: string
  label: string
  baseUrl: string
  apiKey: string
}
/** A capability slot pinned to one provider of the table. */
export interface StoredSlot {
  providerId: string
  model?: string
}
/** The whole multi-provider table (AppConfig `ai.providers`). */
export interface StoredProviders {
  providers: StoredProviderEntry[]
  slots: Partial<Record<AiSlot, StoredSlot>>
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

// ── stock-media keys (v0.16.5 A5) ─────────────────────────────

/** The two stock-media connectors — photos + videos share each key. */
export type StockProviderName = 'pexels' | 'pixabay'
/** Stored stock keys (AppConfig `stock.providers`) — write-only like every credential here. */
export type StoredStockKeys = Partial<Record<StockProviderName, string>>
/** The pre-A5 way to key stock search — still the fallback when nothing is stored. */
export const STOCK_ENV_KEYS: Record<StockProviderName, string> = {
  pexels: 'PEXELS_API_KEY',
  pixabay: 'PIXABAY_API_KEY',
}

const BASEURL_MAX = 2048
const APIKEY_MAX = 4096
// Model ids: letters, digits, ._:+- plus "/" (NVIDIA NIM + HuggingFace
// namespaces: meta/llama-3.1-70b-instruct) and "@" (OpenRouter vendor
// prefixes). No spaces, no path traversal (".." still passes the charset
// but can only ever name a model id at the provider, never a file).
const MODEL_RE = /^[A-Za-z0-9._:+/@-]{1,120}$/
const PROVIDER_ID_RE = /^p[a-z0-9]{1,23}$/
const LABEL_MAX = 60
/** Hard cap on table size — eight providers is far beyond any sane setup. */
const PROVIDERS_MAX = 8

/** Random id for a new provider entry (`p` + 10 base36 chars). */
function makeProviderId(): string {
  return 'p' + Array.from({ length: 10 }, () => Math.floor(Math.random() * 36).toString(36)).join('')
}

// ── validation (pure, unit-tested) ────────────────────────────

export type Check<T> = { ok: true; value: T } | { ok: false; error: string }

/** Shared base-URL validation — returns the normalized URL or why it failed. */
function checkBaseUrl(baseUrl: string): Check<string> {
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
  return { ok: true, value: parsed.toString() }
}

/** A usable provider override: an http(s) base URL without credentials + a non-empty key. */
export function validateProvider(input: unknown): Check<StoredProvider> {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'provider must be an object.' }
  const raw = input as Record<string, unknown>
  if (typeof raw.baseUrl !== 'string' || !raw.baseUrl.trim()) return { ok: false, error: 'baseUrl is required.' }
  if (typeof raw.apiKey !== 'string' || !raw.apiKey) return { ok: false, error: 'apiKey is required.' }
  const baseUrl = raw.baseUrl.trim()
  if (baseUrl.length > BASEURL_MAX) return { ok: false, error: `baseUrl must be at most ${BASEURL_MAX} characters.` }
  if (raw.apiKey.length > APIKEY_MAX) return { ok: false, error: `apiKey must be at most ${APIKEY_MAX} characters.` }
  const url = checkBaseUrl(baseUrl)
  if (!url.ok) return url
  return { ok: true, value: { baseUrl: url.value, apiKey: raw.apiKey } }
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

/**
 * Validate a stock-keys PATCH (v0.16.5 A5). Per connector:
 *   a non-empty string (trimmed, ≤ APIKEY_MAX) sets the stored key,
 *   null explicitly clears it (env fallback restored),
 *   omitted OR an empty string leaves it untouched — the same
 *   write-only posture as the providers table, applied to a fixed
 *   two-provider set (editing one key never demands the other).
 */
export function validateStockKeys(
  input: unknown,
): Check<Partial<Record<StockProviderName, string | null>>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'stock must be an object.' }
  }
  const raw = input as Record<string, unknown>
  const out: Partial<Record<StockProviderName, string | null>> = {}
  for (const name of ['pexels', 'pixabay'] as const) {
    const v = raw[name]
    if (v === undefined) continue
    if (v === null) {
      out[name] = null // explicit clear
      continue
    }
    if (typeof v !== 'string') {
      return { ok: false, error: `stock.${name} must be a key string or null (to clear).` }
    }
    const key = v.trim()
    if (!key) continue // empty = keep the stored key (write-only editing)
    if (key.length > APIKEY_MAX) {
      return { ok: false, error: `stock.${name} must be at most ${APIKEY_MAX} characters.` }
    }
    out[name] = key
  }
  return { ok: true, value: out }
}

// ── multi-provider table validation (v0.16.2 A2) ─────────────

/**
 * Validate the provider LIST half of `ai.providers` (full replace).
 *
 * Input shape: [{ id?, label, baseUrl, apiKey? }]. Keys are write-only:
 * an entry with an id whose apiKey is empty/missing keeps the stored key
 * (matched against `existing`), so editing a label or URL never demands
 * the credential again. New entries (no id, or an id not in `existing`)
 * MUST carry a key. Ids are validated for shape + uniqueness and
 * generated (via `makeId`, injectable for tests) when missing.
 */
export function validateProviderList(
  input: unknown,
  opts: { existing?: Map<string, StoredProviderEntry>; makeId?: () => string } = {}
): Check<StoredProviderEntry[]> {
  if (!Array.isArray(input)) return { ok: false, error: 'providers.list must be an array.' }
  if (input.length > PROVIDERS_MAX) {
    return { ok: false, error: `At most ${PROVIDERS_MAX} providers can be stored.` }
  }
  const existing = opts.existing ?? new Map()
  const makeId = opts.makeId ?? makeProviderId
  const seen = new Set<string>()
  const out: StoredProviderEntry[] = []
  for (let i = 0; i < input.length; i++) {
    const raw = input[i]
    if (typeof raw !== 'object' || raw === null) {
      return { ok: false, error: `providers.list[${i}] must be an object.` }
    }
    const entry = raw as Record<string, unknown>
    // label
    const label = typeof entry.label === 'string' ? entry.label.trim() : ''
    if (!label || label.length > LABEL_MAX) {
      return { ok: false, error: `providers.list[${i}].label must be 1-${LABEL_MAX} characters.` }
    }
    // baseUrl (shared rules with the legacy override)
    if (typeof entry.baseUrl !== 'string' || !entry.baseUrl.trim()) {
      return { ok: false, error: `providers.list[${i}].baseUrl is required.` }
    }
    const baseUrl = entry.baseUrl.trim()
    if (baseUrl.length > BASEURL_MAX) {
      return { ok: false, error: `providers.list[${i}].baseUrl must be at most ${BASEURL_MAX} characters.` }
    }
    const url = checkBaseUrl(baseUrl)
    if (!url.ok) return { ok: false, error: `providers.list[${i}]: ${url.error}` }
    // id — validate or generate, always unique within the list
    let id = typeof entry.id === 'string' && entry.id ? entry.id : ''
    if (id) {
      if (!PROVIDER_ID_RE.test(id)) {
        return { ok: false, error: `providers.list[${i}].id must look like "p" + lowercase alphanumerics.` }
      }
    } else {
      id = makeId()
      while (!PROVIDER_ID_RE.test(id) || seen.has(id)) id = makeId()
    }
    if (seen.has(id)) return { ok: false, error: `Duplicate provider id "${id}".` }
    seen.add(id)
    // apiKey — write-only: keep the stored one when omitted
    const stored = existing.get(id)
    let apiKey = typeof entry.apiKey === 'string' ? entry.apiKey : ''
    if (!apiKey && stored) apiKey = stored.apiKey
    if (!apiKey) {
      return {
        ok: false,
        error: `providers.list[${i}].apiKey is required for a new provider (leave it empty to keep a stored one).`,
      }
    }
    if (apiKey.length > APIKEY_MAX) {
      return { ok: false, error: `providers.list[${i}].apiKey must be at most ${APIKEY_MAX} characters.` }
    }
    out.push({ id, label, baseUrl: url.value, apiKey })
  }
  return { ok: true, value: out }
}

/**
 * Validate the SLOTS half of `ai.providers`: slot → { providerId, model? }
 * or null (clears the slot). providerId must reference a provider in the
 * list being saved. Unknown slot keys are dropped; model ids follow the
 * same MODEL_RE as the legacy models field (empty string = omit).
 */
export function validateSlots(input: unknown, providerIds: Set<string>): Check<Partial<Record<AiSlot, StoredSlot>>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'providers.slots must be an object.' }
  }
  const raw = input as Record<string, unknown>
  const out: Partial<Record<AiSlot, StoredSlot>> = {}
  for (const slot of AI_SLOTS) {
    const v = raw[slot]
    if (v === undefined) continue
    if (v === null) continue // explicit clear — omit the slot
    if (typeof v !== 'object' || Array.isArray(v)) {
      return { ok: false, error: `providers.slots.${slot} must be an object or null.` }
    }
    const entry = v as Record<string, unknown>
    const providerId = typeof entry.providerId === 'string' ? entry.providerId : ''
    if (!providerId || !providerIds.has(providerId)) {
      return { ok: false, error: `providers.slots.${slot}.providerId must reference a provider in the list.` }
    }
    let model: string | undefined
    const m = entry.model
    if (m !== undefined && m !== null && m !== '') {
      if (typeof m !== 'string' || !MODEL_RE.test(m)) {
        return { ok: false, error: `providers.slots.${slot}.model must be a model id (letters, digits, . _ : + -).` }
      }
      model = m
    }
    out[slot] = model ? { providerId, model } : { providerId }
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

/**
 * The multi-provider table (v0.16.2 A2). Null when absent — slots then
 * fall back to the legacy chain (override → env → file). A table whose
 * list half fails validation is treated as absent (fail-open to the
 * legacy chain, the same stance as every other config read here).
 */
export async function getProviders(): Promise<StoredProviders | null> {
  const rows = await readRows()
  const raw = asRecord(rows.get(CONFIG_KEYS.providers))
  const list = Array.isArray(raw.providers) ? raw.providers : []
  const check = validateProviderList(list)
  if (!check.ok || !check.value.length) return null
  const ids = new Set(check.value.map((p) => p.id))
  const slots = validateSlots(raw.slots, ids)
  return { providers: check.value, slots: slots.ok ? slots.value : {} }
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

/** Write the full multi-provider table (list + slots together). */
export async function setProviders(value: StoredProviders): Promise<void> {
  await writeRow(CONFIG_KEYS.providers, value as unknown as Prisma.InputJsonValue)
}

/** Clear the multi-provider table — slots fall back to the legacy chain. */
export async function clearProviders(): Promise<void> {
  await writeRow(CONFIG_KEYS.providers, {})
}

/**
 * One-click migration (v0.16.2 A2): fold the legacy single-provider
 * override into the multi-provider table and clear the legacy row.
 *
 *   • no legacy override stored → { ok: false } (the route answers 400)
 *   • a provider with the same baseUrl already in the table → don't
 *     duplicate, just clear the legacy row
 *   • table has no slots yet → point every slot at the imported provider
 *     (preserves the A1 behaviour where the override answered everything)
 */
export async function importLegacyProvider(): Promise<
  | { ok: false; error: string }
  | { ok: true; value: { list: StoredProviderEntry[]; slots: Partial<Record<AiSlot, StoredSlot>>; added: boolean } }
> {
  const legacy = await getProviderOverride()
  if (!legacy) return { ok: false, error: 'No single-provider override is stored — nothing to import.' }
  const current = await getProviders()
  const list = current?.providers ? [...current.providers] : []
  const slots = current?.slots ? { ...current.slots } : {}
  const duplicate = list.some((p) => p.baseUrl === legacy.baseUrl)
  let added = false
  if (!duplicate) {
    let id = makeProviderId()
    while (list.some((p) => p.id === id)) id = makeProviderId()
    list.push({ id, label: 'Imported override', baseUrl: legacy.baseUrl, apiKey: legacy.apiKey })
    if (!Object.keys(slots).length) {
      for (const slot of AI_SLOTS) slots[slot] = { providerId: id }
    }
    added = true
  }
  await setProviders({ providers: list, slots })
  await clearProvider()
  return { ok: true, value: { list, slots, added } }
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

// ── stock-media keys: read / merge-write / resolve (A5) ───────

/** The console-stored stock keys only (no env) — corrupt entries are skipped, never fatal. */
export async function getStockKeys(): Promise<StoredStockKeys> {
  const rows = await readRows()
  const raw = asRecord(rows.get(CONFIG_KEYS.stock))
  const out: StoredStockKeys = {}
  for (const name of ['pexels', 'pixabay'] as const) {
    const v = raw[name]
    if (typeof v === 'string' && v.trim()) out[name] = v.trim()
  }
  return out
}

/** Merge a validated patch over the stored keys and write the full state. */
export async function setStockKeys(patch: Partial<Record<StockProviderName, string | null>>): Promise<void> {
  const next: StoredStockKeys = { ...(await getStockKeys()) }
  for (const name of ['pexels', 'pixabay'] as const) {
    const v = patch[name]
    if (v === null) delete next[name]
    else if (typeof v === 'string' && v) next[name] = v
  }
  await writeRow(CONFIG_KEYS.stock, next as unknown as Prisma.InputJsonValue)
}

/**
 * The keys the stock connectors actually use (A5): a stored console
 * key wins, else the env var, else '' (unset) — the same precedence
 * direction as every AI credential here: the console overrides the
 * environment, it never loses to it. Clearing a stored key restores
 * the env fallback.
 */
export async function effectiveStockKeys(): Promise<Record<StockProviderName, string>> {
  const stored = await getStockKeys()
  const out = { pexels: '', pixabay: '' }
  for (const name of ['pexels', 'pixabay'] as const) {
    out[name] = stored[name] ?? (process.env[STOCK_ENV_KEYS[name]] ?? '').trim()
  }
  return out
}
