'use client'

import { useState } from 'react'
import { Shapes, Search } from 'lucide-react'
import { GRAPHICS } from '@/lib/editor-utils'
import { addGraphic } from '../add-element'
import { AppHeader, type AppPanelProps } from './registry'
import { cn } from '@/lib/utils'

const ICON_IDS = ['bolt', 'check-circle', 'arrow', 'heart', 'sparkle', 'moon', 'cloud', 'badge', 'speech', 'diamond', 'frame', 'star']

export function IconsApp({ onClose }: AppPanelProps) {
  const [query, setQuery] = useState('')
  const icons = GRAPHICS.filter((g) => ICON_IDS.includes(g.id) || (query && g.name.toLowerCase().includes(query.toLowerCase())))
  const [fill, setFill] = useState('#7630D7')

  return (
    <div>
      <AppHeader icon={Shapes} title="Icons" onClose={onClose} />
      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center gap-2 h-9 rounded-lg bg-white/[0.06] border border-white/10 px-2.5 flex-1">
          <Search size={12} className="text-white/40 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="bg-transparent outline-none text-[12px] text-white w-full placeholder:text-white/35"
            placeholder="Search icons"
            aria-label="Search icons"
          />
        </div>
        <input
          type="color"
          value={fill}
          onChange={(e) => setFill(e.target.value)}
          className="h-9 w-9 rounded-lg border border-white/15 cursor-pointer bg-transparent"
          title="Icon colour"
          aria-label="Icon colour"
        />
      </div>
      <div className="grid grid-cols-4 gap-2">
        {icons.map((g) => (
          <button
            key={g.id}
            onClick={() => {
              addGraphic(g.id, fill)
            }}
            className={cn(
              'flex flex-col items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-3 h-[80px]',
              'hover:border-[#7630D7] hover:bg-[#7630D7]/10 transition-all'
            )}
            aria-label={`Add icon ${g.name}`}
          >
            <svg viewBox="0 0 100 100" className="h-7 w-7" fill={fill} aria-hidden="true">
              <path d={g.path} fillRule="evenodd" />
            </svg>
            <span className="text-[10px] text-white/55">{g.name}</span>
          </button>
        ))}
      </div>
      {!icons.length && <p className="text-center text-[12px] text-white/40 py-6">No icons match “{query}”</p>}
    </div>
  )
}
