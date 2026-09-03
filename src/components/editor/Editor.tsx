'use client'

import { useCallback, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import { X } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { useEditorStore, type PanelId } from '@/store/editor-store'
import { TopBar } from './TopBar'
import { LeftRail } from './LeftRail'
import { PropertiesBar } from './PropertiesBar'
import { PageBar } from './PageBar'
import { ZoomControls } from './ZoomControls'
import { TemplatesPanel } from './panels/TemplatesPanel'
import { ElementsPanel } from './panels/ElementsPanel'
import { TextPanel } from './panels/TextPanel'
import { UploadsPanel } from './panels/UploadsPanel'
import { BackgroundPanel } from './panels/BackgroundPanel'
import { LayersPanel } from './panels/LayersPanel'
import { captureThumbnail, canvasBridge } from './canvas/canvas-bridge'
import { useIsMobile } from '@/hooks/use-mobile'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'

const CanvasStage = dynamic(() => import('./canvas/CanvasStage'), { ssr: false })

const PANEL_TITLES: Record<Exclude<PanelId, null>, string> = {
  templates: 'Templates',
  elements: 'Elements',
  text: 'Text',
  uploads: 'Uploads',
  background: 'Background',
  layers: 'Layers',
}

export default function Editor() {
  const pendingDesign = useAppStore((s) => s.pendingDesign)
  const goDashboard = useAppStore((s) => s.goDashboard)
  const loadDesign = useEditorStore((s) => s.loadDesign)
  const designId = useEditorStore((s) => s.designId)
  const panel = useEditorStore((s) => s.panel)
  const setPanel = useEditorStore((s) => s.setPanel)
  const dirty = useEditorStore((s) => s.dirty)
  const saving = useEditorStore((s) => s.saving)
  const version = useEditorStore((s) => s.version)
  const isMobile = useIsMobile()

  const loadedRef = useRef(false)

  // ── load pending design (from dashboard) ───────────────────
  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    if (pendingDesign) {
      loadDesign(pendingDesign)
    } else if (!designId) {
      // no design to open → back home
      goDashboard()
    }
  }, [])

  // ── autosave ───────────────────────────────────────────────
  const save = useCallback(
    async (withThumbnail: boolean) => {
      const state = useEditorStore.getState()
      if (!state.designId || state.saving) return
      state.markSaving()
      try {
        let thumbnail: string | null = null
        if (withThumbnail) {
          thumbnail = (await canvasBridge.captureThumbnail?.()) ?? (await captureThumbnail().catch(() => null))
        }
        const res = await fetch(`/api/designs/${state.designId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: state.designName,
            pages: state.pages,
            ...(thumbnail ? { thumbnail } : {}),
          }),
        })
        if (!res.ok) throw new Error('save failed')
        useEditorStore.getState().markSaved()
      } catch (err) {
        console.error('Autosave failed', err)
        useEditorStore.setState({ saving: false })
      }
    },
    []
  )

  // debounced autosave on changes
  useEffect(() => {
    if (!dirty || !designId) return
    const t = setTimeout(() => void save(true), 1600)
    return () => clearTimeout(t)
  }, [dirty, designId, version, save])

  // save when leaving the editor
  useEffect(() => {
    return () => {
      const state = useEditorStore.getState()
      if (state.designId && (state.dirty || state.saving)) void save(false)
    }
  }, [])

  // ── keyboard shortcuts ─────────────────────────────────────
  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement
      if (!el) return false
      const tag = el.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable
    }

    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const state = useEditorStore.getState()

      if (e.key === 'Escape') {
        state.clearSelection()
        return
      }
      if (isTyping()) return

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) state.redo()
        else state.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        state.redo()
        return
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save(true)
        toast({ title: 'Design saved' })
        return
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        state.duplicateSelection()
        return
      }
      if (mod && e.key.toLowerCase() === 'c') {
        state.copySelection()
        return
      }
      if (mod && e.key.toLowerCase() === 'x') {
        state.copySelection()
        state.deleteSelection()
        return
      }
      if (mod && e.key.toLowerCase() === 'v') {
        state.pasteClipboard()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedIds.length) {
          e.preventDefault()
          state.deleteSelection()
        }
        return
      }
      // nudge
      if (e.key.startsWith('Arrow') && state.selectedIds.length) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        const patch = {}
        for (const id of state.selectedIds) {
          const el = state.pages[state.currentPage].elements.find((el) => el.id === id)
          if (el) {
            state.updateElementsLive([id], { x: el.x + dx, y: el.y + dy })
          }
        }
        void patch
        return
      }
      if (e.key === '+' || e.key === '=') state.zoomIn()
      if (e.key === '-') state.zoomOut()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  // ── render panel ───────────────────────────────────────────
  const renderPanel = () => {
    switch (panel) {
      case 'templates': return <TemplatesPanel />
      case 'elements': return <ElementsPanel />
      case 'text': return <TextPanel />
      case 'uploads': return <UploadsPanel />
      case 'background': return <BackgroundPanel />
      case 'layers': return <LayersPanel />
      default: return null
    }
  }

  const hasPanel = panel !== null

  return (
    <div className="h-screen w-full flex flex-col bg-[#E9EAF0] overflow-hidden">
      <TopBar onSave={() => save(true)} />

      <div className="flex flex-1 min-h-0">
        {/* desktop rail */}
        <div className="hidden md:flex">
          <LeftRail vertical />
        </div>

        {/* panel — desktop: sidebar; mobile: overlay sheet */}
        {hasPanel && (
          <aside
            className={
              isMobile
                ? 'fixed inset-x-0 bottom-14 top-14 z-40 bg-white shadow-xl flex flex-col'
                : 'w-[300px] bg-white border-r border-black/8 flex flex-col shrink-0'
            }
          >
            {isMobile && (
              <div className="flex items-center justify-between px-4 py-3 border-b border-black/5 shrink-0">
                <h2 className="font-bold text-sm">{PANEL_TITLES[panel]}</h2>
                <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setPanel(null)} aria-label="Close panel">
                  <X size={16} />
                </Button>
              </div>
            )}
            <div className="flex-1 min-h-0">{renderPanel()}</div>
          </aside>
        )}

        {/* canvas workspace */}
        <main className="flex-1 relative min-w-0 min-h-0" aria-label="Design canvas">
          <PropertiesBar />
          <CanvasStage />
          <PageBar />
          <ZoomControls />
        </main>
      </div>

      {/* mobile rail */}
      <div className="md:hidden border-t border-black/10">
        <LeftRail vertical={false} />
      </div>

      {/* save indicator (mobile) */}
      {isMobile && saving && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 text-xs bg-black/70 text-white px-3 py-1 rounded-full">
          Saving…
        </div>
      )}
    </div>
  )
}
