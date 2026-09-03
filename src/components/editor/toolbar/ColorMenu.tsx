'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Pipette, Plus, ChevronRight, Search } from 'lucide-react'
import { SOLID_SWATCHES, GRADIENT_PRESETS } from '@/lib/editor-utils'
import { useEditorStore } from '@/store/editor-store'
import { cn } from '@/lib/utils'

interface ColorMenuProps {
  /** current colour value */
  value: string
  onChange: (color: string, committed: boolean) => void
  /** gradient swatches apply from→to (page background context only) */
  onGradient?: (from: string, to: string, angle: number) => void
  /** menu title (canva: "Text colour" / "Background colour" / "Fill") */
  title?: string
  children?: React.ReactNode
}

/** canva-style colour menu: quick row, brand kit, solid grid, gradient rows. */
export function ColorMenu({ value, onChange, onGradient, title = 'Colour', children }: ColorMenuProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [hex, setHex] = useState(value)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const brand = useEditorStore((s) => s.brand)

  useEffect(() => { setHex(value) }, [value])

  const openMenu = () => {
    const r = triggerRef.current?.getBoundingClientRect()
    if (r) {
      const W = 250
      const x = Math.min(r.left, window.innerWidth - W - 12)
      const y = r.bottom + 6 > window.innerHeight - 380 ? Math.max(8, r.top - 386) : r.bottom + 6
      setPos({ x, y })
    }
    setOpen(true)
  }

  const apply = (c: string) => {
    onChange(c, true)
  }

  const tryHex = () => {
    const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)
    if (m) {
      const h = m[1].length === 3 ? '#' + m[1].split('').map((c) => c + c).join('') : '#' + m[1]
      apply(h)
    }
  }

  const eyedropper = async () => {
    const EyeDropper = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper
    if (!EyeDropper) return
    try {
      const res = await new EyeDropper().open()
      apply(res.sRGBHex)
    } catch { /* cancelled */ }
  }

  return (
    <>
      <button ref={triggerRef} onClick={openMenu} className="cv-tbtn" aria-label={title} title={title}>
        {children ?? (
          <span
            className="block h-[18px] w-[18px] rounded-full border-2 border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
            style={{ background: value === 'transparent' ? 'repeating-conic-gradient(#e3e3e8 0% 25%, #ffffff 0% 50%) 50% / 8px 8px' : value }}
          />
        )}
      </button>

      {open && pos && (
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} onContextMenu={(e) => { e.preventDefault(); setOpen(false) }} />
          <div className="cv-menu !min-w-[250px] !max-w-[250px] !p-0" style={{ left: pos.x, top: pos.y }}>
            {/* header */}
            <div className="flex items-center justify-between px-3 h-10 border-b border-white/[0.07]">
              <span className="text-[13px] font-bold text-white">{title}</span>
              <button className="text-white/60 hover:text-white" onClick={() => setOpen(false)} aria-label="Close colour menu">
                <X size={15} />
              </button>
            </div>

            {/* hex input */}
            <div className="px-3 pt-2.5 pb-1">
              <div className="flex items-center gap-2 h-8 rounded-lg bg-white/[0.06] border border-white/10 px-2.5">
                <Search size={12} className="text-white/40 shrink-0" />
                <input
                  value={hex}
                  onChange={(e) => setHex(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') tryHex() }}
                  onBlur={tryHex}
                  className="bg-transparent outline-none text-[12px] text-white w-full placeholder:text-white/35"
                  placeholder="Try “blue” or “#00c4cc”"
                  maxLength={9}
                />
              </div>
            </div>

            {/* quick row: spectrum / eyedropper / current */}
            <div className="flex items-center gap-3 px-3 py-2.5">
              <label className="relative cursor-pointer" title="Spectrum">
                <span
                  className="block h-9 w-9 rounded-full relative"
                  style={{ background: 'conic-gradient(from 0deg, #ff004c, #ff7a00, #ffe600, #4dff00, #00ffc8, #00c2ff, #4d00ff, #ff00d4, #ff004c)' }}
                >
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="h-5 w-5 rounded-full bg-[#1a1b22] flex items-center justify-center">
                      <Plus size={12} className="text-white" />
                    </span>
                  </span>
                </span>
                <input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'}
                  onChange={(e) => onChange(e.target.value, false)}
                  onBlur={(e) => onChange(e.target.value, true)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  aria-label="Open spectrum picker"
                />
              </label>
              <button className="h-9 w-9 rounded-full bg-white/[0.08] border border-white/10 flex items-center justify-center text-white/80 hover:bg-white/[0.14]" onClick={eyedropper} title="Eyedropper" aria-label="Eyedropper">
                <Pipette size={14} />
              </button>
              <button
                className="h-9 w-9 rounded-full border-2 border-white/80"
                style={{ background: value === 'transparent' ? 'repeating-conic-gradient(#e3e3e8 0% 25%, #ffffff 0% 50%) 50% / 8px 8px' : value }}
                title="Current colour"
                aria-label="Current colour"
                onClick={() => apply(value)}
              />
            </div>

            {/* brand kit */}
            <Section label="Brand Kit" icon="palette">
              <div className="flex flex-wrap gap-2 px-3 pb-2.5">
                {brand.colors.map((c) => (
                  <button key={c} className="cv-swatch h-7 w-7" style={{ background: c }} data-selected={value === c} onClick={() => apply(c)} aria-label={`Brand colour ${c}`} />
                ))}
              </div>
            </Section>

            {/* default solid colours */}
            <Section label="Default solid colours" icon="droplet">
              <div className="grid grid-cols-7 gap-2 px-3 pb-2.5">
                {SOLID_SWATCHES.map((c) => (
                  <button key={c} className="cv-swatch h-7 w-7" style={{ background: c }} data-selected={value === c} onClick={() => apply(c)} aria-label={c} />
                ))}
              </div>
            </Section>

            {/* gradients (background context) */}
            {onGradient && (
              <Section label="Default gradient colours" icon="gradient">
                <div className="grid grid-cols-7 gap-2 px-3 pb-2.5">
                  {GRADIENT_PRESETS.map((g, i) => (
                    <button
                      key={i}
                      className="cv-swatch h-7 w-7"
                      style={{ background: `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})` }}
                      onClick={() => onGradient(g.from, g.to, g.angle)}
                      aria-label={`Gradient ${g.from} to ${g.to}`}
                    />
                  ))}
                </div>
              </Section>
            )}
          </div>
        </>
      )}
    </>
  )
}

function Section({ label, icon, children }: { label: string; icon: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(true)
  return (
    <div className="border-t border-white/[0.07]">
      <button className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-semibold text-white/85 hover:text-white" onClick={() => setExpanded(!expanded)}>
        <ChevronRight size={12} className={cn('transition-transform', expanded && 'rotate-90')} />
        {label}
      </button>
      {expanded && children}
    </div>
  )
}
