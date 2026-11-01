'use client'

import { AppShell } from '@/components/AppShell'

/**
 * v0.11.4: canonical design URLs — /design/<id>.
 *
 * The shell is the same single-page app as /; the DeepLinkHandler inside
 * AppShell resolves the id from the path, fetches the design and opens the
 * editor. Unknown ids fall back to the landing page with the URL reset.
 */
export default function DesignPage() {
  return <AppShell />
}
