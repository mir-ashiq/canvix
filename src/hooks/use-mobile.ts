import * as React from "react"

const MOBILE_BREAKPOINT = 768

/**
 * Reactive viewport check via useSyncExternalStore (no setState-in-effect,
 * no cascading renders). Server snapshot is "desktop" so SSR and the first
 * client render agree; it flips after hydration if the viewport is narrow.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    },
    () => window.innerWidth < MOBILE_BREAKPOINT,
    () => false,
  )
}
