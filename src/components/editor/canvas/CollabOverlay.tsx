'use client'

import { memo } from 'react'
import type { Collaborator } from '@/lib/collab/protocol'

/**
 * Remote collaborator cursors + selections — DOM overlay above the Konva
 * stage (never enters Konva's render path; zero cost to canvas perf).
 */
export const CollabOverlay = memo(function CollabOverlay({
  collaborators,
  currentPage,
  pan,
  zoom,
  elements,
}: {
  collaborators: Collaborator[]
  currentPage: number
  pan: { x: number; y: number }
  zoom: number
  elements: { id: string; x: number; y: number; width: number; height: number }[]
}) {
  const byId = new Map(elements.map((e) => [e.id, e]))

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
      {collaborators.map((c) => {
        if (!c.cursor || c.cursor.page !== currentPage) return null
        const cx = pan.x + c.cursor.x * zoom
        const cy = pan.y + c.cursor.y * zoom

        const sel = (c.cursor.selection ?? [])
          .map((selId) => byId.get(selId))
          .filter(Boolean)
          .map((el) => {
            const ex = pan.x + el!.x * zoom
            const ey = pan.y + el!.y * zoom
            return (
              <div
                key={`${c.id}-${el!.id}`}
                className="absolute border-2 rounded-[2px]"
                style={{
                  left: ex,
                  top: ey,
                  width: el!.width * zoom,
                  height: el!.height * zoom,
                  borderColor: c.color,
                  boxShadow: `0 0 0 1px rgba(0,0,0,0.25) inset`,
                }}
              />
            )
          })

        return (
          <div key={c.id}>
            {sel}
            {/* cursor arrow (canva-style colored pointer with name tag) */}
            <div
              className="absolute transition-transform duration-75 ease-linear will-change-transform"
              style={{ transform: `translate(${cx}px, ${cy}px)` }}
            >
              <svg width="18" height="24" viewBox="0 0 18 24" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.45))' }}>
                <path d="M2 1 L2 19 L6.5 15 L9.5 22 L12.5 20.5 L9.5 14 L15.5 14 Z" fill={c.color} stroke="#FFFFFF" strokeWidth="1.3" />
              </svg>
              <span
                className="absolute left-4 top-5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-white shadow"
                style={{ background: c.color }}
              >
                {c.name}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
})
