'use client'

import { useEffect, useState } from 'react'

/**
 * Client-side AI capability probe (public, secret-free).
 * `configured=false` → panels show "requires server AI provider" states.
 */
export function useAICapabilities() {
  const [state, setState] = useState<{
    loaded: boolean
    configured: boolean
    vision: boolean
    designAgent: boolean
  }>({ loaded: false, configured: false, vision: false, designAgent: false })

  useEffect(() => {
    let cancelled = false
    fetch('/api/ai/capabilities')
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          data: {
            configured?: boolean
            capabilities?: { vision?: boolean; designAgent?: boolean }
          } | null,
        ) => {
          if (cancelled || !data) return
          setState({
            loaded: true,
            configured: Boolean(data.configured),
            vision: Boolean(data.capabilities?.vision),
            designAgent: Boolean(data.capabilities?.designAgent),
          })
        },
      )
      .catch(() => {
        if (!cancelled) setState({ loaded: true, configured: false, vision: false, designAgent: false })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
