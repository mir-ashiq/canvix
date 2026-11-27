'use client'

import { useEffect } from 'react'

/** Registers the lightweight app shell worker on secure origins. */
export function PWARegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // PWA support is progressive enhancement; the web app remains usable
      // when a browser, private session, or host disables service workers.
    })
  }, [])

  return null
}
