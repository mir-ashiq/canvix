// ─────────────────────────────────────────────────────────────
// stock-video — provider-gated stock VIDEO search (v0.15 R6).
//
// The photos-search pattern, one class over: photos ride the AI
// provider; stock video rides SELF-HOSTER KEYS for two plain-REST
// providers (Pexels + Pixabay). No provider key configured ⇒ the
// rail item stays hidden and /api/stock-video/* answers 503
// NO_PROVIDER — everything else in the editor keeps working (the
// F2b fail-closed pattern; research §5.4 R6).
//
// Dependency decision (the house rule): ZERO new runtime
// dependencies — both providers are JSON-over-GET with one auth
// value; the whole connector is plain fetch. Recorded in
// docs/STOCK-VIDEO.md alongside the attribution model.
//
// Attribution (the R6 acceptance: "license/attribution metadata
// surfaced"): every result carries a sanitized credit block
// {provider, author, license, url} that is stored DURABLY on the
// inserted VideoElement (`credit`), shown in the toast at insert
// and in the properties bar whenever the element is selected. It
// is never rendered on the canvas or burned into exports — a
// forced overlay would corrupt the design, and neither license
// demands on-content credit. Pixabay's "show users where videos
// come from" request is satisfied by the provider chip on every
// tile + the durable credit.
//
// Honest limits, stated here so nobody has to rediscover them:
//   - provider responses are cached IN MEMORY per instance for
//     24 h (Pixabay's request; Pexels gets it for free). A
//     multi-instance fleet caches per instance, not per deployment.
//   - downloads happen in the BROWSER (both provider CDNs answer
//     Access-Control-Allow-Origin: * on GET — verified empirically,
//     not assumed), then ride the existing chunked media store:
//     quota, sha256 dedupe and the 32 MB cap all apply as-is.
//   - CI has no provider keys, so the live-provider happy path is
//     covered by unit tests against recorded response fixtures
//     plus a flag-on e2e against a local mock provider; the
//     no-provider states are e2e-asserted on the default suite.
// ─────────────────────────────────────────────────────────────

export type StockVideoProvider = 'pexels' | 'pixabay'

/** Sanitized attribution block — also the shape stored on VideoElement.credit. */
export interface StockVideoCredit {
  provider: string
  author: string
  license: string
  url: string
}

/** One normalized search result — provider shape erased. */
export interface StockVideoResult {
  /** provider-prefixed unique id, e.g. 'pexels-2499611' */
  id: string
  provider: StockVideoProvider
  width: number
  height: number
  /** seconds (0 when the provider omitted it — the probe fixes it at insert) */
  duration: number
  /** preferred rendition: the largest mp4 at most 1920 px wide */
  mp4: string
  /** strictly smaller renditions, widest first — the fallback ladder
   *  for when the media store's size cap rejects the primary */
  alternates: string[]
  /** smallest mp4 — the panel's hover-preview stream */
  previewVideo: string
  /** poster/thumbnail image for the tile */
  preview: string
  credit: StockVideoCredit
}

// ── availability (secret-free — never expose the keys) ────────

export function stockVideoProviders(): StockVideoProvider[] {
  const out: StockVideoProvider[] = []
  if ((process.env.PEXELS_API_KEY ?? '').trim()) out.push('pexels')
  if ((process.env.PIXABAY_API_KEY ?? '').trim()) out.push('pixabay')
  return out
}

export function stockVideoAvailable(): boolean {
  return stockVideoProviders().length > 0
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
}): StockVideoCredit | null {
  const url = isHttpUrl(raw.url) ? raw.url : ''
  const provider = cleanText(raw.provider, 24)
  const author = cleanText(raw.author, 80)
  const license = cleanText(raw.license, 80)
  if (!provider || !author || !license) return null
  return { provider, author, license, url }
}

/** The rendition ladder: pick a primary ≤ MAX_PRIMARY_PX wide, list the
 *  smaller ones as fallbacks (widest first), smallest doubles as the
 *  hover-preview stream. Null when no usable http(s) mp4 exists. */
const MAX_PRIMARY_PX = 1920

export function chooseRenditions(files: { url: string; width: number }[]): {
  primary: string
  alternates: string[]
  previewVideo: string
} | null {
  const seen = new Set<string>()
  const usable = files
    .filter((f) => isHttpUrl(f.url) && !seen.has(f.url) && seen.add(f.url))
    .sort((a, b) => b.width - a.width)
  if (usable.length === 0) return null
  const primary = usable.find((f) => f.width <= MAX_PRIMARY_PX) ?? usable[usable.length - 1]
  const below = usable.filter((f) => f.width < primary.width)
  return {
    primary: primary.url,
    alternates: below.map((f) => f.url),
    previewVideo: usable[usable.length - 1].url,
  }
}

// ── Pexels — GET /videos/search, Authorization header ─────────
// Response (documented Video resource, parsed defensively — the
// API may add keys, so every field is unknown until validated):
//   { videos: [{ id, width, height, duration, url, image,
//       user: { name, url },
//       video_files: [{ link|url, file_type, width, height, quality }],
//       video_pictures: [{ picture }] }] }

function parsePexels(body: unknown): StockVideoResult[] {
  const videos = (body as { videos?: unknown })?.videos
  if (!Array.isArray(videos)) return []
  const out: StockVideoResult[] = []
  for (const v of videos) {
    if (!v || typeof v !== 'object') continue
    const video = v as Record<string, unknown>
    const files: { url: string; width: number }[] = []
    if (Array.isArray(video.video_files)) {
      for (const f of video.video_files) {
        if (!f || typeof f !== 'object') continue
        const file = f as Record<string, unknown>
        // mp4 only (hls/m3u8 renditions exist); tolerate a missing
        // file_type — the URL extension is the next-best signal
        const type = typeof file.file_type === 'string' ? file.file_type : ''
        const link = typeof file.link === 'string' ? file.link : typeof file.url === 'string' ? file.url : ''
        if (type && type !== 'video/mp4') continue
        if (!/\.mp4(\?|$)/i.test(link)) continue
        files.push({ url: link, width: num(file.width) })
      }
    }
    const ladder = chooseRenditions(files)
    if (!ladder) continue
    const credit = sanitizeCredit({
      provider: 'Pexels',
      author: typeof (video.user as { name?: unknown } | null)?.name === 'string' ? (video.user as { name: string }).name : 'Pexels creator',
      license: 'Pexels License',
      url: video.url,
    })
    if (!credit) continue
    const pictures = Array.isArray(video.video_pictures) ? video.video_pictures : []
    const firstPicture = pictures[0] as { picture?: unknown } | undefined
    const preview =
      (firstPicture && isHttpUrl(firstPicture.picture) ? firstPicture.picture : '') ||
      (isHttpUrl(video.image) ? video.image : '')
    out.push({
      id: `pexels-${cleanText(video.id, 32) || out.length}`,
      provider: 'pexels',
      width: num(video.width),
      height: num(video.height),
      duration: num(video.duration),
      mp4: ladder.primary,
      alternates: ladder.alternates,
      previewVideo: ladder.previewVideo,
      preview,
      credit,
    })
  }
  return out
}

// ── Pixabay — GET /api/videos/, key as query param ────────────
// Response (documented, parsed defensively):
//   { hits: [{ id, pageURL, duration, user,
//       videos: { large|medium|small|tiny: { url, width, height, size,
//       thumbnail } } }] }

function parsePixabay(body: unknown): StockVideoResult[] {
  const hits = (body as { hits?: unknown })?.hits
  if (!Array.isArray(hits)) return []
  const out: StockVideoResult[] = []
  for (const h of hits) {
    if (!h || typeof h !== 'object') continue
    const hit = h as Record<string, unknown>
    const renditions = hit.videos
    if (!renditions || typeof renditions !== 'object') continue
    const files: { url: string; width: number }[] = []
    for (const key of ['large', 'medium', 'small', 'tiny'] as const) {
      const r = (renditions as Record<string, unknown>)[key]
      if (!r || typeof r !== 'object') continue
      const rendition = r as Record<string, unknown>
      // "large" is often 4K and may carry an EMPTY url + size 0 (documented)
      if (typeof rendition.url !== 'string' || rendition.url === '') continue
      files.push({ url: rendition.url, width: num(rendition.width) })
    }
    const ladder = chooseRenditions(files)
    if (!ladder) continue
    const credit = sanitizeCredit({
      provider: 'Pixabay',
      author: typeof hit.user === 'string' && hit.user ? hit.user : 'Pixabay creator',
      license: 'Pixabay Content License',
      url: hit.pageURL,
    })
    if (!credit) continue
    // poster: the medium rendition's thumbnail, else any rendition's
    let preview = ''
    for (const key of ['medium', 'small', 'tiny', 'large'] as const) {
      const r = (renditions as Record<string, unknown>)[key]
      const thumb = r && typeof r === 'object' ? (r as Record<string, unknown>).thumbnail : undefined
      if (isHttpUrl(thumb)) {
        preview = thumb
        break
      }
    }
    // dims from the CHOSEN rendition (they differ per tier); fall back
    // to the medium rendition, else 0 — the insert probe fixes it anyway
    const dims = files.find((f) => f.url === ladder.primary)
    const medium = (renditions as Record<string, { width?: unknown; height?: unknown } | undefined>).medium
    out.push({
      id: `pixabay-${cleanText(hit.id, 32) || out.length}`,
      provider: 'pixabay',
      width: dims?.width || num(medium?.width),
      height: num(medium?.height),
      duration: num(hit.duration),
      mp4: ladder.primary,
      alternates: ladder.alternates,
      previewVideo: ladder.previewVideo,
      preview,
      credit,
    })
  }
  return out
}

// ── the 24 h in-memory response cache (per instance) ──────────

interface CacheEntry {
  at: number
  results: StockVideoResult[]
}
const CACHE_TTL_MS = 24 * 3600_000
const CACHE_MAX = 512
const searchCache = new Map<string, CacheEntry>()

function cacheGet(key: string): StockVideoResult[] | null {
  const entry = searchCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    searchCache.delete(key)
    return null
  }
  return entry.results
}

function cacheSet(key: string, results: StockVideoResult[]): void {
  searchCache.set(key, { at: Date.now(), results })
  if (searchCache.size > CACHE_MAX) {
    const oldest = [...searchCache.entries()].sort((a, b) => a[1].at - b[1].at)
    for (const [k] of oldest.slice(0, Math.floor(oldest.length / 2))) searchCache.delete(k)
  }
}

/** Test-only: wipe the response cache. */
export function resetStockVideoCache(): void {
  searchCache.clear()
}

// ── search ─────────────────────────────────────────────────────

const PROVIDER_FETCH_TIMEOUT_MS = 10_000

export interface SearchStockVideosOptions {
  /** which connector to query (must be configured — the route validates) */
  provider?: StockVideoProvider
  /** injected for tests — defaults to the global fetch */
  fetchImpl?: typeof fetch
  /** test-only: bypass the response cache */
  noCache?: boolean
}

export async function searchStockVideos(
  query: string,
  count: number,
  opts: SearchStockVideosOptions = {},
): Promise<StockVideoResult[]> {
  const providers = stockVideoProviders()
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
    const url = `${base}/videos/search?query=${encodeURIComponent(q)}&per_page=${n}&orientation=landscape`
    const res = await doFetch(url, {
      headers: { Authorization: (process.env.PEXELS_API_KEY ?? '').trim() },
      signal: AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      // never surface the provider body — it may echo the request
      // (and pixabay's key lives in the URL). Status is enough.
      console.error(`[stock-video] pexels search failed: ${res.status}`)
      throw new Error(`Pexels search failed (${res.status}).`)
    }
    body = await res.json()
  } else {
    const base = (process.env.PIXABAY_API_BASE ?? 'https://pixabay.com/api').replace(/\/+$/, '')
    const key = encodeURIComponent((process.env.PIXABAY_API_KEY ?? '').trim())
    const url = `${base}/videos/?key=${key}&q=${encodeURIComponent(q)}&per_page=${n}&safesearch=true`
    const res = await doFetch(url, {
      signal: AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.error(`[stock-video] pixabay search failed: ${res.status}`)
      throw new Error(`Pixabay search failed (${res.status}).`)
    }
    body = await res.json()
  }

  const results = provider === 'pexels' ? parsePexels(body) : parsePixabay(body)
  cacheSet(cacheKey, results)
  return results
}
