'use client'

import { useState } from 'react'
import { BookMarked, Wand2, Check, Plus } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { selectedElements } from '@/store/editor-store'
import { PanelShell } from './panel-shell'
import { DEFAULT_BRAND, type BrandKit } from '@/lib/types'
import { FONTS } from '@/lib/editor-utils'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

const BRAND_KEY = 'canvix:brandkit'

/** Canva Brand panel — brand colors + fonts, apply to selection, persisted to localStorage. */
export function BrandPanel() {
  const state = useEditorStore()
  const brand = state.brand
  const setBrand = state.setBrand
  const updateElements = state.updateElements
  const selected = selectedElements(state)

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
    const ids = selected.map((e) => e.id)
    const patches = selected.map((el) => {
      if (el.type === 'text' || (el.type.startsWith('rect') || ['ellipse', 'triangle', 'star', 'path'].includes(el.type))) {
        return { fill: c }
      }
      if (el.type === 'line') return { stroke: c }
      return {}
    })
    // single uniform patch when possible
    const uniform = patches.every((p) => JSON.stringify(p) === JSON.stringify(patches[0]))
    if (uniform) updateElements(ids, patches[0])
    else selected.forEach((el, i) => updateElements([el.id], patches[i]))
    toast({ title: 'Brand color applied' })
  }

  const applyFont = (family: string, heading: boolean) => {
    const texts = selected.filter((e) => e.type === 'text')
    if (!texts.length) {
      toast({ title: 'Select a text element first' })
      return
    }
    updateElements(
      texts.map((t) => t.id),
      { fontFamily: family, bold: heading }
    )
    toast({ title: `Brand ${heading ? 'heading' : 'body'} font applied` })
  }

  return (
    <PanelShell title="Brand" subtitle="Your colors and fonts, applied anywhere.">
      <h4 className="mt-2 mb-2 text-xs font-semibold text-white/50 uppercase tracking-wide flex items-center gap-1.5">
        <BookMarked size={13} /> Brand colors
      </h4>
      <div className="grid grid-cols-5 gap-2">
        {local.colors.map((c, i) => (
          <div key={i} className="relative group">
            <label
              className="block w-full aspect-square rounded-xl border-2 border-white/15 cursor-pointer overflow-hidden hover:scale-105 transition-transform"
              style={{ background: c }}
              title={`Brand color ${i + 1}: ${c}`}
            >
              <input
                type="color"
                value={c}
                onChange={(e) => setColor(i, e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                aria-label={`Edit brand color ${i + 1}`}
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
      <p className="text-[11px] text-white/40 mt-2">Click a swatch to edit • hover and hit ✓ to apply to selection</p>

      <h4 className="mt-6 mb-2 text-xs font-semibold text-white/50 uppercase tracking-wide flex items-center gap-1.5">
        <Wand2 size={13} /> Brand fonts
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

      <div className="mt-6 rounded-xl border border-dashed border-white/15 p-4 text-center">
        <div className="text-white/70 text-sm font-semibold">Brand kit preview</div>
        <div className="mt-2 rounded-lg p-3" style={{ background: local.colors[0], color: '#fff' }}>
          <div style={{ fontFamily: local.headingFont, fontWeight: 800, fontSize: 20, lineHeight: 1.1 }}>Aa Your brand heading</div>
          <div style={{ fontFamily: local.bodyFont, fontSize: 12, marginTop: 6, opacity: 0.85 }}>Body text in your brand voice — consistent everywhere.</div>
        </div>
      </div>

      <button
        className="w-full h-10 rounded-xl bg-[#7630D7] hover:bg-[#8B5CF6] text-white text-[13px] font-semibold mt-3 transition-colors"
        onClick={() => persist(DEFAULT_BRAND)}
      >
        Reset to defaults
      </button>
    </PanelShell>
  )
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
