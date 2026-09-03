'use client'

import { useState } from 'react'
import { Brush, Eraser, MousePointer2, BringToFront, SendToBack, ArrowUp, ArrowDown, AlignLeft, AlignCenter, AlignRight, AlignVerticalJustifyCenter, AlignHorizontalJustifyCenter, FlipHorizontal2, FlipVertical2, Palette, Layers as LayersIcon } from 'lucide-react'
import { useEditorStore, selectedElements, currentPageData } from '@/store/editor-store'
import { PanelShell } from './panel-shell'
import { BackgroundPanel } from './BackgroundPanel'
import { LayersPanel } from './LayersPanel'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

const SUB_TABS = [
  { id: 'draw', label: 'Draw', icon: Brush },
  { id: 'position', label: 'Position', icon: ArrowUp },
  { id: 'background', label: 'Background', icon: Palette },
  { id: 'layers', label: 'Layers', icon: LayersIcon },
] as const

type SubTab = (typeof SUB_TABS)[number]['id']

/** Canva Tools panel — Draw (freehand), Position (arrange/align/flip), Background, Layers. */
export function ToolsPanel() {
  const [tab, setTab] = useState<SubTab>('draw')

  return (
    <div className="flex flex-col h-full bg-[#16181D] text-[#EDEEF2]">
      <div className="px-4 pt-4 pb-3 border-b border-white/[0.07] shrink-0">
        <h3 className="font-bold text-sm">Tools</h3>
        <div className="flex gap-1 mt-2.5 bg-white/[0.05] rounded-xl p-1">
          {SUB_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex-1 h-8 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors',
                tab === t.id ? 'bg-[#7630D7] text-white' : 'text-white/60 hover:text-white hover:bg-white/10'
              )}
              aria-pressed={tab === t.id}
            >
              <t.icon size={12} /> {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'draw' && <DrawTab />}
        {tab === 'position' && <PositionTab />}
        {tab === 'background' && <div className="text-[#EDEEF2]"><BackgroundPanel /></div>}
        {tab === 'layers' && <div className="text-[#EDEEF2]"><LayersPanel /></div>}
      </div>
    </div>
  )
}

function DrawTab() {
  const tool = useEditorStore((s) => s.tool)
  const setTool = useEditorStore((s) => s.setTool)
  const drawColor = useEditorStore((s) => s.drawColor)
  const setDrawColor = useEditorStore((s) => s.setDrawColor)
  const drawSize = useEditorStore((s) => s.drawSize)
  const setDrawSize = useEditorStore((s) => s.setDrawSize)

  const swatches = ['#FFFFFF', '#0F1015', '#7630D7', '#02C0CC', '#FF5C8A', '#FFD166', '#22C55E', '#3B82F6', '#F97316', '#EF4444']

  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-2">
        <button
          onClick={() => setTool('draw')}
          className={cn(
            'flex-1 h-11 rounded-xl border font-semibold text-[13px] flex items-center justify-center gap-2 transition-colors',
            tool === 'draw' ? 'bg-[#7630D7] border-transparent text-white' : 'bg-white/[0.05] border-white/10 text-white/70 hover:bg-white/10'
          )}
          aria-pressed={tool === 'draw'}
        >
          <Brush size={15} /> Draw
        </button>
        <button
          onClick={() => setTool('select')}
          className={cn(
            'flex-1 h-11 rounded-xl border font-semibold text-[13px] flex items-center justify-center gap-2 transition-colors',
            tool === 'select' ? 'bg-[#7630D7] border-transparent text-white' : 'bg-white/[0.05] border-white/10 text-white/70 hover:bg-white/10'
          )}
          aria-pressed={tool === 'select'}
        >
          <MousePointer2 size={15} /> Select
        </button>
      </div>

      <div>
        <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-2">Brush color</h4>
        <div className="grid grid-cols-5 gap-2">
          {swatches.map((c) => (
            <button
              key={c}
              onClick={() => setDrawColor(c)}
              className={cn('aspect-square rounded-xl border-2 transition-transform hover:scale-105', drawColor === c ? 'border-[#02C0CC] scale-105' : 'border-white/15')}
              style={{ background: c }}
              aria-label={`Brush color ${c}`}
              aria-pressed={drawColor === c}
            />
          ))}
        </div>
        <label className="mt-2 flex items-center gap-2 text-[11px] text-white/50">
          Custom
          <input
            type="color"
            value={drawColor}
            onChange={(e) => setDrawColor(e.target.value)}
            className="w-8 h-8 rounded-lg bg-transparent border border-white/15 cursor-pointer"
            aria-label="Custom brush color"
          />
        </label>
      </div>

      <div>
        <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-2">Brush size — {drawSize}px</h4>
        <input
          type="range"
          min={1}
          max={48}
          value={drawSize}
          onChange={(e) => setDrawSize(parseInt(e.target.value, 10))}
          className="w-full accent-[#7630D7]"
          aria-label="Brush size"
        />
        <div className="mt-2 h-10 rounded-xl bg-white/[0.05] flex items-center justify-center">
          <div className="rounded-full bg-white" style={{ width: Math.min(drawSize, 36), height: Math.min(drawSize, 36) }} />
        </div>
      </div>

      <p className="text-[11px] text-white/40 leading-relaxed">
        Drag on the canvas to sketch. Each stroke becomes an editable path element — recolor, resize or layer it like any element.
      </p>
      <p className="text-[11px] text-white/40 flex items-center gap-1.5">
        <Eraser size={12} /> Use Select then Delete to erase strokes.
      </p>
    </div>
  )
}

function PositionTab() {
  const store = useEditorStore()
  const selected = selectedElements(store)
  const page = currentPageData(store)
  const width = store.width
  const height = store.height
  const moveLayer = store.moveLayer
  const updateElements = store.updateElements

  if (!selected.length) {
    return (
      <div className="p-4">
        <p className="text-[13px] text-white/50 text-center py-10">Select an element to arrange, align or flip it.</p>
      </div>
    )
  }

  const ids = selected.map((e) => e.id)
  const applyAlign = (mode: 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom') => {
    if (selected.length === 1) {
      const el = selected[0]
      let x = el.x, y = el.y
      if (mode === 'left') x = 0
      if (mode === 'center-h') x = Math.round((width - el.width) / 2)
      if (mode === 'right') x = width - el.width
      if (mode === 'top') y = 0
      if (mode === 'center-v') y = Math.round((height - el.height) / 2)
      if (mode === 'bottom') y = height - el.height
      updateElements(ids, { x, y })
    } else {
      // align multiple to their bounding box
      const minX = Math.min(...selected.map((e) => e.x))
      const maxX = Math.max(...selected.map((e) => e.x + e.width))
      const minY = Math.min(...selected.map((e) => e.y))
      const maxY = Math.max(...selected.map((e) => e.y + e.height))
      const patches = selected.map((el) => {
        let x = el.x, y = el.y
        if (mode === 'left') x = minX
        if (mode === 'center-h') x = Math.round((minX + maxX - el.width) / 2)
        if (mode === 'right') x = maxX - el.width
        if (mode === 'top') y = minY
        if (mode === 'center-v') y = Math.round((minY + maxY - el.height) / 2)
        if (mode === 'bottom') y = maxY - el.height
        return { id: el.id, x, y }
      })
      patches.forEach((p) => updateElements([p.id], { x: p.x, y: p.y }))
    }
    toast({ title: 'Aligned' })
  }

  const flip = (axis: 'x' | 'y') => {
    if (selected.length !== 1) {
      toast({ title: 'Flip works on a single element' })
      return
    }
    const el = selected[0]
    updateElements([el.id], { rotation: axis === 'x' ? (360 - el.rotation) % 360 : (el.rotation + 180) % 360 })
  }

  void page

  const btn = 'flex-1 h-10 rounded-xl bg-white/[0.05] hover:bg-[#7630D7] text-white flex items-center justify-center transition-colors'

  return (
    <div className="p-4 space-y-4">
      <div>
        <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-2">Arrange</h4>
        <div className="grid grid-cols-4 gap-2">
          <button className={btn} onClick={() => moveLayer(ids[0], 'front')} aria-label="Bring to front" title="Bring to front"><BringToFront size={16} /></button>
          <button className={btn} onClick={() => moveLayer(ids[0], 'up')} aria-label="Forward" title="Forward"><ArrowUp size={16} /></button>
          <button className={btn} onClick={() => moveLayer(ids[0], 'down')} aria-label="Backward" title="Backward"><ArrowDown size={16} /></button>
          <button className={btn} onClick={() => moveLayer(ids[0], 'back')} aria-label="Send to back" title="Send to back"><SendToBack size={16} /></button>
        </div>
      </div>

      <div>
        <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-2">Align</h4>
        <div className="grid grid-cols-3 gap-2">
          <button className={btn} onClick={() => applyAlign('left')} aria-label="Align left"><AlignLeft size={15} /></button>
          <button className={btn} onClick={() => applyAlign('center-h')} aria-label="Align horizontal center"><AlignVerticalJustifyCenter size={15} className="rotate-90" /></button>
          <button className={btn} onClick={() => applyAlign('right')} aria-label="Align right"><AlignRight size={15} /></button>
          <button className={btn} onClick={() => applyAlign('top')} aria-label="Align top"><AlignLeft size={15} className="rotate-90" /></button>
          <button className={btn} onClick={() => applyAlign('center-v')} aria-label="Align vertical center"><AlignHorizontalJustifyCenter size={15} /></button>
          <button className={btn} onClick={() => applyAlign('bottom')} aria-label="Align bottom"><AlignRight size={15} className="-rotate-90" /></button>
        </div>
      </div>

      <div>
        <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-2">Flip</h4>
        <div className="grid grid-cols-2 gap-2">
          <button className="h-10 rounded-xl bg-white/[0.05] hover:bg-[#7630D7] text-white text-[12px] font-semibold flex items-center justify-center gap-1.5 transition-colors" onClick={() => flip('x')}>
            <FlipHorizontal2 size={15} /> Horizontal
          </button>
          <button className="h-10 rounded-xl bg-white/[0.05] hover:bg-[#7630D7] text-white text-[12px] font-semibold flex items-center justify-center gap-1.5 transition-colors" onClick={() => flip('y')}>
            <FlipVertical2 size={15} /> Vertical
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[12px] text-white/60">
        <span className="text-white/90 font-semibold">{selected.length}</span> element{selected.length > 1 ? 's' : ''} selected on this page
      </div>
    </div>
  )
}

void PanelShell
