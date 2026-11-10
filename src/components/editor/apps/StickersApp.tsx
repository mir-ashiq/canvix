'use client'

import { useMemo, useState } from 'react'
import { Smile, Search } from 'lucide-react'
import { EMOJI_STICKERS, STICKER_PACKS, VECTOR_STICKER_COUNT, searchStickers } from '@/lib/stickers'
import { addSticker, addPackSticker } from '../add-element'
import { AppHeader, type AppPanelProps } from './registry'
import { cn } from '@/lib/utils'

/**
 * v0.22: the real sticker library — 11 authored vector packs
 * (Faces, Hands, Hearts, Stars, Celebrate, Business, Arrows, Nature,
 * Food, Frames, Travel) plus the original 40-emoji quick set.
 * Vector stickers insert as native sticker elements (svg path —
 * canvas/video/PDF/PPTX/SVG exports all render them); emoji stay
 * text stickers exactly as before.
 */
export function StickersApp({ onClose }: AppPanelProps) {
  const [query, setQuery] = useState('')
  const [pack, setPack] = useState<string>('all')

  const results = useMemo(() => searchStickers(query), [query])
  const shown = useMemo(
    () => (pack === 'all' || pack === 'emoji' ? results : results.filter((r) => r.pack.id === pack)),
    [results, pack],
  )
  const vectorCount = useMemo(
    () => (pack === 'all' || pack === 'emoji' ? VECTOR_STICKER_COUNT : (results.find((r) => r.pack.id === pack)?.stickers.length ?? 0)),
    [results, pack],
  )

  return (
    <div>
      <AppHeader icon={Smile} title="Stickers" onClose={onClose} />
      <div className="flex items-center gap-2 h-9 rounded-lg bg-white/[0.06] border border-white/10 px-2.5 mb-3">
        <Search size={12} className="text-white/40 shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="bg-transparent outline-none text-[12px] text-white w-full placeholder:text-white/35"
          placeholder="Search 160+ stickers"
          aria-label="Search stickers"
        />
      </div>

      {/* pack chips — All, the vector packs, then the emoji quick set */}
      <div className="cv-tabscroll flex gap-1.5 overflow-x-auto pb-2 mb-1">
        <button
          onClick={() => setPack('all')}
          className={cn(
            'shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium border transition-colors',
            pack === 'all' ? 'bg-[#7630D7] text-white border-transparent' : 'border-white/12 text-white/60 hover:border-white/30 hover:text-white',
          )}
        >
          All
        </button>
        {STICKER_PACKS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPack(p.id)}
            className={cn(
              'shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium border transition-colors',
              pack === p.id ? 'bg-[#7630D7] text-white border-transparent' : 'border-white/12 text-white/60 hover:border-white/30 hover:text-white',
            )}
          >
            {p.icon} {p.name}
          </button>
        ))}
        <button
          onClick={() => setPack('emoji')}
          className={cn(
            'shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium border transition-colors',
            pack === 'emoji' ? 'bg-[#7630D7] text-white border-transparent' : 'border-white/12 text-white/60 hover:border-white/30 hover:text-white',
          )}
        >
          😀 Emoji
        </button>
      </div>

      {/* vector packs */}
      {shown.map(({ pack: p, stickers }) => (
        <div key={p.id} className="mb-4">
          <h4 className="text-xs font-semibold text-white/50 mb-2">
            {p.icon} {p.name}
          </h4>
          <div className="grid grid-cols-4 gap-1.5">
            {stickers.map((s) => (
              <button
                key={s.id}
                onClick={() => addPackSticker(s)}
                className={cn(
                  'aspect-square rounded-xl bg-white/[0.04] hover:bg-[#7630D7]/25 border border-white/10',
                  'hover:border-[#7630D7] hover:scale-105 transition-all flex items-center justify-center p-1',
                )}
                aria-label={`Add sticker ${s.name}`}
                title={`${s.name} · ${p.name} pack`}
                data-testid={`sticker-${s.id}`}
              >
                <span
                  className="w-full h-full flex items-center justify-center [&>svg]:max-w-full [&>svg]:max-h-full"
                  dangerouslySetInnerHTML={{ __html: s.svg }}
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* emoji quick set */}
      {(pack === 'all' || pack === 'emoji') && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-white/50 mb-2">😀 Emoji</h4>
          <div className="grid grid-cols-6 gap-1.5">
            {EMOJI_STICKERS.map((e) => (
              <button
                key={e}
                onClick={() => addSticker(e)}
                className="aspect-square rounded-lg text-xl leading-none flex items-center justify-center hover:bg-[#7630D7]/25 hover:scale-110 transition-all"
                aria-label={`Add sticker ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}

      {!shown.length && pack !== 'emoji' && (
        <p className="text-center text-[12px] text-white/40 py-6">No stickers match “{query}”</p>
      )}
      <p className="mt-3 text-[10px] text-white/30 text-center">
        {vectorCount} vector stickers · 40 emoji · works offline
      </p>
    </div>
  )
}
