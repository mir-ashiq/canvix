'use client'

import { useMemo, useRef, useState } from 'react'
import { Crop, RotateCcw, Check } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useEditorStore } from '@/store/editor-store'
import { useLoadedImage } from './canvas/use-loaded-image'
import type { ImageElement } from '@/lib/types'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

/** canva-style image crop: drag (or draw) a crop rect over the image, pick an aspect, apply. */

interface Rect { x: number; y: number; w: number; h: number }
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move'

const ASPECTS: { id: string; label: string; ratio: number | null }[] = [
  { id: 'free', label: 'Free', ratio: null },
  { id: 'orig', label: 'Original', ratio: 0 }, // resolved per image
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '2:3', label: '2:3', ratio: 2 / 3 },
]

const BOX_W = 540
const BOX_H = 350
const MIN_CROP = 16

export function CropDialog({ element, open, onOpenChange }: { element: ImageElement; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[28px] bg-[#16181D] border-white/10 text-white sm:max-w-2xl">
        {/* keyed inner: every dialog open / image switch starts from a full frame */}
        {open && <CropDialogInner key={element.id} element={element} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function CropDialogInner({ element, onClose }: { element: ImageElement; onClose: () => void }) {
  const updateElements = useEditorStore((s) => s.updateElements)
  const image = useLoadedImage(element.src)

  const natW = image?.naturalWidth ?? (element.naturalWidth || 1)
  const natH = image?.naturalHeight ?? (element.naturalHeight || 1)

  // display scale: fit the image inside the dialog box
  const fit = useMemo(() => {
    const s = Math.min(BOX_W / natW, BOX_H / natH)
    return { w: Math.max(1, Math.round(natW * s)), h: Math.max(1, Math.round(natH * s)) }
  }, [natW, natH])

  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: fit.w, h: fit.h })
  const [aspectId, setAspectId] = useState('free')
  const dragRef = useRef<{ handle: Handle; startX: number; startY: number; rect: Rect } | null>(null)

  const origRatio = natW / natH
  const aspect = aspectId === 'free' ? null : aspectId === 'orig' ? origRatio : (ASPECTS.find((a) => a.id === aspectId)?.ratio ?? null)

  const clampRect = (r: Rect): Rect => {
    const w = Math.min(fit.w, Math.max(MIN_CROP, r.w))
    const h = Math.min(fit.h, Math.max(MIN_CROP, r.h))
    return {
      w,
      h,
      x: Math.min(Math.max(0, r.x), fit.w - w),
      y: Math.min(Math.max(0, r.y), fit.h - h),
    }
  }

  const onHandleDown = (handle: Handle) => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = { handle, startX: e.clientX, startY: e.clientY, rect: { ...rect } }
    const base = dragRef.current.rect

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - dragRef.current!.startX
      const dy = ev.clientY - dragRef.current!.startY
      if (dragRef.current!.handle === 'move') {
        setRect(clampRect({ ...base, x: base.x + dx, y: base.y + dy }))
        return
      }
      let left = base.x
      let top = base.y
      let right = base.x + base.w
      let bottom = base.y + base.h
      if (handle.includes('w')) left = Math.min(right - MIN_CROP, base.x + dx)
      if (handle.includes('e')) right = Math.max(left + MIN_CROP, right + dx)
      if (handle.includes('n')) top = Math.min(bottom - MIN_CROP, base.y + dy)
      if (handle.includes('s')) bottom = Math.max(top + MIN_CROP, bottom + dy)
      if (aspect) {
        // keep the locked ratio anchored at the opposite edge
        const anchorX = handle.includes('w') ? right : left
        const anchorY = handle.includes('n') ? bottom : top
        let w = Math.max(MIN_CROP, Math.abs(right - left))
        let h = w / aspect
        if (h > fit.h) { h = fit.h; w = h * aspect }
        if (w > fit.w) { w = fit.w; h = w / aspect }
        left = handle.includes('w') ? anchorX - w : anchorX
        top = handle.includes('n') ? anchorY - h : anchorY
        right = left + w
        bottom = top + h
      }
      setRect(clampRect({ x: left, y: top, w: right - left, h: bottom - top }))
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /** clicking outside the crop rect starts a brand-new rect (canva behaviour) */
  const onStageDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const r = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - r.left
    const py = e.clientY - r.top
    const inside = px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h
    if (inside) {
      onHandleDown('move')(e)
      return
    }
    e.preventDefault()
    e.stopPropagation()
    const startX = px
    const startY = py
    const onMove = (ev: PointerEvent) => {
      const cx = ev.clientX - r.left
      const cy = ev.clientY - r.top
      if (aspect) {
        let w = Math.abs(cx - startX)
        let h = w / aspect
        if (h > fit.h) { h = fit.h; w = h * aspect }
        if (w > fit.w) { w = fit.w; h = w / aspect }
        setRect(clampRect({
          x: cx < startX ? startX - w : startX,
          y: cy < startY ? startY - h : startY,
          w,
          h,
        }))
      } else {
        setRect(clampRect({
          x: Math.min(startX, cx),
          y: Math.min(startY, cy),
          w: Math.abs(cx - startX),
          h: Math.abs(cy - startY),
        }))
      }
    }
    const onUp = () => {
      // a click without a real drag restores the full frame
      setRect((cur) => (cur.w < MIN_CROP || cur.h < MIN_CROP ? { x: 0, y: 0, w: fit.w, h: fit.h } : cur))
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const applyAspect = (id: string) => {
    setAspectId(id)
    const ratio = id === 'free' ? null : id === 'orig' ? origRatio : (ASPECTS.find((a) => a.id === id)?.ratio ?? null)
    if (ratio === null) return
    // largest centered rect with this ratio
    let w = fit.w
    let h = w / ratio
    if (h > fit.h) {
      h = fit.h
      w = h * ratio
    }
    setRect({ x: Math.round((fit.w - w) / 2), y: Math.round((fit.h - h) / 2), w: Math.round(w), h: Math.round(h) })
  }

  const reset = () => {
    setAspectId('free')
    setRect({ x: 0, y: 0, w: fit.w, h: fit.h })
  }

  const outW = Math.max(1, Math.round((rect.w / fit.w) * natW))
  const outH = Math.max(1, Math.round((rect.h / fit.h) * natH))

  const apply = () => {
    if (!image) return
    try {
      const scaleX = natW / fit.w
      const scaleY = natH / fit.h
      const cx = Math.max(0, Math.round(rect.x * scaleX))
      const cy = Math.max(0, Math.round(rect.y * scaleY))
      const cw = Math.min(natW - cx, Math.max(1, Math.round(rect.w * scaleX)))
      const ch = Math.min(natH - cy, Math.max(1, Math.round(rect.h * scaleY)))
      const out = document.createElement('canvas')
      out.width = cw
      out.height = ch
      const ctx = out.getContext('2d')
      if (!ctx) return
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      // bake current flips into the cropped bitmap
      if (element.flipH) {
        ctx.translate(cw, 0)
        ctx.scale(-1, 1)
      }
      if (element.flipV) {
        ctx.translate(0, ch)
        ctx.scale(1, -1)
      }
      ctx.drawImage(image, cx, cy, cw, ch, 0, 0, cw, ch)
      const isJpeg = element.src.startsWith('data:image/jpeg')
      const src = isJpeg ? out.toDataURL('image/jpeg', 0.92) : out.toDataURL('image/png')
      // keep the on-canvas display scale of the kept region
      const displayScale = element.width / (element.naturalWidth || natW || 1)
      updateElements([element.id], {
        src,
        naturalWidth: cw,
        naturalHeight: ch,
        width: Math.max(4, Math.round(cw * displayScale)),
        height: Math.max(4, Math.round(ch * displayScale)),
        flipH: false,
        flipV: false,
      })
      onClose()
      toast({ title: 'Image cropped' })
    } catch {
      toast({ title: 'Could not crop this image', description: 'It may be from a site that blocks pixel access.' })
    }
  }

  const handles: { id: Handle; style: React.CSSProperties; cursor: string }[] = [
    { id: 'nw', style: { left: -6, top: -6 }, cursor: 'nwse-resize' },
    { id: 'n', style: { left: rect.w / 2 - 5, top: -6 }, cursor: 'ns-resize' },
    { id: 'ne', style: { right: -6, top: -6 }, cursor: 'nesw-resize' },
    { id: 'e', style: { right: -6, top: rect.h / 2 - 5 }, cursor: 'ew-resize' },
    { id: 'se', style: { right: -6, bottom: -6 }, cursor: 'nwse-resize' },
    { id: 's', style: { left: rect.w / 2 - 5, bottom: -6 }, cursor: 'ns-resize' },
    { id: 'sw', style: { left: -6, bottom: -6 }, cursor: 'nesw-resize' },
    { id: 'w', style: { left: -6, top: rect.h / 2 - 5 }, cursor: 'ew-resize' },
  ]

  return (
    <div className="flex flex-col items-center gap-3">
      <DialogHeader className="text-left w-full">
        <DialogTitle className="flex items-center gap-2">
          <Crop size={18} className="text-[#02C0CC]" /> Crop image
        </DialogTitle>
        <DialogDescription className="text-white/55">
          Drag the handles, or draw a brand-new area anywhere outside the current one — aspect presets lock the shape.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col items-center gap-3">
        {/* crop stage */}
        <div
          className="relative overflow-hidden rounded-xl bg-black/40 touch-none select-none"
          style={{ width: fit.w, height: fit.h, cursor: 'crosshair' }}
          onPointerDown={onStageDown}
        >
          {image && (
            <img
              src={element.src}
              alt="Crop source"
              draggable={false}
              className="absolute inset-0 pointer-events-none"
              style={{ width: fit.w, height: fit.h }}
            />
          )}
          {/* the crop rect's huge box-shadow dims everything around it */}
          <div
            className="absolute cursor-move"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.w,
              height: rect.h,
              boxShadow: '0 0 0 100000px rgba(0,0,0,0.55)',
              border: '1.5px solid #FFFFFF',
            }}
          >
            {/* rule-of-thirds hints */}
            <div className="absolute inset-0 pointer-events-none" style={{
              background:
                'linear-gradient(to right, transparent calc(33.33% - 0.5px), rgba(255,255,255,0.25) 33.33%, transparent calc(33.33% + 0.5px)),' +
                'linear-gradient(to right, transparent calc(66.66% - 0.5px), rgba(255,255,255,0.25) 66.66%, transparent calc(66.66% + 0.5px)),' +
                'linear-gradient(to bottom, transparent calc(33.33% - 0.5px), rgba(255,255,255,0.25) 33.33%, transparent calc(33.33% + 0.5px)),' +
                'linear-gradient(to bottom, transparent calc(66.66% - 0.5px), rgba(255,255,255,0.25) 66.66%, transparent calc(66.66% + 0.5px))',
            }} />
            {handles.map((h) => (
              <div
                key={h.id}
                onPointerDown={onHandleDown(h.id)}
                className="absolute w-[11px] h-[11px] rounded-[3px] bg-white border-2 border-[#7630D7] shadow"
                style={{ ...h.style, cursor: h.cursor, touchAction: 'none' }}
                aria-label={`Crop handle ${h.id}`}
              />
            ))}
          </div>
        </div>

        {/* aspect presets */}
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {ASPECTS.map((a) => (
            <button
              key={a.id}
              onClick={() => applyAspect(a.id)}
              className={cn(
                'h-8 px-3 rounded-full text-[12px] font-semibold transition-colors',
                aspectId === a.id ? 'bg-[#7630D7] text-white' : 'bg-white/[0.08] text-white/75 hover:bg-white/[0.14]'
              )}
            >
              {a.label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between w-full">
          <span className="text-[12px] text-white/55 font-medium tabular-nums">
            {outW} × {outH} px
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-white/80 hover:bg-white/10 hover:text-white rounded-xl"
              onClick={reset}
            >
              <RotateCcw size={14} /> Reset
            </Button>
            <Button size="sm" className="btn-cv-white h-9 px-5 rounded-xl font-semibold" onClick={apply} disabled={!image}>
              <Check size={15} /> Apply crop
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
