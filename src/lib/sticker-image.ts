// ─────────────────────────────────────────────────────────────
// Sticker SVG → HTMLImageElement cache (v0.22 sticker packs).
//
// The canvas (element-node) and the export pipeline
// (video-export's collectImages/buildKonvaNode) both draw vector
// stickers as Konva.Image bitmaps. Both need the same
// data-URL → HTMLImageElement, so it lives here once.
//
// The module-level Map is keyed by the exact SVG markup — the
// library is finite (~130 authored strings), so it never grows
// unbounded. In Node (SSR pass) there is no Image; loaders simply
// never resolve to an entry and callers degrade gracefully.
// ─────────────────────────────────────────────────────────────

/** Encode authored SVG markup as a data URL (works for <img>,
 *  Image() and every export path; no base64 round-trip needed). */
export function stickerDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const cache = new Map<string, HTMLImageElement>()
const pending = new Map<string, Promise<HTMLImageElement | null>>()

/** Load a sticker's bitmap, cached. Resolves null when the browser
 *  can't decode the SVG (or in non-browser environments). */
export function loadStickerImage(svg: string): Promise<HTMLImageElement | null> {
  const hit = cache.get(svg)
  if (hit) return Promise.resolve(hit)
  const inflight = pending.get(svg)
  if (inflight) return inflight
  const p = new Promise<HTMLImageElement | null>((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(null)
      return
    }
    const img = new Image()
    img.onload = () => {
      cache.set(svg, img)
      resolve(img)
    }
    img.onerror = () => resolve(null)
    img.src = stickerDataUrl(svg)
  })
  pending.set(svg, p)
  return p
}

/** Synchronous cache probe — the canvas path uses this on render
 *  and subscribes to the async load for the paint-after-decode. */
export function getCachedStickerImage(svg: string): HTMLImageElement | undefined {
  return cache.get(svg)
}
