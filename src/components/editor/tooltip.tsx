'use client'

import { useRef, useState } from 'react'

/** canva-style tooltip: dark chip, ~600ms delay, fixed positioning. */
export function Tip({
  label,
  children,
  side = 'bottom',
  delay = 600,
}: {
  label: string
  children: React.ReactNode
  side?: 'top' | 'bottom' | 'right'
  delay?: number
}) {
  const [pos, setPos] = useState<{ x: number; y: number; tx?: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (side === 'right') {
      const y = Math.max(8, Math.min(r.top + r.height / 2, window.innerHeight - 30))
      timer.current = setTimeout(() => setPos({ x: r.right + 10, y, tx: 'translateY(-50%)' }), delay)
      return
    }
    const x = Math.max(8, Math.min(r.left + r.width / 2, window.innerWidth - label.length * 7 - 16))
    const y = side === 'bottom' ? r.bottom + 8 : r.top - 34
    timer.current = setTimeout(() => setPos({ x, y, tx: 'translateX(-50%)' }), delay)
  }
  const hide = () => {
    if (timer.current) clearTimeout(timer.current)
    setPos(null)
  }

  return (
    <span
      className="contents"
      onMouseEnter={show}
      onMouseLeave={hide}
      onMouseDown={hide}
    >
      {children}
      {pos && (
        <span className="cv-tip" style={{ left: pos.x, top: pos.y, transform: pos.tx }} role="tooltip">
          {label}
        </span>
      )}
    </span>
  )
}
