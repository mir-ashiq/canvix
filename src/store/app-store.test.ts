// @vitest-environment jsdom
// Unit tests for the app store's view transitions — v0.27.2: every
// view switch resets the window scroll. The swap is client-side
// (replaceState, no navigation), so without an explicit reset the
// browser keeps the old offset: a landing page scrolled to the FAQ
// opened the dashboard mid-page.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAppStore } from './app-store'
import type { DesignRecord } from '@/lib/types'

describe('app store view transitions', () => {
  const scrollTo = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo
    // reset the store between tests
    useAppStore.setState({ view: 'landing', pendingDesign: null })
    // history.replaceState on the same path is a no-op here
    vi.spyOn(history, 'replaceState').mockImplementation(() => {})
  })

  it('goDashboard resets the window scroll', () => {
    useAppStore.getState().goDashboard()
    expect(useAppStore.getState().view).toBe('dashboard')
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('goLanding resets the window scroll', () => {
    useAppStore.setState({ view: 'dashboard' })
    useAppStore.getState().goLanding()
    expect(useAppStore.getState().view).toBe('landing')
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('openEditor resets the window scroll and stages the design', () => {
    const design = { id: 'd1', name: 'Poster' } as unknown as DesignRecord
    useAppStore.getState().openEditor(design)
    const s = useAppStore.getState()
    expect(s.view).toBe('editor')
    expect(s.pendingDesign).toBe(design)
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })
})
