'use client'

import { useState } from 'react'
import { ArrowLeft, Undo2, Redo2, Download, Github, Cloud, Check, Loader2 } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { useEditorStore } from '@/store/editor-store'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/logo'
import { cn } from '@/lib/utils'
import { ExportDialog } from './ExportDialog'

export function TopBar({ onSave }: { onSave: () => Promise<void> }) {
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
  const [exportOpen, setExportOpen] = useState(false)

  return (
    <header className="h-14 bg-white border-b border-black/8 flex items-center gap-2 px-2 sm:px-3 z-40 shrink-0">
      <Button variant="ghost" size="icon" className="rounded-full shrink-0" onClick={goDashboard} aria-label="Back to home">
        <ArrowLeft size={18} />
      </Button>
      <Logo size={26} className="hidden sm:inline-flex shrink-0" />

      <div className="flex items-center gap-2 min-w-0">
        <input
          value={name}
          onChange={(e) => rename(e.target.value)}
          onBlur={() => void onSave()}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className="text-sm font-semibold bg-transparent outline-none rounded-lg px-2 py-1.5 hover:bg-black/[0.04] focus:bg-black/[0.04] min-w-0 w-36 sm:w-56 truncate"
          aria-label="Design name"
          maxLength={80}
        />
        <span className={cn('hidden sm:inline-flex items-center gap-1 text-xs shrink-0', saving ? 'text-[#0A8F96]' : 'text-muted-foreground')}>
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
              <Check size={12} className="text-[#34C77B]" /> Saved
            </>
          ) : null}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-1 sm:gap-1.5 shrink-0">
        <Button variant="ghost" size="icon" className="rounded-lg" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
          <Undo2 size={17} />
        </Button>
        <Button variant="ghost" size="icon" className="rounded-lg" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
          <Redo2 size={17} />
        </Button>
        <a href="https://github.com/mir-ashiq/canvix" target="_blank" rel="noreferrer" className="hidden md:block">
          <Button variant="ghost" size="icon" className="rounded-lg" aria-label="GitHub repository">
            <Github size={17} />
          </Button>
        </a>
        <Button size="sm" className="btn-brand-gradient rounded-full px-4 sm:px-5 gap-1.5 h-9" onClick={() => setExportOpen(true)}>
          <Download size={15} /> <span className="hidden sm:inline">Download</span>
        </Button>
      </div>

      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
    </header>
  )
}
