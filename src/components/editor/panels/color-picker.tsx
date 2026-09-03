'use client'

import { useRef, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { SOLID_SWATCHES } from '@/lib/editor-utils'
import { cn } from '@/lib/utils'

interface ColorPickerProps {
  value: string
  onChange: (color: string, committed: boolean) => void
  children?: React.ReactNode
  label?: string
}

export function ColorPicker({ value, onChange, children, label }: ColorPickerProps) {
  const [open, setOpen] = useState(false)
  const startedRef = useRef(false)

  const swatchClick = (color: string) => {
    onChange(color, true)
    setOpen(false)
  }

  const nativeInput = (color: string) => {
    if (!startedRef.current) {
      startedRef.current = true
      onChange(color, false)
    } else {
      onChange(color, false)
    }
  }
  const nativeCommit = (color: string) => {
    startedRef.current = false
    onChange(color, true)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children ?? (
          <button
            className="h-8 w-8 rounded-lg border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.12)] overflow-hidden"
            style={{ background: value === 'transparent' ? 'repeating-conic-gradient(#e3e3e8 0% 25%, #ffffff 0% 50%) 50% / 10px 10px' : value }}
            aria-label={label ?? 'Pick color'}
          />
        )}
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" align="start">
        <div className="grid grid-cols-8 gap-1.5">
          {SOLID_SWATCHES.map((c) => (
            <button
              key={c}
              onClick={() => swatchClick(c)}
              className="h-5 w-5 rounded-md border border-black/10 hover:scale-110 transition-transform"
              style={{ background: c }}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
            onChange={(e) => nativeInput(e.target.value)}
            onBlur={(e) => nativeCommit(e.target.value)}
            className="h-8 w-9 cursor-pointer rounded border border-black/10 bg-white p-0.5"
            aria-label="Custom color"
          />
          <Input
            value={value}
            onChange={(e) => {
              const v = e.target.value
              if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v, false)
            }}
            onBlur={(e) => onChange(e.target.value, true)}
            className="h-8 font-mono text-xs"
            aria-label="Hex color"
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** swatch row used inside background panel */
export function SwatchGrid({ value, onPick, swatches }: { value?: string; onPick: (c: string) => void; swatches: string[] }) {
  return (
    <div className="grid grid-cols-8 gap-1.5">
      {swatches.map((c) => (
        <button
          key={c}
          onClick={() => onPick(c)}
          className={cn('h-6 w-6 rounded-md border border-black/10 hover:scale-110 transition-transform', value === c && 'ring-2 ring-[#00C4CC] ring-offset-1')}
          style={{ background: c }}
          aria-label={`Background ${c}`}
        />
      ))}
    </div>
  )
}
