'use client'

import { useState } from 'react'
import {
  Bold, Italic, Underline, Strikethrough, CaseUpper, AlignLeft, AlignCenter, AlignRight,
  AlignJustify, Minus, Plus, LetterText, Percent, Sparkles, Move, CopyPlus, Trash2,
  Group, Ungroup, ArrowUpToLine, ArrowDownToLine, BringToFront, SendToBack,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
  FlipHorizontal, FlipVertical, Sun, Contrast, Palette, RotateCcw, Replace, Lock, LockOpen,
  Layers, SquareDashed, Crop, Spline, Table2, Rows3, Columns3, Trash, Upload, ExternalLink,
} from 'lucide-react'
import { useEditorStore, selectedElements, currentPageData } from '@/store/editor-store'
import type { EmbedElement, FrameElement, ImageElement, LineElement, ShapeElement, StickerElement, TableElement, TextElement, AnyElement, FrameShape } from '@/lib/types'
import { FRAME_SHAPES, isGroup } from '@/lib/types'
import { TEXT_EFFECTS } from '@/lib/types'
import { cn } from '@/lib/utils'
import { FontDropdown } from './toolbar/FontDropdown'
import { ColorMenu } from './toolbar/ColorMenu'
import { ToolbarPopover, SliderRow, IconTile } from './toolbar/popover-kit'
import { BgRemoverButton, MagicEraserPopover, EnhanceButton } from './ImageAI'

const ALIGN_ICONS = {
  left: AlignLeft,
  center: AlignCenter,
  right: AlignRight,
  justify: AlignJustify,
} as const

const EFFECT_PREVIEW: Record<string, React.CSSProperties> = {
  none: {},
  shadow: { textShadow: '2px 3px 4px rgba(0,0,0,0.7)' },
  lift: { textShadow: '0 4px 0 rgba(0,0,0,0.75)' },
  glow: { textShadow: '0 0 10px rgba(255,255,255,0.9)' },
  hollow: { color: 'transparent', WebkitTextStroke: '0.8px #fff' },
  outline: { WebkitTextStroke: '0.7px #fff' },
  background: { background: '#EFEFEF', color: '#7630D7', padding: '2px 6px', borderRadius: 4 },
  splice: { textShadow: '0 -2px 0 rgba(255,255,255,0.4), 0 2px 0 rgba(255,255,255,0.4)' },
  neon: { textShadow: '0 0 6px #7630D7, 0 0 14px #7630D7, 0 0 22px #9954FF' },
  echo: { textShadow: '4px 4px 0 rgba(255,255,255,0.35)' },
}

/** canva-style contextual toolbar. Desktop: rendered inside the topbar row. Mobile: bottom bar. */
export function ContextToolbar({ variant = 'topbar' }: { variant?: 'topbar' | 'mobile' }) {
  const state = useEditorStore()
  const sel = selectedElements(state)
  if (sel.length === 0) return null

  const ids = sel.map((e) => e.id)
  const update = state.updateElements
  const updateLive = state.updateElementsLive

  const first = sel[0]
  const isMulti = sel.length > 1
  const text = first.type === 'text' ? (first as TextElement) : null
  const shape = ['rect', 'ellipse', 'triangle', 'star', 'path'].includes(first.type) ? (first as ShapeElement) : null
  const line = first.type === 'line' ? (first as LineElement) : null
  const image = first.type === 'image' ? (first as ImageElement) : null
  const sticker = first.type === 'sticker' ? (first as StickerElement) : null
  const group = first.type === 'group' ? first : null
  const table = first.type === 'table' ? (first as TableElement) : null
  const frame = first.type === 'frame' ? (first as FrameElement) : null
  const embed = first.type === 'embed' ? (first as EmbedElement) : null

  const canGroup = isMulti
  const canUngroup = sel.some((e) => isGroup(e))

  const isTopbar = variant === 'topbar'

  return (
    <div
      className={cn(
        'flex items-center gap-0.5 min-w-0 overflow-x-auto cv-scroll-dark',
        isTopbar ? 'h-14 items-center px-1' : 'h-14 items-center px-2 bg-[#16181D] border-t border-white/[0.09]'
      )}
      aria-label="Selected element common controls"
      style={{ scrollbarWidth: 'none' }}
    >
      {/* ── multi-select ─────────────────────────────────────── */}
      {isMulti ? (
        <>
          <span className="text-[12px] font-semibold text-white/85 px-2 shrink-0">{sel.length} selected</span>
          <TBtn onClick={() => state.groupSelection()} disabled={!canGroup} title="Group (Ctrl+G)" ariaLabel="Group">
            <Group size={15} />
          </TBtn>
          <TBtn onClick={() => state.ungroupSelection()} disabled={!canUngroup} title="Ungroup (Ctrl+Shift+G)" ariaLabel="Ungroup">
            <Ungroup size={15} />
          </TBtn>
          <Divider />
          <PositionPopover ids={ids} count={sel.length} />
          <Divider />
          <TBtn onClick={() => state.duplicateSelection()} title="Duplicate (Ctrl+D)" ariaLabel="Duplicate">
            <CopyPlus size={15} />
          </TBtn>
          <TBtn onClick={() => state.deleteSelection()} title="Delete (Del)" ariaLabel="Delete" danger>
            <Trash2 size={15} />
          </TBtn>
        </>
      ) : text ? (
        <>
          <FontDropdown value={text.fontFamily} onChange={(f) => update(ids, { fontFamily: f })} />
          {/* size stepper */}
          <div className="flex items-center shrink-0">
            <TBtn onClick={() => update(ids, { fontSize: Math.max(6, text.fontSize - 2) })} title="Decrease font size" ariaLabel="Decrease font size" className="!rounded-r-none">
              <Minus size={14} />
            </TBtn>
            <input
              type="number"
              value={Math.round(text.fontSize)}
              min={6}
              max={400}
              onChange={(e) => { const v = Number(e.target.value); if (v >= 6 && v <= 400) updateLive(ids, { fontSize: v }) }}
              onBlur={() => update(ids, { fontSize: text.fontSize })}
              className="h-8 w-10 bg-white/[0.06] border-y border-white/10 text-white text-[12px] text-center outline-none focus:border-[#7630D7] [color-scheme:dark]"
              aria-label="Font size"
            />
            <TBtn onClick={() => update(ids, { fontSize: Math.min(400, text.fontSize + 2) })} title="Increase font size" ariaLabel="Increase font size" className="!rounded-l-none">
              <Plus size={14} />
            </TBtn>
          </div>

          <ColorMenu
            value={text.fill}
            gradient={text.fillGradient ?? null}
            onChange={(c, committed) => committed ? update(ids, { fill: c, fillGradient: null }) : updateLive(ids, { fill: c, fillGradient: null })}
            onGradient={(g, committed) => { const patch = g ? { fillGradient: g, fill: g.from } : { fillGradient: null }; if (committed) update(ids, patch); else updateLive(ids, patch) }}
            title="Text colour"
          />

          <TBtn onClick={() => update(ids, { bold: !text.bold })} dataActive={text.bold} title="Bold" ariaLabel="Bold">
            <Bold size={14} />
          </TBtn>
          <TBtn onClick={() => update(ids, { italic: !text.italic })} dataActive={text.italic} title="Italic" ariaLabel="Italic">
            <Italic size={14} />
          </TBtn>
          <TBtn onClick={() => update(ids, { underline: !text.underline })} dataActive={text.underline} title="Underline" ariaLabel="Underline">
            <Underline size={14} />
          </TBtn>
          <TBtn onClick={() => update(ids, { strike: !text.strike })} dataActive={text.strike} title="Strikethrough" ariaLabel="Strikethrough">
            <Strikethrough size={14} />
          </TBtn>
          <TBtn onClick={() => update(ids, { uppercase: !text.uppercase })} dataActive={text.uppercase} title="Uppercase" ariaLabel="Uppercase">
            <CaseUpper size={14} />
          </TBtn>

          {/* alignment */}
          <ToolbarPopover
            trigger={(open) => (
              <button className="cv-tbtn" data-active={open} aria-label="Toggle text alignment" title="Text alignment">
                {(() => { const I = ALIGN_ICONS[text.align] ?? AlignLeft; return <I size={14} /> })()}
              </button>
            )}
          >
            <div className="grid grid-cols-2 gap-1 w-[150px]">
              {(['left', 'center', 'right', 'justify'] as const).map((a) => {
                const I = ALIGN_ICONS[a]
                return (
                  <button
                    key={a}
                    onClick={() => update(ids, { align: a })}
                    className={cn('flex items-center justify-center gap-1.5 h-8 rounded-lg text-[11px] font-medium capitalize', text.align === a ? 'bg-white/[0.16] text-white' : 'text-white/75 hover:bg-white/[0.08]')}
                  >
                    <I size={13} /> <span className="w-[42px] text-left">{a}</span>
                  </button>
                )
              })}
            </div>
          </ToolbarPopover>

          {/* spacing */}
          <ToolbarPopover
            trigger={(open) => (
              <button className="cv-tbtn" data-active={open} aria-label="Advanced settings" title="Letter & line spacing">
                <LetterText size={14} />
              </button>
            )}
          >
            <SliderRow label="Letter spacing" value={text.letterSpacing} min={-10} max={80} step={1} onChange={(v) => updateLive(ids, { letterSpacing: v })} onCommit={() => update(ids, { letterSpacing: text.letterSpacing })} />
            <SliderRow label="Line spacing" value={text.lineHeight} min={0.6} max={3} step={0.05} onChange={(v) => updateLive(ids, { lineHeight: v })} onCommit={() => update(ids, { lineHeight: text.lineHeight })} format={(v) => `${v.toFixed(2)}×`} />
          </ToolbarPopover>

          {/* v0.6: curved text (canva “Curve”) */}
          <ToolbarPopover
            width={228}
            trigger={(open) => (
              <button className="cv-tbtn" data-active={open || !!text.curve} aria-label="Curve text" title="Curve text">
                <Spline size={14} />
              </button>
            )}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[12px] font-bold text-white/90">Curved text</div>
              <button className="text-[11px] text-white/60 hover:text-white" onClick={() => update(ids, { curve: 0 })}>Reset</button>
            </div>
            <SliderRow label="Curve" value={text.curve ?? 0} min={-180} max={180} step={5} onChange={(v) => updateLive(ids, { curve: v })} onCommit={() => update(ids, { curve: text.curve ?? 0 })} format={(v) => `${v}°`} />
            <div className="flex justify-center pt-1.5">
              <span className="text-[15px] text-white/85" style={{ fontFamily: text.fontFamily, color: text.fill }} aria-hidden="true">
                {(text.curve ?? 0) >= 0 ? '◠' : '◡'} Curved preview
              </span>
            </div>
          </ToolbarPopover>

          {/* transparency */}
          <ToolbarPopover
            trigger={(open) => (
              <button className="cv-tbtn" data-active={open} aria-label="Transparency" title="Transparency">
                <Percent size={14} />
              </button>
            )}
          >
            <SliderRow label="Transparency" value={Math.round(text.opacity * 100)} min={0} max={100} step={1}
              onChange={(v) => updateLive(ids, { opacity: v / 100 })}
              onCommit={() => update(ids, { opacity: text.opacity })}
              format={(v) => `${100 - v}% transparent`} />
          </ToolbarPopover>

          {/* effects */}
          <ToolbarPopover width={264} trigger={(open) => (
            <button className="cv-tbtn gap-1 !px-2.5" data-active={open} aria-label="Effects" title="Effects">
              <Sparkles size={14} /> <span className="text-[12px] hidden lg:inline">Effects</span>
            </button>
          )}>
            <div className="text-[12px] font-bold text-white/90 mb-2">Text effects</div>
            <div className="grid grid-cols-3 gap-1.5">
              {TEXT_EFFECTS.map((fx) => (
                <button
                  key={fx.id}
                  onClick={() => update(ids, { effect: fx.id })}
                  className={cn(
                    'flex flex-col items-center justify-center rounded-lg py-2 gap-1 border transition-colors',
                    text.effect === fx.id ? 'bg-white/[0.14] border-white/30' : 'border-white/[0.09] hover:bg-white/[0.07]'
                  )}
                  aria-label={`Effect ${fx.label}`}
                >
                  <span className="text-[19px] leading-none text-white" style={{ fontFamily: 'Poppins', ...EFFECT_PREVIEW[fx.id] }}>Ag</span>
                  <span className="text-[9.5px] text-white/65 font-medium">{fx.label}</span>
                </button>
              ))}
            </div>
            {text.effect === 'background' && (
              <div className="mt-2.5 border-t border-white/[0.08] pt-2.5">
                <div className="text-[11px] text-white/60 mb-1.5 font-medium">Background block</div>
                <div className="flex flex-wrap gap-1.5">
                  {['#EFEFEF', '#7630D7', '#00C4CC', '#FF5C8A', '#1F2226', '#FFE066'].map((c) => (
                    <button key={c} className="cv-swatch h-6 w-6" style={{ background: c }} onClick={() => update(ids, { effectBackground: c })} data-selected={text.effectBackground === c} aria-label={`Background ${c}`} />
                  ))}
                </div>
              </div>
            )}
          </ToolbarPopover>

          <Divider />
          <PositionPopover ids={ids} count={1} element={first} />
        </>
      ) : shape || group || sticker || line ? (
        <>
          {shape && (
            <>
              <ColorMenu
                value={shape.fill}
                gradient={shape.fillGradient ?? null}
                onChange={(c, committed) => committed ? update(ids, { fill: c, fillGradient: null }) : updateLive(ids, { fill: c, fillGradient: null })}
                onGradient={(g, committed) => { const patch = g ? { fillGradient: g, fill: g.from } : { fillGradient: null }; if (committed) update(ids, patch); else updateLive(ids, patch) }}
                title="Fill"
              />
              {/* border colour + width */}
              <ToolbarPopover trigger={(open) => (
                <button className="cv-tbtn gap-1 !px-2.5" data-active={open} aria-label="Border" title="Border">
                  <SquareDashed size={14} /> <span className="text-[12px] hidden lg:inline">Border</span>
                </button>
              )}>
                <div className="text-[12px] font-bold text-white/90 mb-2">Border</div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] text-white/60">Colour</span>
                  <ColorMenu value={shape.stroke === 'transparent' ? '#FFFFFF' : shape.stroke} onChange={(c, committed) => committed ? update(ids, { stroke: c, strokeWidth: shape.strokeWidth || 4 }) : updateLive(ids, { stroke: c, strokeWidth: shape.strokeWidth || 4 })} title="Border colour" />
                </div>
                <SliderRow label="Width" value={shape.strokeWidth} min={0} max={40} step={1} onChange={(v) => updateLive(ids, { strokeWidth: v })} onCommit={() => update(ids, { strokeWidth: shape.strokeWidth })} />
                {shape.type === 'rect' && <SliderRow label="Corner radius" value={shape.cornerRadius} min={0} max={Math.round(shape.width / 2)} step={1} onChange={(v) => updateLive(ids, { cornerRadius: v })} onCommit={() => update(ids, { cornerRadius: shape.cornerRadius })} />}
              </ToolbarPopover>
            </>
          )}
          {line && (
            <>
              <ColorMenu value={line.stroke} onChange={(c, committed) => committed ? update(ids, { stroke: c }) : updateLive(ids, { stroke: c })} title="Line colour" />
              <ToolbarPopover trigger={(open) => (
                <button className="cv-tbtn gap-1 !px-2.5" data-active={open} aria-label="Line style" title="Line style">
                  <Minus size={14} /> <span className="text-[12px] hidden lg:inline">Style</span>
                </button>
              )}>
                <SliderRow label="Thickness" value={line.strokeWidth} min={1} max={40} step={1} onChange={(v) => updateLive(ids, { strokeWidth: v })} onCommit={() => update(ids, { strokeWidth: line.strokeWidth })} />
                <label className="flex items-center justify-between text-[12px] text-white/80 mb-2.5 cursor-pointer">
                  Dashed
                  <input type="checkbox" checked={line.dashed} onChange={(e) => update(ids, { dashed: e.target.checked })} className="accent-[#7630D7]" />
                </label>
                <div className="flex gap-1.5">
                  <TBtn onClick={() => update(ids, { arrowEnd: !line.arrowEnd })} dataActive={line.arrowEnd} title="Arrow end" ariaLabel="Arrow end">→</TBtn>
                  <TBtn onClick={() => update(ids, { arrowStart: !line.arrowStart })} dataActive={line.arrowStart} title="Arrow start" ariaLabel="Arrow start">←</TBtn>
                </div>
              </ToolbarPopover>
            </>
          )}
          {sticker && (
            <SliderRowMini label="Size" value={sticker.fontSize} min={24} max={320} onChange={(v) => updateLive(ids, { fontSize: v, width: v * 1.3, height: v * 1.3 })} onCommit={() => update(ids, { fontSize: sticker.fontSize })} />
          )}
          {group && (
            <span className="text-[12px] font-semibold text-white/85 px-2 shrink-0 flex items-center gap-1.5">
              <Layers size={13} /> Group
            </span>
          )}
          <ToolbarPopover trigger={(open) => (
            <button className="cv-tbtn" data-active={open} aria-label="Transparency" title="Transparency">
              <Percent size={14} />
            </button>
          )}>
            <SliderRow label="Transparency" value={Math.round(first.opacity * 100)} min={0} max={100} step={1}
              onChange={(v) => updateLive(ids, { opacity: v / 100 })}
              onCommit={() => update(ids, { opacity: first.opacity })}
              format={(v) => `${100 - v}% transparent`} />
          </ToolbarPopover>
          <Divider />
          <PositionPopover ids={ids} count={1} element={first} />
        </>
      ) : image ? (
        <>
          <TBtn onClick={() => state.openCrop(image.id)} title="Crop image" ariaLabel="Crop image">
            <Crop size={14} />
          </TBtn>
          <ImageAdjustPopover el={image} ids={ids} />
          {/* v0.4 Canva AI image tools */}
          <BgRemoverButton el={image} />
          <MagicEraserPopover el={image} />
          <EnhanceButton el={image} />
          <Divider />
          <ColorMenu value="#FFFFFF" onChange={() => undefined} title="Filter tint (soon)" />
          <ToolbarPopover trigger={(open) => (
            <button className="cv-tbtn" data-active={open} aria-label="Transparency" title="Transparency">
              <Percent size={14} />
            </button>
          )}>
            <SliderRow label="Transparency" value={Math.round(image.opacity * 100)} min={0} max={100} step={1}
              onChange={(v) => updateLive(ids, { opacity: v / 100 })}
              onCommit={() => update(ids, { opacity: image.opacity })}
              format={(v) => `${100 - v}% transparent`} />
          </ToolbarPopover>
          <Divider />
          <PositionPopover ids={ids} count={1} element={first} />
        </>
      ) : table ? (
        <>
          <span className="text-[12px] font-semibold text-white/85 px-2 shrink-0 flex items-center gap-1.5">
            <Table2 size={13} /> Table
          </span>
          <TableToolbar table={table} ids={ids} />
          <Divider />
          <PositionPopover ids={ids} count={1} element={first} />
        </>
      ) : frame ? (
        <>
          <span className="text-[12px] font-semibold text-white/85 px-2 shrink-0 flex items-center gap-1.5">
            <SquareDashed size={13} /> Frame
          </span>
          <FrameToolbar frame={frame} ids={ids} />
          <Divider />
          <PositionPopover ids={ids} count={1} element={first} />
        </>
      ) : embed ? (
        <>
          <span className="text-[12px] font-semibold text-white/85 px-2 shrink-0 flex items-center gap-1.5 capitalize">
            <ExternalLink size={13} /> {embed.kind} card
          </span>
          <EmbedToolbar embed={embed} ids={ids} />
          <ToolbarPopover trigger={(open) => (
            <button className="cv-tbtn" data-active={open} aria-label="Transparency" title="Transparency">
              <Percent size={14} />
            </button>
          )}>
            <SliderRow label="Transparency" value={Math.round(embed.opacity * 100)} min={0} max={100} step={1}
              onChange={(v) => updateLive(ids, { opacity: v / 100 })}
              onCommit={() => update(ids, { opacity: embed.opacity })}
              format={(v) => `${100 - v}% transparent`} />
          </ToolbarPopover>
          <Divider />
          <PositionPopover ids={ids} count={1} element={first} />
        </>
      ) : null}
    </div>
  )
}

// ── v0.6: table / frame / embed toolbars ──────────────────────

function TableToolbar({ table, ids }: { table: TableElement; ids: string[] }) {
  const update = useEditorStore((s) => s.updateElements)
  const updateLive = useEditorStore((s) => s.updateElementsLive)

  const addRow = () => {
    const cells = [...table.cells]
    for (let c = 0; c < table.cols; c += 1) cells.push({ text: '' })
    update(ids, { rows: table.rows + 1, cells, height: Math.round((table.rows + 1) * (table.height / table.rows)) })
  }
  const addCol = () => {
    const cells: typeof table.cells = []
    for (let r = 0; r < table.rows; r += 1) {
      for (let c = 0; c < table.cols; c += 1) {
        cells.push(table.cells[r * table.cols + c] ?? { text: '' })
      }
      if (r === 0) cells.push({ text: '', bold: true, fill: table.headerFill })
      else cells.push({ text: '' })
    }
    const colWidths = [...table.colWidths, Math.round(table.width / (table.cols + 1))]
    update(ids, { cols: table.cols + 1, cells, colWidths, width: table.width + Math.round(table.width / (table.cols + 1)) })
  }
  const removeRow = () => {
    if (table.rows <= 1) return
    update(ids, { rows: table.rows - 1, cells: table.cells.slice(0, (table.rows - 1) * table.cols), height: Math.round((table.rows - 1) * (table.height / table.rows)) })
  }
  const removeCol = () => {
    if (table.cols <= 1) return
    const cells: typeof table.cells = []
    for (let r = 0; r < table.rows; r += 1) {
      for (let c = 0; c < table.cols - 1; c += 1) cells.push(table.cells[r * table.cols + c] ?? { text: '' })
    }
    update(ids, { cols: table.cols - 1, cells, colWidths: table.colWidths.slice(0, -1) })
  }

  return (
    <>
      <TBtn onClick={addRow} title="Add row" ariaLabel="Add row"><Rows3 size={15} /><Plus size={9} className="-ml-1.5 -mb-1.5" /></TBtn>
      <TBtn onClick={removeRow} title="Remove row" ariaLabel="Remove row"><Rows3 size={15} /><Minus size={9} className="-ml-1.5 -mb-1.5" /></TBtn>
      <TBtn onClick={addCol} title="Add column" ariaLabel="Add column"><Columns3 size={15} /><Plus size={9} className="-ml-1.5 -mb-1.5" /></TBtn>
      <TBtn onClick={removeCol} title="Remove column" ariaLabel="Remove column"><Columns3 size={15} /><Minus size={9} className="-ml-1.5 -mb-1.5" /></TBtn>
      <ToolbarPopover trigger={(open) => (
        <button className="cv-tbtn gap-1 !px-2.5" data-active={open} aria-label="Table style" title="Table style">
          <Palette size={14} /> <span className="text-[12px] hidden lg:inline">Style</span>
        </button>
      )}>
        <div className="text-[12px] font-bold text-white/90 mb-2">Table style</div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] text-white/60">Border</span>
          <ColorMenu value={table.borderColor} onChange={(c, committed) => committed ? update(ids, { borderColor: c }) : updateLive(ids, { borderColor: c })} title="Border colour" />
        </div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] text-white/60">Header</span>
          <ColorMenu value={table.headerFill} onChange={(c, committed) => committed ? update(ids, { headerFill: c }) : updateLive(ids, { headerFill: c })} title="Header fill" />
        </div>
        <SliderRow label="Border width" value={table.borderWidth} min={0} max={6} step={0.5} onChange={(v) => updateLive(ids, { borderWidth: v })} onCommit={() => update(ids, { borderWidth: table.borderWidth })} />
        <SliderRow label="Text size" value={table.fontSize} min={8} max={40} step={1} onChange={(v) => updateLive(ids, { fontSize: v })} onCommit={() => update(ids, { fontSize: table.fontSize })} />
      </ToolbarPopover>
    </>
  )
}

function FrameToolbar({ frame, ids }: { frame: FrameElement; ids: string[] }) {
  const update = useEditorStore((s) => s.updateElements)

  const onFill = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result)
      const img = new window.Image()
      img.onload = () => update(ids, { src, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight })
      img.src = src
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <>
      <label className="cv-tbtn gap-1 !px-2.5 cursor-pointer" title="Fill frame with an image" aria-label="Fill frame with an image">
        <Upload size={14} /> <span className="text-[12px] hidden lg:inline">Fill</span>
        <input type="file" accept="image/*" className="hidden" onChange={onFill} />
      </label>
      <ToolbarPopover trigger={(open) => (
        <button className="cv-tbtn gap-1 !px-2.5" data-active={open} aria-label="Frame shape" title="Frame shape">
          <SquareDashed size={14} /> <span className="text-[12px] hidden lg:inline">Shape</span>
        </button>
      )}>
        <div className="text-[12px] font-bold text-white/90 mb-2">Frame shape</div>
        <div className="grid grid-cols-3 gap-1.5">
          {FRAME_SHAPES.map((fs: FrameShape) => (
            <button
              key={fs}
              onClick={() => update(ids, { frameShape: fs })}
              className={cn(
                'h-9 rounded-lg text-[11px] font-medium capitalize border transition-colors',
                frame.frameShape === fs ? 'bg-white/[0.16] border-white/30 text-white' : 'border-white/[0.09] text-white/75 hover:bg-white/[0.07]'
              )}
              aria-label={`Frame shape ${fs}`}
            >
              {fs}
            </button>
          ))}
        </div>
        {frame.frameShape === 'rect' && (
          <div className="mt-2 border-t border-white/[0.08] pt-2">
            <SliderRow label="Corner radius" value={frame.radius} min={0} max={Math.round(frame.width / 2)} step={1} onChange={(v) => useEditorStore.getState().updateElementsLive(ids, { radius: v })} onCommit={() => update(ids, { radius: frame.radius })} />
          </div>
        )}
      </ToolbarPopover>
    </>
  )
}

function EmbedToolbar({ embed, ids }: { embed: EmbedElement; ids: string[] }) {
  const update = useEditorStore((s) => s.updateElements)
  const [editingUrl, setEditingUrl] = useState(embed.url)

  return (
    <>
      <ToolbarPopover width={280} trigger={(open) => (
        <button className="cv-tbtn gap-1 !px-2.5" data-active={open} aria-label="Edit link" title="Edit link">
          <ExternalLink size={14} /> <span className="text-[12px] hidden lg:inline">Link</span>
        </button>
      )}>
        <div className="text-[12px] font-bold text-white/90 mb-2">Embed link</div>
        <input
          value={editingUrl}
          onChange={(e) => setEditingUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && editingUrl.trim()) update(ids, { url: editingUrl.trim(), title: undefined })
          }}
          className="w-full h-8 rounded-lg bg-white/[0.06] border border-white/10 px-2.5 text-[12px] text-white outline-none focus:border-[#7630D7]"
          aria-label="Embed URL"
        />
        <div className="flex gap-1.5 mt-2">
          <button className="btn-cv h-8 px-3 text-[11px]" onClick={() => editingUrl.trim() && update(ids, { url: editingUrl.trim(), title: undefined })}>Apply</button>
          <button className="h-8 px-3 text-[11px] rounded-lg border border-white/10 text-white/70 hover:bg-white/[0.07]" onClick={() => setEditingUrl(embed.url)}>Reset</button>
        </div>
        <p className="text-[10px] text-white/40 mt-2 leading-relaxed">Cards open their link in Preview &amp; shared views.</p>
      </ToolbarPopover>
    </>
  )
}

/** canva position popover: arrange 2×2 + align 6 + advanced W/H/X/Y/rotate */
function PositionPopover({ ids, count, element }: { ids: string[]; count: number; element?: AnyElement }) {
  const store = useEditorStore()
  const el = element ?? selectedElements(store)[0]

  const [ratio, setRatio] = useState(false)
  const W = el?.width ?? 0
  const H = el?.height ?? 0

  const setSize = (w: number, h: number) => {
    store.updateElements(ids, { width: Math.max(4, Math.round(w)), height: Math.max(4, Math.round(h)) })
  }

  return (
    <ToolbarPopover
      width={252}
      trigger={(open) => (
        <button className="cv-tbtn gap-1 !px-2.5" data-active={open} aria-label="Position" title="Position, layer ordering & size">
          <Move size={14} /> <span className="text-[12px] hidden lg:inline">Position</span>
        </button>
      )}
    >
      {/* arrange 2×2 */}
      <div className="grid grid-cols-2 gap-1 mb-2.5">
        <IconTile icon={<ArrowUpToLine size={15} />} label="Forward" onClick={() => ids.forEach((id) => store.moveLayer(id, 'up'))} />
        <IconTile icon={<ArrowDownToLine size={15} />} label="Backward" onClick={() => ids.forEach((id) => store.moveLayer(id, 'down'))} />
        <IconTile icon={<BringToFront size={15} />} label="To front" onClick={() => ids.forEach((id) => store.moveLayer(id, 'front'))} />
        <IconTile icon={<SendToBack size={15} />} label="To back" onClick={() => ids.forEach((id) => store.moveLayer(id, 'back'))} />
      </div>

      <div className="border-t border-white/[0.08] pt-2 mb-2.5">
        <div className="text-[10px] font-semibold text-white/45 uppercase tracking-wide mb-1.5">Align to page</div>
        <div className="grid grid-cols-3 gap-1">
          <IconTile icon={<AlignVerticalJustifyStart size={15} />} label="Top" onClick={() => store.alignElements(ids, 'top')} />
          <IconTile icon={<AlignVerticalJustifyCenter size={15} />} label="Middle" onClick={() => store.alignElements(ids, 'cy')} />
          <IconTile icon={<AlignVerticalJustifyEnd size={15} />} label="Bottom" onClick={() => store.alignElements(ids, 'bottom')} />
          <IconTile icon={<AlignHorizontalJustifyStart size={15} />} label="Left" onClick={() => store.alignElements(ids, 'left')} />
          <IconTile icon={<AlignHorizontalJustifyCenter size={15} />} label="Centre" onClick={() => store.alignElements(ids, 'cx')} />
          <IconTile icon={<AlignHorizontalJustifyEnd size={15} />} label="Right" onClick={() => store.alignElements(ids, 'right')} />
        </div>
      </div>

      {count === 1 && el && (
        <div className="border-t border-white/[0.08] pt-2">
          <div className="text-[10px] font-semibold text-white/45 uppercase tracking-wide mb-1.5">Advanced</div>
          <div className="grid grid-cols-3 gap-1.5 mb-1.5">
            <NumField label="W" value={W} onCommit={(v) => setSize(ratio ? v * (H / W) : v, ratio ? v * (H / W) : H)} />
            <NumField label="H" value={H} onCommit={(v) => setSize(ratio ? v * (W / H) : W, ratio ? v * (W / H) : v)} />
            <button
              className="flex flex-col items-center justify-center gap-0.5 rounded-lg border border-white/10 text-white/75 hover:bg-white/[0.09] text-[10px] font-medium py-1"
              onClick={() => setRatio(!ratio)}
              title="Lock aspect ratio"
            >
              <Lock size={12} className={ratio ? 'text-[#7630D7]' : 'opacity-50'} />
              Ratio
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <NumField label="X" value={Math.round(el.x)} onCommit={(v) => store.updateElements(ids, { x: Math.round(v) })} />
            <NumField label="Y" value={Math.round(el.y)} onCommit={(v) => store.updateElements(ids, { y: Math.round(v) })} />
            <NumField label="Rotate" value={Math.round(el.rotation)} suffix="°" onCommit={(v) => store.updateElements(ids, { rotation: ((v % 360) + 360) % 360 })} />
          </div>
        </div>
      )}
    </ToolbarPopover>
  )
}

/** image adjustments popover (canva "Edit image" lite) */
function ImageAdjustPopover({ el, ids }: { el: ImageElement; ids: string[] }) {
  const update = useEditorStore((s) => s.updateElements)
  const updateLive = useEditorStore((s) => s.updateElementsLive)
  return (
    <ToolbarPopover
      width={252}
      trigger={(open) => (
        <button className="cv-tbtn gap-1 !px-2.5" data-active={open} aria-label="Adjust image" title="Adjust image">
          <Sun size={14} /> <span className="text-[12px] hidden lg:inline">Adjust</span>
        </button>
      )}
    >
      <SliderRow label="Brightness" value={el.brightness ?? 0} min={-100} max={100} step={1} onChange={(v) => updateLive(ids, { brightness: v })} onCommit={() => update(ids, { brightness: el.brightness ?? 0 })} />
      <SliderRow label="Contrast" value={el.contrast ?? 0} min={-100} max={100} step={1} onChange={(v) => updateLive(ids, { contrast: v })} onCommit={() => update(ids, { contrast: el.contrast ?? 0 })} />
      <SliderRow label="Saturation" value={el.saturation ?? 0} min={-100} max={100} step={1} onChange={(v) => updateLive(ids, { saturation: v })} onCommit={() => update(ids, { saturation: el.saturation ?? 0 })} />
      <div className="flex gap-1.5 mt-1 border-t border-white/[0.08] pt-2.5">
        <TBtn onClick={() => update(ids, { flipH: !el.flipH })} dataActive={el.flipH} title="Flip horizontal" ariaLabel="Flip horizontal"><FlipHorizontal size={14} /></TBtn>
        <TBtn onClick={() => update(ids, { flipV: !el.flipV })} dataActive={el.flipV} title="Flip vertical" ariaLabel="Flip vertical"><FlipVertical size={14} /></TBtn>
        <TBtn onClick={() => update(ids, { brightness: 0, contrast: 0, saturation: 0 })} title="Reset adjustments" ariaLabel="Reset adjustments"><RotateCcw size={14} /></TBtn>
        <TBtn onClick={() => useEditorStore.getState().setPanel('uploads')} title="Replace image" ariaLabel="Replace image"><Replace size={14} /></TBtn>
      </div>
    </ToolbarPopover>
  )
}

function SliderRowMini({ label, value, min, max, onChange, onCommit }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; onCommit: () => void }) {
  return (
    <div className="flex items-center gap-2 px-2 shrink-0 w-[150px]">
      <span className="text-[11px] text-white/60 w-8">{label}</span>
      <input
        type="range"
        className="cv-slider w-full"
        style={{ background: `linear-gradient(to right, #7630D7 ${((value - min) / (max - min)) * 100}%, rgba(255,255,255,0.14) ${((value - min) / (max - min)) * 100}%)` }}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        aria-label={label}
      />
    </div>
  )
}

function NumField({ label, value, onCommit, suffix }: { label: string; value: number; onCommit: (v: number) => void; suffix?: string }) {
  const [v, setV] = useState(String(value))
  const [editing, setEditing] = useState(false)
  if (!editing && String(value) !== v) setV(String(value))
  return (
    <label className="flex flex-col items-center gap-0.5">
      <span className="text-[9px] text-white/40 font-medium">{label}</span>
      <span className="relative w-full">
        <input
          value={v}
          onFocus={() => setEditing(true)}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => { setEditing(false); const n = Number(v); if (!Number.isNaN(n)) onCommit(n) }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className="h-7 w-full rounded-lg bg-white/[0.07] border border-white/10 px-1 text-[11px] text-white text-center outline-none focus:border-[#7630D7] [color-scheme:dark]"
          aria-label={label}
        />
        {suffix && <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-white/35 pointer-events-none">{suffix}</span>}
      </span>
    </label>
  )
}

function TBtn({ children, onClick, title, ariaLabel, disabled, danger, className, dataActive }: {
  children: React.ReactNode
  onClick?: () => void
  title?: string
  ariaLabel: string
  disabled?: boolean
  danger?: boolean
  className?: string
  dataActive?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      data-active={dataActive ? 'true' : undefined}
      className={cn('cv-tbtn', danger && 'hover:bg-[#ff5a5a]/15 hover:text-[#ff8080]', className)}
    >
      {children}
    </button>
  )
}

const Divider = () => <span className="w-px h-5 bg-white/15 mx-1 shrink-0" />
