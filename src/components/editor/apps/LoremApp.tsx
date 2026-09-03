'use client'

import { useState } from 'react'
import { Type, RefreshCw } from 'lucide-react'
import { createTextElement } from '@/lib/types'
import { addTextStyled } from '../add-element'
import { AppHeader, type AppPanelProps } from './registry'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

const LOREM = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.',
  'The quick brown fox jumps over the lazy dog while the calm river reflects the evening sky.',
  'Design is thinking made visual — iterate boldly, simplify relentlessly, and ship with intention.',
  'Coffee fuels the morning; curiosity fuels the craft. Every pixel earns its place.',
]

const PRESETS = [
  { id: 'body', label: 'Body paragraph', fontSize: 32, bold: false, lines: 3 },
  { id: 'subheading', label: 'Subheading', fontSize: 48, bold: true, lines: 1 },
  { id: 'heading', label: 'Heading', fontSize: 72, bold: true, lines: 1 },
] as const

export function LoremApp({ onClose }: AppPanelProps) {
  const [seed, setSeed] = useState(0)
  const [style, setStyle] = useState('body')
  const [lines, setLines] = useState(3)
  const [real, setReal] = useState(false)

  const text = buildText(real, lines, seed)

  return (
    <div>
      <AppHeader icon={Type} title="Placeholder text" onClose={onClose} />

      <div className="flex gap-1.5 mb-3">
        <button
          onClick={() => setReal(false)}
          className={cn('flex-1 h-8 rounded-lg text-[11px] font-semibold transition-colors', !real ? 'bg-[#7630D7] text-white' : 'bg-white/[0.05] text-white/60 hover:text-white')}
        >
          Lorem ipsum
        </button>
        <button
          onClick={() => setReal(true)}
          className={cn('flex-1 h-8 rounded-lg text-[11px] font-semibold transition-colors', real ? 'bg-[#7630D7] text-white' : 'bg-white/[0.05] text-white/60 hover:text-white')}
        >
          Real-feel copy
        </button>
        <button
          onClick={() => setSeed((s) => s + 1)}
          className="h-8 w-8 rounded-lg border border-white/12 text-white/70 hover:text-white flex items-center justify-center"
          title="Shuffle"
          aria-label="Shuffle text"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => { setStyle(p.id); setLines(p.lines) }}
            className={cn(
              'rounded-lg border py-2 text-[11px] font-medium transition-colors',
              style === p.id ? 'border-[#7630D7] bg-[#7630D7]/15 text-white' : 'border-white/10 text-white/60 hover:text-white'
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <label className="block text-[11px] font-semibold text-white/55 mb-1.5">Lines</label>
      <input
        type="range" min={1} max={6} value={lines}
        onChange={(e) => setLines(Number(e.target.value))}
        className="cv-slider w-full mb-3"
        aria-label="Number of lines"
      />

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[11px] text-white/60 leading-relaxed max-h-24 overflow-hidden mb-3">
        {text}
      </div>

      <button
        className="btn-cv w-full h-10 text-[12px]"
        onClick={() => {
          const preset = PRESETS.find((p) => p.id === style)!
          addTextStyled({ text, fontSize: preset.fontSize, bold: preset.bold, width: 720, align: 'left' })
          toast({ title: `${preset.label} placeholder added` })
        }}
      >
        Add to canvas
      </button>
    </div>
  )
}

function buildText(real: boolean, lines: number, seed: number): string {
  const pool = real ? LOREM.slice(1) : LOREM.slice(0, 2).concat(LOREM.slice(2))
  const out: string[] = []
  for (let i = 0; i < lines; i++) {
    out.push(pool[(seed + i) % pool.length])
  }
  return out.join('\n')
}
