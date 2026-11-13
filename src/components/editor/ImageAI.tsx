'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Eraser, Wand2, Loader2, Sparkles, Brush, Maximize2, Accessibility, Cloud, Cpu } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import type { ImageElement } from '@/lib/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'
import { getImageToolsEngine, setImageToolsEngine, IMAGE_TOOL_ENGINES, type ImageToolsEngine } from '@/lib/image-tools-engine'

interface EditResponse {
  dataUrl?: string
  width?: number
  height?: number
  error?: string
  /** scrubbed provider reason (502 PROVIDER_ERROR bodies) — shown to the user */
  detail?: string
  /** v0.19 (Wave 4): structured error codes — SOURCE_NOT_EDITABLE is the
   *  VibesAI-class "only edits its own generations" refusal. */
  code?: string
  /** v0.19 (Wave 4): provider handle of the result (ImageElement.aiEntId) */
  entId?: string
}

/** Pull a human reason out of a provider `detail` string. The API layer
 *  scrubs and forwards the provider's raw error text; when it is JSON
 *  (OpenAI-style {"error":{"message":...}}) extract the message, else
 *  pass the text through. Always capped for toast display. */
function providerReason(detail?: string): string {
  if (!detail) return ''
  try {
    const parsed = JSON.parse(detail.replace(/ \(HTTP \d+\)$/, ''))
    const msg = parsed?.error?.message
    if (typeof msg === 'string' && msg) return msg
  } catch {
    /* not JSON — use as-is */
  }
  return detail
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
 * POST /api/ai/image-edit WITHOUT touching the element — the shared
 * transport under runImageAI and the provider engine of the one-click
 * tools (BG remover, Upscale). Returns either the provider's image or
 * the structured failure the caller decides how to present.
 */
async function editViaProvider(
  el: ImageElement,
  payload: Record<string, unknown>,
): Promise<
  | { ok: true; dataUrl: string; width?: number; height?: number; entId?: string }
  | { ok: false; error?: string; code?: string; detail?: string }
> {
  try {
    const image = await toSendableImage(el.src)
    const res = await fetch('/api/ai/image-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // v0.19 (Wave 4): forward the provider handle so edits of AI-generated
      // images match by id — the byte-hash match breaks on re-encode.
      body: JSON.stringify({
        image,
        naturalWidth: el.naturalWidth,
        naturalHeight: el.naturalHeight,
        ...(el.aiEntId ? { sourceEntId: el.aiEntId } : {}),
        ...payload,
      }),
    })
    const data = (await res.json()) as EditResponse
    if (!res.ok || !data.dataUrl) {
      return { ok: false, error: data.error, code: data.code, detail: data.detail }
    }
    return { ok: true, dataUrl: data.dataUrl, width: data.width, height: data.height, entId: data.entId }
  } catch {
    return { ok: false, error: 'AI image editing is unavailable right now.' }
  }
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
  const r = await editViaProvider(el, payload)
  if (!r.ok) {
    // SOURCE_NOT_EDITABLE (422): the provider only edits its own
    // generations — the route's message already points at the local
    // tools that work on any image.
    const reason = r.code === 'SOURCE_NOT_EDITABLE' ? '' : providerReason(r.detail)
    // v0.23.1: provider failures often mean "no key on the slot" — a
    // nudge toward the user's own keys beats a dead end.
    const byokHint = " Tip: add your own AI key in Profile & AI keys (account menu) — it is used before this instance's providers."
    onDone(
      reason
        ? `${r.error ?? 'The edit failed.'} — ${reason.slice(0, 220)}.${byokHint}`
        : `${r.error ?? 'The edit failed. Please try again.'}${byokHint}`,
    )
    return false
  }
  const w = r.width || el.naturalWidth
  const h = r.height || el.naturalHeight
  // keep on-canvas width; adapt height to the new aspect ratio
  const newHeight = Math.max(4, Math.round(el.width * (h / Math.max(1, w))))
  update([el.id], {
    src: r.dataUrl,
    naturalWidth: w,
    naturalHeight: h,
    height: newHeight,
    // refresh the provider handle — the edit result is the new
    // editable image (cleared when the provider returns none)
    aiEntId: r.entId,
  })
  return true
}

/** v0.22: engine selector for the one-click image tools — Provider
 *  (default: the configured AI provider does the work server-side) or
 *  This device (the local paths: ONNX cut-out / Lanczos resampling).
 *  One shared per-browser preference, persisted across both tools. */
function EngineToggle({ engine, onChange }: { engine: ImageToolsEngine; onChange: (e: ImageToolsEngine) => void }) {
  return (
    <div>
      <div className="flex gap-1 p-0.5 rounded-lg bg-white/[0.06] border border-white/10" role="group" aria-label="Engine — provider or this device">
        {IMAGE_TOOL_ENGINES.map((e) => (
          <button
            key={e.id}
            onClick={() => {
              setImageToolsEngine(e.id)
              onChange(e.id)
            }}
            className={`flex-1 h-7 rounded-md text-[11px] font-semibold inline-flex items-center justify-center gap-1 transition-colors ${
              engine === e.id ? 'bg-[#02C0CC] text-black' : 'text-white/65 hover:text-white'
            }`}
            aria-pressed={engine === e.id}
            data-testid={`engine-${e.id}`}
          >
            {e.id === 'provider' ? <Cloud size={11} /> : <Cpu size={11} />}
            {e.label}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-white/40 mt-1 leading-snug">
        {engine === 'provider'
          ? 'Provider (default) — the configured AI provider does the work server-side.'
          : 'This device — runs locally in your browser, works offline on any image.'}
      </p>
    </div>
  )
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
 *  v0.22: two engines, user-selectable, provider by default —
 *  · Provider: the configured image-edit AI does the cut-out server-side
 *    (no local compute; refuses on VibesAI-class providers that only
 *    edit their own generations — the popover says so)
 *  · This device: a local ONNX segmentation model (true alpha cut-out);
 *    the first use downloads the model (~40 MB) once, then it is cached
 */
export function BgRemoverPopover({ el }: { el: ImageElement }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'model' | 'removing' | 'provider'>('idle')
  const [engine, setEngine] = useState<ImageToolsEngine>('provider')
  const [error, setError] = useState('')

  // re-sync the shared per-browser preference whenever the popover opens
  // (render-time adjust — the React-docs pattern, not an effect)
  const [lastOpen, setLastOpen] = useState(false)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setEngine(getImageToolsEngine())
      setError('')
    }
  }

  /** The on-device path — ONNX segmentation cut-out. */
  const runDevice = async () => {
    const update = useEditorStore.getState().updateElements
    setPhase('model')
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
    return dims
  }

  const run = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    const update = useEditorStore.getState().updateElements
    try {
      if (engine === 'provider') {
        setPhase('provider')
        const r = await editViaProvider(el, { mode: 'bg-remove' })
        if (r.ok) {
          const dims = await imageSize(r.dataUrl)
          const w = r.width || dims.w
          const h = r.height || dims.h
          const newHeight = Math.max(4, Math.round(el.width * (h / Math.max(1, w))))
          update([el.id], {
            src: r.dataUrl,
            naturalWidth: w,
            naturalHeight: h,
            height: newHeight,
            aiEntId: r.entId,
          })
          toast({ title: 'Background removed', description: 'Provider cut-out swapped in. Ctrl+Z to undo.' })
          setOpen(false)
        } else if (r.code === 'SOURCE_NOT_EDITABLE') {
          setError(
            'This provider only edits images it generated itself. Switch the engine to This device — the local cut-out works on any image.',
          )
        } else if (r.code === 'NO_PROVIDER' || r.code === 'FEATURE_DISABLED') {
          setError(
            'No AI provider is configured on this server. Switch the engine to This device — the local model works offline (first use downloads ~40 MB).',
          )
        } else {
          const reason = providerReason(r.detail)
          setError(reason ? `${r.error ?? 'The edit failed.'} — ${reason.slice(0, 220)}` : (r.error ?? 'The edit failed. Please try again.'))
        }
      } else {
        await runDevice()
        toast({ title: 'Background removed', description: 'On-device cut-out replaced your image. Ctrl+Z to undo.' })
        setOpen(false)
      }
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

  const label = busy
    ? phase === 'provider'
      ? 'Removing…'
      : phase === 'model'
        ? 'Loading model…'
        : 'Removing…'
    : 'BG Remover'
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={btnBase} data-active={open} disabled={busy} title="BG Remover — remove the image background" aria-label="Remove background">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Eraser size={14} />}
          <span className="text-[12px] hidden lg:inline">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" side="bottom" className="w-[300px] rounded-2xl bg-[#1A1C22] border-white/10 text-white p-3.5">
        <div className="text-[13px] font-bold mb-1 flex items-center gap-1.5">
          <Eraser size={13} className="text-[#02C0CC]" /> BG Remover
        </div>
        <p className="text-[11px] text-white/55 mb-2.5 leading-snug">
          One click — the background disappears, the subject stays. Choose who does the work:
        </p>
        <div className="mb-2.5">
          <EngineToggle engine={engine} onChange={setEngine} />
        </div>
        {error && (
          <p className="text-[11px] text-[#FF8A8A] mb-2 leading-snug" data-testid="bg-remover-error" role="alert">
            {error}
          </p>
        )}
        <Button className="btn-cv w-full h-9 text-[12px]" onClick={() => void run()} disabled={busy}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : 'Remove background'}
        </Button>
      </PopoverContent>
    </Popover>
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

/** ── v0.19 (Wave 4): local image power tools ───────────────────
 *  Both run entirely in the browser on ANY image — uploads, stock
 *  photos, AI generations — no provider, no network, no model
 *  download. This is the universal path: VibesAI-class edit providers
 *  only edit images they generated themselves (422 otherwise). */

/** dataURL → HTMLImageElement (decoded) */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode the image'))
    img.src = src
  })
}

/** Raster bytes → ImageData. TS's ImageData ctor wants
 *  Uint8ClampedArray<ArrayBuffer>; a fresh copy satisfies it on every
 *  TS version (and costs nothing next to the resample itself). */
function toImageData(data: Uint8ClampedArray, w: number, h: number): ImageData {
  const copy = new Uint8ClampedArray(data.byteLength)
  copy.set(data)
  return new ImageData(copy, w, h)
}

/**
 * Deterministic Lanczos resize of a dataURL image to exact target
 * dimensions (both engines' final sizing step — v0.22).
 */
async function lanczosTo(dataUrl: string, targetW: number, targetH: number): Promise<{ dataUrl: string; width: number; height: number }> {
  const { lanczosResize } = await import('@/lib/upscale')
  const img = await loadImage(dataUrl)
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (w === targetW && h === targetH) return { dataUrl, width: w, height: h }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas is unavailable')
  ctx.drawImage(img, 0, 0)
  const inData = ctx.getImageData(0, 0, w, h)
  const out = lanczosResize({ data: inData.data, width: w, height: h }, targetW, targetH)
  canvas.width = out.width
  canvas.height = out.height
  ctx.putImageData(toImageData(out.data, out.width, out.height), 0, 0)
  return { dataUrl: canvas.toDataURL('image/png'), width: out.width, height: out.height }
}

/**
 * Canva-style "Upscale" — 2×/4× enlargement with alpha discipline.
 * v0.22: two engines, user-selectable, provider by default —
 * · Provider: the image-edit AI re-renders the image with restored
 *   detail at its supported sizes (only attempted when it adds pixels),
 *   then the deterministic Lanczos pass finishes to the advertised
 *   target. When no provider is configured the local pass runs alone.
 * · This device: the Lanczos-3 pass only, exactly as before.
 */
export function UpscaleButton({ el }: { el: ImageElement }) {
  const [busy, setBusy] = useState(false)
  const [factor, setFactor] = useState<2 | 4>(2)
  const [open, setOpen] = useState(false)
  const [engine, setEngine] = useState<ImageToolsEngine>('provider')
  const [error, setError] = useState('')

  // re-sync the shared per-browser preference whenever the popover opens
  // (render-time adjust — the React-docs pattern, not an effect)
  const [lastOpen, setLastOpen] = useState(false)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setEngine(getImageToolsEngine())
      setError('')
    }
  }

  const run = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    const update = useEditorStore.getState().updateElements
    try {
      const { factorFor } = await import('@/lib/upscale')
      const sendable = await toSendableImage(el.src)
      const img = await loadImage(sendable)
      const src = { width: img.naturalWidth, height: img.naturalHeight }
      const f = factorFor(src.width, src.height, factor)
      if (f === 1) {
        toast({
          title: 'Upscale',
          description: `This image is already at the size cap (${src.width}×${src.height}px).`,
        })
        return
      }
      const origTarget = {
        width: Math.min(8192, src.width * f),
        height: Math.min(8192, src.height * f),
      }

      // base the enlargement starts from — the original unless the
      // provider engine contributes a higher-detail re-render
      let base = { dataUrl: sendable, width: src.width, height: src.height }
      let usedProvider = false
      let fellBackNote = ''
      let providerEntId: string | undefined

      if (engine === 'provider') {
        // The provider re-renders at ~1 MP — only worth the call when it
        // actually adds pixels over the source. Above that, Lanczos alone
        // is the honest enlargement (and the toast says so).
        if (src.width * src.height < 1_000_000) {
          const r = await editViaProvider(el, { mode: 'upscale' })
          if (r.ok) {
            const dims = await imageSize(r.dataUrl)
            if (dims.w * dims.h > src.width * src.height) {
              base = { dataUrl: r.dataUrl, width: dims.w, height: dims.h }
              usedProvider = true
              providerEntId = r.entId
            }
          } else if (r.code === 'NO_PROVIDER' || r.code === 'FEATURE_DISABLED') {
            // nothing configured server-side — the deterministic pass IS
            // the tool; say so instead of failing
            fellBackNote = ' No AI provider configured — enlarged on this device.'
          } else if (r.code === 'SOURCE_NOT_EDITABLE') {
            setError(
              'This provider only edits images it generated itself. Switch the engine to This device — Lanczos enlarges any image.',
            )
            return
          } else {
            const reason = providerReason(r.detail)
            setError(reason ? `${r.error ?? 'The edit failed.'} — ${reason.slice(0, 220)}` : (r.error ?? 'The edit failed. Please try again.'))
            return
          }
        } else {
          fellBackNote = ' Already above the provider re-render size — enlarged on this device.'
        }
      }

      // deterministic finish — land on the advertised multiple of the base
      const target = usedProvider
        ? { width: Math.min(8192, base.width * f), height: Math.min(8192, base.height * f) }
        : origTarget
      const out = await lanczosTo(base.dataUrl, target.width, target.height)
      const newHeight = Math.max(4, Math.round(el.width * (out.height / Math.max(1, out.width))))
      update([el.id], {
        src: out.dataUrl,
        naturalWidth: out.width,
        naturalHeight: out.height,
        height: newHeight,
        // refresh the provider handle when the provider re-rendered the
        // image — the result is the new provider-owned editable
        ...(providerEntId ? { aiEntId: providerEntId } : {}),
      })
      toast({
        title: `Upscaled ${f}×`,
        description:
          `${base.width}×${base.height} → ${out.width}×${out.height}px` +
          `${usedProvider ? ' (provider re-render + Lanczos finish)' : ''}.${fellBackNote} Ctrl+Z to undo.`,
      })
      setOpen(false)
    } catch (e) {
      toast({
        title: 'Upscale',
        description: e instanceof Error ? e.message : 'Could not upscale this image.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  const target = `${Math.min(8192, el.naturalWidth * factor)}×${Math.min(8192, el.naturalHeight * factor)}`
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={btnBase} data-active={open} title="Upscale — enlarge this image (provider or on-device)" aria-label="Upscale image">
          <Maximize2 size={14} />
          <span className="text-[12px] hidden lg:inline">Upscale</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" side="bottom" className="w-[300px] rounded-2xl bg-[#1A1C22] border-white/10 text-white p-3.5">
        <div className="text-[13px] font-bold mb-1 flex items-center gap-1.5">
          <Maximize2 size={13} className="text-[#02C0CC]" /> Upscale
        </div>
        <p className="text-[11px] text-white/55 mb-2.5 leading-snug">
          Enlarge to {target}px with alpha discipline. Now {el.naturalWidth}×{el.naturalHeight}px.
        </p>
        <div className="mb-2.5">
          <EngineToggle engine={engine} onChange={setEngine} />
        </div>
        {error && (
          <p className="text-[11px] text-[#FF8A8A] mb-2 leading-snug" data-testid="upscale-error" role="alert">
            {error}
          </p>
        )}
        <div className="flex gap-1.5 mb-2.5">
          {([2, 4] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFactor(f)}
              className={`flex-1 h-9 rounded-lg text-[12px] font-semibold border transition-colors ${
                factor === f ? 'bg-[#02C0CC] text-black border-[#02C0CC]' : 'bg-white/5 border-white/10 text-white/80 hover:bg-white/10'
              }`}
              aria-pressed={factor === f}
            >
              {f}× → {Math.min(8192, el.naturalWidth * f)}px
            </button>
          ))}
        </div>
        <Button className="btn-cv w-full h-9 text-[12px]" onClick={() => void run()} disabled={busy}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : `Upscale to ${target}`}
        </Button>
      </PopoverContent>
    </Popover>
  )
}

/** Canva-style "Brush eraser" — paint over unwanted objects; the region
 *  is reconstructed from its surroundings (local pyramid-diffusion
 *  inpainting — no model download, no provider, works offline). */
export function BrushEraserDialog({ el }: { el: ImageElement }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [brush, setBrush] = useState(36)
  const [painted, setPainted] = useState(false)
  const baseRef = useRef<HTMLCanvasElement | null>(null)
  const maskRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const painting = useRef(false)
  const lastPt = useRef<{ x: number; y: number } | null>(null)
  /** display geometry, set when the image decodes */
  const [disp, setDisp] = useState<{ w: number; h: number } | null>(null)

  // (re)draw the base image whenever the dialog opens / element changes
  useEffect(() => {
    if (!open || !baseRef.current || !maskRef.current) return
    let cancelled = false
    setPainted(false)
    ;(async () => {
      try {
        const sendable = await toSendableImage(el.src)
        const img = await loadImage(sendable)
        if (cancelled) return
        // fit inside ~62vh / 640px while preserving the aspect ratio
        const maxW = 640
        const maxH = Math.round(window.innerHeight * 0.62)
        const s = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1)
        const w = Math.max(80, Math.round(img.naturalWidth * s))
        const h = Math.max(80, Math.round(img.naturalHeight * s))
        setDisp({ w, h })
        const base = baseRef.current!
        const mask = maskRef.current!
        base.width = w
        base.height = h
        mask.width = w
        mask.height = h
        const bctx = base.getContext('2d')
        const mctx = mask.getContext('2d')
        if (!bctx || !mctx) return
        bctx.clearRect(0, 0, w, h)
        bctx.drawImage(img, 0, 0, w, h)
        mctx.clearRect(0, 0, w, h)
      } catch {
        /* decode failure leaves disp null → the hint stays visible */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, el.src])

  const drawMaskStroke = useCallback(
    (x: number, y: number) => {
      const mask = maskRef.current
      if (!mask) return
      const ctx = mask.getContext('2d')
      if (!ctx) return
      ctx.fillStyle = 'rgba(255,0,128,0.85)'
      const r = brush / 2
      // full-opacity stroke: keep painting round dots along the move path
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      const lp = lastPt.current
      if (lp) {
        // interpolate between events so fast strokes stay continuous
        const d = Math.hypot(x - lp.x, y - lp.y)
        const steps = Math.max(1, Math.floor(d / (r * 0.5)))
        for (let i = 1; i < steps; i++) {
          const ix = lp.x + ((x - lp.x) * i) / steps
          const iy = lp.y + ((y - lp.y) * i) / steps
          ctx.beginPath()
          ctx.arc(ix, iy, r, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      lastPt.current = { x, y }
      setPainted(true)
    },
    [brush],
  )

  const pointerPos = (e: React.PointerEvent): { x: number; y: number } | null => {
    const mask = maskRef.current
    if (!mask) return null
    const rect = mask.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * mask.width,
      y: ((e.clientY - rect.top) / rect.height) * mask.height,
    }
  }

  const clearMask = () => {
    const mask = maskRef.current
    const ctx = mask?.getContext('2d')
    if (mask && ctx) ctx.clearRect(0, 0, mask.width, mask.height)
    setPainted(false)
  }

  const run = async () => {
    if (busy || !painted || !disp) return
    setBusy(true)
    const update = useEditorStore.getState().updateElements
    try {
      const { inpaint } = await import('@/lib/inpaint')
      const sendable = await toSendableImage(el.src)
      const img = await loadImage(sendable)
      const w = img.naturalWidth
      const h = img.naturalHeight
      // decode the source at natural resolution
      const srcCanvas = document.createElement('canvas')
      srcCanvas.width = w
      srcCanvas.height = h
      const sctx = srcCanvas.getContext('2d', { willReadFrequently: true })
      if (!sctx) throw new Error('Canvas is unavailable')
      sctx.drawImage(img, 0, 0)
      const srcData = sctx.getImageData(0, 0, w, h)
      // scale the painted mask up to natural resolution
      const maskCanvas = document.createElement('canvas')
      maskCanvas.width = w
      maskCanvas.height = h
      const mctx = maskCanvas.getContext('2d', { willReadFrequently: true })
      if (!mctx) throw new Error('Canvas is unavailable')
      mctx.imageSmoothingEnabled = false
      mctx.drawImage(maskRef.current!, 0, 0, w, h)
      const maskData = mctx.getImageData(0, 0, w, h)
      // run the reconstruction on the main thread — hole sizes are
      // brush-scale, and the yields below keep the tab responsive
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      const out = inpaint(
        { data: srcData.data, width: w, height: h },
        { data: maskData.data, width: w, height: h },
      )
      srcCanvas.width = w
      srcCanvas.height = h
      sctx.putImageData(toImageData(out.data, w, h), 0, 0)
      const dataUrl = srcCanvas.toDataURL('image/png')
      update([el.id], { src: dataUrl })
      toast({
        title: 'Erased',
        description: 'The painted region was reconstructed. Ctrl+Z to undo.',
      })
      setOpen(false)
    } catch (e) {
      toast({
        title: 'Brush eraser',
        description: e instanceof Error ? e.message : 'Could not erase. Please try again.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button className={btnBase} onClick={() => setOpen(true)} title="Brush eraser — paint over anything to remove it" aria-label="Brush eraser">
        <Brush size={14} />
        <span className="text-[12px] hidden lg:inline">Brush eraser</span>
      </button>
      <DialogContent className="max-w-[720px] rounded-2xl bg-[#14161B] border-white/10 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5 text-[15px]">
            <Brush size={15} className="text-[#02C0CC]" /> Brush eraser
          </DialogTitle>
        </DialogHeader>
        <p className="text-[12px] text-white/55 -mt-1 mb-2 leading-snug">
          Paint over whatever should disappear — people, objects, watermarks. The region is rebuilt from
          its surroundings, entirely on your device (works offline, on any image).
        </p>
        <div
          ref={wrapRef}
          className="relative mx-auto select-none touch-none rounded-xl overflow-hidden border border-white/10 bg-[repeating-conic-gradient(#20242c_0%_25%,#181b21_0%_50%)] bg-[length:16px_16px]"
          style={{ width: disp ? disp.w : undefined, height: disp ? disp.h : undefined, cursor: 'crosshair' }}
        >
          <canvas ref={baseRef} className="block max-w-full" />
          <canvas
            ref={maskRef}
            className="absolute inset-0 w-full h-full"
            style={{ cursor: 'crosshair' }}
            aria-label="Erase brush area"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              painting.current = true
              lastPt.current = null
              const p = pointerPos(e)
              if (p) drawMaskStroke(p.x, p.y)
            }}
            onPointerMove={(e) => {
              if (!painting.current) return
              const p = pointerPos(e)
              if (p) drawMaskStroke(p.x, p.y)
            }}
            onPointerUp={() => {
              painting.current = false
              lastPt.current = null
            }}
            onPointerCancel={() => {
              painting.current = false
              lastPt.current = null
            }}
          />
          {!disp && (
            <div className="flex items-center justify-center h-56 text-[12px] text-white/45">Decoding image…</div>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-[11px] text-white/55 shrink-0">Brush</span>
          <input
            type="range"
            min={8}
            max={120}
            value={brush}
            onChange={(e) => setBrush(Number(e.target.value))}
            className="flex-1 accent-[#02C0CC]"
            aria-label="Brush size"
          />
          <span className="text-[11px] text-white/40 w-8 text-right">{brush}px</span>
          <button
            className="text-[11px] text-white/55 hover:text-white px-2 h-7 rounded-md hover:bg-white/10"
            onClick={clearMask}
          >
            Clear
          </button>
        </div>
        <div className="flex justify-end gap-2 mt-1">
          <Button variant="ghost" className="h-9 text-[12px] text-white/70 hover:text-white" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button className="btn-cv h-9 px-4 text-[12px]" onClick={() => void run()} disabled={busy || !painted}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : 'Erase painted area'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** ── v0.19 (Wave 4): accessibility alt text ──────────────────── */

/** Alt-text editor + AI suggestion for the selected image. The stored
 *  value (ImageElement.alt) feeds screen-reader landmarks; the AI draft
 *  is a SUGGESTION the user reviews/edits before saving. */
export function AltTextPopover({ el }: { el: ImageElement }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(el.alt ?? '')
  const [busy, setBusy] = useState(false)

  // re-sync when the selection moves to another element / the element's
  // alt changes elsewhere — the render-time adjust pattern (React docs),
  // not an effect
  const [lastAlt, setLastAlt] = useState(el.alt ?? '')
  if ((el.alt ?? '') !== lastAlt) {
    setLastAlt(el.alt ?? '')
    setValue(el.alt ?? '')
  }

  const update = useEditorStore.getState().updateElements

  const generate = async () => {
    if (busy) return
    setBusy(true)
    try {
      const image = await toSendableImage(el.src)
      const res = await fetch('/api/ai/alt-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image }),
      })
      const data = (await res.json()) as { alt?: string; error?: string }
      if (!res.ok || !data.alt) throw new Error(data.error ?? 'Generation failed')
      setValue(data.alt)
    } catch (e) {
      toast({
        title: 'Alt text',
        description: e instanceof Error ? e.message : 'Could not generate. Try again.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  const save = () => {
    const alt = value.trim().slice(0, 200)
    update([el.id], alt ? { alt } : { alt: undefined })
    toast({ title: alt ? 'Alt text saved' : 'Alt text cleared', description: 'Used by screen readers — never shown visually.' })
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={btnBase} data-active={open} title="Alt text — describe this image for screen readers" aria-label="Alt text">
          <Accessibility size={14} />
          <span className="text-[12px] hidden lg:inline">Alt</span>
          {el.alt ? <span className="w-1.5 h-1.5 rounded-full bg-[#02C0CC]" title="Has alt text" /> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" side="bottom" className="w-[300px] rounded-2xl bg-[#1A1C22] border-white/10 text-white p-3.5">
        <div className="text-[13px] font-bold mb-1 flex items-center gap-1.5">
          <Accessibility size={13} className="text-[#02C0CC]" /> Alt text
        </div>
        <p className="text-[11px] text-white/55 mb-2.5 leading-snug">
          One sentence describing what is in the image — read aloud by screen readers, required for accessible
          exports.
        </p>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. A barista pouring latte art in a sunlit café"
          className="w-full h-20 resize-none rounded-lg bg-white/5 border border-white/10 px-2.5 py-2 text-[12px] text-white/85 placeholder:text-white/30 focus:outline-none focus:border-[#02C0CC]"
          aria-label="Alt text"
          maxLength={200}
          data-testid="alt-text-input"
        />
        <div className="flex gap-1.5 mt-2.5">
          <Button
            variant="ghost"
            className="h-9 px-3 text-[12px] text-white/70 hover:text-white border border-white/10"
            onClick={() => void generate()}
            disabled={busy}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} className="text-[#02C0CC]" />}
            Generate
          </Button>
          <Button className="btn-cv h-9 px-3 ml-auto text-[12px]" onClick={save}>
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
