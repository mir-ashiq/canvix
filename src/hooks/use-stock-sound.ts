'use client'

// ─────────────────────────────────────────────────────────────
// use-stock-sound — client availability probe for the Audio
// panel's stock-search section (the Sound wave — the
// use-stock-photo twin, F2b fail-closed).
// ─────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'

export interface StockSoundAvailability {
  available: boolean
  providers: string[]
}

const FALLBACK: StockSoundAvailability = { available: false, providers: [] }

let inflight: Promise<StockSoundAvailability> | null = null
let resolved: StockSoundAvailability | null = null

function probe(): Promise<StockSoundAvailability> {
  if (resolved) return Promise.resolve(resolved)
  inflight ??= fetch('/api/stock-sound/available')
    .then(async (res) => {
      if (!res.ok) return FALLBACK
      const body = (await res.json().catch(() => null)) as StockSoundAvailability | null
      if (!body || typeof body.available !== 'boolean' || !Array.isArray(body.providers)) return FALLBACK
      resolved = body
      return body
    })
    .catch(() => FALLBACK)
  return inflight
}

/**
 * The stock-sound search state. `loaded` distinguishes "probe still
 * in flight" from "probe answered no" — the web-results section only
 * renders its unkeyed hint on a POSITIVE no (no flash on cold mounts).
 */
export function useStockSound(): StockSoundAvailability & { loaded: boolean } {
  const [state, setState] = useState<StockSoundAvailability>(resolved ?? FALLBACK)

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
