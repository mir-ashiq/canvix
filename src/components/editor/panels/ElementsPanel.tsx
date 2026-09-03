'use client'

import { useState } from 'react'
import { Square, Circle, Triangle, Star, Minus, ArrowRight, MoveHorizontal } from 'lucide-react'
import { GRAPHICS, STICKER_GROUPS } from '@/lib/editor-utils'
import { addGraphic, addLine, addShape, addSticker } from '../add-element'
import { cn } from '@/lib/utils'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

function GraphicIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 100 100" className="h-7 w-7" fill="currentColor" aria-hidden="true">
      <path d={path} />
    </svg>
  )
}

export function ElementsPanel() {
  const [tab, setTab] = useState('shapes')

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-3 border-b border-black/5">
        <h3 className="font-bold text-sm">Elements</h3>
        <TabsList className="mt-3 w-full grid grid-cols-4 h-8">
          <TabsTrigger value="shapes" className="text-xs">Shapes</TabsTrigger>
          <TabsTrigger value="lines" className="text-xs">Lines</TabsTrigger>
          <TabsTrigger value="graphics" className="text-xs">Graphics</TabsTrigger>
          <TabsTrigger value="stickers" className="text-xs">Stickers</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="shapes" className="flex-1 overflow-y-auto cv-scroll p-4 mt-0">
        <div className="grid grid-cols-3 gap-2">
          {[
            { id: 'rect', label: 'Square', icon: Square },
            { id: 'rounded', label: 'Rounded', icon: null },
            { id: 'ellipse', label: 'Circle', icon: Circle },
            { id: 'triangle', label: 'Triangle', icon: Triangle },
            { id: 'star', label: 'Star', icon: Star },
          ].map((s) => (
            <button
              key={s.id}
              onClick={() => addShape(s.id as 'rect')}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-black/8 p-3 hover:border-[#00C4CC] hover:bg-[#F0FBFC] transition-all"
              aria-label={`Add ${s.label}`}
            >
              {s.icon ? (
                <s.icon size={26} strokeWidth={1.6} className="text-[#3D3F47]" />
              ) : (
                <span className="h-[22px] w-[22px] rounded-md border-2 border-[#3D3F47]" aria-hidden="true" />
              )}
              <span className="text-[11px] text-muted-foreground">{s.label}</span>
            </button>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="lines" className="flex-1 overflow-y-auto cv-scroll p-4 mt-0">
        <div className="grid grid-cols-2 gap-2">
          {[
            { id: 'solid', label: 'Line', icon: Minus },
            { id: 'dashed', label: 'Dashed', icon: MoveHorizontal },
            { id: 'arrow', label: 'Arrow', icon: ArrowRight },
            { id: 'arrowBoth', label: 'Two-way', icon: MoveHorizontal },
          ].map((l) => (
            <button
              key={l.id}
              onClick={() => addLine(l.id as 'solid')}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-black/8 p-4 hover:border-[#00C4CC] hover:bg-[#F0FBFC] transition-all"
              aria-label={`Add ${l.label}`}
            >
              <l.icon size={24} strokeWidth={1.6} className="text-[#3D3F47]" />
              <span className="text-[11px] text-muted-foreground">{l.label}</span>
            </button>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="graphics" className="flex-1 overflow-y-auto cv-scroll p-4 mt-0">
        <div className="grid grid-cols-3 gap-2">
          {GRAPHICS.map((g) => (
            <button
              key={g.id}
              onClick={() => addGraphic(g.id)}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-black/8 p-3 text-[#3D3F47] hover:border-[#00C4CC] hover:bg-[#F0FBFC] transition-all"
              aria-label={`Add ${g.name}`}
            >
              <GraphicIcon path={g.path} />
              <span className="text-[11px] text-muted-foreground">{g.name}</span>
            </button>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="stickers" className="flex-1 overflow-y-auto cv-scroll p-4 mt-0">
        {STICKER_GROUPS.map((group) => (
          <div key={group.name} className="mb-5">
            <h4 className="text-xs font-semibold text-muted-foreground mb-2">{group.name}</h4>
            <div className="grid grid-cols-6 gap-1">
              {group.emojis.map((e) => (
                <button
                  key={e}
                  onClick={() => addSticker(e)}
                  className="h-9 w-9 rounded-lg text-xl leading-none flex items-center justify-center hover:bg-[#F0FBFC] hover:scale-110 transition-all"
                  aria-label={`Add sticker ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        ))}
      </TabsContent>
    </Tabs>
  )
}
