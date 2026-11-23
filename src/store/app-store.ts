'use client'

import { create } from 'zustand'
import type { DesignRecord } from '@/lib/types'
import { designPath, replaceUrl } from '@/lib/design-url'

export type AppView = 'landing' | 'dashboard' | 'editor'

interface AppStore {
  view: AppView
  /** design to open in the editor (already fetched) */
  pendingDesign: DesignRecord | null
  goLanding: () => void
  goDashboard: () => void
  openEditor: (design: DesignRecord) => void
}

export const useAppStore = create<AppStore>((set) => ({
  view: 'landing',
  pendingDesign: null,
  // v0.11.4: the address bar follows the view — the editor lives at
  // /design/<id>, everything else resets to /. replaceState (not push)
  // because popstate is not routed in this SPA shell.
  // v0.27.2: every view switch also resets the window scroll — the
  // swap is client-side (no navigation), so without this the browser
  // keeps the offset: a landing page scrolled to the FAQ opened the
  // dashboard (or editor) mid-page. Instant, not smooth: the reset
  // must land before React commits the shorter view, or the browser
  // clamps a stale offset to the new page's max scroll.
  goLanding: () => {
    set({ view: 'landing' })
    replaceUrl('/')
    window.scrollTo(0, 0)
  },
  goDashboard: () => {
    set({ view: 'dashboard' })
    replaceUrl('/')
    window.scrollTo(0, 0)
  },
  openEditor: (design) => {
    set({ view: 'editor', pendingDesign: design })
    if (design?.id) replaceUrl(designPath(design.id))
    window.scrollTo(0, 0)
  },
}))
