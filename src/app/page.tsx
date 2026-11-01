'use client'

import { AppShell } from '@/components/AppShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'

export default function Page() {
  // v0.12.2 (H4): the top-level boundary — catches anything the
  // per-surface boundaries inside AppShell do not (the landing view,
  // DeepLinkHandler, the shell itself).
  return (
    <ErrorBoundary label="app">
      <AppShell />
    </ErrorBoundary>
  )
}
