'use client'

import { useState } from 'react'
import { History, RotateCcw, Trash2, Save, Layers } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useEditorStore } from '@/store/editor-store'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

/** v0.3.1 — canva-style version history: save labelled snapshots of the design
 *  (stored locally per design), restore or delete them at any time. */

function timeAgo(at: number): string {
  const s = Math.floor((Date.now() - at) / 1000)
  if (s < 45) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d} day${d > 1 ? 's' : ''} ago`
  return new Date(at).toLocaleDateString()
}

export function VersionHistoryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const versions = useEditorStore((s) => s.versions)
  const saveVersion = useEditorStore((s) => s.saveVersion)
  const restoreVersion = useEditorStore((s) => s.restoreVersion)
  const deleteVersion = useEditorStore((s) => s.deleteVersion)

  const [label, setLabel] = useState('')

  const save = () => {
    saveVersion(label)
    toast({ title: 'Version saved', description: label.trim() || undefined })
    setLabel('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[28px] bg-[#16181D] border-white/10 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History size={18} className="text-[#02C0CC]" /> Version history
          </DialogTitle>
          <DialogDescription className="text-white/55">
            Snapshots are stored in this browser for this design. Restoring keeps your current state on undo (Ctrl+Z).
          </DialogDescription>
        </DialogHeader>

        {/* save a new snapshot */}
        <div className="flex items-center gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder={`Version ${versions.length + 1} — e.g. "before print"`}
            maxLength={40}
            className="flex-1 min-w-0 h-9 rounded-xl bg-white/[0.08] border border-white/10 px-3 text-[13px] placeholder:text-white/35 outline-none focus:border-[#7630D7]"
            aria-label="Version label"
          />
          <Button size="sm" className="btn-cv-white h-9 px-4 rounded-xl font-semibold shrink-0" onClick={save}>
            <Save size={14} /> Save
          </Button>
        </div>

        {/* version list */}
        <div className="max-h-80 overflow-y-auto cv-scroll-dark -mx-1 px-1">
          {versions.length === 0 && (
            <div className="text-center text-[13px] text-white/40 py-10">
              No versions yet.<br />
              Save one before a big change — you can always come back.
            </div>
          )}
          {versions.map((v, i) => (
            <div
              key={v.id}
              className={cn(
                'group flex items-center gap-2.5 rounded-xl px-3 py-2.5',
                i === 0 ? 'bg-white/[0.05]' : 'hover:bg-white/[0.04]'
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold truncate">{v.label}</span>
                  {i === 0 && <span className="text-[10px] font-bold text-[#02C0CC] uppercase tracking-wide">latest</span>}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-white/45 mt-0.5">
                  <Layers size={11} /> {v.pages.length} page{v.pages.length > 1 ? 's' : ''}
                  <span className="text-white/25">·</span>
                  {v.width} × {v.height}
                  <span className="text-white/25">·</span>
                  {timeAgo(v.at)}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-3 rounded-lg text-white/85 hover:bg-white/10 hover:text-white text-[12px] font-semibold"
                onClick={() => {
                  restoreVersion(v.id)
                  toast({ title: `Restored “${v.label}”`, description: 'Ctrl+Z brings your previous state back.' })
                }}
              >
                <RotateCcw size={13} /> Restore
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-lg text-white/50 hover:bg-red-500/20 hover:text-red-400 shrink-0"
                onClick={() => deleteVersion(v.id)}
                aria-label={`Delete version ${v.label}`}
                title="Delete version"
              >
                <Trash2 size={13} />
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
