'use client'

import { useEffect, useState } from 'react'
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Trash2,
  Copy,
  Lock,
  LockOpen,
  Droplets,
  Plus,
  Minus,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  CornerDownRight,
  ArrowLeftRight,
  MoveDiagonal,
  Wand2,
} from 'lucide-react'
import { useEditorStore, selectedElements, currentPageData } from '@/store/editor-store'
import { FONTS } from '@/lib/editor-utils'
import { ColorPicker } from './panels/color-picker'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import type { AnyElement, TextElement, ShapeElement, LineElement, ImageElement, StickerElement } from '@/lib/types'
import { TEXT_EFFECTS, type TextEffect } from '@/lib/types'

function ToolButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick?: () => void
  active?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        'h-8 min-w-8 px-1.5 rounded-lg flex items-center justify-center transition-colors',
        active ? 'bg-[#7630D7] text-white' : 'text-white/75 hover:bg-white/10 hover:text-white'
      )}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span className="h-5 w-px bg-white/15 mx-1 shrink-0" aria-hidden="true" />
}

function NumberStepper({
  value,
  onCommit,
  min = 1,
  max = 800,
  suffix,
  title,
}: {
  value: number
  onCommit: (v: number) => void
  min?: number
  max?: number
  suffix?: string
  title: string
}) {
  const [draft, setDraft] = useState(String(value))

  // resync when the value changes externally
  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commit = (raw: string) => {
    const n = parseInt(raw, 10)
    if (Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, n)))
    else setDraft(String(value))
  }

  return (
    <div className="flex items-center rounded-lg border border-white/12 h-8 bg-white/[0.06]" title={title}>
      <button className="h-full px-1.5 text-white/70 hover:text-white" aria-label="Decrease" onClick={() => commit(String(value - 1))}>
        <Minus size={12} />
      </button>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => e.key === 'Enter' && commit(draft)}
        className="w-11 text-center text-xs font-semibold text-white outline-none bg-transparent"
        inputMode="numeric"
        aria-label={title}
      />
      {suffix && <span className="text-[10px] text-white/50 pr-1">{suffix}</span>}
      <button className="h-full px-1.5 text-white/70 hover:text-white" aria-label="Increase" onClick={() => commit(String(value + 1))}>
        <Plus size={12} />
      </button>
    </div>
  )
}

function OpacityControl({ opacity, onCommit }: { opacity: number; onCommit: (v: number) => void }) {
  const [local, setLocal] = useState(opacity)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <ToolButton title="Transparency">
          <span className="relative flex items-center justify-center">
            <Droplets size={15} />
          </span>
        </ToolButton>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-3 bg-[#16181D] border-white/10 text-white">
        <div className="flex items-center justify-between text-xs font-medium">
          <span>Transparency</span>
          <span>{Math.round(local * 100)}%</span>
        </div>
        <Slider
          value={[Math.round(local * 100)]}
          min={5}
          max={100}
          step={1}
          onValueChange={(v) => {
            const o = v[0] / 100
            setLocal(o)
            onCommit(o)
          }}
          className="mt-2"
        />
      </PopoverContent>
    </Popover>
  )
}

export function PropertiesBar() {
  const state = useEditorStore()
  const sel = selectedElements(state)
  const page = currentPageData(state)

  if (sel.length === 0) return null

  const ids = sel.map((e) => e.id)
  const update = state.updateElements
  const updateLive = state.updateElementsLive

  const first = sel[0]
  const isMulti = sel.length > 1
  const allText = sel.every((e) => e.type === 'text')

  // align actions (multi-select): relative to page
  const alignSelection = (mode: 'left' | 'cx' | 'right' | 'top' | 'cy' | 'bottom') => {
    state.pushHistory()
    const pages = state.pages.map((p, i) => {
      if (i !== state.currentPage) return p
      return {
        ...p,
        elements: p.elements.map((el) => {
          if (!ids.includes(el.id)) return el
          switch (mode) {
            case 'left': return { ...el, x: 0 }
            case 'cx': return { ...el, x: (state.width - el.width) / 2 }
            case 'right': return { ...el, x: state.width - el.width }
            case 'top': return { ...el, y: 0 }
            case 'cy': return { ...el, y: (state.height - el.height) / 2 }
            case 'bottom': return { ...el, y: state.height - el.height }
          }
        }),
      }
    })
    useEditorStore.setState({ pages })
  }

  const text = first.type === 'text' ? (first as TextElement) : null
  const shape = ['rect', 'ellipse', 'triangle', 'star', 'path'].includes(first.type) ? (first as ShapeElement) : null
  const line = first.type === 'line' ? (first as LineElement) : null
  const image = first.type === 'image' ? (first as ImageElement) : null
  const sticker = first.type === 'sticker' ? (first as StickerElement) : null

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 max-w-[calc(100%-2rem)]">
      <div className="flex items-center gap-0.5 rounded-2xl bg-[#1D1F26]/95 backdrop-blur border border-white/10 shadow-xl shadow-black/50 px-2 py-1.5 overflow-x-auto cv-scroll-dark">
        {isMulti ? (
          <>
            <span className="text-xs font-medium text-white/60 px-1.5 shrink-0">{sel.length} selected</span>
            <Divider />
            <ToolButton title="Align left" onClick={() => alignSelection('left')}><AlignStartVertical size={15} /></ToolButton>
            <ToolButton title="Align centers" onClick={() => alignSelection('cx')}><AlignCenterVertical size={15} /></ToolButton>
            <ToolButton title="Align right" onClick={() => alignSelection('right')}><AlignEndVertical size={15} /></ToolButton>
            <ToolButton title="Align top" onClick={() => alignSelection('top')}><AlignStartHorizontal size={15} /></ToolButton>
            <ToolButton title="Align middles" onClick={() => alignSelection('cy')}><AlignCenterHorizontal size={15} /></ToolButton>
            <ToolButton title="Align bottom" onClick={() => alignSelection('bottom')}><AlignEndHorizontal size={15} /></ToolButton>
          </>
        ) : text ? (
          <>
            {/* font family */}
            <div className="shrink-0">
              <select
                value={text.fontFamily}
                onChange={(e) => update(ids, { fontFamily: e.target.value })}
                className="h-8 rounded-lg border border-white/12 bg-white/[0.06] text-white px-2 text-xs font-semibold outline-none cursor-pointer max-w-[130px] truncate [color-scheme:dark]"
                style={{ fontFamily: text.fontFamily }}
                aria-label="Font family"
              >
                {FONTS.map((f) => (
                  <option key={f.family} value={f.family} style={{ fontFamily: f.family }}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <NumberStepper
              value={text.fontSize}
              onCommit={(v) => update(ids, { fontSize: v })}
              min={6}
              max={400}
              title="Font size"
            />
            <Divider />
            <ToolButton title="Bold" active={text.bold} onClick={() => update(ids, { bold: !text.bold })}><Bold size={14} /></ToolButton>
            <ToolButton title="Italic" active={text.italic} onClick={() => update(ids, { italic: !text.italic })}><Italic size={14} /></ToolButton>
            <ToolButton title="Underline" active={text.underline} onClick={() => update(ids, { underline: !text.underline })}><Underline size={14} /></ToolButton>
            <ToolButton title="Strikethrough" active={text.strike} onClick={() => update(ids, { strike: !text.strike })}><Strikethrough size={14} /></ToolButton>
            <Divider />
            <ColorPicker
              value={text.fill}
              onChange={(c, committed) => (committed ? update(ids, { fill: c }) : updateLive(ids, { fill: c }))}
              label="Text color"
            />
            <Divider />
            <ToolButton title="Align left" active={text.align === 'left'} onClick={() => update(ids, { align: 'left' })}><AlignLeft size={14} /></ToolButton>
            <ToolButton title="Align center" active={text.align === 'center'} onClick={() => update(ids, { align: 'center' })}><AlignCenter size={14} /></ToolButton>
            <ToolButton title="Align right" active={text.align === 'right'} onClick={() => update(ids, { align: 'right' })}><AlignRight size={14} /></ToolButton>
            <Divider />
            <SpacingControl
              letterSpacing={text.letterSpacing}
              lineHeight={text.lineHeight}
              onChangeLetter={(v) => update(ids, { letterSpacing: v })}
              onChangeLine={(v) => update(ids, { lineHeight: v })}
            />
            <EffectsControl effect={text.effect ?? 'none'} onChange={(fx) => update(ids, { effect: fx })} />
          </>
        ) : shape ? (
          <>
            <ColorPicker
              value={shape.fill}
              onChange={(c, committed) => (committed ? update(ids, { fill: c }) : updateLive(ids, { fill: c }))}
              label="Fill color"
            />
            <ColorPicker
              value={shape.stroke}
              onChange={(c, committed) => (committed ? update(ids, { stroke: c }) : updateLive(ids, { stroke: c }))}
              label="Stroke color"
            />
            <NumberStepper value={shape.strokeWidth} onCommit={(v) => update(ids, { strokeWidth: v })} min={0} max={80} title="Stroke width" />
            {first.type === 'rect' && (
              <NumberStepper value={shape.cornerRadius} onCommit={(v) => update(ids, { cornerRadius: v })} min={0} max={400} title="Corner radius" />
            )}
          </>
        ) : line ? (
          <>
            <ColorPicker
              value={line.stroke}
              onChange={(c, committed) => (committed ? update(ids, { stroke: c }) : updateLive(ids, { stroke: c }))}
              label="Line color"
            />
            <NumberStepper value={line.strokeWidth} onCommit={(v) => update(ids, { strokeWidth: v })} min={1} max={60} title="Line weight" />
            <ToolButton title="Dashed" active={line.dashed} onClick={() => update(ids, { dashed: !line.dashed })}>
              <ArrowLeftRight size={14} className="opacity-60" />
            </ToolButton>
            <ToolButton title="Start arrow" active={line.arrowStart} onClick={() => update(ids, { arrowStart: !line.arrowStart })}>
              <CornerDownRight size={14} className="-scale-x-100" />
            </ToolButton>
            <ToolButton title="End arrow" active={line.arrowEnd} onClick={() => update(ids, { arrowEnd: !line.arrowEnd })}>
              <CornerDownRight size={14} />
            </ToolButton>
          </>
        ) : sticker ? (
          <>
            <NumberStepper value={sticker.fontSize} onCommit={(v) => update(ids, { fontSize: v })} min={12} max={600} title="Sticker size" />
          </>
        ) : image ? (
          <>
            <NumberStepper value={image.radius} onCommit={(v) => update(ids, { radius: v })} min={0} max={500} title="Corner radius" />
          </>
        ) : null}

        {/* common controls */}
        {!isMulti && <Divider />}
        {!isMulti && <ShadowControl element={first} />}
        {!isMulti && <OpacityControl opacity={first.opacity} onCommit={(v) => update(ids, { opacity: v })} />}
        <Divider />
        {!isMulti && (
          <ToolButton
            title={first.locked ? 'Unlock' : 'Lock'}
            active={first.locked}
            onClick={() => state.setLock(ids, !first.locked)}
          >
            {first.locked ? <Lock size={14} /> : <LockOpen size={14} />}
          </ToolButton>
        )}
        <ToolButton title="Duplicate" onClick={() => state.duplicateSelection()}>
          <Copy size={14} />
        </ToolButton>
        <ToolButton title="Delete" onClick={() => state.deleteSelection()}>
          <Trash2 size={14} className="text-red-500" />
        </ToolButton>
      </div>
    </div>
  )
}

function SpacingControl({
  letterSpacing,
  lineHeight,
  onChangeLetter,
  onChangeLine,
}: {
  letterSpacing: number
  lineHeight: number
  onChangeLetter: (v: number) => void
  onChangeLine: (v: number) => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <ToolButton title="Letter & line spacing">
          <MoveDiagonal size={14} />
        </ToolButton>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3 bg-[#16181D] border-white/10 text-white">
        <div className="flex items-center justify-between text-xs font-medium">
          <span>Letter spacing</span>
          <span>{letterSpacing.toFixed(0)}px</span>
        </div>
        <Slider value={[letterSpacing]} min={-10} max={40} step={1} onValueChange={(v) => onChangeLetter(v[0])} className="mt-2" />
        <div className="flex items-center justify-between text-xs font-medium mt-4">
          <span>Line height</span>
          <span>{lineHeight.toFixed(2)}</span>
        </div>
        <Slider value={[lineHeight * 100]} min={80} max={250} step={5} onValueChange={(v) => onChangeLine(v[0] / 100)} className="mt-2" />
      </PopoverContent>
    </Popover>
  )
}

function ShadowControl({ element }: { element: AnyElement }) {
  const update = useEditorStore((s) => s.updateElements)
  const enabled = element.shadow?.enabled ?? false
  const setShadow = (patch: Partial<typeof element.shadow>) => {
    update([element.id], { shadow: { ...element.shadow, ...patch } })
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <ToolButton title="Shadow" active={enabled}>
          <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v9" />
            <path d="M12 12c0 4-3 6-6.5 6A5.5 5.5 0 0 1 12 12z" fill="currentColor" fillOpacity={enabled ? 0.35 : 0.12} />
          </svg>
        </ToolButton>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3 bg-[#16181D] border-white/10 text-white">
        <label className="flex items-center justify-between text-xs font-medium cursor-pointer">
          <span>Shadow</span>
          <input type="checkbox" checked={enabled} onChange={(e) => setShadow({ enabled: e.target.checked })} className="accent-[#00C4CC]" />
        </label>
        {enabled && (
          <>
            <div className="flex items-center justify-between text-xs font-medium mt-3">
              <span>Blur</span>
              <span>{element.shadow.blur}px</span>
            </div>
            <Slider value={[element.shadow.blur]} min={0} max={60} step={1} onValueChange={(v) => setShadow({ blur: v[0] })} className="mt-2" />
            <div className="flex items-center justify-between text-xs font-medium mt-2">
              <span>Offset Y</span>
              <span>{element.shadow.offsetY}px</span>
            </div>
            <Slider value={[element.shadow.offsetY]} min={-40} max={40} step={1} onValueChange={(v) => setShadow({ offsetY: v[0], offsetX: 0 })} className="mt-2" />
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs font-medium">Color</span>
              <ColorPicker
                value={element.shadow.color}
                onChange={(c) => setShadow({ color: c })}
                label="Shadow color"
              />
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Canva-style text effects: None / Shadow / Lift / Hollow / Neon / Echo */
function EffectsControl({ effect, onChange }: { effect: TextEffect; onChange: (fx: TextEffect) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <ToolButton title="Effects" active={effect !== 'none'}>
          <Wand2 size={14} />
        </ToolButton>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 bg-[#16181D] border-white/10 text-white">
        <div className="text-xs font-bold uppercase tracking-wide text-white/50 mb-2">Text effects</div>
        <div className="grid grid-cols-3 gap-2">
          {TEXT_EFFECTS.map((fx) => (
            <button
              key={fx.id}
              onClick={() => onChange(fx.id)}
              className={cn(
                'rounded-xl border px-2 py-2.5 text-center transition-colors',
                effect === fx.id ? 'border-[#7630D7] bg-[#7630D7]/25' : 'border-white/10 bg-white/[0.04] hover:border-white/30'
              )}
              aria-pressed={effect === fx.id}
            >
              <span
                className="block text-[15px] font-bold leading-tight"
                style={
                  fx.id === 'shadow'
                    ? { textShadow: '0 3px 5px rgba(0,0,0,0.5)' }
                    : fx.id === 'lift'
                      ? { textShadow: '0 4px 0 rgba(0,0,0,0.55)' }
                      : fx.id === 'hollow'
                        ? { WebkitTextStroke: '1px #fff', color: 'transparent' }
                        : fx.id === 'neon'
                          ? { textShadow: '0 0 10px #02C0CC, 0 0 20px #02C0CC' }
                          : fx.id === 'echo'
                            ? { textShadow: '3px 3px 0 rgba(255,255,255,0.4)' }
                            : undefined
                }
              >
                Aa
              </span>
              <span className="block text-[10px] mt-1 text-white/70">{fx.label}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
