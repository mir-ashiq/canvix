'use client'

import { useEffect, useState } from 'react'

// ── v0.7 rendering performance: shared image cache ────────────
// Module-level cache so images decode once per URL, no matter how many
// nodes mount/unmount them (page switching, thumbnails, duplicated images).
// In-flight loads are deduplicated; failures are remembered (negative cache)
// so a broken URL can't re-trigger a request loop on every render.

interface CacheEntry {
  image: HTMLImageElement | null
  ready: boolean
  listeners: Set<(image: HTMLImageElement | null) => void>
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
    for (const fn of e.listeners) fn(image)
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

/** Loads an HTMLImageElement for use inside Konva. Supports dataURLs and
 *  CORS-friendly URLs. Results are cached per URL across the whole app. */
export function useLoadedImage(src?: string): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(() => {
    if (!src) return null
    const entry = cache.get(src)
    return entry?.ready ? entry.image : null
  })

  useEffect(() => {
    if (!src) {
      setImage(null)
      return
    }
    const entry = load(src)
    if (entry.ready) {
      setImage(entry.image)
      return
    }
    // still loading — subscribe
    let alive = true
    const listener = (img: HTMLImageElement | null) => {
      if (alive) setImage(img)
    }
    entry.listeners.add(listener)
    return () => {
      alive = false
      entry.listeners.delete(listener)
    }
  }, [src])

  return image
}
