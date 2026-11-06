'use client'

// ─────────────────────────────────────────────────────────────
// use-stock-video — client availability probe for the v0.15 R6
// stock-video rail (the F2b pattern).
//
// ONE request per editor mount, cached at module level so the
// LeftRail, the VideosPanel and any future surface agree without
// a stampede. Fail-closed: any fetch/parse failure reads as
// "not available" — on a keyed instance a transient network error
// hides the rail item until reload, never shows a broken panel.
// ─────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'

export interface StockVideoAvailability {
  available: boolean
  providers: string[]
}

const FALLBACK: StockVideoAvailability = { available: false, providers: [] }

let inflight: Promise<StockVideoAvailability> | null = null
let resolved: StockVideoAvailability | null = null

function probe(): Promise<StockVideoAvailability> {
  if (resolved) return Promise.resolve(resolved)
  inflight ??= fetch('/api/stock-video/available')
    .then(async (res) => {
      if (!res.ok) return FALLBACK
      const body = (await res.json().catch(() => null)) as StockVideoAvailability | null
      if (!body || typeof body.available !== 'boolean' || !Array.isArray(body.providers)) return FALLBACK
      resolved = body
      return body
    })
    .catch(() => FALLBACK)
  return inflight
}

/**
 * The stock-video rail state. `loaded` distinguishes "probe still
 * in flight" from "probe answered no" — the rail only ever SHOWS
 * the item on a positive answer (no flash on unkeyed instances).
 */
export function useStockVideo(): StockVideoAvailability & { loaded: boolean } {
  const [state, setState] = useState<StockVideoAvailability>(resolved ?? FALLBACK)

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
