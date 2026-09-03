'use client'

import { create } from 'zustand'
import type { DesignRecord } from '@/lib/types'

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
  goLanding: () => set({ view: 'landing' }),
  goDashboard: () => set({ view: 'dashboard' }),
  openEditor: (design) => set({ view: 'editor', pendingDesign: design }),
}))
