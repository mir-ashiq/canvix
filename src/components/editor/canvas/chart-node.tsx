'use client'

// ─────────────────────────────────────────────────────────────
// chart-node (v0.14, D7) — the editor renderer for the data-bound
// chart element. A thin adapter: ALL geometry comes from
// lib/chart-geometry.ts (see that module's header for the parity
// contract with video-export.ts and svg-export.ts).
// ─────────────────────────────────────────────────────────────

import { Arc, Circle, Group, Line, Rect, Text } from 'react-konva'
import { chartPrimitives, type ChartPrimitive } from '@/lib/chart-geometry'
import type { ChartElement } from '@/lib/types'

/** Konva.Text positions its box TOP; chart primitives carry baselines.
 *  0.78 ≈ Inter's ascent — labels land within a pixel of the SVG export. */
const KONVA_TEXT_ASCENT = 0.78

function textProps(p: Extract<ChartPrimitive, { kind: 'text' }>) {
  const base = {
    y: p.y - p.size * KONVA_TEXT_ASCENT,
    text: p.text,
    fontSize: p.size,
    fontFamily: p.family,
    fill: p.fill,
    fontStyle: p.bold ? '700' : '400',
    perfectDrawEnabled: false as const,
  }
  // anchored text without measuring: center/right inside a wide box
  // offset from the anchor (SVG uses text-anchor — see svg-export.ts)
  if (p.anchor === 'middle') return { ...base, x: p.x - 2000, width: 4000, align: 'center' as const }
  if (p.anchor === 'end') return { ...base, x: p.x - 1000, width: 1000, align: 'right' as const }
  return { ...base, x: p.x }
}

function PrimNode({ p }: { p: ChartPrimitive }) {
  switch (p.kind) {
    case 'rect':
      return (
        <Rect
          x={p.x}
          y={p.y}
          width={p.w}
          height={p.h}
          cornerRadius={p.r ?? 0}
          fill={p.fill}
          stroke={p.stroke}
          strokeWidth={p.strokeWidth ?? 1}
        />
      )
    case 'line':
      return <Line points={[p.x1, p.y1, p.x2, p.y2]} stroke={p.stroke} strokeWidth={p.width} dash={p.dash} lineCap="round" />
    case 'polyline':
      return <Line points={p.points} stroke={p.stroke} strokeWidth={p.width} lineCap="round" lineJoin="round" />
    case 'circle':
      return <Circle x={p.cx} y={p.cy} radius={p.r} fill={p.fill} stroke={p.stroke} strokeWidth={p.strokeWidth ?? 1} />
    case 'arc':
      // Konva.Arc: sweep `angle` from `rotation` (degrees, 0 = 3 o'clock,
      // clockwise — the same convention as the geometry's radians)
      return (
        <Arc
          x={p.cx}
          y={p.cy}
          innerRadius={p.rIn}
          outerRadius={p.rOut}
          angle={((p.a1 - p.a0) * 180) / Math.PI}
          rotation={(p.a0 * 180) / Math.PI}
          fill={p.fill}
        />
      )
    case 'text':
      return <Text {...textProps(p)} />
  }
}

export function ChartNode({ el, common }: { el: ChartElement; common: Record<string, unknown> }) {
  const prims = chartPrimitives(el)
  return (
    <Group {...common} clip={undefined}>
      {/* invisible hit area — a fully transparent fill is not hittable
          in Konva, and charts with fill="transparent" must still be
          selectable/draggable like every other element */}
      <Rect width={el.width} height={el.height} fill="rgba(0,0,0,0.001)" />
      {prims.map((p, i) => (
        <PrimNode key={i} p={p} />
      ))}
    </Group>
  )
}
