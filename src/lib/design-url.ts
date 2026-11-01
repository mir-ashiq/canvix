'use client'

/**
 * v0.11.4: clean, shareable design URLs.
 *
 *   /design/<id>        → canonical design URL (new)
 *   /?design=<id>       → legacy query-param deep link (still works)
 *   /?d=<id>            → legacy short form (still works)
 *
 * The app is a single-page shell (the editor mounts client-side), so these
 * helpers resolve a design id from ANY of the shapes above and keep the
 * address bar in sync via history.replaceState — refresh keeps the design,
 * share links look like real URLs, and old links keep working.
 */

export const DESIGN_ID_RE = /^[a-zA-Z0-9_-]{5,40}$/

/** Canonical path for a design id. */
export function designPath(id: string): string {
  return `/design/${id}`
}

/** Absolute share URL for a design id (origin + canonical path). */
export function designShareUrl(id: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}${designPath(id)}`
}

/** Replace the address bar without touching history (SPA — popstate is not routed). */
export function replaceUrl(path: string): void {
  if (typeof window === 'undefined') return
  try {
    if (window.location.pathname !== path || window.location.search) {
      window.history.replaceState(null, '', path)
    }
  } catch {
    /* SSR / security-context guard */
  }
}

/**
 * Read the design id the URL points at, whichever shape it takes.
 * Path form wins over query form; returns null when no design is referenced.
 */
export function readDesignIdFromLocation(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const m = window.location.pathname.match(/^\/design\/([a-zA-Z0-9_-]{5,40})\/?$/)
    if (m) return m[1]
    const params = new URLSearchParams(window.location.search)
    const q = params.get('design') ?? params.get('d')
    if (q && DESIGN_ID_RE.test(q)) return q
  } catch {
    /* SSR guard */
  }
  return null
}

/** True when the URL is a /design/<id> path (vs. a legacy query link). */
export function isDesignPath(): boolean {
  if (typeof window === 'undefined') return false
  return /^\/design\/[a-zA-Z0-9_-]{5,40}\/?$/.test(window.location.pathname)
}
