'use client'

import { useCallback, useSyncExternalStore } from 'react'

// ── v0.7 rendering performance: shared image cache ────────────
// Module-level cache so images decode once per URL, no matter how many
// nodes mount/unmount them (page switching, thumbnails, duplicated images).
// In-flight loads are deduplicated; failures are remembered (negative cache)
// so a broken URL can't re-trigger a request loop on every render.
//
// v0.8: exposed through useSyncExternalStore — the cache IS an external
// store, so React gets cache-change notifications without effect-time
// setState (cleaner renders, lint-clean, hydration-safe).

interface CacheEntry {
  image: HTMLImageElement | null
  ready: boolean
  listeners: Set<() => void>
}

const cache = new Map<string, CacheEntry>()

function load(src: string): CacheEntry {
  let entry = cache.get(src)
  if (entry) return entry
  entry = { image: null, ready: false, listeners: new Set() }
  cache.set(src, entry)

  const img = new window.Image()
  img.crossOrigin = 'anonymous'
  const settle = (image: HTMLImageElement | null) => {
    const e = cache.get(src)
    if (!e) return
    e.image = image
    e.ready = true
    for (const fn of e.listeners) fn()
    e.listeners.clear()
    // keep at most ~300 decoded images; drop the oldest entries
    if (cache.size > 300) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined && oldest !== src) cache.delete(oldest)
    }
  }
  img.onload = () => settle(img)
  img.onerror = () => settle(null)
  img.src = src
  return entry
}

const noop = () => {}

/** Loads an HTMLImageElement for use inside Konva. Supports dataURLs and
 *  CORS-friendly URLs. Results are cached per URL across the whole app. */
export function useLoadedImage(src?: string): HTMLImageElement | null {
  // subscribe is stable per src — resubscription only happens when src changes
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!src) return noop
      const entry = load(src) // starts the fetch on first mount (effect context)
      if (entry.ready) return noop // already settled — snapshot read is enough
      entry.listeners.add(onChange)
      return () => {
        entry.listeners.delete(onChange)
      }
    },
    [src]
  )

  const image = useSyncExternalStore(
    subscribe,
    () => (src ? (cache.get(src)?.image ?? null) : null),
    () => null
  )

  return image
}
