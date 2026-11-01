'use client'

import { AppShell } from '@/components/AppShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'

/**
 * v0.11.4: canonical design URLs — /design/<id>.
 *
 * The shell is the same single-page app as /; the DeepLinkHandler inside
 * AppShell resolves the id from the path, fetches the design and opens the
 * editor. Unknown ids fall back to the landing page with the URL reset.
 * v0.12.2 (H4): wrapped in the top-level error boundary like /.
 */
export default function DesignPage() {
  return (
    <ErrorBoundary label="app">
      <AppShell />
    </ErrorBoundary>
  )
}
