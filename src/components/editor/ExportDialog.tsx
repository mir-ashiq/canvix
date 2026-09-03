'use client'

import { useState } from 'react'
import { Download, Loader2, FileImage } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { captureStage, canvasBridge } from './canvas/canvas-bridge'
import { toast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

function sanitizeFilename(name: string): string {
  return (name || 'canvix-design').trim().toLowerCase().replace(/[^a-z0-9-_ ]/g, '').replace(/\s+/g, '-') || 'canvix-design'
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

const SCALES = [
  { id: 1, label: '1×', hint: 'Standard' },
  { id: 2, label: '2×', hint: 'High-res' },
  { id: 3, label: '3×', hint: 'Max quality' },
]

const FORMATS = [
  { id: 'png', label: 'PNG', hint: 'Lossless · transparency' },
  { id: 'jpg', label: 'JPG', hint: 'Smaller file' },
] as const

export function ExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const name = useEditorStore((s) => s.designName)
  const pages = useEditorStore((s) => s.pages)
  const setCurrentPage = useEditorStore((s) => s.setCurrentPage)
  const currentPage = useEditorStore((s) => s.currentPage)

  const [format, setFormat] = useState<'png' | 'jpg'>('png')
  const [scale, setScale] = useState(2)
  const [allPages, setAllPages] = useState(false)
  const [busy, setBusy] = useState(false)

  const base = sanitizeFilename(name)
  const pageCount = allPages ? pages.length : 1
  const estWidth = canvasBridge.pageWidth * scale
  const estHeight = canvasBridge.pageHeight * scale

  const run = async () => {
    setBusy(true)
    try {
      const mimeType = format === 'png' ? 'image/png' : 'image/jpeg'
      const indices = allPages ? pages.map((_, i) => i) : [currentPage]
      const savedPage = currentPage
      for (let k = 0; k < indices.length; k++) {
        const idx = indices[k]
        if (idx !== useEditorStore.getState().currentPage) {
          setCurrentPage(idx)
          // wait for the stage to re-render the page
          await new Promise((r) => setTimeout(r, 220))
        }
        const url = await captureStage({ pixelScale: scale, mimeType, quality: 0.94 })
        const suffix = indices.length > 1 ? `-page-${idx + 1}` : ''
        triggerDownload(url, `${base}${suffix}.${format}`)
        if (indices.length > 1) await new Promise((r) => setTimeout(r, 380))
      }
      if (savedPage !== useEditorStore.getState().currentPage) setCurrentPage(savedPage)
      toast({ title: `Downloaded ${pageCount} ${pageCount > 1 ? 'files' : 'file'}` })
      onOpenChange(false)
    } catch (err) {
      console.error('Export failed', err)
      toast({ title: 'Export failed', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileImage size={18} className="text-[#7D2AE8]" /> Download your design
          </DialogTitle>
          <DialogDescription>No watermarks. Files are generated locally in your browser.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-2">File type</h4>
            <div className="grid grid-cols-2 gap-2">
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFormat(f.id)}
                  className={cn(
                    'rounded-xl border-2 p-3 text-left transition-all',
                    format === f.id ? 'border-[#00C4CC] bg-[#F0FBFC]' : 'border-black/10 hover:border-black/25'
                  )}
                >
                  <div className="font-bold text-sm">{f.label}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{f.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-2">Quality</h4>
            <div className="grid grid-cols-3 gap-2">
              {SCALES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setScale(s.id)}
                  className={cn(
                    'rounded-xl border-2 p-3 text-center transition-all',
                    scale === s.id ? 'border-[#00C4CC] bg-[#F0FBFC]' : 'border-black/10 hover:border-black/25'
                  )}
                >
                  <div className="font-bold text-sm">{s.label}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{s.hint}</div>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Output: {estWidth} × {estHeight} px per file
            </p>
          </div>

          {pages.length > 1 && (
            <label className="flex items-center justify-between rounded-xl border border-black/10 px-4 py-3 cursor-pointer">
              <span className="text-sm font-medium">
                Download all pages
                <span className="block text-[11px] text-muted-foreground font-normal">{pages.length} files, one per page</span>
              </span>
              <input type="checkbox" checked={allPages} onChange={(e) => setAllPages(e.target.checked)} className="accent-[#00C4CC] h-4 w-4" />
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button className="btn-brand-gradient gap-2 px-6" onClick={run} disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            {busy ? 'Exporting…' : `Download ${pageCount} ${format.toUpperCase()}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
