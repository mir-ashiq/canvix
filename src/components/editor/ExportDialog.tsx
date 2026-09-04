'use client'

import { useState } from 'react'
import { Download, Loader2, FileImage, FileType2, FileCode2, Film } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { captureStage, canvasBridge } from './canvas/canvas-bridge'
import { exportDesignToSVGs, downloadSVG } from '@/lib/svg-export'
import { detectVideoFormat, downloadVideo, estimateVideoDuration, exportVideo } from '@/lib/video-export'
import { toast } from '@/hooks/use-toast'
import { Progress } from '@/components/ui/progress'
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
  { id: 'png', label: 'PNG', hint: 'Lossless · transparency', icon: FileImage },
  { id: 'jpg', label: 'JPG', hint: 'Smaller file', icon: FileImage },
  { id: 'pdf', label: 'PDF', hint: 'Print-ready · all pages', icon: FileType2 },
  { id: 'svg', label: 'SVG', hint: 'Vector · editable', icon: FileCode2 },
  { id: 'mp4', label: 'Video', hint: 'MP4 / WebM · animated', icon: Film },
] as const

type FormatId = (typeof FORMATS)[number]['id']

export function ExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const name = useEditorStore((s) => s.designName)
  const pages = useEditorStore((s) => s.pages)
  const setCurrentPage = useEditorStore((s) => s.setCurrentPage)
  const currentPage = useEditorStore((s) => s.currentPage)

  const [format, setFormat] = useState<FormatId>('png')
  const [scale, setScale] = useState(2)
  const [allPages, setAllPages] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [progressLabel, setProgressLabel] = useState('')
  const videoFormat = detectVideoFormat()
  const videoDuration = estimateVideoDuration(pages)

  const base = sanitizeFilename(name)
  const pageCount = allPages ? pages.length : 1
  const estWidth = canvasBridge.pageWidth * scale
  const estHeight = canvasBridge.pageHeight * scale

  const run = async () => {
    setBusy(true)
    setProgress(null)
    try {
      if (format === 'mp4') {
        if (!videoFormat) throw new Error('This browser cannot record video. Try Chrome or Edge.')
        const result = await exportVideo({
          designWidth: canvasBridge.pageWidth || 1080,
          designHeight: canvasBridge.pageHeight || 1080,
          pages,
          maxWidth: scale === 3 ? 1920 : scale === 2 ? 1440 : 960,
          onProgress: (ratio, label) => {
            setProgress(Math.round(ratio * 100))
            setProgressLabel(label)
          },
        })
        downloadVideo(result, base)
        toast({
          title: `Video downloaded (${result.extension.toUpperCase()})`,
          description: `${result.frames} frames · ${result.durationSec.toFixed(1)}s · rendered locally in your browser`,
        })
        onOpenChange(false)
        return
      }
      if (format === 'svg') {
        // true vector export — no rasterization of vector elements
        const svgs = exportDesignToSVGs(allPages ? pages : [pages[currentPage]], canvasBridge.pageWidth, canvasBridge.pageHeight)
        for (let k = 0; k < svgs.length; k++) {
          const suffix = svgs.length > 1 ? `-page-${(allPages ? 0 : currentPage) + k + 1}` : ''
          downloadSVG(svgs[k], `${base}${suffix}.svg`)
          if (svgs.length > 1) await new Promise((r) => setTimeout(r, 380))
        }
        toast({
          title: `SVG downloaded (${svgs.length} file${svgs.length > 1 ? 's' : ''})`,
          description: 'Text keeps font-family references — viewers fall back to installed fonts.',
        })
        onOpenChange(false)
        return
      }
      if (format === 'pdf') {
        // multi-page PDF via jsPDF (client-side, no watermark)
        const { jsPDF } = await import('jspdf')
        const pw = canvasBridge.pageWidth
        const ph = canvasBridge.pageHeight
        const orientation = pw >= ph ? 'landscape' : 'portrait'
        const pdf = new jsPDF({ orientation, unit: 'px', format: [pw, ph], compress: true })
        const savedPage = currentPage
        const indices = allPages ? pages.map((_, i) => i) : [currentPage]
        for (let k = 0; k < indices.length; k++) {
          const idx = indices[k]
          if (idx !== useEditorStore.getState().currentPage) {
            setCurrentPage(idx)
            await new Promise((r) => setTimeout(r, 260))
          }
          const url = await captureStage({ pixelScale: scale, mimeType: 'image/jpeg', quality: 0.95 })
          if (k > 0) pdf.addPage([pw, ph], orientation)
          pdf.addImage(url, 'JPEG', 0, 0, pw, ph)
        }
        if (savedPage !== useEditorStore.getState().currentPage) setCurrentPage(savedPage)
        pdf.save(`${base}.pdf`)
        toast({ title: `PDF downloaded (${pageCount} page${pageCount > 1 ? 's' : ''})` })
        onOpenChange(false)
        return
      }
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
      <DialogContent className="rounded-[28px] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileImage size={18} className="text-[#7D2AE8]" /> Download your design
          </DialogTitle>
          <DialogDescription>No watermarks. Files are generated locally in your browser.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-2">File type</h4>
            <div className="grid grid-cols-5 gap-1.5">
              {FORMATS.map((f) => {
                const Ico = f.icon
                return (
                  <button
                    key={f.id}
                    onClick={() => setFormat(f.id)}
                    className={cn(
                      'rounded-xl border-2 p-3 text-left transition-all',
                      format === f.id ? 'border-[#00C4CC] bg-[#F0FBFC]' : 'border-black/10 hover:border-black/25'
                    )}
                  >
                    <div className="font-bold text-sm flex items-center gap-1.5">
                      <Ico size={13} className="text-[#7D2AE8]" /> {f.label}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{f.hint}</div>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-2">Quality</h4>
            {format === 'svg' ? (
              <p className="text-[11px] text-muted-foreground py-3">
                Vector export — resolution-independent, opens in browsers & vector editors.
              </p>
            ) : format === 'mp4' ? (
              <div className="text-[11px] text-muted-foreground space-y-1.5 py-1">
                <p>
                  Renders <strong>{videoDuration.toFixed(1)}s</strong> of animated playback ({pages.length} page{pages.length > 1 ? 's' : ''}) — element animations and page transitions included.
                </p>
                <p>
                  {videoFormat ? (
                    <>Format: <strong>{videoFormat.label}</strong>{videoFormat.extension === 'webm' && <> — this browser can’t encode MP4, so Canvix produces WebM (plays everywhere)</>}</>
                  ) : (
                    <span className="text-red-500">This browser cannot record video — try Chrome or Edge.</span>
                  )}
                  · rendered locally (no upload)
                </p>
              </div>
            ) : (
              <>
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
              </>
            )}
          </div>

          {pages.length > 1 && format !== 'mp4' && (
            <label className="flex items-center justify-between rounded-xl border border-black/10 px-4 py-3 cursor-pointer">
              <span className="text-sm font-medium">
                {format === 'pdf' ? 'Include all pages' : 'Download all pages'}
                <span className="block text-[11px] text-muted-foreground font-normal">{format === 'pdf' ? `${pages.length} pages in one PDF file` : `${pages.length} files, one per page`}</span>
              </span>
              <input type="checkbox" checked={allPages} onChange={(e) => setAllPages(e.target.checked)} className="accent-[#00C4CC] h-4 w-4" />
            </label>
          )}
        </div>

        {busy && progress !== null && (
          <div className="space-y-2">
            <Progress value={progress} className="h-2" />
            <p className="text-[11px] text-muted-foreground text-center">{progressLabel}</p>
          </div>
        )}

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
