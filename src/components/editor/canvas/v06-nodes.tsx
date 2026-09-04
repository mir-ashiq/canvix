'use client'

// ─────────────────────────────────────────────────────────────
// v0.6 node renderers — curved text, tables, frames, embeds
// ─────────────────────────────────────────────────────────────

import Konva from 'konva'
import { Ellipse, Group, Image as KonvaImage, Line, Path, Rect, Text, TextPath } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { EmbedElement, FrameElement, TableElement, TextElement } from '@/lib/types'
import { withAlpha } from '@/lib/types'
import { arcForCurve, embedLayout, hexPoints, hostOf, tableGeometry, youtubeThumbUrl } from '@/lib/v06-geometry'
import { useLoadedImage } from './use-loaded-image'

// ── curved text ──────────────────────────────────────────────

/** Curved text — rendered as a single Konva TextPath (no wrapping, canva-style). */
export function CurvedTextNode({ t, common }: { t: TextElement; common: Record<string, unknown> }) {
  const arc = arcForCurve(t.curve ?? 0, t.width)
  const rendered = t.uppercase ? t.text.toUpperCase() : t.text
  if (!arc) {
    return (
      <Text
        {...common}
        text={rendered}
        fontSize={t.fontSize}
        fontFamily={t.fontFamily}
        fontStyle={`${t.italic ? 'italic ' : ''}${t.bold ? 'bold' : 'normal'}`}
        textDecoration={[t.underline ? 'underline' : '', t.strike ? 'line-through' : ''].filter(Boolean).join(' ')}
        fill={t.fill}
        align={t.align === 'justify' ? 'left' : t.align}
        width={t.width}
        lineHeight={t.lineHeight}
        letterSpacing={t.letterSpacing}
        wrap="word"
        perfectDrawEnabled={false}
      />
    )
  }
  return (
    <TextPath
      {...common}
      data={arc.data}
      text={rendered}
      fontSize={t.fontSize}
      fontFamily={t.fontFamily}
      fontStyle={`${t.italic ? 'italic ' : ''}${t.bold ? 'bold' : 'normal'}`}
      textDecoration={[t.underline ? 'underline' : '', t.strike ? 'line-through' : ''].filter(Boolean).join(' ')}
      fill={t.fill}
      letterSpacing={t.letterSpacing}
      perfectDrawEnabled={false}
    />
  )
}

// ── tables ───────────────────────────────────────────────────

export interface TableCellRef {
  row: number
  col: number
}

export function TableNode({
  el,
  common,
  interactive,
  onCellDoubleClick,
  hideCell,
}: {
  el: TableElement
  common: Record<string, unknown>
  interactive?: boolean
  onCellDoubleClick?: (cell: TableCellRef) => void
  /** the cell whose text is being edited via the overlay (hidden underneath) */
  hideCell?: TableCellRef | null
}) {
  const { colX, colW, rowH } = tableGeometry(el)
  const bw = el.borderWidth

  const cellNodes = Array.from({ length: el.rows * el.cols }, (_, idx) => {
    const r = Math.floor(idx / el.cols)
    const c = idx % el.cols
    const cell = el.cells[idx] ?? { text: '' }
    const isHeader = r === 0
    const cellFill = cell.fill ?? (isHeader ? el.headerFill : el.fill)
    const hidingThis = hideCell && hideCell.row === r && hideCell.col === c
    const startDbl = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (!interactive) return
      e.cancelBubble = true
      onCellDoubleClick?.({ row: r, col: c })
    }
    return (
      <Group key={`c${idx}`}>
        <Rect
          x={colX[c]}
          y={r * rowH}
          width={colW[c]}
          height={rowH}
          fill={cellFill === 'transparent' ? undefined : cellFill}
          stroke={el.borderColor}
          strokeWidth={bw}
          onDblClick={startDbl}
          onDblTap={startDbl}
        />
        <Text
          x={colX[c] + 10}
          y={r * rowH}
          width={Math.max(8, colW[c] - 20)}
          height={rowH}
          text={cell.text}
          fontSize={el.fontSize}
          fontFamily={el.fontFamily}
          fontStyle={cell.bold || isHeader ? 'bold' : 'normal'}
          fill={isHeader ? (el.headerTextColor ?? '#FFFFFF') : el.textColor}
          verticalAlign="middle"
          align="left"
          wrap="none"
          ellipsis
          visible={!hidingThis}
          onDblClick={startDbl}
          onDblTap={startDbl}
          perfectDrawEnabled={false}
        />
      </Group>
    )
  })

  return <Group {...common} clip={undefined}>{cellNodes}</Group>
}

// ── frames ───────────────────────────────────────────────────

function roundedRectPath(ctx: Konva.Context, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(rr, 0)
  ctx.lineTo(w - rr, 0)
  ctx.quadraticCurveTo(w, 0, w, rr)
  ctx.lineTo(w, h - rr)
  ctx.quadraticCurveTo(w, h, w - rr, h)
  ctx.lineTo(rr, h)
  ctx.quadraticCurveTo(0, h, 0, h - rr)
  ctx.lineTo(0, rr)
  ctx.quadraticCurveTo(0, 0, rr, 0)
  ctx.closePath()
}

function polygonPath(ctx: Konva.Context, pts: [number, number][]) {
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1])
  ctx.closePath()
}

/** clip function for a frame shape (used by the Konva group) */
function frameClip(el: FrameElement) {
  return (ctx: Konva.Context) => {
    const { width: w, height: h } = el
    switch (el.frameShape) {
      case 'ellipse':
      case 'circle': {
        const rx = el.frameShape === 'circle' ? Math.min(w, h) / 2 : w / 2
        const ry = el.frameShape === 'circle' ? Math.min(w, h) / 2 : h / 2
        ctx.beginPath()
        ctx.ellipse(w / 2, h / 2, rx, ry, 0, 0, Math.PI * 2, false)
        ctx.closePath()
        break
      }
      case 'triangle':
        polygonPath(ctx, [[0, h], [w / 2, 0], [w, h]])
        break
      case 'hexagon':
        polygonPath(ctx, hexPoints(w, h))
        break
      default:
        roundedRectPath(ctx, w, h, el.radius)
    }
  }
}

/** placeholder outline shape for an empty frame */
function framePlaceholder(el: FrameElement) {
  const stroke = withAlpha('#FFFFFF', 0.85)
  switch (el.frameShape) {
    case 'ellipse':
    case 'circle': {
      const rx = el.frameShape === 'circle' ? Math.min(el.width, el.height) / 2 : el.width / 2
      const ry = el.frameShape === 'circle' ? Math.min(el.width, el.height) / 2 : el.height / 2
      return <Ellipse x={el.width / 2} y={el.height / 2} radiusX={rx} radiusY={ry} fill={withAlpha(el.fill, 0.16)} stroke={stroke} strokeWidth={2} dash={[8, 6]} />
    }
    case 'triangle':
      return <Line points={[0, el.height, el.width / 2, 0, el.width, el.height]} closed fill={withAlpha(el.fill, 0.16)} stroke={stroke} strokeWidth={2} dash={[8, 6]} />
    case 'hexagon': {
      const pts = hexPoints(el.width, el.height)
      return <Line points={pts.flat()} closed fill={withAlpha(el.fill, 0.16)} stroke={stroke} strokeWidth={2} dash={[8, 6]} />
    }
    default:
      return <Rect width={el.width} height={el.height} cornerRadius={el.radius} fill={withAlpha(el.fill, 0.16)} stroke={stroke} strokeWidth={2} dash={[8, 6]} />
  }
}

export function FrameNode({ el, common }: { el: FrameElement; common: Record<string, unknown> }) {
  const image = useLoadedImage(el.src || undefined)

  // cover-fit the image inside the frame box
  let img: React.ReactNode = null
  if (image && el.naturalWidth > 0 && el.naturalHeight > 0) {
    const scale = Math.max(el.width / el.naturalWidth, el.height / el.naturalHeight)
    const dw = el.naturalWidth * scale
    const dh = el.naturalHeight * scale
    const dx = (el.width - dw) / 2
    const dy = (el.height - dh) / 2
    img = <KonvaImage image={image} x={dx} y={dy} width={dw} height={dh} listening={false} />
  }

  return (
    <Group {...common} clip={undefined} clipFunc={frameClip(el)}>
      {img ?? framePlaceholder(el)}
    </Group>
  )
}

// ── embed cards ──────────────────────────────────────────────

/** Embed card — a native vector link card (opens in the browser on click). */
export function EmbedNode({ el, common }: { el: EmbedElement; common: Record<string, unknown> }) {
  const w = el.width
  const h = el.height
  const thumbUrl = el.kind === 'youtube' ? youtubeThumbUrl(el.url) : null
  const thumb = useLoadedImage(thumbUrl ?? undefined)

  const { bandH, iconR } = embedLayout(w, h)
  const cx = w / 2
  const cy = bandH / 2

  // icon glyphs (pure vector, export-safe)
  let glyph: React.ReactNode = null
  if (el.kind === 'youtube') {
    glyph = (
      <Group>
        <Ellipse x={cx} y={cy} radiusX={iconR} radiusY={iconR} fill="rgba(255,255,255,0.92)" />
        <Line points={[cx - iconR * 0.32, cy - iconR * 0.42, cx - iconR * 0.32, cy + iconR * 0.42, cx + iconR * 0.46, cy]} closed fill="#FF0033" />
      </Group>
    )
  } else if (el.kind === 'map') {
    glyph = (
      <Group>
        <Ellipse x={cx} y={cy} radiusX={iconR} radiusY={iconR} fill="rgba(255,255,255,0.95)" />
        <Ellipse x={cx} y={cy - iconR * 0.12} radiusX={iconR * 0.34} radiusY={iconR * 0.46} fill="#34A853" />
        <Line points={[cx - iconR * 0.24, cy + iconR * 0.1, cx, cy + iconR * 0.58, cx + iconR * 0.24, cy + iconR * 0.1]} closed fill="#34A853" />
      </Group>
    )
  } else {
    const s = iconR * 0.8
    glyph = (
      <Group>
        <Ellipse x={cx} y={cy} radiusX={iconR} radiusY={iconR} fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.9)" strokeWidth={2.5} />
        <Path
          data={`M ${cx - s * 0.4} ${cy + s * 0.4} L ${cx + s * 0.42} ${cy - s * 0.42} M ${cx - s * 0.05} ${cy - s * 0.42} L ${cx + s * 0.42} ${cy - s * 0.42} L ${cx + s * 0.42} ${cy + s * 0.05}`}
          stroke="#FFFFFF"
          strokeWidth={Math.max(2, iconR * 0.16)}
          lineCap="round"
          lineJoin="round"
        />
      </Group>
    )
  }

  return (
    <Group {...common} clip={undefined}>
      <Rect width={w} height={h} cornerRadius={14} fill="#15171C" />
      {/* media band */}
      {thumb ? (
        <KonvaImage image={thumb} y={0} width={w} height={bandH} crop={{ x: 45, y: 0, width: 270, height: 157 }} listening={false} />
      ) : (
        <Rect y={0} width={w} height={bandH} cornerRadius={[14, 14, 0, 0]} fill={withAlpha(el.tint, 0.28)} />
      )}
      {glyph}
      {/* text block */}
      <Text
        x={14}
        y={bandH + 10}
        width={Math.max(8, w - 28)}
        height={18}
        text={hostOf(el.url).toUpperCase()}
        fontSize={Math.max(9, Math.round(h * 0.055))}
        fontFamily="Inter"
        fill="rgba(255,255,255,0.55)"
        letterSpacing={1.2}
        wrap="none"
        ellipsis
        listening={false}
        perfectDrawEnabled={false}
      />
      <Text
        x={14}
        y={bandH + 30}
        width={Math.max(8, w - 28)}
        height={Math.max(16, h - bandH - 40)}
        text={el.title ?? el.url}
        fontSize={Math.max(11, Math.round(h * 0.07))}
        fontFamily="Inter"
        fontStyle="600"
        fill="#FFFFFF"
        wrap="word"
        ellipsis
        listening={false}
        perfectDrawEnabled={false}
      />
    </Group>
  )
}
