'use client'

import Konva from 'konva'
import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { Ellipse, Group, Image as KonvaImage, Line, Path, Rect, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type {
  AnyElement,
  AudioElement,
  ChartElement,
  EmbedElement,
  FrameElement,
  GroupElement,
  ImageElement,
  LineElement,
  PluginElement,
  ShapeElement,
  StickerElement,
  StrokeElement,
  TableElement,
  TextElement,
  VideoElement,
} from '@/lib/types'
import { isLine, withAlpha, type GradientFill } from '@/lib/types'
import { elementGradientProps } from '@/lib/editor-utils'
import { useEditorStore } from '@/store/editor-store'
import { useLoadedImage } from './use-loaded-image'
import { isImageFilterId, clampFilterIntensity, applyPresetToImageData } from '@/lib/image-filters'
import { createCanvasMeasure, layoutRichLines, normalizeSpans } from '@/lib/rich-text'
import type { TextSpan } from '@/lib/types'
import { CurvedTextNode, EmbedNode, FrameNode, TableNode, type TableCellRef } from './v06-nodes'
import { PluginNode } from './PluginNode'
import { ChartNode } from './chart-node'
import { isMaskShape, maskPolygon, polygonPoints, starPointsEx, stretchPts, tracePts, type MaskShape } from '@/lib/shapes'
import { stickerDataUrl } from '@/lib/sticker-image'
import { fitFontSize } from '@/lib/text-fit'
import { layoutListLines } from '@/lib/list-text'

export interface ElementNodeProps {
  element: AnyElement
  /** editor mode: interactions enabled */
  interactive?: boolean
  /** text element currently being edited via overlay (hide the Konva text) */
  hiding?: boolean
  /** register node ref for the Transformer (editor) */
  registerNode?: (id: string, node: Konva.Node | null) => void
  /** called on every drag move so the parent can apply snapping to the node */
  onDragMoveNode?: (id: string, node: Konva.Node) => void
  /** called when a drag finishes (parent clears snapping guides) */
  onDragEndNode?: (id: string) => void
  /** double-click / double-tap (text editing; tables report the clicked cell) */
  onDoubleClick?: (id: string, cell?: TableCellRef) => void
  /** table cell currently edited via the overlay (its text is hidden underneath) */
  hideCell?: TableCellRef | null
  /** render nested (inside a group / preview) — page coords are baked by the parent */
  nested?: boolean
}

function shadowProps(el: AnyElement) {
  if (!el.shadow?.enabled) {
    return {
      shadowColor: 'transparent',
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
    }
  }
  return {
    shadowColor: el.shadow.color,
    shadowBlur: el.shadow.blur,
    shadowOffsetX: el.shadow.offsetX,
    shadowOffsetY: el.shadow.offsetY,
  }
}

/** canva-style text effect presets → Konva text attrs */
/** v0.15 (R1): the browser-side measure for rich text layout — canvas 2d
 *  with the codebase's graceful no-canvas fallback (svg-export pattern). */
const richMeasure = createCanvasMeasure()

/** v0.18 (Wave 3): the effective font size of a text element — the
 *  authored size, or the auto-fit shrink when enabled. ONE definition
 *  shared by the canvas, the SVG serializer and (through Konva) the
 *  video exporter, so every surface agrees to the pixel. */
export function effectiveFontSize(t: TextElement): number {
  if (!t.autoFit) return t.fontSize
  return fitFontSize(
    {
      text: t.uppercase ? t.text.toUpperCase() : t.text,
      fontFamily: t.fontFamily,
      bold: t.bold,
      italic: t.italic,
      letterSpacing: t.letterSpacing,
      lineHeight: t.lineHeight,
      fontSize: t.fontSize,
    },
    { width: t.width, height: t.height },
    (text, style) => richMeasure(text, style)
  )
}

/** v0.18 (Wave 3): a text element renders through the list layout when a
 *  list style is set (flat path — rich spans and curved text keep their
 *  own single-style renders, documented in docs/EDITOR-DEPTH.md). */
function isListText(t: TextElement): boolean {
  return !!t.listStyle && t.listStyle !== 'none' && (t.curve ?? 0) === 0 && t.effect !== 'splice'
}

/** shift a Konva gradient's anchor points so a per-run node maps the
 *  ELEMENT-box gradient continuously instead of restarting per run */
function shiftGradientForRun(grad: Record<string, unknown>, dx: number, dy: number): Record<string, unknown> {
  const pointKeys = new Set([
    'fillLinearGradientStartPoint', 'fillLinearGradientEndPoint',
    'fillRadialGradientStartPoint', 'fillRadialGradientEndPoint',
  ])
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(grad)) {
    if (pointKeys.has(k) && v && typeof v === 'object') {
      const p = v as { x: number; y: number }
      out[k] = { x: p.x - dx, y: p.y - dy }
    } else {
      out[k] = v
    }
  }
  return out
}

/**
 * v0.15 (R1): rich text — one Konva.Text per positioned run at the exact
 * coordinates from the shared geometry module (src/lib/rich-text.ts);
 * the SVG serializer and the video-export frame builder draw the SAME
 * positions. Gradient fills map across the whole element box via
 * per-run point offsets; hollow/outline strokes follow the run colour.
 * The Group carries an explicit block height so the post-edit height
 * sync (CanvasStage's rAF) reads the true text block height, matching
 * the flat Konva.Text behaviour.
 */
function RichTextNode({
  t,
  spans,
  common,
  effect,
}: {
  t: TextElement
  spans: TextSpan[]
  common: Record<string, unknown>
  effect: Record<string, unknown>
}) {
  const runs = useMemo(() => layoutRichLines(t, spans, richMeasure), [t, spans])
  const blockH = runs.length
    ? Math.max(...runs.map((r) => r.y)) + t.fontSize * t.lineHeight
    : t.fontSize * t.lineHeight
  const grad =
    t.fillGradient && (!t.effect || ['none', 'shadow', 'lift', 'echo', 'splice'].includes(t.effect))
      ? elementGradientProps(t.fillGradient, t.width, Math.max(t.height, blockH), 'corner')
      : {}
  const strokeEffect = t.effect === 'hollow' || t.effect === 'outline'
  return (
    <Group {...common} height={blockH}>
      {/* the element's declared box as a transparent hit rect — keeps the
          Group's clientRect (and therefore the Transformer's anchors and
          the click/marquee hit region) on the DECLARED box exactly like
          the flat Konva.Text, instead of the tight glyph bbox (without
          it, a click at the element centre lands on a bottom anchor and
          fires a phantom transformstart → an undo step that changes
          nothing) */}
      <Rect width={t.width} height={Math.max(t.height, blockH)} fill="transparent" perfectDrawEnabled={false} />
      {t.effect === 'background' && (
        <Rect width={t.width} height={Math.max(t.height, blockH)} fill={t.effectBackground ?? '#EFEFEF'} cornerRadius={Math.min(8, t.fontSize * 0.2)} />
      )}
      {runs.map((run, i) => {
        const runGrad =
          Object.keys(grad).length && !strokeEffect && run.style.color === t.fill
            ? shiftGradientForRun(grad, run.x, run.y)
            : {}
        const runEffect = strokeEffect ? { ...effect, fill: 'transparent', stroke: run.style.color } : effect
        return (
          <Text
            key={i}
            x={run.x}
            y={run.y}
            text={run.text}
            fontSize={t.fontSize}
            fontFamily={t.fontFamily}
            fontStyle={`${run.style.italic ? 'italic ' : ''}${run.style.bold ? 'bold' : 'normal'}`}
            textDecoration={[run.style.underline ? 'underline' : '', run.style.strike ? 'line-through' : ''].filter(Boolean).join(' ')}
            fill={Object.keys(runGrad).length ? undefined : run.style.color}
            {...runGrad}
            {...runEffect}
            perfectDrawEnabled={false}
          />
        )
      })}
    </Group>
  )
}

/** v0.18 (Wave 3): bullet / numbered list text — one Konva.Text per
 *  pre-wrapped line plus a marker glyph at the hanging indent, all
 *  positioned by the shared geometry module (lib/list-text.ts) so the
 *  SVG serializer emits byte-identical positions. */
function ListTextNode({
  t,
  common,
  effect,
}: {
  t: TextElement
  common: Record<string, unknown>
  effect: Record<string, unknown>
}) {
  const size = effectiveFontSize(t)
  const rtl = t.direction === 'rtl'
  const rendered = t.uppercase ? t.text.toUpperCase() : t.text
  const lines = useMemo(
    () =>
      layoutListLines(
        {
          text: rendered,
          fontFamily: t.fontFamily,
          bold: t.bold,
          italic: t.italic,
          letterSpacing: t.letterSpacing,
          lineHeight: t.lineHeight,
          fontSize: size,
          width: t.width,
          listStyle: t.listStyle ?? 'none',
          direction: rtl ? 'rtl' : 'ltr',
        },
        (text, style) => richMeasure(text, style)
      ),
    [rendered, t.fontFamily, t.bold, t.italic, t.letterSpacing, t.lineHeight, size, t.width, t.listStyle, rtl]
  )
  const blockH = lines.length ? Math.max(...lines.map((l) => l.y)) + size * t.lineHeight : size * t.lineHeight
  const fontStyle = `${t.italic ? 'italic ' : ''}${t.bold ? 'bold' : 'normal'}`
  // rtl mirrors the default alignment (an explicit centre stays centred)
  const align =
    t.align === 'center' ? 'center' : t.align === 'justify' ? 'left' : rtl ? (t.align === 'left' ? 'right' : 'left') : t.align
  return (
    <Group {...common} height={blockH}>
      {/* declared-box hit rect — mirrors RichTextNode */}
      <Rect width={t.width} height={Math.max(t.height, blockH)} fill="transparent" perfectDrawEnabled={false} />
      {t.effect === 'background' && (
        <Rect width={t.width} height={Math.max(t.height, blockH)} fill={t.effectBackground ?? '#EFEFEF'} cornerRadius={Math.min(8, size * 0.2)} />
      )}
      {lines.map((line, i) => (
        <Group key={i}>
          {line.marker && (
            <Text
              x={line.markerX}
              y={line.y}
              text={line.marker}
              fontSize={size}
              fontFamily={t.fontFamily}
              fontStyle={fontStyle}
              fill={t.fill}
              width={t.width}
              align={rtl ? 'right' : 'left'}
              perfectDrawEnabled={false}
            />
          )}
          <Text
            x={line.textX}
            y={line.y}
            text={line.text}
            fontSize={size}
            fontFamily={t.fontFamily}
            fontStyle={fontStyle}
            textDecoration={[t.underline ? 'underline' : '', t.strike ? 'line-through' : ''].filter(Boolean).join(' ')}
            fill={t.fill}
            align={align}
            width={line.textWidth}
            lineHeight={t.lineHeight}
            letterSpacing={t.letterSpacing}
            wrap="none"
            perfectDrawEnabled={false}
          />
        </Group>
      ))}
    </Group>
  )
}

function textEffectProps(t: TextElement): Record<string, string | number> {
  switch (t.effect) {
    case 'shadow':
      return { shadowColor: withAlpha('#000000', 0.35), shadowBlur: 14, shadowOffsetX: 0, shadowOffsetY: 5 }
    case 'lift':
      return { shadowColor: withAlpha('#000000', 0.55), shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 9 }
    case 'hollow':
      return { fill: 'transparent', stroke: t.fill, strokeWidth: Math.max(1, t.fontSize * 0.05), lineJoin: 'round' as unknown as string }
    case 'neon':
      return { shadowColor: t.fill, shadowBlur: 30, shadowOffsetX: 0, shadowOffsetY: 0 }
    case 'glow':
      return { shadowColor: withAlpha(t.fill, 0.85), shadowBlur: 12, shadowOffsetX: 0, shadowOffsetY: 0 }
    case 'outline':
      return { stroke: t.fill, strokeWidth: Math.max(1, t.fontSize * 0.045), lineJoin: 'round' as unknown as string }
    case 'echo':
      return { shadowColor: withAlpha(t.fill, 0.45), shadowBlur: 0, shadowOffsetX: Math.max(4, t.fontSize * 0.12), shadowOffsetY: Math.max(4, t.fontSize * 0.12) }
    case 'splice':
      return { shadowColor: withAlpha(t.fill, 0.5), shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: -Math.max(3, t.fontSize * 0.09) }
    default:
      return {}
  }
}

/** v0.22 sticker packs: an authored vector sticker drawn as a cached
 *  bitmap. The SVG rides the same data-URL image cache photos use
 *  (decode once per markup string, app-wide); until decode finishes
 *  Konva paints nothing — a blank frame at most on first add. */
function StickerVectorNode({ el, common }: { el: StickerElement; common: Record<string, unknown> }) {
  const image = useLoadedImage(el.svg ? stickerDataUrl(el.svg) : undefined)
  return <KonvaImage {...common} image={image ?? undefined} width={el.width} height={el.height} />
}

/** image with Konva filters (brightness / contrast / saturation).
 *  v0.18 (Wave 3): optional shape mask — the image clips to a polygon
 *  (lib/shapes.ts) drawn into the Group's clipShapeFunc, so filters,
 *  flips, adjustments and the Transformer all keep working unchanged. */
function ImageNode({ el, common }: { el: ImageElement; common: Record<string, unknown> }) {
  const image = useLoadedImage(el.src)
  const nodeRef = useRef<Konva.Image | null>(null)

  const bright = (el.brightness ?? 0) / 100 // konva Brighten: -0.5..0.5 approx
  const contrast = el.contrast ?? 0
  const sat = el.saturation ?? 0
  // v0.14 (D4): filter-gallery preset rides the same cached pipeline
  const preset = isImageFilterId(el.filter) ? el.filter : 'none'
  const intensity = clampFilterIntensity(el.filterIntensity) / 100
  const needsFilters = bright !== 0 || contrast !== 0 || sat !== 0 || (preset !== 'none' && intensity > 0)

  useEffect(() => {
    const node = nodeRef.current
    if (!node || !image) return
    const filters: Konva.Filter[] = []
    if (bright !== 0) filters.push(Konva.Filters.Brighten)
    if (contrast !== 0) filters.push(Konva.Filters.Contrast)
    if (sat !== 0) filters.push(Konva.Filters.HSL)
    if (preset !== 'none' && intensity > 0) {
      // pure pixel kernel as a Konva filter (no `this` needed)
      const id = preset
      const t = intensity
      filters.push((imageData: ImageData) => applyPresetToImageData(imageData, id, t))
    }
    node.filters(filters)
    node.brightness(bright)
    node.contrast(contrast)
    node.saturation(sat / 100)
    if (filters.length) node.cache()
    else node.clearCache()
    node.getLayer()?.batchDraw()
  }, [image, bright, contrast, sat, preset, intensity])

  // v0.18 (Wave 3): validated mask — hostile pastes can't smuggle junk in
  const maskPts = useMemo(() => {
    if (!isMaskShape(el.maskShape) || el.maskShape === 'none') return null
    return maskPolygon(el.maskShape as MaskShape, el.maskSides, el.maskInnerRatio)
  }, [el.maskShape, el.maskSides, el.maskInnerRatio])

  const img = (
    <KonvaImage
      ref={(n) => { nodeRef.current = n; (common.ref as (node: Konva.Node | null) => void | undefined)?.(n) }}
      image={image ?? undefined}
      width={el.width}
      height={el.height}
      cornerRadius={maskPts ? 0 : el.radius}
      scaleX={el.flipH ? -1 : 1}
      scaleY={el.flipV ? -1 : 1}
      offsetX={el.flipH ? el.width : 0}
      offsetY={el.flipV ? el.height : 0}
    />
  )

  if (!maskPts) {
    return <Group {...common} clip={undefined}>{img}</Group>
  }
  return (
    <Group
      {...common}
      clip={undefined}
      clipShapeFunc={(ctx) => tracePts(ctx, maskPts, el.width, el.height)}
    >
      {img}
    </Group>
  )
}

/** v0.11: audio — waveform player card. Pure vector: dark rounded card,
 *  peak bars from the baked-in analysis (so every replica renders it
 *  without the multi-MB file), a play glyph, the name, duration and a
 *  Beat Sync chip when a grid was detected. Playback happens in
 *  preview/present (see preview-stage.tsx), never in the editor canvas. */
function AudioNode({ el, common }: { el: AudioElement; common: Record<string, unknown> }) {
  const peaks = el.peaks && el.peaks.length ? el.peaks : null
  const barCount = peaks ? Math.min(peaks.length, Math.max(24, Math.floor(el.width / 6))) : 48
  const bars: number[] = []
  if (peaks) {
    for (let i = 0; i < barCount; i++) {
      bars.push(peaks[Math.floor((i / barCount) * peaks.length)] ?? 0)
    }
  }
  const barW = 3
  const gap = peaks ? Math.max(1.5, (el.width - 116 - barCount * barW) / Math.max(1, barCount - 1)) : 4
  const midY = el.height / 2

  return (
    <Group {...common} clip={undefined}>
      <Rect width={el.width} height={el.height} cornerRadius={14} fill="#1B1D27" stroke="#FFFFFF22" strokeWidth={1} />
      {/* play glyph */}
      <Path
        x={18}
        y={midY - 13}
        data="M13 0 L26 13 L13 26 Z"
        fill="#02C0CC"
      />
      {/* waveform */}
      {bars.length > 0 ? (
        bars.map((v, i) => {
          const h = Math.max(2, v * (el.height - 34))
          return (
            <Rect
              key={i}
              x={116 + i * (barW + gap)}
              y={midY - h / 2}
              width={barW}
              height={h}
              cornerRadius={1.5}
              fill="#7BE8E1"
              opacity={0.35 + 0.65 * v}
            />
          )
        })
      ) : (
        <Text x={116} y={midY - 8} text="♪" fontSize={20} fill="#7BE8E1" />
      )}
      {/* label + duration */}
      <Text
        x={18}
        y={el.height - 20}
        text={el.name.slice(0, 42)}
        fontSize={11}
        fontFamily="Inter, system-ui, sans-serif"
        fill="#FFFFFF99"
        width={el.width - 36}
        ellipsis
      />
      <Text
        x={el.width - 62}
        y={10}
        text={formatDuration(el.duration)}
        fontSize={11}
        fontFamily="Inter, system-ui, sans-serif"
        fill="#FFFFFF66"
      />
      {el.bpm ? (
        <Group x={el.width - 62} y={el.height - 21}>
          <Rect width={50} height={14} cornerRadius={7} fill="#02C0CC26" />
          <Text x={4} y={2.5} text={`${Math.round(el.bpm)} BPM`} fontSize={9} fontFamily="Inter, system-ui, sans-serif" fill="#02C0CC" />
        </Group>
      ) : null}
    </Group>
  )
}

/** v0.11: video — poster frame + play affordance + duration chip. The
 *  poster is a dataURL captured at upload, so it renders identically on
 *  every replica and in exports. Frame playback runs in preview/present. */
function VideoNode({ el, common }: { el: VideoElement; common: Record<string, unknown> }) {
  const image = useLoadedImage(el.poster)
  const isTrimmed = el.trimStart > 0.05 || el.trimEnd < el.duration - 0.05
  return (
    <Group {...common} clip={undefined}>
      <Rect width={el.width} height={el.height} cornerRadius={12} fill="#101218" />
      <KonvaImage
        image={image ?? undefined}
        x={0}
        y={0}
        width={el.width}
        height={el.height}
        cornerRadius={12}
        crop={undefined}
      />
      {/* play affordance */}
      <Group x={el.width / 2 - 24} y={el.height / 2 - 24} opacity={0.92}>
        <Ellipse radiusX={24} radiusY={24} fill="#000000AA" />
        <Path x={24 - 8} y={24 - 10} data="M0 0 L16 10 L0 20 Z" fill="#FFFFFF" />
      </Group>
      <Text
        x={el.width - 62}
        y={10}
        text={formatDuration(el.duration)}
        fontSize={11}
        fontFamily="Inter, system-ui, sans-serif"
        fill="#FFFFFFCC"
      />
      {isTrimmed && (
        <Group x={12} y={10}>
          <Rect width={44} height={14} cornerRadius={7} fill="#FFB84C26" />
          <Text x={5} y={2.5} text="TRIM" fontSize={9} fontFamily="Inter, system-ui, sans-serif" fill="#FFB84C" />
        </Group>
      )}
    </Group>
  )
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function ElementNodeImpl({ element: el, interactive, hiding, hideCell, registerNode, onDragMoveNode, onDragEndNode, onDoubleClick, nested }: ElementNodeProps) {
  // v0.7 rendering performance: this component no longer subscribes to the
  // editor store. Store actions are read at event time via getState(), and
  // the component is memoized (see bottom of file) — it re-renders only when
  // its own element changes identity. Combined with structural sharing in
  // the store, a keystroke or remote live edit re-renders exactly ONE node
  // instead of the whole canvas.

  // ── shared interaction handlers ────────────────────────────
  const handleClick = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!interactive) return
    e.cancelBubble = true
    const additive = !!e.evt && 'shiftKey' in e.evt && (e.evt as MouseEvent).shiftKey
    const store = useEditorStore.getState()
    if (additive) {
      store.selectToggle(el.id)
    } else {
      store.setSelection([el.id])
    }
  }

  const handleDragStart = () => {
    if (!interactive) return
    const store = useEditorStore.getState()
    store.pushHistory()
    store.setSelection([el.id])
  }

  const handleDragMove = (node: Konva.Node) => {
    if (!interactive) return
    // position is applied directly to the node; state is committed on dragEnd
    onDragMoveNode?.(el.id, node)
  }

  const handleDragEnd = (node: Konva.Node) => {
    if (!interactive) return
    const store = useEditorStore.getState()
    if (el.type === 'group') {
      // bake drag delta into children so ungroup restores the moved positions
      const g = el as GroupElement
      const dx = node.x() - g.x
      const dy = node.y() - g.y
      store.updateElementsLive([el.id], {
        x: Math.round(node.x()),
        y: Math.round(node.y()),
        children: g.children.map((c) => ({ ...c, x: Math.round(c.x + dx), y: Math.round(c.y + dy) })),
      })
      return
    }
    if (el.type === 'ellipse' || el.type === 'star' || el.type === 'polygon') {
      store.updateElementsLive([el.id], { x: node.x() - el.width / 2, y: node.y() - el.height / 2 })
    } else {
      store.updateElementsLive([el.id], { x: node.x(), y: node.y() })
    }
  }

  const handleTransformStart = () => {
    if (!interactive) return
    const store = useEditorStore.getState()
    store.pushHistory()
    store.setSelection([el.id])
  }

  const handleTransformEnd = (node: Konva.Node) => {
    if (!interactive) return
    const store = useEditorStore.getState()
    const sx = Math.abs(node.scaleX())
    const sy = Math.abs(node.scaleY())
    // restore flip sign for images (transformer resets scale)
    if (el.type === 'image') {
      const im = el as ImageElement
      node.scaleX(im.flipH ? -1 : 1)
      node.scaleY(im.flipV ? -1 : 1)
    } else {
      node.scaleX(1)
      node.scaleY(1)
    }

    if (el.type === 'group') {
      // bake scale into children (children use page coords relative to group origin).
      // NOTE: children keep their own rotation — they render inside the rotated
      // Konva group, so adding node.rotation() here would double-rotate them.
      const g = el as GroupElement
      const dx = node.x() - g.x
      const dy = node.y() - g.y
      const children = g.children.map((c) => ({
        ...c,
        x: Math.round(g.x + dx + (c.x - g.x) * sx),
        y: Math.round(g.y + dy + (c.y - g.y) * sy),
        width: Math.max(4, c.width * sx),
        height: Math.max(4, c.height * sy),
      }))
      store.updateElementsLive([el.id], {
        children,
        x: Math.round(node.x()),
        y: Math.round(node.y()),
        width: Math.max(8, g.width * sx),
        height: Math.max(8, g.height * sy),
        rotation: node.rotation(),
      })
      return
    }

    const patch: Record<string, number> = {}

    if (el.type === 'path') {
      // paths live in a 100×100 box, scaled into place
      const newW = Math.max(8, 100 * sx)
      const newH = Math.max(8, 100 * sy)
      patch.width = newW
      patch.height = newH
      patch.x = node.x()
      patch.y = node.y()
    } else if (el.type === 'stroke') {
      // bake the scale into the point list (points are relative to x/y)
      const s = el as StrokeElement
      const scaled = s.points.map((v, i) => (i % 2 === 0 ? v * sx : v * sy))
      store.updateElementsLive([el.id], {
        points: scaled,
        strokeWidth: Math.max(1, s.strokeWidth * (sx + sy) / 2),
        rotation: node.rotation(),
        x: node.x(),
        y: node.y(),
      })
      return
    } else if (isLine(el)) {
      patch.width = Math.max(12, el.width * sx)
      patch.x = node.x()
      patch.y = node.y()
    } else if (el.type === 'text') {
      const t = el as TextElement
      patch.width = Math.max(12, el.width * sx)
      if (Math.abs(sy - 1) > 0.01) patch.fontSize = Math.max(6, t.fontSize * sy)
      patch.height = node.height() * sy
      patch.x = node.x()
      patch.y = node.y()
    } else if (el.type === 'sticker') {
      const s = el as StickerElement
      patch.fontSize = Math.max(8, s.fontSize * sy)
      patch.width = Math.max(8, el.width * sx)
      patch.height = Math.max(8, el.height * sy)
      patch.x = node.x()
      patch.y = node.y()
    } else {
      // rect / ellipse / triangle / image
      const newW = Math.max(4, el.width * sx)
      const newH = Math.max(4, el.height * sy)
      patch.width = newW
      patch.height = newH
      if (el.type === 'ellipse' || el.type === 'star' || el.type === 'polygon') {
        patch.x = node.x() - newW / 2
        patch.y = node.y() - newH / 2
      } else {
        patch.x = node.x()
        patch.y = node.y()
      }
    }
    patch.rotation = node.rotation()
    store.updateElementsLive([el.id], patch)
  }

  // stable node ref (avoids re-register churn on every render)
  const setNodeRef = useCallback(
    (node: Konva.Node | null) => registerNode?.(el.id, node),
    [registerNode, el.id]
  )

  const common = {
    id: el.id,
    name: 'cv-element',
    x: el.x,
    y: el.y,
    rotation: el.rotation,
    opacity: el.opacity,
    visible: el.visible && !hiding,
    draggable: interactive && !el.locked,
    // v0.7: skip Konva's "perfect draw" hit-canvas pass — big win while
    // dragging/transforming, no visible change for our node types.
    perfectDrawEnabled: false,
    onClick: handleClick,
    onTap: handleClick,
    onDragStart: handleDragStart,
    onDragMove: (e: KonvaEventObject<DragEvent>) => handleDragMove(e.target),
    onDragEnd: (e: KonvaEventObject<DragEvent>) => {
      handleDragEnd(e.target)
      onDragEndNode?.(el.id)
    },
    onTransformStart: handleTransformStart,
    onTransformEnd: (e: KonvaEventObject<Event>) => handleTransformEnd(e.target),
    onDblClick: () => interactive && onDoubleClick?.(el.id),
    onDblTap: () => interactive && onDoubleClick?.(el.id),
    ref: setNodeRef,
    ...shadowProps(el),
  }

  const { curve = 0 } = el as TextElement
  if (el.type === 'text' && curve !== 0) {
    // v0.6: curved text (single-line arc — effects fall back to plain fill)
    const t = el as TextElement
    return <CurvedTextNode t={t} common={common} />
  }

  switch (el.type) {
    case 'text': {
      const t = el as TextElement
      const effect = t.effect && t.effect !== 'none' ? textEffectProps(t) : {}
      const rendered = t.uppercase ? t.text.toUpperCase() : t.text
      // v0.18 (Wave 3): list text renders through the shared list
      // layout (flat — rich spans keep their own path, like curved text)
      if (isListText(t)) {
        return <ListTextNode t={t} common={common} effect={effect} />
      }
      // v0.15 (R1): rich text — spans render through the shared layout;
      // curved text and the splice ghost-copies effect stay on the flat
      // path (single-style by design, documented in README · R1)
      const richSpans = (t.curve ?? 0) === 0 && t.effect !== 'splice' ? normalizeSpans(t.spans, t.text) : null
      if (richSpans) {
        return <RichTextNode t={t} spans={richSpans} common={common} effect={effect} />
      }
      // v0.18 (Wave 3): auto-fit — the effective size is derived at render
      // (lib/text-fit.ts); the authored fontSize is never mutated
      const effSize = effectiveFontSize(t)
      // v0.18 (Wave 3): rtl mirrors the default alignment (centre stays)
      const rtl = t.direction === 'rtl'
      const alignAttr =
        t.align === 'center' ? 'center' : t.align === 'justify' ? 'left' : rtl ? (t.align === 'left' ? 'right' : 'left') : t.align
      // gradient fill (skipped for effects that own the fill, e.g. Hollow)
      const textGrad: GradientFill | null | undefined = t.fillGradient
      const gradProps =
        textGrad && (!t.effect || ['none', 'shadow', 'lift', 'echo', 'splice'].includes(t.effect))
          ? elementGradientProps(textGrad, t.width, Math.max(t.height, t.fontSize * t.lineHeight), 'corner')
          : {}

      if (t.effect === 'background') {
        // canva "Background" effect: solid block behind the text
        const bg = t.effectBackground ?? '#EFEFEF'
        const h = Math.max(t.height, effSize * t.lineHeight + 8)
        return (
          <Group {...common}>
            <Rect width={t.width} height={h} fill={bg} cornerRadius={Math.min(8, effSize * 0.2)} />
            <Text
              text={rendered}
              fontSize={effSize}
              fontFamily={t.fontFamily}
              fontStyle={`${t.italic ? 'italic ' : ''}${t.bold ? 'bold' : 'normal'}`}
              textDecoration={[t.underline ? 'underline' : '', t.strike ? 'line-through' : ''].filter(Boolean).join(' ')}
              fill={t.fill}
              align={alignAttr}
              width={t.width}
              lineHeight={t.lineHeight}
              letterSpacing={t.letterSpacing}
              wrap="word"
              perfectDrawEnabled={false}
              ref={() => undefined}
            />
          </Group>
        )
      }

      if (t.effect === 'splice') {
        // canva "Splice": sliced look — ghost copies above & below
        return (
          <Group {...common}>
            <Text text={rendered} fontSize={effSize} fontFamily={t.fontFamily} fontStyle={`${t.italic ? 'italic ' : ''}${t.bold ? 'bold' : 'normal'}`} fill={withAlpha(t.fill, 0.35)} align={alignAttr} width={t.width} lineHeight={t.lineHeight} letterSpacing={t.letterSpacing} wrap="word" y={-Math.max(3, effSize * 0.09)} perfectDrawEnabled={false} />
            <Text text={rendered} fontSize={effSize} fontFamily={t.fontFamily} fontStyle={`${t.italic ? 'italic ' : ''}${t.bold ? 'bold' : 'normal'}`} fill={withAlpha(t.fill, 0.35)} align={alignAttr} width={t.width} lineHeight={t.lineHeight} letterSpacing={t.letterSpacing} wrap="word" y={Math.max(3, effSize * 0.09)} perfectDrawEnabled={false} />
            <Text text={rendered} fontSize={effSize} fontFamily={t.fontFamily} fontStyle={`${t.italic ? 'italic ' : ''}${t.bold ? 'bold' : 'normal'}`} fill={t.fill} align={alignAttr} width={t.width} lineHeight={t.lineHeight} letterSpacing={t.letterSpacing} wrap="word" perfectDrawEnabled={false} />
          </Group>
        )
      }

      return (
        <Text
          {...common}
          {...effect}
          {...gradProps}
          text={rendered}
          fontSize={effSize}
          fontFamily={t.fontFamily}
          fontStyle={`${t.italic ? 'italic ' : ''}${t.bold ? 'bold' : 'normal'}`}
          textDecoration={[t.underline ? 'underline' : '', t.strike ? 'line-through' : ''].filter(Boolean).join(' ')}
          fill={Object.keys(gradProps).length ? undefined : t.fill}
          align={alignAttr}
          width={t.width}
          lineHeight={t.lineHeight}
          letterSpacing={t.letterSpacing}
          wrap="word"
          perfectDrawEnabled={false}
        />
      )
    }

    case 'rect': {
      const s = el as ShapeElement
      const grad = s.fillGradient ? elementGradientProps(s.fillGradient, s.width, s.height, 'corner') : {}
      return <Rect {...common} width={s.width} height={s.height} {...grad} fill={s.fillGradient ? undefined : s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} cornerRadius={s.cornerRadius} />
    }

    case 'ellipse': {
      const s = el as ShapeElement
      const grad = s.fillGradient ? elementGradientProps(s.fillGradient, s.width, s.height, 'center') : {}
      return <Ellipse {...common} x={s.x + s.width / 2} y={s.y + s.height / 2} radiusX={s.width / 2} radiusY={s.height / 2} {...grad} fill={s.fillGradient ? undefined : s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
    }

    case 'triangle': {
      const s = el as ShapeElement
      const grad = s.fillGradient ? elementGradientProps(s.fillGradient, s.width, s.height, 'corner') : {}
      return <Line {...common} points={[0, s.height, s.width / 2, 0, s.width, s.height]} closed {...grad} fill={s.fillGradient ? undefined : s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
    }

    case 'star': {
      const s = el as ShapeElement
      // v0.18 (Wave 3): parametric — 3..16 points, adjustable spike ratio.
      // stretchPts is THE shape mapping (fills the box, like ellipse/rect) —
      // the SVG + PDF exports render the identical points.
      const grad = s.fillGradient ? elementGradientProps(s.fillGradient, s.width, s.height, 'center') : {}
      // absolute points in the box, then re-based to the centre (the
      // node sits at the centre so rotation turns around the shape)
      const pts = stretchPts(starPointsEx(s.numPoints ?? 5, s.innerRatio), 0, 0, s.width, s.height)
      return (
        <Line
          {...common}
          x={s.x + s.width / 2}
          y={s.y + s.height / 2}
          points={pts.flatMap(([px, py]): number[] => [px - s.width / 2, py - s.height / 2])}
          closed
          {...grad}
          fill={s.fillGradient ? undefined : s.fill}
          stroke={s.stroke}
          strokeWidth={s.strokeWidth}
        />
      )
    }

    case 'polygon': {
      // v0.18 (Wave 3): regular polygon — centred geometry like the star
      const s = el as ShapeElement
      const grad = s.fillGradient ? elementGradientProps(s.fillGradient, s.width, s.height, 'center') : {}
      const pts = stretchPts(polygonPoints(s.sides ?? 6), 0, 0, s.width, s.height)
      return (
        <Line
          {...common}
          x={s.x + s.width / 2}
          y={s.y + s.height / 2}
          points={pts.flatMap(([px, py]): number[] => [px - s.width / 2, py - s.height / 2])}
          closed
          {...grad}
          fill={s.fillGradient ? undefined : s.fill}
          stroke={s.stroke}
          strokeWidth={s.strokeWidth}
        />
      )
    }

    case 'path': {
      const s = el as ShapeElement
      const grad = s.fillGradient ? elementGradientProps(s.fillGradient, s.width, s.height, 'box100') : {}
      return <Path {...common} data={s.pathData ?? ''} scaleX={s.width / 100} scaleY={s.height / 100} {...grad} fill={s.fillGradient ? undefined : s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth / (s.width / 100)} />
    }

    case 'line': {
      const l = el as LineElement
      const points = [0, 0, Math.max(l.width, 12), 0]
      const shared = {
        ...common,
        x: l.x,
        y: l.y,
        points,
        stroke: l.stroke,
        strokeWidth: l.strokeWidth,
        lineCap: 'round' as const,
        dash: l.dashed ? [l.strokeWidth * 2.2, l.strokeWidth * 1.8] : undefined,
      }
      if (l.arrowStart || l.arrowEnd) {
        return (
          <Line
            {...shared}
            fill={l.stroke}
            pointerLength={Math.max(10, l.strokeWidth * 2.4)}
            pointerWidth={Math.max(8, l.strokeWidth * 2)}
            pointerAtBeginning={l.arrowStart}
            pointerAtEnd={l.arrowEnd}
          />
        )
      }
      return <Line {...shared} hitStrokeWidth={Math.max(12, l.strokeWidth)} />
    }

    case 'stroke': {
      const s = el as StrokeElement
      return (
        <Line
          {...common}
          points={s.points}
          stroke={s.stroke}
          strokeWidth={s.strokeWidth}
          lineCap="round"
          lineJoin="round"
          tension={0.25}
          hitStrokeWidth={Math.max(14, s.strokeWidth)}
        />
      )
    }

    case 'image': {
      const im = el as ImageElement
      return <ImageNode el={im} common={common} />
    }

    case 'audio': {
      const au = el as AudioElement
      return <AudioNode el={au} common={common} />
    }

    case 'video': {
      const vd = el as VideoElement
      return <VideoNode el={vd} common={common} />
    }

    case 'table': {
      const tb = el as TableElement
      return (
        <TableNode
          el={tb}
          common={common}
          interactive={interactive}
          onCellDoubleClick={(cell) => interactive && onDoubleClick?.(el.id, cell)}
          hideCell={hideCell ?? null}
        />
      )
    }

    case 'frame': {
      const fr = el as FrameElement
      return <FrameNode el={fr} common={common} />
    }

    case 'embed': {
      const em = el as EmbedElement
      return <EmbedNode el={em} common={common} />
    }

    // v0.14 (D7): data-bound chart — geometry from lib/chart-geometry.ts
    case 'chart': {
      const ch = el as ChartElement
      return <ChartNode el={ch} common={common} />
    }

    // v0.13 (P4): plugin-owned elements — pixels delegated to the
    // plugin's registered renderer via the cache; every failure
    // state degrades to a placeholder card, never data loss
    case 'plugin': {
      const pl = el as PluginElement
      return <PluginNode el={pl} common={common} />
    }

    case 'sticker': {
      const sk = el as StickerElement
      // v0.22: authored vector stickers draw as a cached bitmap
      // (data-URL SVG → useLoadedImage — the photo pipeline); emoji
      // stickers stay on the text path below
      if (sk.svg) return <StickerVectorNode el={sk} common={common} />
      return <Text {...common} text={sk.char} fontSize={sk.fontSize} fontFamily="'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif" width={sk.width} height={sk.height} align="center" />
    }

    case 'group': {
      const g = el as GroupElement
      return (
        <Group {...common} clip={undefined}>
          {g.children
            .filter((c) => c.visible)
            .map((c) => (
              <ElementNode
                key={c.id}
                element={{ ...c, x: c.x - g.x, y: c.y - g.y } as AnyElement}
                interactive={false}
                nested
              />
            ))}
        </Group>
      )
    }

    default: {
      // exhaustive: every ElementType is handled above
      return null
    }
  }
}

/**
 * v0.7 rendering performance: memoized canvas element node. With structural
 * sharing in the editor store, untouched elements keep referential identity,
 * so a mutation re-renders only the nodes whose elements actually changed.
 */
export const ElementNode = memo(ElementNodeImpl)

/** non-interactive renderer used inside thumbnails / previews */
export const PreviewElements = memo(function PreviewElements({ elements }: { elements: AnyElement[] }) {
  const reg = useCallback(() => undefined, [])
  return (
    <Group listening={false}>
      {elements.map((el) => (
        <ElementNode key={el.id} element={el} interactive={false} registerNode={reg} />
      ))}
    </Group>
  )
})
