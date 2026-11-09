'use client'

import { useMemo, useState } from 'react'
import { ImageIcon, Search } from 'lucide-react'
import { ILLUSTRATIONS, ILLUSTRATION_PACKS, type IllustrationPack } from '@/lib/assets/illustrations'
import { addIllustration } from '../add-element'
import { AppHeader, type AppPanelProps } from './registry'
import { cn } from '@/lib/utils'

/**
 * v0.17 (Wave 2): the illustration library — 48 original flat-art
 * pieces in six packs (business, people, nature, tech, abstract,
 * festive), bundled offline. Inserted as SVG image elements.
 */
export function IllustrationsApp({ onClose }: AppPanelProps) {
  const [query, setQuery] = useState('')
  const [pack, setPack] = useState<IllustrationPack | 'all'>('all')

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return ILLUSTRATIONS.filter(
      (i) =>
        (pack === 'all' || i.pack === pack) &&
        (!q || i.name.toLowerCase().includes(q) || i.tags.some((t) => t.includes(q)))
    )
  }, [query, pack])

  return (
    <div>
      <AppHeader icon={ImageIcon} title="Illustrations" onClose={onClose} />
      <div className="flex items-center gap-2 h-9 rounded-lg bg-white/[0.06] border border-white/10 px-2.5 mb-3">
        <Search size={12} className="text-white/40 shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="bg-transparent outline-none text-[12px] text-white w-full placeholder:text-white/35"
          placeholder="Search illustrations"
          aria-label="Search illustrations"
        />
      </div>

      {/* pack chips */}
      <div className="cv-tabscroll flex gap-1.5 overflow-x-auto pb-2 mb-1">
        {[{ id: 'all' as const, label: 'All' }, ...ILLUSTRATION_PACKS].map((p) => (
          <button
            key={p.id}
            onClick={() => setPack(p.id)}
            className={cn(
              'shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium border transition-colors',
              pack === p.id ? 'bg-[#7630D7] text-white border-transparent' : 'border-white/12 text-white/60 hover:border-white/30 hover:text-white'
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {list.map((i) => (
          <button
            key={i.id}
            onClick={() => addIllustration(i.svg)}
            className={cn(
              'flex flex-col items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-2.5',
              'hover:border-[#7630D7] hover:bg-[#7630D7]/10 transition-all'
            )}
            aria-label={`Add illustration ${i.name}`}
            title={`${i.name} · ${i.pack} pack`}
          >
            <div
              className="w-full aspect-square rounded-lg bg-[#0F1015] flex items-center justify-center [&>svg]:max-w-full [&>svg]:max-h-full"
              dangerouslySetInnerHTML={{ __html: i.svg }}
              aria-hidden="true"
            />
            <span className="text-[10px] text-white/55 truncate w-full text-center">{i.name}</span>
          </button>
        ))}
      </div>
      {!list.length && <p className="text-center text-[12px] text-white/40 py-6">No illustrations match “{query}”</p>}
      <p className="mt-3 text-[10px] text-white/30 text-center">48 original pieces · works offline</p>
    </div>
  )
}
