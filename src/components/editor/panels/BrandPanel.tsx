'use client'

import { useRef, useState } from 'react'
import { BookMarked, Wand2, Check, Plus, Palette, ImagePlus, Trash2, Layers, Type } from 'lucide-react'
import { useEditorStore, selectedElements } from '@/store/editor-store'
import { PanelShell } from './panel-shell'
import { DEFAULT_BRAND, type BrandKit, type AnyElement } from '@/lib/types'
import { createImageElement } from '@/lib/types'
import { FONTS } from '@/lib/editor-utils'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

const BRAND_KEY = 'canvix:brandkit'

/** colour distance for "apply brand to page" nearest-colour mapping */
function colorDistance(a: string, b: string): number {
  const hex = (c: string) => {
    const h = c.replace('#', '')
    const f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h
    return [parseInt(f.slice(0, 2), 16) || 0, parseInt(f.slice(2, 4), 16) || 0, parseInt(f.slice(4, 6), 16) || 0]
  }
  const [r1, g1, b1] = hex(a)
  const [r2, g2, b2] = hex(b)
  return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2
}

/** Canva Brand panel — colors, palettes, fonts, logos + apply-brand-style, persisted to localStorage. */
export function BrandPanel() {
  const state = useEditorStore()
  const brand = state.brand
  const setBrand = state.setBrand
  const updateElements = state.updateElements
  const selected = selectedElements(state)
  const logoInputRef = useRef<HTMLInputElement>(null)

  const [local, setLocal] = useState<BrandKit>(() => {
    if (typeof window === 'undefined') return brand ?? DEFAULT_BRAND
    try {
      const saved = localStorage.getItem(BRAND_KEY)
      if (saved) return { ...DEFAULT_BRAND, ...JSON.parse(saved) }
    } catch { /* ignore */ }
    return brand ?? DEFAULT_BRAND
  })

  const persist = (b: BrandKit) => {
    setLocal(b)
    setBrand(b)
    try { localStorage.setItem(BRAND_KEY, JSON.stringify(b)) } catch { /* ignore */ }
  }

  const setColor = (i: number, c: string) => {
    const colors = [...local.colors]
    colors[i] = c
    persist({ ...local, colors })
  }

  const applyColor = (c: string) => {
    if (!selected.length) {
      toast({ title: 'Select an element first' })
      return
    }
    for (const el of selected) {
      if (el.type === 'text' || ['rect', 'ellipse', 'triangle', 'star', 'path'].includes(el.type)) {
        updateElements([el.id], { fill: c })
      } else if (el.type === 'line' || el.type === 'stroke') {
        updateElements([el.id], { stroke: c })
      } else if (el.type === 'sticker') {
        toast({ title: 'Stickers keep their own colours' })
      }
    }
    toast({ title: 'Brand colour applied' })
  }

  const applyFont = (family: string, heading: boolean) => {
    const texts = selected.filter((e) => e.type === 'text')
    if (!texts.length) {
      toast({ title: 'Select a text element first' })
      return
    }
    updateElements(texts.map((t) => t.id), { fontFamily: family, bold: heading })
    toast({ title: `Brand ${heading ? 'heading' : 'body'} font applied` })
  }

  /** canva "apply brand style": recolour every element to its nearest brand colour + swap fonts */
  const applyBrandToPage = () => {
    const s = useEditorStore.getState()
    const page = s.pages[s.currentPage]
    const colors = local.colors
    let recoloured = 0
    let refonted = 0
    for (const el of page.elements) {
      const patch: Partial<Record<string, unknown>> = {}
      const current = fillColorOf(el)
      if (current && colors.length) {
        const nearest = colors.reduce((best, c) => (colorDistance(current, c) < colorDistance(current, best) ? c : best), colors[0])
        if (nearest !== current) {
          if (el.type === 'text' || ['rect', 'ellipse', 'triangle', 'star', 'path'].includes(el.type)) patch.fill = nearest
          else patch.stroke = nearest
          recoloured += 1
        }
      }
      if (el.type === 'text') {
        const big = (el as { fontSize: number }).fontSize >= 48
        const family = big ? local.headingFont : local.bodyFont
        if (family !== (el as { fontFamily: string }).fontFamily) {
          patch.fontFamily = family
          refonted += 1
        }
      }
      if (Object.keys(patch).length) updateElements([el.id], patch)
    }
    toast({ title: `Brand style applied — ${recoloured} recoloured, ${refonted} refonted` })
  }

  const savePalette = () => {
    const palettes = [local.colors, ...(local.palettes ?? [])].slice(0, 8)
    persist({ ...local, palettes })
    toast({ title: 'Palette saved to Brand Kit' })
  }

  const addLogo = async (file: File) => {
    try {
      const src = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = () => reject(new Error('read failed'))
        r.readAsDataURL(file)
      })
      const dims = await new Promise<{ w: number; h: number }>((resolve) => {
        const img = new window.Image()
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
        img.onerror = () => resolve({ w: 240, h: 240 })
        img.src = src
      })
      persist({ ...local, logos: [src, ...(local.logos ?? [])].slice(0, 8) })
      // also place it on canvas
      const s = useEditorStore.getState()
      const scale = Math.min((s.width * 0.25) / dims.w, 1)
      s.addElement(
        createImageElement(src, dims.w, dims.h, {
          x: 40, y: 40,
          width: Math.round(dims.w * scale),
          height: Math.round(dims.h * scale),
        })
      )
      toast({ title: 'Logo saved & added to canvas' })
    } catch {
      toast({ title: 'Could not read logo file', variant: 'destructive' })
    }
  }

  const addLogoToCanvas = (src: string) => {
    const img = new window.Image()
    img.onload = () => {
      const s = useEditorStore.getState()
      const scale = Math.min((s.width * 0.25) / img.naturalWidth, 1)
      s.addElement(
        createImageElement(src, img.naturalWidth, img.naturalHeight, {
          x: 40, y: 40,
          width: Math.round(img.naturalWidth * scale),
          height: Math.round(img.naturalHeight * scale),
        })
      )
    }
    img.src = src
  }

  return (
    <PanelShell title="Brand" subtitle="Your colours, fonts, palettes & logos.">
      <h4 className="mt-2 mb-2 text-xs font-semibold text-white/50 uppercase tracking-wide flex items-center gap-1.5">
        <BookMarked size={13} /> Brand colours
      </h4>
      <div className="grid grid-cols-5 gap-2">
        {local.colors.map((c, i) => (
          <div key={i} className="relative group">
            <label
              className="block w-full aspect-square rounded-full border-2 border-white/15 cursor-pointer overflow-hidden hover:scale-105 transition-transform"
              style={{ background: c }}
              title={`Brand colour ${i + 1}: ${c}`}
            >
              <input
                type="color"
                value={c}
                onChange={(e) => setColor(i, e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                aria-label={`Edit brand colour ${i + 1}`}
              />
            </label>
            <button
              onClick={() => applyColor(c)}
              className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-[#7630D7] text-white items-center justify-center hidden group-hover:flex hover:bg-[#8B5CF6] shadow-lg"
              aria-label={`Apply ${c} to selection`}
              title="Apply to selection"
            >
              <Check size={13} />
            </button>
          </div>
        ))}
      </div>
      <button onClick={savePalette} className="mt-2 text-[11px] text-white/50 hover:text-white inline-flex items-center gap-1">
        <Palette size={11} /> Save current colours as palette
      </button>

      {(local.palettes?.length ?? 0) > 0 && (
        <>
          <h4 className="mt-5 mb-2 text-xs font-semibold text-white/50 uppercase tracking-wide flex items-center gap-1.5">
            <Layers size={13} /> Palettes
          </h4>
          <div className="space-y-1.5">
            {local.palettes!.map((pal, pi) => (
              <div key={pi} className="group flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-1.5 hover:border-[#7630D7]/50 transition-colors">
                <div className="flex gap-1.5 flex-1">
                  {pal.map((c) => (
                    <button
                      key={c}
                      className="h-6 w-6 rounded-full border border-white/20 hover:scale-110 transition-transform"
                      style={{ background: c }}
                      onClick={() => applyColor(c)}
                      title={`Apply ${c}`}
                      aria-label={`Apply ${c}`}
                    />
                  ))}
                </div>
                <button
                  className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-red-400"
                  onClick={() => persist({ ...local, palettes: local.palettes!.filter((_, i) => i !== pi) })}
                  aria-label="Delete palette"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <h4 className="mt-6 mb-2 text-xs font-semibold text-white/50 uppercase tracking-wide flex items-center gap-1.5">
        <Type size={13} /> Brand fonts
      </h4>
      <div className="space-y-2">
        <FontRow
          label="Heading"
          font={local.headingFont}
          onChange={(f) => persist({ ...local, headingFont: f })}
          onApply={() => applyFont(local.headingFont, true)}
        />
        <FontRow
          label="Body"
          font={local.bodyFont}
          onChange={(f) => persist({ ...local, bodyFont: f })}
          onApply={() => applyFont(local.bodyFont, false)}
        />
      </div>

      <h4 className="mt-6 mb-2 text-xs font-semibold text-white/50 uppercase tracking-wide flex items-center gap-1.5">
        <ImagePlus size={13} /> Logos
      </h4>
      <div className="grid grid-cols-4 gap-2">
        {(local.logos ?? []).map((src, i) => (
          <div key={i} className="group relative rounded-lg border border-white/10 bg-[#0F1015] aspect-square overflow-hidden">
            <button onClick={() => addLogoToCanvas(src)} className="w-full h-full flex items-center justify-center" aria-label="Add logo to canvas" title="Add to canvas">
              <img src={src} alt="Brand logo" className="max-w-full max-h-full object-contain p-1" />
            </button>
            <button
              className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 text-white/60 hover:text-red-400 bg-black/50 rounded p-0.5"
              onClick={() => persist({ ...local, logos: local.logos!.filter((_, j) => j !== i) })}
              aria-label="Remove logo"
            >
              <Trash2 size={11} />
            </button>
          </div>
        ))}
        <button
          onClick={() => logoInputRef.current?.click()}
          className="rounded-lg border-2 border-dashed border-white/15 hover:border-[#7630D7] aspect-square flex flex-col items-center justify-center text-white/40 hover:text-white transition-colors"
          aria-label="Upload logo"
        >
          <Plus size={16} />
          <span className="text-[9px] mt-1">Logo</span>
        </button>
        <input
          ref={logoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void addLogo(f)
            e.target.value = ''
          }}
          aria-label="Logo file"
        />
      </div>

      <div className="mt-6 rounded-xl border border-dashed border-white/15 p-4 text-center">
        <div className="text-white/70 text-sm font-semibold">Brand kit preview</div>
        <div className="mt-2 rounded-lg p-3" style={{ background: local.colors[0], color: '#fff' }}>
          <div style={{ fontFamily: local.headingFont, fontWeight: 800, fontSize: 20, lineHeight: 1.1 }}>Aa Your brand heading</div>
          <div style={{ fontFamily: local.bodyFont, fontSize: 12, marginTop: 6, opacity: 0.85 }}>Body text in your brand voice — consistent everywhere.</div>
        </div>
      </div>

      <button
        className="w-full h-10 rounded-xl bg-gradient-to-r from-[#02C0CC] to-[#7630D7] hover:brightness-110 text-white text-[13px] font-semibold mt-3 flex items-center justify-center gap-1.5 transition-all"
        onClick={applyBrandToPage}
      >
        <Wand2 size={14} /> Apply brand style to page
      </button>

      <button
        className="w-full h-9 rounded-xl border border-white/12 hover:bg-white/[0.06] text-white/70 text-[12px] font-semibold mt-2 transition-colors"
        onClick={() => persist(DEFAULT_BRAND)}
      >
        Reset to defaults
      </button>
    </PanelShell>
  )
}

function fillColorOf(el: AnyElement): string | null {
  if (el.type === 'text') return (el as { fill: string }).fill
  if (el.type === 'line' || el.type === 'stroke') return (el as { stroke: string }).stroke
  if (['rect', 'ellipse', 'triangle', 'star', 'path'].includes(el.type)) return (el as { fill: string }).fill
  return null
}

function FontRow({ label, font, onChange, onApply }: { label: string; font: string; onChange: (f: string) => void; onApply: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-white/50 w-14 shrink-0">{label}</span>
      <select
        value={font}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 min-w-0 h-10 rounded-xl bg-white/[0.05] border border-white/10 text-white text-[13px] px-2 outline-none focus:border-[#7630D7] [color-scheme:dark]"
        aria-label={`Brand ${label} font`}
      >
        {FONTS.map((f) => (
          <option key={f.family} value={f.family}>
            {f.label}
          </option>
        ))}
      </select>
      <button
        className={cn('h-10 px-3 rounded-xl border border-white/12 bg-white/[0.05] hover:bg-[#7630D7] hover:border-transparent text-white text-[12px] font-semibold flex items-center gap-1 shrink-0 transition-colors')}
        onClick={onApply}
        title={`Apply as ${label.toLowerCase()} font`}
      >
        <Plus size={13} /> Apply
      </button>
    </div>
  )
}
