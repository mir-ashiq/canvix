'use client'

import { useMemo, useState } from 'react'
import { Plus, ImageDown } from 'lucide-react'
import { PanelShell } from './panel-shell'
import { addImageFromSrc } from '../add-element'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

/** stock photo entry — bundled, AI-generated, license-free */
interface StockPhoto {
  file: string
  cat: string
  tags: string[]
}

const CATEGORIES = [
  { id: 'all', label: 'All photos' },
  { id: 'nature', label: 'Nature' },
  { id: 'business', label: 'Business' },
  { id: 'people', label: 'People' },
  { id: 'food', label: 'Food' },
  { id: 'travel', label: 'Travel' },
  { id: 'texture', label: 'Textures' },
  { id: 'abstract', label: 'Abstract' },
]

const TAGS: Record<string, string[]> = {
  nature: ['mountain', 'landscape', 'forest', 'lake', 'sunset', 'outdoor', 'green', 'mist'],
  business: ['office', 'work', 'laptop', 'desk', 'startup', 'meeting', 'coffee', 'minimal'],
  people: ['team', 'portrait', 'collaboration', 'creative', 'diverse', 'lifestyle'],
  food: ['flat lay', 'healthy', 'fresh', 'colorful', 'vegetables', 'meal'],
  travel: ['beach', 'ocean', 'tropical', 'palm', 'summer', 'vacation', 'sunset'],
  texture: ['paper', 'macro', 'pastel', 'tactile', 'material', 'background'],
  abstract: ['gradient', 'color', 'modern', 'wallpaper', 'purple', 'teal'],
}

const PHOTOS: StockPhoto[] = []
for (const cat of Object.keys(TAGS)) {
  for (let n = 1; n <= 6; n++) {
    PHOTOS.push({ file: `/photos/${cat}-${n}.jpg`, cat, tags: TAGS[cat] })
  }
}

export function PhotosPanel() {
  const [cat, setCat] = useState('all')
  const [query, setQuery] = useState('')
  // resilient to not-yet-bundled photos: broken tiles hide themselves
  const [hidden, setHidden] = useState<Record<string, boolean>>({})

  const photos = useMemo(() => {
    const q = query.trim().toLowerCase()
    return PHOTOS.filter((p) => {
      if (hidden[p.file]) return false
      if (cat !== 'all' && p.cat !== cat) return false
      if (!q) return true
      const label = CATEGORIES.find((c) => c.id === p.cat)?.label ?? p.cat
      return p.cat.includes(q) || label.toLowerCase().includes(q) || p.tags.some((t) => t.includes(q))
    })
  }, [cat, query, hidden])

  const add = (p: StockPhoto) => {
    // bundled photos are 900 × ~514 (1344×768 originals downscaled)
    addImageFromSrc(p.file, 900, 514)
    toast({ title: 'Photo added' })
  }

  return (
    <PanelShell
      title="Photos"
      subtitle="Free stock library — search or browse"
      searchPlaceholder="Search photos (e.g. nature, coffee, beach)"
      onSearch={setQuery}
      belowSearch={
        <div className="flex gap-1.5 flex-wrap mt-2.5">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              className={cn(
                'h-7 px-3 rounded-full text-[11.5px] font-semibold transition-colors border',
                cat === c.id
                  ? 'bg-white/[0.16] text-white border-white/25'
                  : 'bg-transparent text-white/65 border-white/10 hover:bg-white/[0.07] hover:text-white'
              )}
              aria-pressed={cat === c.id}
            >
              {c.label}
            </button>
          ))}
        </div>
      }
    >
      {photos.length === 0 ? (
        <div className="py-16 text-center">
          <ImageDown size={28} className="mx-auto text-white/25 mb-3" />
          <p className="text-[13px] text-white/50 font-medium">No photos match “{query}”</p>
          <p className="text-[11.5px] text-white/35 mt-1">Try a different keyword or category.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {photos.map((p) => (
            <button
              key={p.file}
              onClick={() => add(p)}
              className={cn(
                'group relative aspect-[7/5] rounded-xl overflow-hidden border border-white/10',
                'hover:border-[#7630D7] transition-colors'
              )}
              aria-label={`Add photo ${p.cat}`}
            >
              <img
                src={p.file}
                alt={`${p.cat} stock photo`}
                loading="lazy"
                onError={() => setHidden((h) => ({ ...h, [p.file]: true }))}
                className="absolute inset-0 h-full w-full object-cover group-hover:scale-[1.04] transition-transform duration-300"
              />
              <span className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors" />
              <span className="absolute inset-0 hidden group-hover:flex items-center justify-center">
                <span className="h-8 px-3 rounded-full bg-[#7630D7] text-white text-[11.5px] font-bold flex items-center gap-1.5 shadow-lg">
                  <Plus size={12} /> Add
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      <p className="text-[10.5px] text-white/30 mt-3 leading-relaxed">
        All photos are AI-generated for Canvix and free to use in your designs.
      </p>
    </PanelShell>
  )
}
