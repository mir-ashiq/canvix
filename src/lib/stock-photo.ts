// ─────────────────────────────────────────────────────────────
// stock-photo — provider-gated stock PHOTO search (v0.16.4 A4).
//
// Photo search is NOT an AI-model capability: "find me a photo of
// a coffee shop" is a library query against licensed stock
// catalogs, not a generative one. It used to ride the AI
// provider table (the imageSearch slot), which pinned it to
// OpenAI-compatible endpoints that almost never serve an
// images/search route — the standing 404 behind the A3 incident.
// The slot is retired; photos now ride the SAME self-hoster-key
// architecture as stock video (v0.15 R6): Pexels + Pixabay,
// plain REST, one free key each — and the SAME two env keys
// (PEXELS_API_KEY / PIXABAY_API_KEY) activate both rails.
//
// No provider key configured ⇒ the Photos panel keeps its
// bundled library, web results answer 503 NO_PROVIDER with the
// operator hint, and everything else keeps working (the F2b
// fail-closed pattern; docs/STOCK-PHOTO.md).
//
// Dependency decision (the house rule): ZERO new runtime
// dependencies — both providers are JSON-over-GET with one auth
// value; the whole connector is plain fetch. Recorded in
// docs/STOCK-PHOTO.md alongside the attribution model.
//
// Attribution (the R6 acceptance, applied to photos): every
// result carries a sanitized credit block {provider, author,
// license, url} stored DURABLY on the inserted ImageElement
// (`credit`), shown in the toast at insert and in the
// properties bar whenever the element is selected. It is never
// rendered on the canvas or burned into exports — a forced
// overlay would corrupt the design, and neither license demands
// on-content credit.
//
// Honest limits, stated here so nobody has to rediscover them:
//   - provider responses are cached IN MEMORY per instance for
//     24 h (Pixabay's request; Pexels gets it for free). A
//     multi-instance fleet caches per instance, not per
//     deployment.
//   - downloads happen in the BROWSER (both provider CDNs
//     answer Access-Control-Allow-Origin: * on GET — verified
//     empirically for the video renditions, same CDNs), then
//     ride the existing chunked media store: quota, sha256
//     dedupe and the 32 MB cap all apply as-is.
//   - CI has no provider keys, so the live-provider happy path
//     is covered by unit tests against recorded response
//     fixtures plus the provider-on e2e against a local mock
//     provider (tests/e2e-stock-video/stock-photo.spec.ts);
//     the no-provider states are e2e-asserted on the default
//     suite (tests/e2e/stock-photo-gated.spec.ts).
// ─────────────────────────────────────────────────────────────

export type StockPhotoProvider = 'pexels' | 'pixabay'

/** Sanitized attribution block — also the shape stored on ImageElement.credit. */
export interface StockPhotoCredit {
  provider: string
  author: string
  license: string
  url: string
}

/** One normalized search result — provider shape erased. */
export interface StockPhotoResult {
  /** provider-prefixed unique id, e.g. 'pexels-417173' */
  id: string
  provider: StockPhotoProvider
  /** original dimensions (the insert probes the real bytes anyway) */
  width: number
  height: number
  /** tile thumbnail — small, CORS-open CDN image */
  preview: string
  /** preferred download rendition: the largest at most 1920 px wide */
  download: string
  /** strictly smaller renditions, widest first — the fallback ladder
   *  for when the media store's size cap rejects the primary */
  alternates: string[]
  credit: StockPhotoCredit
}

// ── availability (secret-free — never expose the keys) ────────

export function stockPhotoProviders(): StockPhotoProvider[] {
  const out: StockPhotoProvider[] = []
  if ((process.env.PEXELS_API_KEY ?? '').trim()) out.push('pexels')
  if ((process.env.PIXABAY_API_KEY ?? '').trim()) out.push('pixabay')
  return out
}

export function stockPhotoAvailable(): boolean {
  return stockPhotoProviders().length > 0
}

// ── shared helpers ────────────────────────────────────────────

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

/** Strip control characters + collapse whitespace + hard cap. */
function cleanText(v: unknown, max: number): string {
  // provider ids arrive as JSON numbers — stringify those, drop the rest
  const s = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v : ''
  if (!s) return ''
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function sanitizeCredit(raw: {
  provider: string
  author: string
  license: string
  url: unknown
}): StockPhotoCredit | null {
  const url = isHttpUrl(raw.url) ? raw.url : ''
  const provider = cleanText(raw.provider, 24)
  const author = cleanText(raw.author, 80)
  const license = cleanText(raw.license, 80)
  if (!provider || !author || !license) return null
  return { provider, author, license, url }
}

/** The rendition ladder: pick a primary ≤ MAX_PRIMARY_PX wide, list the
 *  smaller ones as fallbacks (widest first). Null when no usable
 *  http(s) URL exists. (Widths may be 0/unknown — those sort last and
 *  only ever become the last resort.) */
const MAX_PRIMARY_PX = 1920

export function choosePhotoRenditions(files: { url: string; width: number }[]): {
  primary: string
  alternates: string[]
} | null {
  const seen = new Set<string>()
  const usable = files
    .filter((f) => isHttpUrl(f.url) && !seen.has(f.url) && seen.add(f.url))
    .sort((a, b) => b.width - a.width)
  if (usable.length === 0) return null
  const primary = usable.find((f) => f.width <= MAX_PRIMARY_PX && f.width > 0) ?? usable[usable.length - 1]
  const below = usable.filter((f) => f !== primary && (f.width < primary.width || primary.width === 0))
  return { primary: primary.url, alternates: below.map((f) => f.url) }
}

// ── Pexels — GET /v1/search, Authorization header ─────────────
// Response (documented Photo resource, parsed defensively — the
// API may add keys, so every field is unknown until validated):
//   { photos: [{ id, width, height, url, photographer,
//       photographer_url, avg_color, alt,
//       src: { original, large2x, large, medium, small,
//              portrait, landscape, tiny } }] }

/**
 * pexels src variants we build the download ladder from, widest first.
 * Deliberately EXCLUDED: `portrait`/`landscape` (different CROPS of the
 * same photo — a size-cap fallback must never silently swap the crop)
 * and `tiny` (65 px — useless as an insert). `original` stays as the
 * last resort when nothing else exists (it can be 4000 px+ / multi-MB;
 * the media store's cap then rejects it and the panel reports honestly).
 */
const PEXELS_SRC_ORDER = ['large2x', 'large', 'medium', 'small', 'original'] as const
const PEXELS_SRC_WIDTH: Record<(typeof PEXELS_SRC_ORDER)[number], number> = {
  large2x: 1880,
  large: 940,
  medium: 400,
  small: 200,
  original: 4000,
}

function parsePexels(body: unknown): StockPhotoResult[] {
  const photos = (body as { photos?: unknown })?.photos
  if (!Array.isArray(photos)) return []
  const out: StockPhotoResult[] = []
  for (const p of photos) {
    if (!p || typeof p !== 'object') continue
    const photo = p as Record<string, unknown>
    const src = photo.src && typeof photo.src === 'object' ? (photo.src as Record<string, unknown>) : {}
    const files: { url: string; width: number }[] = []
    for (const key of PEXELS_SRC_ORDER) {
      const link = src[key]
      if (typeof link === 'string' && link) {
        // width estimate per the documented src ladder (the API does
        // not repeat per-variant widths); the insert probes real bytes
        files.push({ url: link, width: PEXELS_SRC_WIDTH[key] })
      }
    }
    const ladder = choosePhotoRenditions(files)
    if (!ladder) continue
    const credit = sanitizeCredit({
      provider: 'Pexels',
      author:
        typeof photo.photographer === 'string' && photo.photographer ? photo.photographer : 'Pexels creator',
      license: 'Pexels License',
      url: photo.url,
    })
    if (!credit) continue
    const preview =
      (typeof src.medium === 'string' && src.medium) ||
      (typeof src.small === 'string' && src.small) ||
      (typeof src.tiny === 'string' && src.tiny) ||
      ladder.primary
    out.push({
      id: `pexels-${cleanText(photo.id, 32) || out.length}`,
      provider: 'pexels',
      width: num(photo.width),
      height: num(photo.height),
      preview: isHttpUrl(preview) ? preview : ladder.primary,
      download: ladder.primary,
      alternates: ladder.alternates,
      credit,
    })
  }
  return out
}

// ── Pixabay — GET /api/, key as query param ───────────────────
// Response (documented, parsed defensively):
//   { hits: [{ id, pageURL, previewURL, previewWidth, previewHeight,
//       webformatURL, webformatWidth, webformatHeight, largeImageURL,
//       fullHDURL, imageWidth, imageHeight, user }] }

function parsePixabay(body: unknown): StockPhotoResult[] {
  const hits = (body as { hits?: unknown })?.hits
  if (!Array.isArray(hits)) return []
  const out: StockPhotoResult[] = []
  for (const h of hits) {
    if (!h || typeof h !== 'object') continue
    const hit = h as Record<string, unknown>
    // the documented size ladder: fullHDURL (1920, only when the
    // original is big enough) → largeImageURL (~936) → webformatURL
    // (640, always present). previewURL is 150 px — tile-sized.
    const files: { url: string; width: number }[] = []
    if (typeof hit.fullHDURL === 'string' && hit.fullHDURL) files.push({ url: hit.fullHDURL, width: 1920 })
    if (typeof hit.largeImageURL === 'string' && hit.largeImageURL) {
      files.push({
        url: hit.largeImageURL,
        width: num(hit.imageWidth) > 0 ? Math.min(num(hit.imageWidth), 1280) : 936,
      })
    }
    if (typeof hit.webformatURL === 'string' && hit.webformatURL) {
      files.push({ url: hit.webformatURL, width: num(hit.webformatWidth) || 640 })
    }
    const ladder = choosePhotoRenditions(files)
    if (!ladder) continue
    const credit = sanitizeCredit({
      provider: 'Pixabay',
      author: typeof hit.user === 'string' && hit.user ? hit.user : 'Pixabay creator',
      license: 'Pixabay Content License',
      url: hit.pageURL,
    })
    if (!credit) continue
    const preview = typeof hit.previewURL === 'string' && hit.previewURL ? hit.previewURL : ladder.primary
    out.push({
      id: `pixabay-${cleanText(hit.id, 32) || out.length}`,
      provider: 'pixabay',
      width: num(hit.imageWidth),
      height: num(hit.imageHeight),
      preview: isHttpUrl(preview) ? preview : ladder.primary,
      download: ladder.primary,
      alternates: ladder.alternates,
      credit,
    })
  }
  return out
}

// ── the 24 h in-memory response cache (per instance) ──────────

interface CacheEntry {
  at: number
  results: StockPhotoResult[]
}
const CACHE_TTL_MS = 24 * 3600_000
const CACHE_MAX = 512
const searchCache = new Map<string, CacheEntry>()

function cacheGet(key: string): StockPhotoResult[] | null {
  const entry = searchCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    searchCache.delete(key)
    return null
  }
  return entry.results
}

function cacheSet(key: string, results: StockPhotoResult[]): void {
  searchCache.set(key, { at: Date.now(), results })
  if (searchCache.size > CACHE_MAX) {
    const oldest = [...searchCache.entries()].sort((a, b) => a[1].at - b[1].at)
    for (const [k] of oldest.slice(0, Math.floor(oldest.length / 2))) searchCache.delete(k)
  }
}

/** Test-only: wipe the response cache. */
export function resetStockPhotoCache(): void {
  searchCache.clear()
}

// ── search ─────────────────────────────────────────────────────

const PROVIDER_FETCH_TIMEOUT_MS = 10_000

export interface SearchStockPhotosOptions {
  /** which connector to query (must be configured — the route validates) */
  provider?: StockPhotoProvider
  /** injected for tests — defaults to the global fetch */
  fetchImpl?: typeof fetch
  /** test-only: bypass the response cache */
  noCache?: boolean
}

export async function searchStockPhotos(
  query: string,
  count: number,
  opts: SearchStockPhotosOptions = {},
): Promise<StockPhotoResult[]> {
  const providers = stockPhotoProviders()
  const provider = opts.provider && providers.includes(opts.provider) ? opts.provider : providers[0]
  if (!provider) throw new Error('NO_PROVIDER')

  const q = query.trim().slice(0, 120)
  if (!q) return []
  const n = Math.min(Math.max(count, 1), 40)

  const cacheKey = `${provider}:${q}:${n}`
  if (!opts.noCache) {
    const cached = cacheGet(cacheKey)
    if (cached) return cached
  }

  const doFetch = opts.fetchImpl ?? fetch
  let body: unknown
  if (provider === 'pexels') {
    const base = (process.env.PEXELS_API_BASE ?? 'https://api.pexels.com').replace(/\/+$/, '')
    const url = `${base}/v1/search?query=${encodeURIComponent(q)}&per_page=${n}&orientation=landscape`
    const res = await doFetch(url, {
      headers: { Authorization: (process.env.PEXELS_API_KEY ?? '').trim() },
      signal: AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      // never surface the provider body — it may echo the request
      // (and pixabay's key lives in the URL). Status is enough.
      console.error(`[stock-photo] pexels search failed: ${res.status}`)
      throw new Error(`Pexels search failed (${res.status}).`)
    }
    body = await res.json()
  } else {
    const base = (process.env.PIXABAY_API_BASE ?? 'https://pixabay.com/api').replace(/\/+$/, '')
    const key = encodeURIComponent((process.env.PIXABAY_API_KEY ?? '').trim())
    const url = `${base}/?key=${key}&q=${encodeURIComponent(q)}&image_type=photo&per_page=${n}&safesearch=true`
    const res = await doFetch(url, {
      signal: AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.error(`[stock-photo] pixabay search failed: ${res.status}`)
      throw new Error(`Pixabay search failed (${res.status}).`)
    }
    body = await res.json()
  }

  const results = provider === 'pexels' ? parsePexels(body) : parsePixabay(body)
  cacheSet(cacheKey, results)
  return results
}
