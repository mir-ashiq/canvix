'use client'

import { useRef, useState, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** shared anchored popover for the context toolbar (canva .cv-pop style) */
export function ToolbarPopover({
  children,
  trigger,
  title,
  width = 232,
}: {
  children: ReactNode
  trigger: (open: boolean) => ReactNode
  title?: string
  width?: number
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const toggle = () => {
    if (!open) {
      const r = ref.current?.getBoundingClientRect()
      if (r) {
        const x = Math.min(r.left, window.innerWidth - width - 12)
        const y = r.bottom + 6 > window.innerHeight - 300 ? Math.max(8, r.top - 306) : r.bottom + 6
        setPos({ x, y })
      }
    }
    setOpen(!open)
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <span onClick={toggle}>{trigger(open)}</span>
      {open && pos && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} onContextMenu={(e) => { e.preventDefault(); setOpen(false) }} />
          <div className="cv-pop" style={{ left: pos.x, top: pos.y, minWidth: width }}>
            {title && <div className="text-[12px] font-bold text-white/90 mb-2.5">{title}</div>}
            {children}
          </div>
        </>
      )}
    </div>
  )
}

/** labelled slider row (canva spacing/transparency style) */
export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  defaultValue,
  onChange,
  onCommit,
  format,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  defaultValue?: number
  onChange: (v: number) => void
  onCommit?: (v: number) => void
  format?: (v: number) => string
}) {
  return (
    <div className="mb-3.5 last:mb-0">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] text-white/80 font-medium">{label}</span>
        <input
          type="number"
          value={Number(value.toFixed(2))}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (!Number.isNaN(v)) onChange(v)
          }}
          onBlur={() => onCommit?.(value)}
          className="h-7 w-16 rounded-lg bg-white/[0.07] border border-white/10 px-2 text-[12px] text-white outline-none focus:border-[#7630D7] [color-scheme:dark]"
          aria-label={label}
        />
      </div>
      <input
        type="range"
        className="cv-slider w-full"
        style={{ background: `linear-gradient(to right, #7630D7 ${((value - min) / (max - min)) * 100}%, rgba(255,255,255,0.14) ${((value - min) / (max - min)) * 100}%)` }}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={() => onCommit?.(value)}
        aria-label={`${label} slider`}
      />
      {format && <div className="text-[10px] text-white/40 mt-1">{format(value)}</div>}
    </div>
  )
}

/** small square icon tile used in the position popover (canva 2×2 grid) */
export function IconTile({
  icon,
  label,
  onClick,
  disabled,
  active,
}: {
  icon: ReactNode
  label: string
  onClick?: () => void
  disabled?: boolean
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex flex-col items-center justify-center gap-1 rounded-lg py-2 text-[10px] font-medium text-white/80 transition-colors',
        'hover:bg-white/[0.09] disabled:opacity-35 disabled:pointer-events-none',
        active && 'bg-white/[0.13] text-white'
      )}
      aria-label={label}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
