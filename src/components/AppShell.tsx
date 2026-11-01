'use client'

import dynamic from 'next/dynamic'
import { useEffect } from 'react'
import { useAppStore } from '@/store/app-store'
import { Landing } from '@/components/landing/Landing'
import { Dashboard } from '@/components/dashboard/Dashboard'
import { readDesignIdFromLocation, isDesignPath, replaceUrl } from '@/lib/design-url'

const Editor = dynamic(() => import('@/components/editor/Editor'), {
  ssr: false,
  loading: () => (
    <div className="h-screen w-full flex items-center justify bg-[#E9EAF0]">
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 rounded-full border-4 border-[#00C4CC] border-t-transparent animate-spin" />
        <p className="text-sm text-muted-foreground font-medium">Loading editor…</p>
      </div>
    </div>
  ),
})

/**
 * v0.5: collaboration deep links — /design/<id> (canonical, v0.11.4) or the
 * legacy /?design=<id> / /?d=<id> query forms open the editor directly.
 */
function DeepLinkHandler() {
  useEffect(() => {
    try {
      const designId = readDesignIdFromLocation()
      if (!designId) return
      const openEditor = useAppStore.getState().openEditor
      void fetch(`/api/designs/${encodeURIComponent(designId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((design) => {
          if (design && Array.isArray(design.pages)) {
            openEditor(design)
          } else if (isDesignPath()) {
            // /design/<unknown-id> — an honest reset to the landing page
            // instead of a dead URL that renders nothing.
            replaceUrl('/')
            useAppStore.getState().goLanding()
          }
        })
        .catch(() => {
          /* bad link — stay on landing */
        })
    } catch {
      /* SSR guard */
    }
  }, [])
  return null
}

/**
 * The single-page Canvix shell — shared by / (landing + dashboard) and
 * /design/<id> (deep link). The view switch is client-side; the URL is
 * kept in sync by the app store (see src/store/app-store.ts).
 */
export function AppShell() {
  const view = useAppStore((s) => s.view)

  if (view === 'editor') {
    return <Editor />
  }
  if (view === 'dashboard') {
    return <Dashboard />
  }
  return (
    <>
      <DeepLinkHandler />
      <Landing />
    </>
  )
}
