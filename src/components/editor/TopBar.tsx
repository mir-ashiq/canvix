'use client'

import { useState } from 'react'
import { Home, MessageCircle, Play, Share2, ChevronDown, Undo2, Redo2, Download, Github, Cloud, Check, Loader2, Ruler, History, Languages, Wand2, Zap } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { useEditorStore } from '@/store/editor-store'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { ExportDialog } from './ExportDialog'
import { ResizeDialog } from './ResizeDialog'
import { ShareDialog } from './ShareDialog'
import { VersionHistoryDialog } from './VersionHistoryDialog'
import { TranslateDialog } from './TranslateDialog'
import { MagicLayersDialog } from './MagicLayersDialog'
import { PresenceAvatars } from './PresenceAvatars'
import { useCommentsStore } from '@/lib/comments-store'
import { markAllCommentsRead } from '@/hooks/use-comments'
import { ContextToolbar } from './PropertiesBar'

/** Canva-2026 editor topbar: 56px cyan→purple gradient, white text, File/Resize/Editing left, Preview/Share right. */
export function TopBar({ onSave, onShortcuts }: { onSave: () => Promise<void>; onShortcuts: () => void }) {
  const goDashboard = useAppStore((s) => s.goDashboard)
  const name = useEditorStore((s) => s.designName)
  const rename = useEditorStore((s) => s.rename)
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)
  const canUndo = useEditorStore((s) => s.past.length > 0)
  const canRedo = useEditorStore((s) => s.future.length > 0)
  const dirty = useEditorStore((s) => s.dirty)
  const saving = useEditorStore((s) => s.saving)
  const savedAt = useEditorStore((s) => s.savedAt)
  const editingMode = useEditorStore((s) => s.editingMode)
  const setEditingMode = useEditorStore((s) => s.setEditingMode)
  const setPreviewOpen = useEditorStore((s) => s.setPreviewOpen)
  const setPanel = useEditorStore((s) => s.setPanel)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const showRulers = useEditorStore((s) => s.showRulers)
  const toggleRulers = useEditorStore((s) => s.toggleRulers)
  const commentsOpen = useEditorStore((s) => s.commentsOpen)
  const toggleComments = useEditorStore((s) => s.toggleComments)
  const animateOpen = useEditorStore((s) => s.animateOpen)
  const toggleAnimate = useEditorStore((s) => s.toggleAnimate)
  const designId = useEditorStore((s) => s.designId)
  const unreadCount = useCommentsStore((s) => s.unreadIds.size)

  const [exportOpen, setExportOpen] = useState(false)
  const [resizeOpen, setResizeOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [translateOpen, setTranslateOpen] = useState(false)
  const [magicLayersOpen, setMagicLayersOpen] = useState(false)

  const item = 'h-10 px-3 rounded-xl text-white/95 hover:bg-white/15 transition-colors text-sm font-semibold flex items-center gap-1.5 select-none'

  // canva behaviour: an element selection replaces the topbar middle section with the context toolbar
  const hasSelection = selectedIds.length > 0

  return (
    <header className="h-14 cv-topbar-gradient flex items-center gap-1 px-2 sm:px-3 z-40 shrink-0 shadow-[0_1px_0_rgba(0,0,0,0.15)]">
      <Button variant="ghost" size="icon" className="rounded-full text-white hover:bg-white/15 hover:text-white shrink-0" onClick={goDashboard} aria-label="Back to home" title="Home">
        <Home size={19} />
      </Button>

      {hasSelection ? (
        /* context toolbar occupies the middle (desktop only; mobile gets the bottom bar) */
        <div className="hidden md:flex flex-1 min-w-0 overflow-hidden">
          <ContextToolbar />
        </div>
      ) : (
        <>
      {/* File menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className={item} aria-label="File menu">
            File <ChevronDown size={12} className="opacity-70" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56 bg-[#16181D] border-white/10 text-white">
          <DropdownMenuItem className="gap-2" onClick={goDashboard}>
            <Home size={15} /> Home
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2" onClick={() => void onSave()}>
            <Cloud size={15} /> Save changes
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2" onClick={() => setResizeOpen(true)}>
            <Play size={15} /> Magic Resize
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2" onClick={() => setMagicLayersOpen(true)}>
            <Wand2 size={15} /> Magic Layers — edit a flat design
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2" onClick={() => setTranslateOpen(true)}>
            <Languages size={15} /> Translate design…
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2" onClick={toggleRulers}>
            <Ruler size={15} /> {showRulers ? 'Hide rulers' : 'Show rulers'}
            <span className="ml-auto text-[10px] text-white/40 font-semibold">⇧R</span>
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2" onClick={() => setVersionsOpen(true)}>
            <History size={15} /> Version history
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-white/10" />
          <DropdownMenuItem className="gap-2" onClick={() => setExportOpen(true)}>
            <Download size={15} /> Download
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-white/10" />
          <DropdownMenuItem className="gap-2" onClick={onShortcuts}>
            Keyboard shortcuts
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2" asChild>
            <a href="https://github.com/mir-ashiq/canvix" target="_blank" rel="noreferrer">
              <Github size={15} /> GitHub repository
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Magic Layers */}
      <button className={cn(item, 'hidden sm:flex')} onClick={() => setMagicLayersOpen(true)} aria-label="Magic Layers">
        <Wand2 size={13} className="text-white/80" /> Magic Layers
      </button>

      {/* Magic Resize */}
      <button className={cn(item, 'hidden md:flex')} onClick={() => setResizeOpen(true)} aria-label="Magic Resize">
        Magic Resize
      </button>

      {/* Editing / Viewing mode */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className={item} aria-label="Editing mode">
            {editingMode === 'editing' ? 'Editing' : 'Viewing'} <ChevronDown size={12} className="opacity-70" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44 bg-[#16181D] border-white/10 text-white">
          <DropdownMenuItem onClick={() => setEditingMode('editing')}>✏️ Editing — make changes</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setEditingMode('viewing')}>👁 Viewing — read only</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* title + save state */}
      <div className="flex items-center gap-2 min-w-0 ml-1">
        <input
          value={name}
          onChange={(e) => rename(e.target.value)}
          onBlur={() => void onSave()}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className="text-sm font-semibold bg-transparent text-white outline-none rounded-lg px-2 py-1.5 hover:bg-white/15 focus:bg-white/20 min-w-0 w-32 sm:w-48 truncate placeholder:text-white/60"
          aria-label="Design name"
          maxLength={80}
          placeholder="Untitled design"
        />
        <span className="hidden md:inline-flex items-center gap-1 text-xs text-white/85 shrink-0">
          {saving ? (
            <>
              <Loader2 size={12} className="animate-spin" /> Saving…
            </>
          ) : dirty ? (
            <>
              <Cloud size={12} /> Unsaved
            </>
          ) : savedAt ? (
            <>
              <Check size={12} /> All changes saved
            </>
          ) : null}
        </span>
      </div>
      </>
      )}

      <div className="ml-auto flex items-center gap-0.5 sm:gap-1 shrink-0">
        {/* v0.5: collaborators + connection status */}
        <PresenceAvatars />
        <Button variant="ghost" size="icon" className="rounded-lg text-white hover:bg-white/15 hover:text-white" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
          <Undo2 size={17} />
        </Button>
        <Button variant="ghost" size="icon" className="rounded-lg text-white hover:bg-white/15 hover:text-white" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
          <Redo2 size={17} />
        </Button>
        <Button variant="ghost" size="icon" className={cn('relative rounded-lg hover:bg-white/15 hover:text-white', commentsOpen ? 'text-white bg-white/15' : 'text-white')} onClick={() => { toggleComments(); if (!commentsOpen && designId) markAllCommentsRead(designId) }} aria-label="Comments" title="Comments">
          <MessageCircle size={17} className={cn(commentsOpen && 'fill-white/20')} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-[#FF5C8A] text-white text-[9px] font-bold flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
        <button className={cn(item, 'hidden sm:flex')} onClick={toggleAnimate} aria-label="Animate">
          <Zap size={13} className={cn(animateOpen && 'text-[#02C0CC]')} /> Animate
        </button>
        <button className={cn(item, 'hidden sm:flex')} onClick={() => setPreviewOpen(true)} aria-label="Preview design">
          <Play size={14} /> Preview
        </button>
        <Button size="sm" className="btn-cv-white h-10 px-4 sm:px-5 gap-1.5 font-semibold" onClick={() => setShareOpen(true)}>
          <Share2 size={15} /> <span className="hidden sm:inline">Share</span>
        </Button>
        <Button size="icon" variant="ghost" className="rounded-lg text-white hover:bg-white/15 hover:text-white" onClick={() => setExportOpen(true)} aria-label="Download" title="Download">
          <Download size={17} />
        </Button>
      </div>

      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
      <ResizeDialog open={resizeOpen} onOpenChange={setResizeOpen} />
      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} />
      <VersionHistoryDialog open={versionsOpen} onOpenChange={setVersionsOpen} />
      <TranslateDialog open={translateOpen} onOpenChange={setTranslateOpen} />
      <MagicLayersDialog open={magicLayersOpen} onOpenChange={setMagicLayersOpen} />
    </header>
  )
}
