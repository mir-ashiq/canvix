// ─────────────────────────────────────────────────────────────
// Font acquisition ladder for vector-text PDF export (v0.15 R4).
//
// For every (family, bold, italic) a page's text needs we try,
// in order:
//   1. session cache of already-acquired TTF bytes
//   2. /api/fonts/ttf → fonts.gstatic.com TTF (the same Google
//      Fonts the app already renders with, fetched through a
//      legacy-UA css2 lookup so we get raw TrueType instead of
//      woff2 — the only embeddable format for PDF FontFile2)
//   3. the documented per-family standard-14 fallback (PDF's
//      built-in Helvetica/Times/Courier — NOT embedded, still
//      real selectable text) when offline or the lookup fails
//
// Fail-closed throughout: any error at any step degrades to the
// std14 path, never a failed export. All IO is INJECTED so the
// ladder is unit-testable in node (the R1 MeasureText pattern).
// ─────────────────────────────────────────────────────────────

import { FONTS } from '@/lib/editor-utils'

export type Std14Base = 'Helvetica' | 'Times' | 'Courier'

/** Category → PDF standard-14 base font. The app renders these
 * families with Google web fonts; when embedding is impossible
 * (offline, Google unreachable, css2 rejects the combination)
 * the export still emits real text in the nearest base face.
 * Handwriting/display have no standard-14 equivalent — they
 * degrade to Helvetica (documented in docs/PDF-VECTOR-EXPORT.md). */
const CATEGORY_TO_STD14: Record<string, Std14Base> = {
  sans: 'Helvetica',
  display: 'Helvetica',
  handwriting: 'Helvetica',
  serif: 'Times',
  mono: 'Courier',
}

const familyCategory = new Map<string, string>(FONTS.map((f) => [f.family, f.category]))
const familyWeights = new Map<string, number[]>(
  FONTS.map((f) => [f.family, f.weights.split(',').map((w) => Number(w)).filter((w) => Number.isFinite(w))]),
)

/** Nearest available Google weight for a family (elements carry
 * only a bold flag → 400/700; Montserrat has no 400, Oswald has
 * no 400 — snap instead of letting css2 404 the whole family). */
export function snapWeight(family: string, desired: number): number {
  const avail = familyWeights.get(family)
  if (!avail || avail.length === 0) return desired
  let best = avail[0]
  for (const w of avail) {
    const d = Math.abs(w - desired)
    const bd = Math.abs(best - desired)
    if (d < bd || (d === bd && w < best)) best = w
  }
  return best
}

/** Standard-14 base for any family (unknown families → the sans
 * stack, the editor's own default). */
export function std14For(family: string): Std14Base {
  return CATEGORY_TO_STD14[familyCategory.get(family) ?? 'sans'] ?? 'Helvetica'
}

export function isKnownFamily(family: string): boolean {
  return familyCategory.has(family)
}

// ── css2 response parsing (shared with the API route) ───────

/** Extract the first `url(…) format('truetype')` source from a
 * Google Fonts css2 response. Returns null when the response has
 * no TTF face (should not happen for the legacy UA we send, but
 * Google's formats are an implementation detail — fail closed). */
export function parseTtfUrlFromCss2(css: string): string | null {
  const re = /url\((https:\/\/fonts\.gstatic\.com\/[^)'"\s]+)\)\s*format\('truetype'\)/
  const m = re.exec(css)
  return m ? m[1] : null
}

// ── the ladder ──────────────────────────────────────────────

export interface FontFaceRequest {
  family: string
  bold: boolean
  italic: boolean
}

export type ResolvedPdfFont =
  | { kind: 'ttf'; family: string; bold: boolean; italic: boolean; bytes: Uint8Array }
  | { kind: 'std14'; family: string; bold: boolean; italic: boolean; base: Std14Base }

export interface FontLadderIo {
  /** resolve a family+weight+style to a gstatic TTF url */
  lookupUrl?: (family: string, weight: number, italic: boolean) => Promise<string | null>
  /** download bytes for a url */
  fetchBytes?: (url: string) => Promise<Uint8Array | null>
}

export const faceKey = (r: { family: string; bold: boolean; italic: boolean }): string =>
  `${r.family}|${r.bold ? 'b' : ''}${r.italic ? 'i' : ''}`

const sessionCache = new Map<string, Promise<ResolvedPdfFont | null>>()

const defaultLookupUrl = async (family: string, weight: number, italic: boolean): Promise<string | null> => {
  try {
    const res = await fetch(
      `/api/fonts/ttf?family=${encodeURIComponent(family)}&weight=${weight}&italic=${italic ? 1 : 0}`,
      { signal: AbortSignal.timeout(6000) },
    )
    if (!res.ok) return null
    const data = (await res.json()) as { url?: string }
    return typeof data.url === 'string' && data.url.startsWith('https://fonts.gstatic.com/') ? data.url : null
  } catch {
    return null
  }
}

const defaultFetchBytes = async (url: string): Promise<Uint8Array | null> => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    return new Uint8Array(buf)
  } catch {
    return null
  }
}

const isPlausibleTtf = (bytes: Uint8Array): boolean =>
  bytes.length > 512 && bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00

/** Resolve one face through the ladder. Null never escapes as a
 * throw — failures return the std14 fallback. */
export async function resolveFontFace(
  req: FontFaceRequest,
  io: FontLadderIo = {},
): Promise<ResolvedPdfFont> {
  const lookupUrl = io.lookupUrl ?? defaultLookupUrl
  const fetchBytes = io.fetchBytes ?? defaultFetchBytes
  const key = faceKey(req)
  const std14 = (): ResolvedPdfFont => ({ kind: 'std14', ...req, base: std14For(req.family) })

  const cached = sessionCache.get(key)
  if (cached) {
    const hit = await cached
    if (hit) return hit
    sessionCache.delete(key) // a failed promise should not poison later retries within reason
  }

  const attempt = (async (): Promise<ResolvedPdfFont | null> => {
    try {
      if (!isKnownFamily(req.family)) return null
      const weight = snapWeight(req.family, req.bold ? 700 : 400)
      const url = await lookupUrl(req.family, weight, req.italic)
      if (!url) return null
      const bytes = await fetchBytes(url)
      if (!bytes || !isPlausibleTtf(bytes)) return null
      return { kind: 'ttf', ...req, bytes }
    } catch {
      return null // the ladder never throws — degrade, don't fail the export
    }
  })()

  sessionCache.set(key, attempt)
  const resolved = await attempt
  if (!resolved) {
    sessionCache.delete(key)
    return std14()
  }
  return resolved
}

/** Resolve every face a set of pages' text needs (deduped). */
export async function resolveFontFaces(
  requests: FontFaceRequest[],
  io: FontLadderIo = {},
): Promise<Map<string, ResolvedPdfFont>> {
  const unique = new Map<string, FontFaceRequest>()
  for (const r of requests) unique.set(faceKey(r), r)
  const out = new Map<string, ResolvedPdfFont>()
  for (const r of unique.values()) {
    out.set(faceKey(r), await resolveFontFace(r, io))
  }
  return out
}

/** Test hook — clear the session cache. */
export function clearFontSessionCache(): void {
  sessionCache.clear()
}
