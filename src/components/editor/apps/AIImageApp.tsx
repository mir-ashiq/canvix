'use client'

import { useState } from 'react'
import { ImageIcon, Loader2, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { createImageElement } from '@/lib/types'
import { useEditorStore } from '@/store/editor-store'
import { AppHeader, type AppPanelProps } from './registry'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

const SIZES = [
  { id: '1024x1024', label: 'Square 1:1', w: 1, h: 1 },
  { id: '1344x768', label: 'Wide 16:9', w: 16, h: 9 },
  { id: '768x1344', label: 'Story 9:16', w: 9, h: 16 },
  { id: '1152x864', label: 'Photo 4:3', w: 4, h: 3 },
] as const

const STYLES = [
  'Photorealistic, professional photography',
  'Flat vector illustration',
  '3D render, soft studio lighting',
  'Watercolour painting',
  'Minimal gradient poster art',
]

const IDEAS = [
  'A minimalist workspace with a plant and coffee, soft morning light',
  'Abstract wave shapes in purple and teal, poster style',
  'Cute 3D character holding a rocket ship',
  'Sunset over calm ocean with pastel sky',
]

interface Generated {
  dataUrl: string
  width: number
  height: number
  prompt: string
}

export function AIImageApp({ onClose }: AppPanelProps) {
  const addElement = useEditorStore((s) => s.addElement)
  const pages = useEditorStore((s) => s.pages)
  const currentPage = useEditorStore((s) => s.currentPage)
  const designW = useEditorStore((s) => s.width)
  const designH = useEditorStore((s) => s.height)

  const [prompt, setPrompt] = useState('')
  const [style, setStyle] = useState<string | null>(null)
  const [size, setSize] = useState<(typeof SIZES)[number]['id']>('1024x1024')
  const [image, setImage] = useState<Generated | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generate = async (regen = false) => {
    if (!prompt.trim() || busy) return
    setBusy(true)
    setError(null)
    if (!regen) setImage(null)
    try {
      const fullPrompt = style ? `${prompt}, ${style}` : prompt
      const res = await fetch('/api/ai/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: fullPrompt, size }),
      })
      const data = (await res.json()) as Generated & { error?: string }
      if (!res.ok || !data.dataUrl) throw new Error(data.error ?? 'Generation failed')
      setImage({ ...data, prompt: fullPrompt })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setBusy(false)
    }
  }

  const addToCanvas = () => {
    if (!image) return
    const maxW = designW * 0.7
    const maxH = designH * 0.7
    const scale = Math.min(maxW / image.width, maxH / image.height, 1)
    const w = Math.round(image.width * scale)
    const h = Math.round(image.height * scale)
    addElement(
      createImageElement(image.dataUrl, image.width, image.height, {
        x: Math.max(0, (designW - w) / 2),
        y: Math.max(0, (designH - h) / 2),
        width: w,
        height: h,
      })
    )
    toast({ title: 'AI image added' })
  }

  return (
    <div>
      <AppHeader icon={ImageIcon} title="AI image generator" onClose={onClose} />

      <div className="rounded-xl border border-white/10 bg-white/[0.04] focus-within:border-[#7630D7] transition-colors p-3 mb-2.5">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate() }}
          rows={2}
          maxLength={600}
          placeholder="Describe the image — e.g. “A dreamy purple nebula with a lone astronaut”"
          className="w-full bg-transparent outline-none text-[12.5px] text-white resize-none placeholder:text-white/35"
          aria-label="Image generation prompt"
        />
      </div>

      <div className="grid grid-cols-4 gap-1.5 mb-2">
        {SIZES.map((s) => (
          <button
            key={s.id}
            onClick={() => setSize(s.id)}
            className={cn(
              'h-7 rounded-lg text-[10px] font-semibold transition-colors',
              size === s.id ? 'bg-[#7630D7] text-white' : 'bg-white/[0.05] text-white/60 hover:text-white'
            )}
            title={s.label}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex gap-1.5 flex-wrap mb-2.5">
        {STYLES.map((s) => (
          <button
            key={s}
            onClick={() => setStyle(style === s ? null : s)}
            className={cn(
              'h-6 px-2.5 rounded-full text-[10px] font-semibold border transition-colors',
              style === s ? 'bg-white/[0.16] text-white border-white/25' : 'text-white/55 border-white/10 hover:text-white'
            )}
          >
            {s.split(',')[0]}
          </button>
        ))}
      </div>

      <button
        onClick={() => generate()}
        disabled={busy || !prompt.trim()}
        className="w-full h-10 rounded-xl bg-gradient-to-r from-[#7630D7] to-[#9B6BFF] text-white text-[13px] font-bold flex items-center justify-center gap-2 disabled:opacity-40 hover:brightness-110 transition-all"
        aria-label="Generate image"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        {busy ? 'Dreaming…' : 'Generate image'}
      </button>

      {error && <p className="text-[11px] text-[#FF8095] mt-2.5">{error}</p>}

      {busy && (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] aspect-square flex flex-col items-center justify-center gap-2">
          <Loader2 size={22} className="animate-spin text-[#9B6BFF]" />
          <span className="text-[11px] text-white/50">Painting your image…</span>
        </div>
      )}

      {image && !busy && (
        <div className="mt-3">
          <button
            onClick={addToCanvas}
            className="group relative w-full rounded-xl overflow-hidden border border-white/10 hover:border-[#7630D7] transition-colors"
            role="button"
            aria-label="Add image to canvas"
          >
            <img src={image.dataUrl} alt={image.prompt} className="w-full block" />
            <span className="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/35">
              <span className="h-8 px-4 rounded-full bg-[#7630D7] text-white text-[11.5px] font-bold flex items-center gap-1.5 shadow-lg">
                <Plus size={12} /> Add to canvas
              </span>
            </span>
          </button>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => generate(true)}
              className="flex-1 h-8 rounded-lg border border-white/12 text-white/70 hover:text-white text-[11px] font-semibold flex items-center justify-center gap-1.5"
              aria-label="Generate another"
            >
              <RefreshCw size={11} /> Another
            </button>
            <button
              onClick={addToCanvas}
              className="flex-1 h-8 rounded-lg bg-[#7630D7] hover:bg-[#8B5CF6] text-white text-[11px] font-semibold flex items-center justify-center gap-1.5"
              aria-label="Add to canvas"
            >
              <Plus size={11} /> Add to canvas
            </button>
          </div>
        </div>
      )}

      {!image && !busy && !error && (
        <div className="mt-3.5">
          <p className="text-[10.5px] font-bold text-white/60 uppercase tracking-wide mb-1.5">Try a prompt like…</p>
          <div className="space-y-1">
            {IDEAS.map((idea) => (
              <button
                key={idea}
                onClick={() => setPrompt(idea)}
                className="block w-full text-left text-[11.5px] text-white/55 hover:text-white rounded-lg border border-white/[0.07] hover:border-white/20 px-2.5 py-1.5 transition-colors"
              >
                “{idea}”
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
