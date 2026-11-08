'use client'

// ─────────────────────────────────────────────────────────────
// use-stock-photo — client availability probe for the Photos
// panel's stock-search section (v0.16.4 A4, the F2b pattern —
// the use-stock-video twin).
//
// ONE request per editor mount, cached at module level. Fail-
// closed: any fetch/parse failure reads as "not available" —
// on a keyed instance a transient network error hides the
// web-results section until reload, never shows a broken panel.
// The bundled library never depends on this probe.
// ─────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'

export interface StockPhotoAvailability {
  available: boolean
  providers: string[]
}

const FALLBACK: StockPhotoAvailability = { available: false, providers: [] }

let inflight: Promise<StockPhotoAvailability> | null = null
let resolved: StockPhotoAvailability | null = null

function probe(): Promise<StockPhotoAvailability> {
  if (resolved) return Promise.resolve(resolved)
  inflight ??= fetch('/api/stock-photo/available')
    .then(async (res) => {
      if (!res.ok) return FALLBACK
      const body = (await res.json().catch(() => null)) as StockPhotoAvailability | null
      if (!body || typeof body.available !== 'boolean' || !Array.isArray(body.providers)) return FALLBACK
      resolved = body
      return body
    })
    .catch(() => FALLBACK)
  return inflight
}

/**
 * The stock-photo search state. `loaded` distinguishes "probe still
 * in flight" from "probe answered no" — the web-results section only
 * renders its unkeyed hint on a POSITIVE no (no flash on cold mounts).
 */
export function useStockPhoto(): StockPhotoAvailability & { loaded: boolean } {
  const [state, setState] = useState<StockPhotoAvailability>(resolved ?? FALLBACK)

  useEffect(() => {
    let alive = true
    void probe().then((v) => {
      if (alive) setState(v)
    })
    return () => {
      alive = false
    }
  }, [])

  return { ...state, loaded: state.available || resolved !== null }
}
