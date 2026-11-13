// ─────────────────────────────────────────────────────────────
// BYOK — per-user AI providers (v0.23).
//
// The profile page lets a signed-in user store their own provider
// credentials (baseUrl + apiKey + slots + per-slot models). Every
// provider-backed feature then prefers the USER's provider over the
// instance-wide slots, so people can bring their own keys to a
// self-hosted (or operator-limited) instance and still use the AI
// features — the operator's keys are never consumed for their work.
//
// Precedence per slot (documented in README → "Bring your own key"):
//   1. the user's own provider that answers the slot (first by
//      createdAt, most recent update wins within the same slot)
//   2. the instance-wide chain: multi-provider table → legacy
//      override → env → .z-ai-config file (unchanged, v0.16.2 A2)
//
// SECURITY POSTURE (mirrors the admin console, docs/ADMIN.md):
//   • Keys are write-only: every read path returns maskApiKey(),
//     never the stored credential. The API never sends it back.
//   • The key lives server-side in Postgres, exactly like the admin
//     table's keys — it is resolved server-side per request and
//     never reaches the browser (same contract as secrets never
//     reaching the browser in provider.ts).
//   • Validation reuses the admin validators (baseUrl http(s), no
//     embedded credentials, key length caps, MODEL_RE for ids).
//
// CONTRACT: server-only (Prisma + credentials in memory).
// ─────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import { maskApiKey, validateProvider, type AiSlot } from '@/lib/admin/config'

/** The AI slots a user provider can answer — same universe as the admin table. */
export const BYOK_SLOTS: readonly AiSlot[] = ['text', 'vision', 'image', 'imageEdit', 'video'] as const

/** Hard cap — mirrors the admin table's PROVIDERS_MAX (8). */
export const BYOK_PROVIDERS_MAX = 8

/** One stored user provider, as the profile page sees it (key masked). */
export interface UserProviderView {
  id: string
  label: string
  baseUrl: string
  slots: AiSlot[]
  models: Partial<Record<AiSlot, string>>
  keyMask: string
  createdAt: string
  updatedAt: string
}

export type ByokCheck<T> = { ok: true; value: T } | { ok: false; error: string }

// ── validation (pure, unit-tested) ────────────────────────────

/** Parse the comma-separated slots string ('text,vision') into slot values. */
export function parseSlots(raw: string | undefined | null): AiSlot[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is AiSlot => (BYOK_SLOTS as readonly string[]).includes(s))
}

/**
 * Validate a save-provider payload: label + baseUrl + apiKey + slots +
 * optional per-slot model ids. Reuses the admin base checks so the
 * accepted input shapes stay identical.
 */
export function validateUserProvider(input: unknown): ByokCheck<{
  label: string
  baseUrl: string
  apiKey: string
  slots: AiSlot[]
  models: Partial<Record<AiSlot, string>>
}> {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'Provider must be an object.' }
  const raw = input as Record<string, unknown>
  // label: 3–60 chars, no control characters (shown in lists and logs)
  if (typeof raw.label !== 'string' || raw.label.trim().length < 3 || raw.label.trim().length > 60) {
    return { ok: false, error: 'Label must be 3–60 characters.' }
  }
  // baseUrl + apiKey: same rules as the admin table (http(s), no
  // embedded credentials, length caps) — validateProvider does both.
  const prov = validateProvider({ baseUrl: raw.baseUrl, apiKey: raw.apiKey })
  if (!prov.ok) return prov
  // slots: at least one known slot
  let slots: AiSlot[] = []
  if (Array.isArray(raw.slots)) {
    slots = raw.slots.filter((s): s is AiSlot => (BYOK_SLOTS as readonly string[]).includes(s as string))
  } else if (typeof raw.slots === 'string') {
    slots = parseSlots(raw.slots)
  }
  if (!slots.length) return { ok: false, error: 'Pick at least one capability slot (text, vision, image, imageEdit, video).' }
  // models: optional per-slot ids — strings under MODEL_RE (validated
  // per entry; the admin table checks the same pattern in validateSlots)
  const models: Partial<Record<AiSlot, string>> = {}
  if (raw.models !== undefined && raw.models !== null) {
    if (typeof raw.models !== 'object' || Array.isArray(raw.models)) {
      return { ok: false, error: 'models must be an object of { slot: modelId }.' }
    }
    for (const [slot, id] of Object.entries(raw.models as Record<string, unknown>)) {
      if (!(BYOK_SLOTS as readonly string[]).includes(slot)) continue // unknown keys dropped, not fatal
      if (typeof id !== 'string' || !id.trim()) continue
      const MODEL_RE = /^[A-Za-z0-9._:+/@-]{1,120}$/
      if (!MODEL_RE.test(id.trim())) return { ok: false, error: `Invalid model id for the ${slot} slot.` }
      models[slot as AiSlot] = id.trim()
    }
  }
  return { ok: true, value: { label: raw.label.trim(), baseUrl: prov.value.baseUrl, apiKey: prov.value.apiKey, slots, models } }
}

// ── reads (masked) ────────────────────────────────────────────

/** All of a user's providers, masked — the profile page list. */
export async function listUserProviders(userId: string): Promise<UserProviderView[]> {
  const rows = await db.userAIProvider.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } })
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    baseUrl: r.baseUrl,
    slots: parseSlots(r.slots),
    models: (r.models ?? {}) as Partial<Record<AiSlot, string>>,
    keyMask: maskApiKey(r.apiKey),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }))
}

// ── slot resolution (the BYOK layer of resolveSlot) ──────────

/** Resolved user slot — same shape ResolvedSlot uses, source: 'user'. */
export interface UserResolvedSlot {
  baseUrl: string
  apiKey: string
  model?: string
  providerId: string
  label: string
  source: 'user'
}

/**
 * Resolve ONE slot from the user's own providers. First provider row
 * (by createdAt — insertion order is the user's declared priority)
 * whose slots list contains the slot. Returns null when none matches.
 *
 * Pure data in, data out — no client construction, so it unit-tests
 * without a DB.
 */
export function pickUserSlot(
  slot: AiSlot,
  rows: { id: string; label: string; baseUrl: string; apiKey: string; slots: string; models: unknown }[]
): UserResolvedSlot | null {
  for (const r of rows) {
    if (!parseSlots(r.slots).includes(slot)) continue
    const models = (r.models ?? {}) as Partial<Record<AiSlot, string>>
    return {
      baseUrl: r.baseUrl,
      apiKey: r.apiKey,
      model: models[slot],
      providerId: r.id,
      label: r.label,
      source: 'user',
    }
  }
  return null
}

/** DB-backed picker — the one the request path uses. */
export async function resolveUserSlot(slot: AiSlot, userId: string): Promise<UserResolvedSlot | null> {
  const rows = await db.userAIProvider.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, label: true, baseUrl: true, apiKey: true, slots: true, models: true },
  })
  return pickUserSlot(slot, rows)
}

/** Which slots does this user cover? (capabilities integration) */
export async function userCoveredSlots(userId: string): Promise<AiSlot[]> {
  const rows = await db.userAIProvider.findMany({ where: { userId }, select: { slots: true } })
  const set = new Set<AiSlot>()
  for (const r of rows) for (const s of parseSlots(r.slots)) set.add(s)
  return [...set]
}

// ── writes ────────────────────────────────────────────────────

/** Save (insert) a validated provider. Caps the list at BYOK_PROVIDERS_MAX. */
export async function saveUserProvider(
  userId: string,
  value: { label: string; baseUrl: string; apiKey: string; slots: AiSlot[]; models: Partial<Record<AiSlot, string>> }
): Promise<ByokCheck<UserProviderView>> {
  const count = await db.userAIProvider.count({ where: { userId } })
  if (count >= BYOK_PROVIDERS_MAX) {
    return { ok: false, error: `Provider limit reached (${BYOK_PROVIDERS_MAX}) — remove one first.` }
  }
  const row = await db.userAIProvider.create({
    data: {
      userId,
      label: value.label,
      baseUrl: value.baseUrl,
      apiKey: value.apiKey,
      slots: value.slots.join(','),
      models: value.models as object,
    },
  })
  return {
    ok: true,
    value: {
      id: row.id,
      label: row.label,
      baseUrl: row.baseUrl,
      slots: value.slots,
      models: value.models,
      keyMask: maskApiKey(row.apiKey),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
  }
}

/**
 * Replace an existing provider row (edit path). The key is write-only:
 * when apiKey is absent or empty, the stored key is KEPT (same
 * posture as the admin table — editing a label never demands the
 * credential again).
 */
export async function updateUserProvider(
  userId: string,
  id: string,
  value: { label: string; baseUrl: string; apiKey?: string; slots: AiSlot[]; models: Partial<Record<AiSlot, string>> }
): Promise<ByokCheck<UserProviderView>> {
  const existing = await db.userAIProvider.findFirst({ where: { id, userId } })
  if (!existing) return { ok: false, error: 'Provider not found.' }
  const row = await db.userAIProvider.update({
    where: { id },
    data: {
      label: value.label,
      baseUrl: value.baseUrl,
      ...(value.apiKey ? { apiKey: value.apiKey } : {}),
      slots: value.slots.join(','),
      models: value.models as object,
    },
  })
  return {
    ok: true,
    value: {
      id: row.id,
      label: row.label,
      baseUrl: row.baseUrl,
      slots: parseSlots(row.slots),
      models: (row.models ?? {}) as Partial<Record<AiSlot, string>>,
      keyMask: maskApiKey(row.apiKey),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
  }
}

/** Delete one of the user's providers. No-op-safe. */
export async function deleteUserProvider(userId: string, id: string): Promise<boolean> {
  const existing = await db.userAIProvider.findFirst({ where: { id, userId } })
  if (!existing) return false
  await db.userAIProvider.delete({ where: { id } })
  return true
}
