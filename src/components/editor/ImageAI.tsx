'use client'

import { useState } from 'react'
import { Eraser, Wand2, Loader2, Sparkles } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import type { ImageElement } from '@/lib/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'

interface EditResponse {
  dataUrl?: string
  width?: number
  height?: number
  error?: string
}

/** Normalise an element src into something the AI service can consume:
 *  dataURLs and absolute http(s) URLs pass through; relative paths
 *  (bundled /photos/*.jpg) are fetched and converted to dataURLs. */
async function toSendableImage(src: string): Promise<string> {
  if (src.startsWith('data:') || /^https?:\/\//.test(src)) return src
  const res = await fetch(src)
  if (!res.ok) throw new Error('Could not load the image')
  const blob = await res.blob()
  return await new Promise<string>((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new Error('Could not read the image'))
    fr.readAsDataURL(blob)
  })
}

/**
 * Shared AI image-edit runner — calls /api/ai/image-edit and swaps the
 * element's image in place, preserving the on-canvas width and adapting
 * the height to the new aspect ratio.
 */
async function runImageAI(
  el: ImageElement,
  payload: Record<string, unknown>,
  onDone: (msg: string) => void
): Promise<boolean> {
  const update = useEditorStore.getState().updateElements
  try {
    const image = await toSendableImage(el.src)
    const res = await fetch('/api/ai/image-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, ...payload }),
    })
    const data = (await res.json()) as EditResponse
    if (!res.ok || !data.dataUrl) {
      onDone(data.error ?? 'The edit failed. Please try again.')
      return false
    }
    const w = data.width || el.naturalWidth
    const h = data.height || el.naturalHeight
    // keep on-canvas width; adapt height to the new aspect ratio
    const newHeight = Math.max(4, Math.round(el.width * (h / Math.max(1, w))))
    update([el.id], {
      src: data.dataUrl,
      naturalWidth: w,
      naturalHeight: h,
      height: newHeight,
    })
    return true
  } catch {
    onDone('AI image editing is unavailable right now.')
    return false
  }
}

const btnBase =
  'cv-tbtn gap-1 !px-2.5 disabled:opacity-60'

/** Blob → dataURL */
function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new Error('Could not read the result'))
    fr.readAsDataURL(blob)
  })
}

/** natural pixel size of a dataURL image */
function imageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new window.Image()
    img.onload = () => resolve({ w: img.naturalWidth || 1024, h: img.naturalHeight || 1024 })
    img.onerror = () => resolve({ w: 1024, h: 1024 })
    img.src = dataUrl
  })
}

/** Canva "BG Remover" — one-click background removal on the selected image.
 *  Runs a local ONNX segmentation model in the browser (true alpha cut-out);
 *  the first use downloads the model (~40 MB) once, then it is cached. */
export function BgRemoverButton({ el }: { el: ImageElement }) {
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'model' | 'removing'>('idle')
  const run = async () => {
    if (busy) return
    setBusy(true)
    setPhase('model')
    const update = useEditorStore.getState().updateElements
    try {
      const { removeBackground } = await import('@imgly/background-removal')
      const sendable = await toSendableImage(el.src)
      const blob = await (await fetch(sendable)).blob()
      setPhase('removing')
      const result = await removeBackground(blob, {
        output: { format: 'image/png' },
        progress: (key) => {
          if (key === 'fetch:network' || key.startsWith('fetch:')) setPhase('model')
        },
      })
      const dataUrl = await blobToDataURL(result)
      const dims = await imageSize(dataUrl)
      const newHeight = Math.max(4, Math.round(el.width * (dims.h / Math.max(1, dims.w))))
      update([el.id], {
        src: dataUrl,
        naturalWidth: dims.w,
        naturalHeight: dims.h,
        height: newHeight,
      })
      toast({ title: 'Background removed', description: 'The cut-out replaced your image. Ctrl+Z to undo.' })
    } catch (e) {
      toast({
        title: 'Background remover',
        description: e instanceof Error ? e.message : 'Could not remove the background. Please try again.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
      setPhase('idle')
    }
  }
  const label = busy ? (phase === 'model' ? 'Loading model…' : 'Removing…') : 'BG Remover'
  return (
    <button className={btnBase} onClick={() => void run()} disabled={busy} title="BG Remover — remove the image background" aria-label="Remove background">
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Eraser size={14} />}
      <span className="text-[12px] hidden lg:inline">{label}</span>
    </button>
  )
}

/** Canva "Magic Eraser" — describe an object to wipe from the photo. */
export function MagicEraserPopover({ el }: { el: ImageElement }) {
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  const run = async () => {
    if (!target.trim()) return
    setBusy(true)
    const ok = await runImageAI(el, { mode: 'erase', eraseTarget: target.trim() }, (msg) =>
      toast({ title: 'Magic eraser', description: msg, variant: 'destructive' })
    )
    setBusy(false)
    if (ok) {
      toast({ title: 'Erased', description: `"${target.trim()}" was removed. Ctrl+Z to undo.` })
      setTarget('')
      setOpen(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={btnBase} data-active={open} title="Magic eraser — remove unwanted objects" aria-label="Magic eraser">
          <Sparkles size={14} />
          <span className="text-[12px] hidden lg:inline">Magic eraser</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" side="bottom" className="w-[300px] rounded-2xl bg-[#1A1C22] border-white/10 text-white p-3.5">
        <div className="text-[13px] font-bold mb-1 flex items-center gap-1.5">
          <Wand2 size={13} className="text-[#02C0CC]" /> Magic eraser
        </div>
        <p className="text-[11px] text-white/55 mb-2.5 leading-snug">
          Remove an unwanted object from this photo. Describe it — e.g. &quot;the person in the
          background&quot; or &quot;the trash can on the left&quot;.
        </p>
        <div className="flex gap-1.5">
          <Input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !busy && void run()}
            placeholder="What should disappear?"
            className="h-9 bg-white/5 border-white/10 text-white text-[12px]"
            aria-label="Object to remove"
            maxLength={200}
          />
          <Button className="btn-cv h-9 px-3 shrink-0 text-[12px]" onClick={() => void run()} disabled={busy || !target.trim()}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : 'Erase'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Canva "Image Upscaler / enhancer" — one-click AI photo enhance. */
export function EnhanceButton({ el }: { el: ImageElement }) {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    const ok = await runImageAI(el, { mode: 'enhance' }, (msg) =>
      toast({ title: 'Enhance image', description: msg, variant: 'destructive' })
    )
    setBusy(false)
    if (ok) toast({ title: 'Image enhanced', description: 'Sharper, cleaner photo swapped in. Ctrl+Z to undo.' })
  }
  return (
    <button className={btnBase} onClick={() => void run()} disabled={busy} title="Enhance image — sharpen & clean up with AI" aria-label="Enhance image">
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
      <span className="text-[12px] hidden lg:inline">{busy ? 'Enhancing…' : 'Enhance'}</span>
    </button>
  )
}
