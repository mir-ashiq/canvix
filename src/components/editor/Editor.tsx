'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { X, Keyboard } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { useEditorStore, type PanelId } from '@/store/editor-store'
import { TopBar } from './TopBar'
import { LeftRail } from './LeftRail'
import { ContextToolbar } from './PropertiesBar'
import { PageBar } from './PageBar'
import { ZoomControls } from './ZoomControls'
import { PreviewOverlay } from './PreviewOverlay'
import { TemplatesPanel } from './panels/TemplatesPanel'
import { ElementsPanel } from './panels/ElementsPanel'
import { TextPanel } from './panels/TextPanel'
import { UploadsPanel } from './panels/UploadsPanel'
import { PhotosPanel } from './panels/PhotosPanel'
import { BrandPanel } from './panels/BrandPanel'
import { ToolsPanel } from './panels/ToolsPanel'
import { ProjectsPanel } from './panels/ProjectsPanel'
import { AppsPanel } from './panels/AppsPanel'
import { BackgroundPanel } from './panels/BackgroundPanel'
import { LayersPanel } from './panels/LayersPanel'
import { captureThumbnail, canvasBridge } from './canvas/canvas-bridge'
import { CropDialog } from './CropDialog'
import { useIsMobile } from '@/hooks/use-mobile'
import { useCollab } from '@/hooks/use-collab'
import { useComments, markAllCommentsRead } from '@/hooks/use-comments'
import { CommentsPanel } from './CommentsPanel'
import { AnimatePanel } from './AnimatePanel'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import type { ImageElement } from '@/lib/types'

const CanvasStage = dynamic(() => import('./canvas/CanvasStage'), { ssr: false })

const PANEL_TITLES: Record<Exclude<PanelId, null>, string> = {
  templates: 'Templates',
  elements: 'Elements',
  text: 'Text',
  brand: 'Brand',
  uploads: 'Uploads',
  photos: 'Photos',
  tools: 'Tools',
  projects: 'Projects',
  apps: 'Apps',
  background: 'Background',
  layers: 'Layers',
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl + Z / Ctrl + Shift + Z', 'Undo / redo'],
  ['Ctrl + S', 'Save design'],
  ['Ctrl + Alt + S', 'Save a version snapshot'],
  ['Ctrl + D', 'Duplicate selection'],
  ['Ctrl + C / X / V', 'Copy / cut / paste elements'],
  ['Ctrl + G / Ctrl + Shift + G', 'Group / ungroup selection'],
  ['Ctrl + A', 'Select all elements'],
  ['Ctrl + L', 'Lock / unlock selection'],
  ['Ctrl + ] / [', 'Bring forward / send backward'],
  ['Shift + Ctrl + ] / [', 'Bring to front / send to back'],
  ['Delete / Backspace', 'Delete selection'],
  ['Arrows (+ Shift ×10)', 'Nudge selection'],
  ['+ / −', 'Zoom in / out'],
  ['Space + drag', 'Pan the canvas'],
  ['Drag on empty canvas', 'Marquee (box) select'],
  ['Double-click text', 'Edit text'],
  ['Double-click layer name', 'Rename layer'],
  ['V', 'Select tool'],
  ['Shift + R', 'Show / hide rulers'],
  ['Drag from a ruler', 'Pull out a guide line'],
  ['Escape', 'Deselect / close'],
  ['Ctrl + mouse wheel', 'Zoom at cursor'],
]

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
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const commentsOpen = useEditorStore((s) => s.commentsOpen)
  const animateOpen = useEditorStore((s) => s.animateOpen)
  const setAnimateOpen = useEditorStore((s) => s.setAnimateOpen)

  // v0.3.1: image crop dialog (opened from the toolbar or context menu)
  const cropTargetId = useEditorStore((s) => s.cropTargetId)
  const closeCrop = useEditorStore((s) => s.closeCrop)
  const cropPages = useEditorStore((s) => s.pages)
  const cropPageIdx = useEditorStore((s) => s.currentPage)
  const cropElement = cropTargetId
    ? (cropPages[cropPageIdx]?.elements.find((e) => e.id === cropTargetId && e.type === 'image') as ImageElement | undefined)
    : undefined

  const loadedRef = useRef(false)

  // ── v0.5: real-time collaboration session for the open design ──
  useCollab()

  // ── v0.5: comments (live refresh) ──
  useComments()

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

      // v0.3.1: Shift+R toggles rulers & guides
      if (!mod && e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault()
        state.toggleRulers()
        return
      }
      // canva: V switches back to the select tool
      if (!mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'v') {
        state.setTool('select')
        return
      }
      // v0.3.1: Ctrl+Alt+S saves a version snapshot
      if (mod && e.altKey && (e.code === 'KeyS' || e.key.toLowerCase() === 's')) {
        e.preventDefault()
        state.saveVersion()
        toast({ title: 'Version saved' })
        return
      }

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
      if (mod && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        if (e.shiftKey) state.ungroupSelection()
        else state.groupSelection()
        return
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        const els = state.pages[state.currentPage].elements.filter((el) => !el.locked)
        state.setSelection(els.map((el) => el.id))
        return
      }
      if (mod && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        const hasLocked = state.pages[state.currentPage].elements.some((el) => state.selectedIds.includes(el.id) && el.locked)
        state.setLock(state.selectedIds, !hasLocked)
        return
      }
      if (mod && (e.key === ']' || e.key === '[')) {
        e.preventDefault()
        for (const id of state.selectedIds) state.moveLayer(id, e.key === ']' ? (e.shiftKey ? 'front' : 'up') : (e.shiftKey ? 'back' : 'down'))
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

  // ── drag & drop image files onto the canvas ───────────────
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
    }
    const onDrop = async (e: DragEvent) => {
      const files = e.dataTransfer?.files
      if (!files?.length) return
      e.preventDefault()
      const images = Array.from(files).filter((f) => f.type.startsWith('image/'))
      if (!images.length) return
      const { addImageFromFile, fillFrameAt, readImageFile } = await import('./add-element')
      const { canvasBridge } = await import('./canvas/canvas-bridge')
      let ok = 0
      let filled = 0
      for (const file of images) {
        try {
          // v0.6: dropping over a frame fills the frame instead of adding an image
          const { src, w, h } = await readImageFile(file)
          const pageX = (e.clientX - canvasBridge.pan.x) / canvasBridge.zoom
          const pageY = (e.clientY - canvasBridge.pan.y) / canvasBridge.zoom
          if (fillFrameAt(pageX, pageY, src, w, h)) {
            filled += 1
            ok += 1
            continue
          }
          await addImageFromFile(file)
          ok += 1
        } catch { /* ignore */ }
      }
      if (filled) toast({ title: `Frame filled with ${filled} image${filled > 1 ? 's' : ''}` })
      else if (ok) toast({ title: `${ok} image${ok > 1 ? 's' : ''} added` })
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  // ── render panel ───────────────────────────────────────────
  const renderPanel = () => {
    switch (panel) {
      case 'templates': return <TemplatesPanel />
      case 'elements': return <ElementsPanel />
      case 'text': return <TextPanel />
      case 'uploads': return <UploadsPanel />
      case 'photos': return <PhotosPanel />
      case 'brand': return <BrandPanel />
      case 'tools': return <ToolsPanel />
      case 'projects': return <ProjectsPanel />
      case 'apps': return <AppsPanel />
      case 'background': return <BackgroundPanel />
      case 'layers': return <LayersPanel />
      default: return null
    }
  }

  const hasPanel = panel !== null

  return (
    <div className="h-screen w-full flex flex-col bg-[#0F1015] overflow-hidden">
      <TopBar onSave={() => save(true)} onShortcuts={() => setShortcutsOpen(true)} />

      <div className="flex flex-1 min-h-0">
        {/* desktop rail */}
        <div className="hidden md:flex">
          <LeftRail vertical />
        </div>

        {/* v0.5: comments panel — replaces the tool panel while open */}
        {commentsOpen ? (
          <aside
            className={
              isMobile
                ? 'fixed inset-x-0 bottom-14 top-14 z-40 bg-[#16181D] shadow-2xl flex flex-col'
                : 'w-[340px] bg-[#16181D] border-r border-white/[0.07] flex flex-col shrink-0'
            }
          >
            <CommentsPanel />
          </aside>
        ) : (
          <>
        {/* panel — desktop: sidebar; mobile: overlay sheet */}
        {hasPanel && (
          <aside
            className={
              isMobile
                ? 'fixed inset-x-0 bottom-14 top-14 z-40 bg-[#16181D] shadow-2xl flex flex-col'
                : 'w-[320px] bg-[#16181D] border-r border-white/[0.07] flex flex-col shrink-0'
            }
          >
            {isMobile && (
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.07] shrink-0">
                <h2 className="font-bold text-sm text-white">{PANEL_TITLES[panel]}</h2>
                <Button variant="ghost" size="icon" className="rounded-full text-white hover:bg-white/10 hover:text-white" onClick={() => setPanel(null)} aria-label="Close panel">
                  <X size={16} />
                </Button>
              </div>
            )}
            <div className="flex-1 min-h-0">{renderPanel()}</div>
          </aside>
        )}
          </>
        )}

        {/* canvas workspace */}
        <main className="flex-1 relative min-w-0 min-h-0" aria-label="Design canvas">
          <CanvasStage />
          <PageBar />
          <ZoomControls />
        </main>

        {/* v0.5: Animate panel — canva-style right side panel */}
        {animateOpen && (
          <aside className="w-[300px] bg-[#16181D] border-l border-white/[0.07] flex flex-col shrink-0 hidden md:flex">
            <AnimatePanel onClose={() => setAnimateOpen(false)} />
          </aside>
        )}
      </div>

      {/* mobile contextual action bar (canva mobile: bottom bar on selection) */}
      {isMobile && selectedIds.length > 0 && (
        <div className="fixed inset-x-0 bottom-14 z-40">
          <ContextToolbar variant="mobile" />
        </div>
      )}

      {/* mobile rail */}
      <div className="md:hidden border-t border-white/[0.07]">
        <LeftRail vertical={false} />
      </div>

      {/* save indicator (mobile) */}
      {isMobile && saving && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 text-xs bg-[#7630D7] text-white px-3 py-1 rounded-full">
          Saving…
        </div>
      )}

      <PreviewOverlay />

      {/* v0.3.1: image crop dialog */}
      {cropElement && (
        <CropDialog element={cropElement} open onOpenChange={(o) => { if (!o) closeCrop() }} />
      )}

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="rounded-[28px] bg-[#16181D] border-white/10 text-white sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <Keyboard size={18} className="text-[#02C0CC]" /> Keyboard shortcuts
            </DialogTitle>
          </DialogHeader>
          <div className="divide-y divide-white/[0.07]">
            {SHORTCUTS.map(([keys, label]) => (
              <div key={keys} className="flex items-center justify-between py-2">
                <span className="text-[13px] text-white/70">{label}</span>
                <kbd className="text-[11px] font-semibold bg-white/[0.08] border border-white/10 rounded-md px-2 py-1">{keys}</kbd>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
