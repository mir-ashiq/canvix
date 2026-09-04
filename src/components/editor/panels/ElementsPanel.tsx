'use client'

import { useMemo, useState } from 'react'
import { Square, Circle, Triangle, Star, Minus, ArrowRight, MoveHorizontal, Search, Hexagon, Pentagon, Diamond, CircleDashed, Frame, Youtube, MapPin, Link2 } from 'lucide-react'
import { GRAPHICS, STICKER_GROUPS } from '@/lib/editor-utils'
import { addEmbed, addFrame, addGraphic, addLine, addShape, addSticker, addTable, type TableStyle } from '../add-element'
import { cn } from '@/lib/utils'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FRAME_SHAPES } from '@/lib/types'

function GraphicIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 100 100" className="h-7 w-7" fill="currentColor" aria-hidden="true">
      <path d={path} fillRule="evenodd" />
    </svg>
  )
}

const BASIC_SHAPES = [
  { id: 'rect', label: 'Square', icon: Square },
  { id: 'rounded', label: 'Rounded', icon: null },
  { id: 'ellipse', label: 'Circle', icon: Circle },
  { id: 'triangle', label: 'Triangle', icon: Triangle },
  { id: 'star', label: 'Star', icon: Star },
] as const

const POLY_SHAPES = [
  { id: 'pentagon', label: 'Pentagon', icon: Pentagon },
  { id: 'hexagon', label: 'Hexagon', icon: Hexagon },
  { id: 'octagon', label: 'Octagon', icon: null },
  { id: 'diamond', label: 'Diamond', icon: Diamond },
  { id: 'semi-circle', label: 'Semicircle', icon: CircleDashed },
] as const

const GRAPHIC_GROUPS: { name: string; ids: string[] }[] = [
  { name: 'Decorative', ids: ['heart', 'blob', 'cloud', 'moon', 'sparkle', 'wave'] },
  { name: 'Badges & labels', ids: ['badge', 'banner', 'ribbon', 'frame', 'speech'] },
  { name: 'Icons', ids: ['bolt', 'check-circle', 'arrow'] },
]

const TABLE_STYLES: { id: TableStyle; label: string; swatch: React.CSSProperties }[] = [
  { id: 'classic', label: 'Classic', swatch: { background: '#FFFFFF', border: '1px solid #E0E1E6' } },
  { id: 'minimal', label: 'Minimal', swatch: { background: '#FFFFFF', borderTop: '2px solid #7630D7' } },
  { id: 'bold', label: 'Bold', swatch: { background: '#F6F2FC', border: '2px solid #7630D7' } },
  { id: 'soft', label: 'Soft', swatch: { background: '#F2FBFC', border: '1px solid #02C0CC' } },
]

export function ElementsPanel() {
  const [tab, setTab] = useState('shapes')
  const [query, setQuery] = useState('')

  const filteredGraphics = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    return GRAPHICS.filter((g) => g.name.toLowerCase().includes(q))
  }, [query])

  const searchPlaceholder = 'Search shapes & graphics'

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex flex-col h-full bg-[#16181D] text-[#EDEEF2]">
      <div className="px-4 pt-4 pb-3 border-b border-white/[0.07] shrink-0">
        <h3 className="font-bold text-sm">Elements</h3>
        <div className="flex items-center gap-2 h-9 rounded-lg bg-white/[0.06] border border-white/10 px-2.5 mt-2.5">
          <Search size={13} className="text-white/40 shrink-0" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              if (e.target.value) setTab('graphics')
            }}
            className="bg-transparent outline-none text-[12px] text-white w-full placeholder:text-white/35"
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
        </div>
        <TabsList className="mt-3 w-full grid grid-cols-4 h-8 bg-white/[0.05]">
          <TabsTrigger value="shapes" className="text-xs data-[state=active]:bg-[#7630D7] data-[state=active]:text-white">Shapes</TabsTrigger>
          <TabsTrigger value="lines" className="text-xs data-[state=active]:bg-[#7630D7] data-[state=active]:text-white">Lines</TabsTrigger>
          <TabsTrigger value="graphics" className="text-xs data-[state=active]:bg-[#7630D7] data-[state=active]:text-white">Graphics</TabsTrigger>
          <TabsTrigger value="stickers" className="text-xs data-[state=active]:bg-[#7630D7] data-[state=active]:text-white">Stickers</TabsTrigger>
          <TabsTrigger value="tables" className="text-[11px] data-[state=active]:bg-[#7630D7] data-[state=active]:text-white">Tables</TabsTrigger>
          <TabsTrigger value="frames" className="text-[11px] data-[state=active]:bg-[#7630D7] data-[state=active]:text-white">Frames</TabsTrigger>
          <TabsTrigger value="embeds" className="text-[11px] data-[state=active]:bg-[#7630D7] data-[state=active]:text-white">Embeds</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="shapes" className="flex-1 overflow-y-auto cv-scroll-dark p-4 mt-0">
        <SectionTitle>Basic shapes</SectionTitle>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {BASIC_SHAPES.map((s) => (
            <ShapeTile key={s.id} label={s.label} onClick={() => addShape(s.id as 'rect')}>
              {s.icon ? <s.icon size={26} strokeWidth={1.6} className="text-white/80" /> : <span className="h-[22px] w-[22px] rounded-md border-2 border-white/80" aria-hidden="true" />}
            </ShapeTile>
          ))}
        </div>
        <SectionTitle>Polygons</SectionTitle>
        <div className="grid grid-cols-3 gap-2">
          {POLY_SHAPES.map((s) => (
            <ShapeTile key={s.id} label={s.label} onClick={() => addGraphic(s.id)}>
              {s.icon ? <s.icon size={26} strokeWidth={1.6} className="text-white/80" /> : <GraphicIcon path={GRAPHICS.find((g) => g.id === 'octagon')?.path ?? ''} />}
            </ShapeTile>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="lines" className="flex-1 overflow-y-auto cv-scroll-dark p-4 mt-0">
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
              className="flex flex-col items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:border-[#7630D7] hover:bg-[#7630D7]/10 transition-all"
              aria-label={`Add ${l.label}`}
            >
              <l.icon size={24} strokeWidth={1.6} className="text-white/80" />
              <span className="text-[11px] text-white/55">{l.label}</span>
            </button>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="graphics" className="flex-1 overflow-y-auto cv-scroll-dark p-4 mt-0">
        {filteredGraphics ? (
          <>
            <SectionTitle>{filteredGraphics.length ? `Results for “${query}”` : `No results for “${query}”`}</SectionTitle>
            <div className="grid grid-cols-3 gap-2">
              {filteredGraphics.map((g) => (
                <GraphicTile key={g.id} g={g} />
              ))}
            </div>
          </>
        ) : (
          GRAPHIC_GROUPS.map((group) => (
            <div key={group.name} className="mb-4">
              <SectionTitle>{group.name}</SectionTitle>
              <div className="grid grid-cols-3 gap-2">
                {group.ids
                  .map((id) => GRAPHICS.find((g) => g.id === id))
                  .filter((g): g is NonNullable<typeof g> => !!g)
                  .map((g) => (
                    <GraphicTile key={g.id} g={g} />
                  ))}
              </div>
            </div>
          ))
        )}
      </TabsContent>

      <TabsContent value="stickers" className="flex-1 overflow-y-auto cv-scroll-dark p-4 mt-0">
        {STICKER_GROUPS.map((group) => (
          <div key={group.name} className="mb-5">
            <h4 className="text-xs font-semibold text-white/50 mb-2">{group.name}</h4>
            <div className="grid grid-cols-6 gap-1">
              {group.emojis.map((e) => (
                <button
                  key={e}
                  onClick={() => addSticker(e)}
                  className="h-9 w-9 rounded-lg text-xl leading-none flex items-center justify-center hover:bg-[#7630D7]/25 hover:scale-110 transition-all"
                  aria-label={`Add sticker ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        ))}
      </TabsContent>

      {/* v0.6: native tables */}
      <TabsContent value="tables" className="flex-1 overflow-y-auto cv-scroll-dark p-4 mt-0">
        <p className="text-[11px] text-white/45 leading-relaxed mb-3">
          Tables are native elements — click a cell on the canvas to edit it. Add or remove rows &amp; columns from the toolbar.
        </p>
        <SectionTitle>Styles</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          {TABLE_STYLES.map((t) => (
            <button
              key={t.id}
              onClick={() => addTable(t.id)}
              className="flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 h-[92px] hover:border-[#7630D7] hover:bg-[#7630D7]/10 transition-all"
              aria-label={`Add ${t.label} table`}
            >
              <span className="w-14 h-10 rounded-md grid grid-cols-3 grid-rows-2 gap-px overflow-hidden" style={t.swatch} aria-hidden="true">
                {Array.from({ length: 6 }, (_, i) => (
                  <span key={i} className={cn('bg-current opacity-10', i < 3 && 'opacity-40')} />
                ))}
              </span>
              <span className="text-[11px] text-white/55">{t.label}</span>
            </button>
          ))}
        </div>
      </TabsContent>

      {/* v0.6: frames (image-in-shape) */}
      <TabsContent value="frames" className="flex-1 overflow-y-auto cv-scroll-dark p-4 mt-0">
        <p className="text-[11px] text-white/45 leading-relaxed mb-3">
          Drop an upload or photo onto a frame to fill it — the image is clipped to the shape.
        </p>
        <SectionTitle>Shapes</SectionTitle>
        <div className="grid grid-cols-3 gap-2">
          {FRAME_SHAPES.map((fs) => (
            <ShapeTile key={fs} label={fs === 'rect' ? 'Rectangle' : fs === 'ellipse' ? 'Ellipse' : fs === 'triangle' ? 'Triangle' : fs === 'hexagon' ? 'Hexagon' : 'Circle'} onClick={() => addFrame(fs)}>
              <FrameIconFor shape={fs} />
            </ShapeTile>
          ))}
        </div>
      </TabsContent>

      {/* v0.6: embed link cards */}
      <TabsContent value="embeds" className="flex-1 overflow-y-auto cv-scroll-dark p-4 mt-0">
        <p className="text-[11px] text-white/45 leading-relaxed mb-3">
          Embed cards open their link when clicked in Preview or shared views. Paste any URL — YouTube and Maps get a styled card.
        </p>
        <EmbedComposer />
      </TabsContent>
    </Tabs>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="text-[11px] font-bold text-white/45 uppercase tracking-wide mb-2.5">{children}</h4>
}

function FrameIconFor({ shape }: { shape: string }) {
  if (shape === 'ellipse') return <span className="h-6 w-6 rounded-full border-2 border-dashed border-white/80" aria-hidden="true" />
  if (shape === 'circle') return <span className="h-6 w-6 rounded-full border-2 border-dashed border-[#7630D7]" aria-hidden="true" />
  if (shape === 'triangle') return <span className="w-0 h-0 border-l-[14px] border-r-[14px] border-b-[24px] border-l-transparent border-r-transparent border-b-white/60" aria-hidden="true" />
  if (shape === 'hexagon') return <Hexagon size={26} strokeWidth={1.8} className="text-white/80" />
  return <Frame size={26} strokeWidth={1.8} className="text-white/80" />
}

function EmbedComposer() {
  const [url, setUrl] = useState('')
  return (
    <div>
      <SectionTitle>Add a link card</SectionTitle>
      <div className="flex items-center gap-2 h-10 rounded-lg bg-white/[0.06] border border-white/10 px-3">
        <Link2 size={14} className="text-white/40 shrink-0" />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && url.trim()) {
              addEmbed(url)
              setUrl('')
            }
          }}
          className="bg-transparent outline-none text-[12px] text-white w-full placeholder:text-white/35"
          placeholder="https://youtube.com/watch?v=…"
          aria-label="Embed URL"
        />
        <button
          className="btn-cv h-7 px-3 text-[11px] shrink-0"
          onClick={() => {
            if (url.trim()) {
              addEmbed(url)
              setUrl('')
            }
          }}
        >
          Add
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-4">
        <QuickEmbed
          icon={Youtube}
          label="YouTube video"
          placeholder="https://youtube.com/watch?v=dQw4w9WgXcQ"
        />
        <QuickEmbed
          icon={MapPin}
          label="Google Maps"
          placeholder="https://maps.google.com/?q=Paris"
        />
      </div>
    </div>
  )
}

function QuickEmbed({ icon: Icon, label, placeholder }: { icon: typeof Youtube; label: string; placeholder: string }) {
  return (
    <button
      onClick={() => addEmbed(placeholder)}
      className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-3 h-[92px] hover:border-[#7630D7] hover:bg-[#7630D7]/10 transition-all"
      aria-label={`Add ${label} embed`}
    >
      <Icon size={24} strokeWidth={1.6} className="text-white/80" />
      <span className="text-[11px] text-white/55">{label}</span>
    </button>
  )
}

function ShapeTile({ label, children, onClick }: { label: string; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-3 h-[84px] hover:border-[#7630D7] hover:bg-[#7630D7]/10 transition-all"
      aria-label={`Add ${label}`}
    >
      <span className="h-7 flex items-center">{children}</span>
      <span className="text-[11px] text-white/55">{label}</span>
    </button>
  )
}

function GraphicTile({ g }: { g: { id: string; name: string; path: string } }) {
  return (
    <button
      onClick={() => addGraphic(g.id)}
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-3 h-[84px] text-white/80',
        'hover:border-[#7630D7] hover:bg-[#7630D7]/10 hover:text-white transition-all'
      )}
      aria-label={`Add ${g.name}`}
    >
      <GraphicIcon path={g.path} />
      <span className="text-[11px] text-white/55">{g.name}</span>
    </button>
  )
}
