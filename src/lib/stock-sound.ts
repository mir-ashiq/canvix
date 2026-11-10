// ─────────────────────────────────────────────────────────────
// stock-sound — provider-gated stock SOUND search (the Sound wave).
//
// The fourth stock-media connector, riding the SAME self-hoster-key
// architecture as stock photo (v0.16.4 A4) and stock video (v0.15
// R6): Freesound, plain REST, one free API key. Sound search is a
// library query against a licensed catalogue — never an AI slot —
// and the CC0 filter is ON BY DEFAULT (the audit's requirement):
// everything the connector returns is Creative Commons 0 unless
// the user explicitly opts into wider licences via
// `includeOtherLicenses`.
//
// Key resolution (the A5 pattern): a key stored on the admin AI &
// models page (stock.providers row, freesound) wins over the
// FREESOUND_API_KEY env var; no key configured ⇒ the Audio panel
// keeps its bundled library, web results answer 503 NO_PROVIDER
// with the operator hint, everything else keeps working (F2b
// fail-closed; docs/SOUND.md).
//
// Insert path: the browser downloads the CC0 preview MP3
// (cdn.freesound.org answers CORS-open on GET — verified pattern
// with the other stock CDNs), wraps it in a File and rides the
// existing chunked media store + audio analysis (waveform/BPM/beats
// bake in at insert), landing as a native AudioElement with a
// durable credit block.
//
// Honest limits (same shape as the photo connector):
//   - responses cached IN MEMORY per instance for 24 h
//   - preview MP3s are the insert rendition (HQ when present);
//     original FLAC/WAV/OGG downloads need OAuth2 and are out of
//     scope for the self-hoster key flow — recorded in SOUND.md
//   - CI has no key: unit tests run against recorded response
//     fixtures; the no-provider states are e2e-asserted
//     (tests/e2e/sound-gated.spec.ts)
// ─────────────────────────────────────────────────────────────

import { effectiveStockKeys } from '@/lib/admin/config'

export type StockSoundProvider = 'freesound'

/** Sanitized attribution block — also the shape stored on AudioElement.credit. */
export interface StockSoundCredit {
  provider: string
  author: string
  license: string
  url: string
}

/** One normalized search result — provider shape erased. */
export interface StockSoundResult {
  /** provider-prefixed unique id, e.g. 'freesound-123456' */
  id: string
  provider: StockSoundProvider
  /** cleaned display name */
  name: string
  /** seconds */
  duration: number
  /** preview MP3 (the insert rendition) */
  preview: string
  /** cleaned tags (max 6, tile-sized) */
  tags: string[]
  credit: StockSoundCredit
}

// ── availability (secret-free — never expose the key) ─────────

export async function stockSoundProviders(): Promise<StockSoundProvider[]> {
  const keys = await effectiveStockKeys()
  return keys.freesound ? ['freesound'] : []
}

export async function stockSoundAvailable(): Promise<boolean> {
  return (await stockSoundProviders()).length > 0
}

// ── shared helpers (the photo connector's, kept local) ────────

function isHttpUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 2000) return false
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function cleanText(v: unknown, max: number): string {
  const s = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v : ''
  if (!s) return ''
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function sanitizeCredit(raw: { provider: string; author: string; license: string; url: unknown }): StockSoundCredit | null {
  const url = isHttpUrl(raw.url) ? raw.url : ''
  const provider = cleanText(raw.provider, 24)
  const author = cleanText(raw.author, 80)
  const license = cleanText(raw.license, 80)
  if (!provider || !author || !license) return null
  return { provider, author, license, url }
}

// ── Freesound — GET /apiv2/search/text/, token query param ────
// Documented response (parsed defensively — the API may add keys):
//   { count: number, results: [{ id, name, tags: string[],
//       username, duration, license, previews: {
//         'preview-hq-mp3': url, 'preview-lq-mp3': url,
//         'preview-hq-ogg': url, 'preview-lq-ogg': url } }] }
//
// License values are URLs like https://creativecommons.org/publicdomain/zero/1.0/
// — mapped to the short display form; anything CC0 stays CC0.

const FREESOUND_LICENSE_LABELS: [RegExp, string][] = [
  [/publicdomain\/zero/i, 'CC0'],
  [/licenses\/by\//i, 'CC BY'],
  [/licenses\/by-nc/i, 'CC BY-NC'],
  [/licenses\/sampling\+/i, 'CC Sampling+'],
]

function licenseLabel(v: unknown): string {
  const s = typeof v === 'string' ? v : ''
  for (const [re, label] of FREESOUND_LICENSE_LABELS) if (re.test(s)) return label
  return cleanText(s.replace(/^https?:\/\/creativecommons\.org\//, ''), 40) || 'See source'
}

function parseFreesound(body: unknown): StockSoundResult[] {
  const results = (body as { results?: unknown })?.results
  if (!Array.isArray(results)) return []
  const out: StockSoundResult[] = []
  for (const r of results) {
    if (!r || typeof r !== 'object') continue
    const s = r as Record<string, unknown>
    const previews = s.previews && typeof s.previews === 'object' ? (s.previews as Record<string, unknown>) : {}
    const preview =
      (typeof previews['preview-hq-mp3'] === 'string' && previews['preview-hq-mp3']) ||
      (typeof previews['preview-lq-mp3'] === 'string' && previews['preview-lq-mp3']) ||
      ''
    if (!isHttpUrl(preview)) continue
    const id = cleanText(s.id, 32)
    if (!id) continue
    const tags = Array.isArray(s.tags)
      ? s.tags.filter((t): t is string => typeof t === 'string').map((t) => cleanText(t, 24)).filter(Boolean).slice(0, 6)
      : []
    const license = licenseLabel(s.license)
    const credit = sanitizeCredit({
      provider: 'Freesound',
      author: typeof s.username === 'string' && s.username ? s.username : 'Freesound creator',
      license,
      url: `https://freesound.org/s/${id}/`,
    })
    if (!credit) continue
    out.push({
      id: `freesound-${id}`,
      provider: 'freesound',
      name: cleanText(s.name, 80) || 'Untitled sound',
      duration: Math.min(600, num(s.duration)),
      preview,
      tags,
      credit,
    })
  }
  return out
}

// ── the 24 h in-memory response cache (per instance) ──────────

interface CacheEntry {
  at: number
  results: StockSoundResult[]
}
const CACHE_TTL_MS = 24 * 3600_000
const CACHE_MAX = 256
const searchCache = new Map<string, CacheEntry>()

function cacheGet(key: string): StockSoundResult[] | null {
  const entry = searchCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    searchCache.delete(key)
    return null
  }
  return entry.results
}

function cacheSet(key: string, results: StockSoundResult[]): void {
  searchCache.set(key, { at: Date.now(), results })
  if (searchCache.size > CACHE_MAX) {
    const oldest = [...searchCache.entries()].sort((a, b) => a[1].at - b[1].at)
    for (const [k] of oldest.slice(0, Math.floor(oldest.length / 2))) searchCache.delete(k)
  }
}

/** Test-only: wipe the response cache. */
export function resetStockSoundCache(): void {
  searchCache.clear()
}

// ── search ─────────────────────────────────────────────────────

const PROVIDER_FETCH_TIMEOUT_MS = 10_000
const FREESOUND_FIELDS = 'id,name,tags,username,duration,license,previews'

export interface SearchStockSoundsOptions {
  /** include non-CC0 licences (CC BY etc.) — default CC0 only */
  includeOtherLicenses?: boolean
  /** injected for tests — defaults to the global fetch */
  fetchImpl?: typeof fetch
  /** test-only: bypass the response cache */
  noCache?: boolean
}

export async function searchStockSounds(
  query: string,
  count: number,
  opts: SearchStockSoundsOptions = {},
): Promise<StockSoundResult[]> {
  const keys = await effectiveStockKeys()
  if (!keys.freesound) throw new Error('NO_PROVIDER')

  const q = query.trim().slice(0, 120)
  if (!q) return []
  const n = Math.min(Math.max(count, 1), 40)

  const cacheKey = `freesound:${q}:${n}:${opts.includeOtherLicenses ? 'all' : 'cc0'}`
  if (!opts.noCache) {
    const cached = cacheGet(cacheKey)
    if (cached) return cached
  }

  const base = (process.env.FREESOUND_API_BASE ?? 'https://freesound.org/apiv2').replace(/\/+$/, '')
  // CC0 by default — the audit's standing requirement. The wider
  // filter only ever UNIONs more permissive-looking licences the
  // user explicitly asked for; credit blocks stay durable either way.
  const licenseFilter = opts.includeOtherLicenses
    ? ''
    : `filter=${encodeURIComponent('license:"Creative Commons 0"')}&`
  const url =
    `${base}/search/text/?query=${encodeURIComponent(q)}&${licenseFilter}` +
    `fields=${FREESOUND_FIELDS}&page_size=${n}&token=${encodeURIComponent(keys.freesound)}`
  const doFetch = opts.fetchImpl ?? fetch
  const res = await doFetch(url, {
    signal: AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS),
  })
  if (!res.ok) {
    // never surface the provider body — the key lives in this URL
    console.error(`[stock-sound] freesound search failed: ${res.status}`)
    throw new Error(`Freesound search failed (${res.status}).`)
  }
  const body = await res.json()
  const results = parseFreesound(body)
  cacheSet(cacheKey, results)
  return results
}
