'use client'

import dynamic from 'next/dynamic'
import { useEffect } from 'react'
import { useAppStore } from '@/store/app-store'
import { Landing } from '@/components/landing/Landing'
import { Dashboard } from '@/components/dashboard/Dashboard'

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

/** v0.5: collaboration deep links — /?design=<id> or /?d=<id> opens the editor directly. */
function DeepLinkHandler() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const designId = params.get('design') ?? params.get('d')
      if (!designId || !/^[a-zA-Z0-9_-]{5,40}$/.test(designId)) return
      const openEditor = useAppStore.getState().openEditor
      void fetch(`/api/designs/${encodeURIComponent(designId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((design) => {
          if (design && Array.isArray(design.pages)) {
            openEditor(design)
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

export default function Page() {
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
