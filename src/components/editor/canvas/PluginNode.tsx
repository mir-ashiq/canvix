'use client'

// ─────────────────────────────────────────────────────────────
// PluginNode — the canvas half of the renderer contract
// (research/PLUGIN-SYSTEM.md §4.5, P4).
//
// One `case 'plugin'` in element-node.tsx delegates here; this node
// asks the renderer cache what the element looks like and draws it:
//
//   render ok      → Konva Image fed by the sanitized data URL
//                    (the use-loaded-image cache dedupes decodes)
//   pending        → quiet neutral card (never blocks the editor)
//   any failure    → placeholder card: element label + plugin id +
//                    the honest reason (§4.9 matrix: flag off /
//                    not installed / disabled / not responding)
//
// The element itself is ordinary: selection, drag, transform, undo,
// animations and Beat Sync all apply through `common` — plugin
// elements are first-class citizens, only their pixels are delegated.
// ─────────────────────────────────────────────────────────────

import { useEffect, useSyncExternalStore } from 'react'
import { Group, Image as KonvaImage, Line, Rect, Text } from 'react-konva'
import type { PluginElement } from '@/lib/types'
import {
  getBrokerEpoch,
  getPluginSystemState,
  getRenderEntry,
  placeholderReason,
  renderKey,
  requestRender,
  subscribePluginSystem,
  subscribeRender,
} from '@/lib/plugins/renderer-cache'
import { useLoadedImage } from './use-loaded-image'

/** Placeholder palette — neutral on purpose: it must read as
 *  "data intact, renderer absent", never as an error state of the
 *  design itself. */
const CARD_FILL = '#F4F5F7'
const CARD_STROKE = '#C9CDD6'
const TITLE_FILL = '#3A3F4B'
const SUB_FILL = '#878E9C'

export function PluginNode({ el, common }: { el: PluginElement; common: Record<string, unknown> }) {
  const key = renderKey(el, 'canvas')

  // install/transport landscape as a value-stable string snapshot
  // (strings compare by value, so a rebuilt identical string is ===)
  const systemVersion = useSyncExternalStore(
    subscribePluginSystem,
    () => {
      const s = getPluginSystemState()
      return `${s.status}:${s.installs.size}:${getBrokerEpoch()}`
    },
    () => 'unknown:0:0',
  )

  const entry = useSyncExternalStore(
    (cb: () => void) => subscribeRender(key, cb),
    () => getRenderEntry(key),
    () => undefined,
  )

  // kick off (or re-kick after a broker/install change) whenever the
  // element's render identity or the plugin landscape changes
  useEffect(() => {
    requestRender(el, 'canvas')
  }, [el, key, systemVersion])

  const image = useLoadedImage(entry?.status === 'ok' ? entry.dataUrl : undefined)

  if (entry?.status === 'ok' && image) {
    return (
      <KonvaImage
        {...common}
        image={image}
        width={el.width}
        height={el.height}
        perfectDrawEnabled={false}
      />
    )
  }

  const reason =
    entry?.status === 'error'
      ? entry.message
      : placeholderReason(el)?.label ?? 'Preparing content…'
  return <PluginPlaceholder el={el} common={common} reason={reason} />
}

/** The neutral degradation card (§4.5 "Failure", §4.9 matrix). */
function PluginPlaceholder({
  el,
  common,
  reason,
}: {
  el: PluginElement
  common: Record<string, unknown>
  reason: string
}) {
  const w = Math.max(24, el.width)
  const h = Math.max(24, el.height)
  const title = el.name?.trim() || el.kind
  const titleSize = Math.max(11, Math.min(20, Math.round(Math.min(w, h) / 12)))
  const subSize = Math.max(9, Math.round(titleSize * 0.72))
  const lines = wrapCardLines(reason, w * 0.86, subSize)
  const blockH = titleSize * 0.9 + titleSize + 6 + lines.length * (subSize + 3)
  const startY = Math.max((h - blockH) / 2, 6)

  return (
    <Group {...common}>
      <Rect
        width={w}
        height={h}
        fill={CARD_FILL}
        stroke={CARD_STROKE}
        strokeWidth={1}
        cornerRadius={Math.min(10, Math.min(w, h) / 8)}
        dash={[6, 4]}
        listening={false}
      />
      {/* puzzle-ish glyph: a rounded diamond, vector-only (export-safe) */}
      <Line
        x={w / 2}
        y={startY + titleSize * 0.35}
        points={[-titleSize * 0.5, 0, 0, -titleSize * 0.36, titleSize * 0.5, 0, 0, titleSize * 0.36]}
        closed
        fill={CARD_STROKE}
        listening={false}
      />
      <Text
        y={startY + titleSize * 0.9}
        width={w}
        align="center"
        text={title}
        fontSize={titleSize}
        fontStyle="600"
        fontFamily="Inter, system-ui, sans-serif"
        fill={TITLE_FILL}
        listening={false}
        perfectDrawEnabled={false}
      />
      {lines.map((line, i) => (
        <Text
          key={i}
          y={startY + titleSize * 0.9 + titleSize + 6 + i * (subSize + 3)}
          width={w}
          align="center"
          text={line}
          fontSize={subSize}
          fontFamily="Inter, system-ui, sans-serif"
          fill={SUB_FILL}
          listening={false}
          perfectDrawEnabled={false}
        />
      ))}
      <Text
        y={Math.max(4, h - subSize - 6)}
        width={w}
        align="center"
        text={el.pluginId}
        fontSize={Math.max(8, subSize - 1)}
        fontFamily="Inter, system-ui, sans-serif"
        fill={SUB_FILL}
        opacity={0.75}
        listening={false}
        perfectDrawEnabled={false}
      />
    </Group>
  )
}

/** Cheap greedy wrap for the reason line(s), capped at 3 lines. */
function wrapCardLines(text: string, maxWidth: number, fontSize: number): string[] {
  const charW = fontSize * 0.54
  const perLine = Math.max(12, Math.floor(maxWidth / charW))
  const words = text.split(/\s+/)
  const out: string[] = []
  let line = ''
  for (const word of words) {
    if ((line ? `${line} ${word}` : word).length > perLine && line) {
      out.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) out.push(line)
  return out.slice(0, 3)
}
