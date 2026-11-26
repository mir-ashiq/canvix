'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  ImageIcon,
  Layers,
  Loader2,
  MousePointer2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { useAICapabilities } from '@/hooks/use-ai-capabilities'
import type { ImageElement, PageData } from '@/lib/types'
import { createImageElement, uid } from '@/lib/types'
import { normalizeForAnalysis, normalizeSrcForAnalysis } from '@/lib/magic-layers/normalize'
import { reconstructDesign, toPage, type MagicLayersReconstruction } from '@/lib/magic-layers/reconstruct'
import { REVIEW_CONFIDENCE_THRESHOLD, type MagicLayerAnalysis, type MagicRegion } from '@/lib/magic-layers/types'

type Stage = 'upload' | 'analyzing' | 'review' | 'rebuilding'

type InsertMode = 'replace' | 'append' | 'overlay'

/** Approximate wrapped-text height the way Konva measures it (offscreen 2D canvas). */
function measureTextHeight(text: string, fontFamily: string, fontSize: number, width: number, lineHeight: number, bold: boolean): number {
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return fontSize * lineHeight
    ctx.font = `${bold ? '700' : '400'} ${fontSize}px ${fontFamily}`
    const words = text.split(/\s+/)
    const lines: string[] = []
    let line = ''
    for (const word of words) {
      const test = line ? `${line} ${word}` : word
      if (ctx.measureText(test).width > width && line) {
        lines.push(line)
        line = word
      } else {
        line = test
      }
    }
    if (line) lines.push(line)
    return Math.max(fontSize * lineHeight, lines.length * fontSize * lineHeight)
  } catch {
    return fontSize * lineHeight
  }
}

export function MagicLayersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const width = useEditorStore((s) => s.width)
  const height = useEditorStore((s) => s.height)
  const addElementsBulk = useEditorStore((s) => s.addElementsBulk)
  const replaceCurrentPage = useEditorStore((s) => s.replaceCurrentPage)
  const appendPage = useEditorStore((s) => s.appendPage)
  const updateElementsLive = useEditorStore((s) => s.updateElementsLive)
  const currentPageElements = useEditorStore((s) => s.pages[s.currentPage]?.elements)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const selectedElements = useMemo(
    () => (currentPageElements ?? []).filter((e) => selectedIds.includes(e.id)),
    [currentPageElements, selectedIds]
  )
  const { configured: aiConfigured, loaded: aiLoaded } = useAICapabilities()

  const [stage, setStage] = useState<Stage>('upload')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<MagicLayerAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [discarded, setDiscarded] = useState<Set<string>>(new Set())
  const [insertMode, setInsertMode] = useState<InsertMode>('replace')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = useCallback(() => {
    setStage('upload')
    setImageUrl(null)
    setAnalysis(null)
    setError(null)
    setDiscarded(new Set())
  }, [])

  const close = (o: boolean) => {
    if (!o) {
      onOpenChange(false)
      setTimeout(reset, 250)
    }
  }

  // ── pick a file → normalize → analyze ────────────────────
  const analyzeFile = async (file: File) => {
    setStage('analyzing')
    setError(null)
    try {
      const { dataUrl } = await normalizeForAnalysis(file)
      setImageUrl(dataUrl)
      await runAnalysis(dataUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that image.')
      setStage('upload')
    }
  }

  const analyzeSelected = async () => {
    const img = selectedElements.find((e): e is ImageElement => e.type === 'image')
    if (!img) return
    setStage('analyzing')
    setError(null)
    try {
      const dataUrl = await normalizeSrcForAnalysis(img.src)
      setImageUrl(dataUrl)
      await runAnalysis(dataUrl)
    } catch {
      setError('That image could not be loaded for analysis.')
      setStage('upload')
    }
  }

  const runAnalysis = async (dataUrl: string) => {
    try {
      const res = await fetch('/api/ai/magic-layers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      })
      const data = (await res.json()) as MagicLayerAnalysis & { error?: string; code?: string }
      if (!res.ok || !Array.isArray(data.regions)) {
        throw new Error(data.error ?? 'Analysis failed.')
      }
      setAnalysis(data)
      setDiscarded(new Set(data.regions.filter((r) => r.confidence < 0.35).map((r) => r.id)))
      setStage('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed.')
      setStage('upload')
    }
  }

  // ── rebuild → insert ─────────────────────────────────────
  const createLayers = async () => {
    if (!analysis || !imageUrl) return
    setStage('rebuilding')
    try {
      const rec = await reconstructDesign(analysis, imageUrl, width, height, [...discarded])
      applyReconstruction(rec)
      toast({
        title: 'Magic Layers created',
        description: `${rec.elements.length} editable layers extracted — each element can be selected, moved and restyled.`,
      })
      close(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reconstruction failed.')
      setStage('review')
    }
  }

  const applyReconstruction = (rec: MagicLayersReconstruction) => {
    if (insertMode === 'replace') {
      replaceCurrentPage(toPage(rec))
    } else if (insertMode === 'append') {
      appendPage(toPage(rec))
    } else {
      addElementsBulk(rec.elements)
    }
    // best-effort text height measure pass (text boxes are placed by the
    // analysis bounds; heights re-measure to the wrapped content)
    const texts = rec.elements.filter((e) => e.type === 'text')
    if (texts.length) {
      requestAnimationFrame(() => {
        for (const el of texts) {
          if (el.type !== 'text') continue
          const h = measureTextHeight(el.text, el.fontFamily, el.fontSize, el.width, el.lineHeight, el.bold)
          if (Number.isFinite(h) && h > 0) updateElementsLive([el.id], { height: Math.round(h) })
        }
      })
    }
  }

  const insertAsImage = () => {
    if (!imageUrl) return
    addElementsBulk([
      createImageElement(imageUrl, width, height, {
        x: 0,
        y: 0,
        width,
        height,
        name: 'Original image (flat)',
      }),
    ])
    toast({ title: 'Image placed flat', description: 'The original image was placed as a single layer.' })
    close(false)
  }

  const toggleDiscard = (id: string) => {
    setDiscarded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedImageElement = selectedElements.find((e): e is ImageElement => e.type === 'image')
  const regionCount = analysis?.regions.length ?? 0
  const keptCount = analysis ? analysis.regions.filter((r) => !discarded.has(r.id)).length : 0
  const lowConfidenceCount = analysis
    ? analysis.regions.filter((r) => r.confidence < REVIEW_CONFIDENCE_THRESHOLD).length
    : 0

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="rounded-[28px] sm:max-w-2xl bg-[#16181D] border-white/10 text-white max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Wand2 size={18} className="text-[#02C0CC]" /> Magic Layers
          </DialogTitle>
          <DialogDescription className="text-white/60">
            Turn a flat design image into an editable layout — text, images and shapes become real layers you can move, restyle and edit.
          </DialogDescription>
        </DialogHeader>

        {/* AI provider not configured — honest state with local fallback */}
        {aiLoaded && !aiConfigured && stage === 'upload' && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-200/90">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle size={15} /> AI provider not configured
            </div>
            <p className="mt-1 text-amber-200/70">
              Automatic layer extraction needs a vision AI provider configured on the server. You can still place the
              image as a single flat layer.
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200/90">{error}</div>
        )}

        {/* ── Stage: upload ─────────────────────────────── */}
        {stage === 'upload' && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full rounded-2xl border-2 border-dashed border-white/15 hover:border-[#7630D7] bg-white/[0.03] hover:bg-[#7630D7]/10 transition-all py-10 flex flex-col items-center gap-3 cursor-pointer"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const file = e.dataTransfer.files?.[0]
                if (file?.type.startsWith('image/')) void analyzeFile(file)
              }}
            >
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#00C4CC] to-[#7630D7] flex items-center justify-center">
                <Upload size={22} className="text-white" />
              </div>
              <div className="text-sm font-semibold">Upload a flat design</div>
              <div className="text-xs text-white/50">PNG, JPG or WebP — drop it here or click to browse</div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void analyzeFile(file)
                e.target.value = ''
              }}
            />

            {selectedImageElement && (
              <button
                type="button"
                onClick={() => void analyzeSelected()}
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] p-3 flex items-center gap-3 text-left cursor-pointer transition-colors"
              >
                <div className="w-10 h-10 rounded-lg bg-[#7630D7]/20 flex items-center justify-center shrink-0">
                  <MousePointer2 size={16} className="text-[#c39bff]" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">Analyze the selected image</div>
                  <div className="text-xs text-white/50 truncate">
                    Uses the image currently selected on your canvas
                  </div>
                </div>
              </button>
            )}

            <div className="rounded-xl bg-white/[0.03] border border-white/[0.07] p-3.5 text-xs text-white/55 space-y-1.5">
              <div className="font-semibold text-white/75 flex items-center gap-1.5">
                <Sparkles size={12} className="text-[#02C0CC]" /> How it works
              </div>
              <p>
                A vision model detects text, photos, shapes and the background, then Canvix rebuilds each region as a
                <strong className="text-white/80"> native editable element</strong>. Exact fonts can&apos;t be recovered —
                the closest family from the Canvix library is used. Uncertain regions are flagged so you can review them.
              </p>
            </div>
          </div>
        )}

        {/* ── Stage: analyzing ──────────────────────────── */}
        {stage === 'analyzing' && (
          <div className="py-10 flex flex-col items-center gap-4">
            {imageUrl && (
               
              <img src={imageUrl} alt="Design being analyzed" className="max-h-44 rounded-xl border border-white/10 object-contain" />
            )}
            <Loader2 size={28} className="animate-spin text-[#02C0CC]" />
            <div className="text-sm font-semibold">Detecting layers…</div>
            <div className="text-xs text-white/50">Reading text, photos, shapes and the background.</div>
          </div>
        )}

        {/* ── Stage: review ─────────────────────────────── */}
        {stage === 'review' && analysis && imageUrl && (
          <div className="space-y-4">
            {analysis.notes && (
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs text-white/60 flex gap-2">
                <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-300/80" />
                <span>{analysis.notes}</span>
              </div>
            )}

            <div className="grid grid-cols-[220px_1fr] gap-4">
              {/* preview with region outlines */}
              <div className="relative rounded-xl overflow-hidden border border-white/10 bg-[#0F1015]">
                { }
                <img src={imageUrl} alt="Analyzed design" className="w-full block" />
                {analysis.regions.map((r) => {
                  const isDiscarded = discarded.has(r.id)
                  const low = r.confidence < REVIEW_CONFIDENCE_THRESHOLD
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => toggleDiscard(r.id)}
                      title={`${r.type}${r.text ? `: ${r.text.slice(0, 40)}` : ''} — confidence ${(r.confidence * 100).toFixed(0)}% (click to ${isDiscarded ? 'keep' : 'discard'})`}
                      className={cn(
                        'absolute border-2 transition-all',
                        isDiscarded
                          ? 'border-white/20 opacity-25'
                          : low
                            ? 'border-amber-400'
                            : 'border-[#02C0CC]'
                      )}
                      style={{
                        left: `${r.bounds.x * 100}%`,
                        top: `${r.bounds.y * 100}%`,
                        width: `${r.bounds.w * 100}%`,
                        height: `${r.bounds.h * 100}%`,
                      }}
                    >
                      {isDiscarded && (
                        <span className="absolute inset-0 flex items-center justify-center">
                          <EyeOff size={12} className="text-white/70" />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* region list */}
              <div className="min-h-0">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-white/70">
                    {keptCount} of {regionCount} layers kept
                    {lowConfidenceCount > 0 && (
                      <span className="ml-2 text-amber-300/80">
                        {lowConfidenceCount} need review
                      </span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-white/70 hover:bg-white/10 hover:text-white"
                    onClick={() => setDiscarded(new Set())}
                  >
                    <RefreshCw size={11} className="mr-1" /> Keep all
                  </Button>
                </div>
                <div className="max-h-64 overflow-y-auto pr-1 space-y-1.5">
                  {analysis.regions.map((r) => (
                    <RegionRow key={r.id} region={r} discarded={discarded.has(r.id)} onToggle={() => toggleDiscard(r.id)} />
                  ))}
                </div>
              </div>
            </div>

            {/* insert mode */}
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'replace', label: 'Replace page', hint: 'Rebuilds the current page' },
                  { id: 'append', label: 'New page', hint: 'Adds a page after this one' },
                  { id: 'overlay', label: 'Add to page', hint: 'Layers on top of existing elements' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setInsertMode(m.id)}
                  className={cn(
                    'rounded-xl border-2 p-2.5 text-left transition-all cursor-pointer',
                    insertMode === m.id ? 'border-[#02C0CC] bg-[#02C0CC]/10' : 'border-white/10 hover:border-white/25'
                  )}
                >
                  <div className="text-[13px] font-semibold">{m.label}</div>
                  <div className="text-[11px] text-white/50">{m.hint}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {stage === 'rebuilding' && (
          <div className="py-10 flex flex-col items-center gap-4">
            <Loader2 size={28} className="animate-spin text-[#7630D7]" />
            <div className="text-sm font-semibold">Building editable layers…</div>
          </div>
        )}

        <div className="flex items-center gap-2 justify-end pt-1">
          {stage === 'review' && (
            <>
              <Button variant="ghost" className="text-white/70 hover:bg-white/10 hover:text-white" onClick={() => reset()}>
                <RefreshCw size={14} className="mr-1.5" /> Start over
              </Button>
              <Button className="btn-brand-gradient gap-2 px-5" onClick={() => void createLayers()} disabled={keptCount === 0}>
                <Layers size={15} />
                Create {keptCount} editable layers
              </Button>
            </>
          )}
          {stage === 'upload' && imageUrl === null && (
            <Button variant="ghost" className="text-white/70 hover:bg-white/10 hover:text-white" onClick={() => close(false)}>
              <X size={14} className="mr-1.5" /> Close
            </Button>
          )}
          {(stage === 'upload' || stage === 'review') && imageUrl && (
            <Button variant="ghost" className="text-white/70 hover:bg-white/10 hover:text-white" onClick={insertAsImage}>
              <ImageIcon size={14} className="mr-1.5" /> Place flat instead
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function RegionRow({ region, discarded, onToggle }: { region: MagicRegion; discarded: boolean; onToggle: () => void }) {
  const low = region.confidence < REVIEW_CONFIDENCE_THRESHOLD
  const icon =
    region.type === 'text' ? 'T' : region.type === 'photo' ? <ImageIcon size={12} /> : region.type === 'shape' ? <Plus size={12} /> : <Sparkles size={12} />
  const label =
    region.type === 'text'
      ? (region.text ?? '').replace(/\n/g, ' ').slice(0, 44)
      : region.type === 'photo'
        ? region.subject || 'Photo region'
        : region.type === 'shape'
          ? `${region.shape ?? 'rect'} shape`
          : 'Decoration'

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'w-full rounded-lg border p-2 flex items-center gap-2 text-left transition-all cursor-pointer',
        discarded
          ? 'border-white/[0.06] bg-transparent opacity-45'
          : low
            ? 'border-amber-400/40 bg-amber-400/5 hover:bg-amber-400/10'
            : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]'
      )}
    >
      <div
        className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0"
        style={{ background: region.color ?? '#00C4CC', color: readableOn(region.color) }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-white/85 truncate">{label}</div>
        <div className="text-[10px] text-white/40 flex items-center gap-1.5">
          {region.type}
          <span
            className={cn(
              'px-1 rounded font-semibold',
              low ? 'bg-amber-400/20 text-amber-300' : 'bg-[#02C0CC]/15 text-[#02C0CC]'
            )}
          >
            {(region.confidence * 100).toFixed(0)}%
          </span>
        </div>
      </div>
      {discarded ? <EyeOff size={13} className="text-white/30 shrink-0" /> : <Check size={13} className="text-[#02C0CC] shrink-0" />}
    </button>
  )
}

function readableOn(hex?: string): string {
  if (!hex) return '#FFFFFF'
  const h = hex.replace('#', '')
  if (h.length !== 6) return '#FFFFFF'
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#1F2226' : '#FFFFFF'
}

/** reserved for future magic-layer element swapping (element metadata UI) */
export function magicLayerBadge(el: { magicLayer?: { confidence: number } }): string | null {
  if (!el.magicLayer) return null
  return el.magicLayer.confidence < REVIEW_CONFIDENCE_THRESHOLD ? 'low confidence' : null
}

void uid
void Trash2
void Eye
