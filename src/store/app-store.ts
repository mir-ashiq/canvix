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
  goLanding: () => {
    set({ view: 'landing' })
    replaceUrl('/')
  },
  goDashboard: () => {
    set({ view: 'dashboard' })
    replaceUrl('/')
  },
  openEditor: (design) => {
    set({ view: 'editor', pendingDesign: design })
    if (design?.id) replaceUrl(designPath(design.id))
  },
}))
