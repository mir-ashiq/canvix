'use client'

import { useEffect, useState } from 'react'

/** Loads an HTMLImageElement for use inside Konva. Supports dataURLs and CORS-friendly URLs. */
export function useLoadedImage(src?: string): HTMLImageElement | null {
  const [loaded, setLoaded] = useState<{ src: string; image: HTMLImageElement } | null>(null)

  useEffect(() => {
    if (!src) return
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => setLoaded({ src, image: img })
    img.onerror = () => setLoaded(null)
    img.src = src
  }, [src])

  return loaded && loaded.src === src ? loaded.image : null
}
