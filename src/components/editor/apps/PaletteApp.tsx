'use client'

import { useState } from 'react'
import { Palette, RefreshCw } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { createShapeElement, createTextElement } from '@/lib/types'
import { AppHeader, type AppPanelProps } from './registry'
import { toast } from '@/hooks/use-toast'

/** HSL helpers for harmonious palette generation */
function hsl(h: number, s: number, l: number): string {
  return `hsl(${((h % 360) + 360) % 360} ${s}% ${l}%)`
}

function generatePalette(mode: 'analogous' | 'complementary' | 'triad' | 'monochrome'): string[] {
  const base = Math.random() * 360
  switch (mode) {
    case 'analogous':
      return [hsl(base, 80, 55), hsl(base + 30, 75, 60), hsl(base - 30, 70, 50), hsl(base + 60, 65, 45), hsl(base, 85, 75)]
    case 'complementary':
      return [hsl(base, 80, 55), hsl(base + 180, 80, 55), hsl(base, 60, 80), hsl(base + 180, 60, 80), hsl(base, 30, 30)]
    case 'triad':
      return [hsl(base, 80, 55), hsl(base + 120, 80, 55), hsl(base + 240, 80, 55), hsl(base, 50, 80), hsl(base, 25, 25)]
    case 'monochrome':
      return [hsl(base, 70, 25), hsl(base, 70, 45), hsl(base, 70, 60), hsl(base, 70, 75), hsl(base, 70, 90)]
  }
}

/** hsl string → hex for canvas elements (Konva prefers hex) */
function hslToHex(c: string): string {
  const m = c.match(/hsl\(([\d.]+) ([\d.]+)% ([\d.]+)%\)/)
  if (!m) return c
  const h = Number(m[1]) / 360, s = Number(m[2]) / 100, l = Number(m[3]) / 100
  const k = (n: number) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const toHex = (x: number) => Math.round(255 * x).toString(16).padStart(2, '0')
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`
}

const MODES = ['analogous', 'complementary', 'triad', 'monochrome'] as const

export function PaletteApp({ onClose }: AppPanelProps) {
  const [mode, setMode] = useState<(typeof MODES)[number]>('analogous')
  const [colors, setColors] = useState<string[]>(() => generatePalette('analogous'))

  const regen = (m: (typeof MODES)[number] = mode) => {
    setMode(m)
    setColors(generatePalette(m))
  }

  const addToCanvas = () => {
    const store = useEditorStore.getState()
    store.pushHistory()
    const W = 640, H = 160
    const x = Math.round((store.width - W) / 2)
    const y = Math.round((store.height - H) / 2)
    const swatchW = W / colors.length
    colors.forEach((c, i) => {
      store.addElement(
        createShapeElement('rect', {
          x: Math.round(x + i * swatchW),
          y,
          width: Math.round(swatchW - 8),
          height: H,
          fill: hslToHex(c),
          cornerRadius: 16,
        })
      )
    })
    store.addElement(createTextElement({ x: x + 4, y: y + H + 14, width: W, text: `${mode} palette`, fontSize: 22, bold: true, fill: '#6B7280', align: 'left' }))
    toast({ title: 'Palette added to canvas' })
  }

  const saveToBrand = () => {
    const store = useEditorStore.getState()
    const brand = { ...store.brand }
    brand.colors = colors.map(hslToHex)
    store.setBrand(brand)
    try {
      localStorage.setItem('canvix:brandkit', JSON.stringify(brand))
    } catch { /* ignore */ }
    toast({ title: 'Palette saved to Brand Kit' })
  }

  return (
    <div>
      <AppHeader icon={Palette} title="Colour palette" onClose={onClose} />
      <div className="flex gap-1.5 mb-3 flex-wrap">
        {MODES.map((m) => (
          <button
            key={m}
            onClick={() => regen(m)}
            className={`rounded-full px-3 py-1 text-[11px] font-medium border capitalize transition-colors ${
              mode === m ? 'bg-[#7630D7] text-white border-transparent' : 'border-white/12 text-white/60 hover:text-white'
            }`}
          >
            {m}
          </button>
        ))}
        <button
          onClick={() => regen()}
          className="ml-auto h-7 w-7 rounded-full border border-white/12 text-white/70 hover:text-white hover:border-white/30 flex items-center justify-center"
          title="Regenerate"
          aria-label="Regenerate palette"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      <div className="flex rounded-xl overflow-hidden border border-white/10 h-20 mb-3">
        {colors.map((c, i) => (
          <button
            key={i}
            className="flex-1 hover:flex-[1.3] transition-all relative"
            style={{ background: c }}
            onClick={() => {
              navigator.clipboard?.writeText(hslToHex(c)).catch(() => undefined)
              toast({ title: `${hslToHex(c)} copied` })
            }}
            title={`Copy ${hslToHex(c)}`}
            aria-label={`Copy colour ${hslToHex(c)}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn-cv h-9 text-[12px]" onClick={addToCanvas}>
          Add to canvas
        </button>
        <button className="h-9 rounded-xl border border-white/12 hover:bg-white/[0.06] text-white/80 text-[12px] font-semibold transition-colors" onClick={saveToBrand}>
          Save to Brand Kit
        </button>
      </div>
    </div>
  )
}
