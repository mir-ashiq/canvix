'use client'

import Konva from 'konva'
import { useCallback, useEffect, useRef } from 'react'
import { Ellipse, Group, Image as KonvaImage, Line, Path, Rect, Star, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type {
  AnyElement,
  GroupElement,
  ImageElement,
  LineElement,
  ShapeElement,
  StickerElement,
  StrokeElement,
  TextElement,
} from '@/lib/types'
import { isLine, withAlpha } from '@/lib/types'
import { useEditorStore } from '@/store/editor-store'
import { useLoadedImage } from './use-loaded-image'

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
  /** double-click / double-tap (text editing) */
  onDoubleClick?: (id: string) => void
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

/** image with Konva filters (brightness / contrast / saturation) */
function ImageNode({ el, common }: { el: ImageElement; common: Record<string, unknown> }) {
  const image = useLoadedImage(el.src)
  const nodeRef = useRef<Konva.Image | null>(null)

  const bright = (el.brightness ?? 0) / 100 // konva Brighten: -0.5..0.5 approx
  const contrast = el.contrast ?? 0
  const sat = el.saturation ?? 0
  const needsFilters = bright !== 0 || contrast !== 0 || sat !== 0

  useEffect(() => {
    const node = nodeRef.current
    if (!node || !image) return
    const filters: Array<typeof Konva.Filters.Brighten> = []
    if (bright !== 0) filters.push(Konva.Filters.Brighten)
    if (contrast !== 0) filters.push(Konva.Filters.Contrast)
    if (sat !== 0) filters.push(Konva.Filters.HSL)
    node.filters(filters)
    node.brightness(bright)
    node.contrast(contrast)
    node.saturation(sat / 100)
    if (filters.length) node.cache()
    else node.clearCache()
    node.getLayer()?.batchDraw()
  }, [image, bright, contrast, sat])

  return (
    <KonvaImage
      {...common}
      ref={(n) => { nodeRef.current = n; (common.ref as (node: Konva.Node | null) => void | undefined)?.(n) }}
      image={image ?? undefined}
      width={el.width}
      height={el.height}
      cornerRadius={el.radius}
      scaleX={el.flipH ? -1 : 1}
      scaleY={el.flipV ? -1 : 1}
      offsetX={el.flipH ? el.width : 0}
      offsetY={el.flipV ? el.height : 0}
    />
  )
}

export function ElementNode({ element: el, interactive, hiding, registerNode, onDragMoveNode, onDragEndNode, onDoubleClick, nested }: ElementNodeProps) {
  const store = useEditorStore()

  // ── shared interaction handlers ────────────────────────────
  const handleClick = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!interactive) return
    e.cancelBubble = true
    const additive = !!e.evt && 'shiftKey' in e.evt && (e.evt as MouseEvent).shiftKey
    if (additive) {
      store.selectToggle(el.id)
    } else {
      store.setSelection([el.id])
    }
  }

  const handleDragStart = () => {
    if (!interactive) return
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
    if (el.type === 'ellipse' || el.type === 'star') {
      store.updateElementsLive([el.id], { x: node.x() - el.width / 2, y: node.y() - el.height / 2 })
    } else {
      store.updateElementsLive([el.id], { x: node.x(), y: node.y() })
    }
  }

  const handleTransformStart = () => {
    if (!interactive) return
    store.pushHistory()
    store.setSelection([el.id])
  }

  const handleTransformEnd = (node: Konva.Node) => {
    if (!interactive) return
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
      if (el.type === 'ellipse' || el.type === 'star') {
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

  const common = {
    id: el.id,
    name: 'cv-element',
    x: el.x,
    y: el.y,
    rotation: el.rotation,
    opacity: el.opacity,
    visible: el.visible && !hiding,
    draggable: interactive && !el.locked,
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
    ref: (node: Konva.Node | null) => registerNode?.(el.id, node),
    ...shadowProps(el),
  }

  switch (el.type) {
    case 'text': {
      const t = el as TextElement
      const effect = t.effect && t.effect !== 'none' ? textEffectProps(t) : {}
      const rendered = t.uppercase ? t.text.toUpperCase() : t.text

      if (t.effect === 'background') {
        // canva "Background" effect: solid block behind the text
        const bg = t.effectBackground ?? '#EFEFEF'
        const h = Math.max(t.height, t.fontSize * t.lineHeight + 8)
        return (
          <Group {...common}>
            <Rect width={t.width} height={h} fill={bg} cornerRadius={Math.min(8, t.fontSize * 0.2)} />
            <Text
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
              ref={() => undefined}
            />
          </Group>
        )
      }

      if (t.effect === 'splice') {
        // canva "Splice": sliced look — ghost copies above & below
        return (
          <Group {...common}>
            <Text text={rendered} fontSize={t.fontSize} fontFamily={t.fontFamily} fontStyle={`${t.italic ? 'italic ' : ''}${t.bold ? 'bold' : 'normal'}`} fill={withAlpha(t.fill, 0.35)} align={t.align === 'justify' ? 'left' : t.align} width={t.width} lineHeight={t.lineHeight} letterSpacing={t.letterSpacing} wrap="word" y={-Math.max(3, t.fontSize * 0.09)} perfectDrawEnabled={false} />
            <Text text={rendered} fontSize={t.fontSize} fontFamily={t.fontFamily} fontStyle={`${t.italic ? 'italic ' : ''}${t.bold ? 'bold' : 'normal'}`} fill={withAlpha(t.fill, 0.35)} align={t.align === 'justify' ? 'left' : t.align} width={t.width} lineHeight={t.lineHeight} letterSpacing={t.letterSpacing} wrap="word" y={Math.max(3, t.fontSize * 0.09)} perfectDrawEnabled={false} />
            <Text text={rendered} fontSize={t.fontSize} fontFamily={t.fontFamily} fontStyle={`${t.italic ? 'italic ' : ''}${t.bold ? 'bold' : 'normal'}`} fill={t.fill} align={t.align === 'justify' ? 'left' : t.align} width={t.width} lineHeight={t.lineHeight} letterSpacing={t.letterSpacing} wrap="word" perfectDrawEnabled={false} />
          </Group>
        )
      }

      return (
        <Text
          {...common}
          {...effect}
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

    case 'rect': {
      const s = el as ShapeElement
      return <Rect {...common} width={s.width} height={s.height} fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} cornerRadius={s.cornerRadius} />
    }

    case 'ellipse': {
      const s = el as ShapeElement
      return <Ellipse {...common} x={s.x + s.width / 2} y={s.y + s.height / 2} radiusX={s.width / 2} radiusY={s.height / 2} fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
    }

    case 'triangle': {
      const s = el as ShapeElement
      return <Line {...common} points={[0, s.height, s.width / 2, 0, s.width, s.height]} closed fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
    }

    case 'star': {
      const s = el as ShapeElement
      const outer = Math.min(s.width, s.height) / 2
      return <Star {...common} x={s.x + s.width / 2} y={s.y + s.height / 2} numPoints={5} innerRadius={outer * 0.55} outerRadius={outer} fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
    }

    case 'path': {
      const s = el as ShapeElement
      return <Path {...common} data={s.pathData ?? ''} scaleX={s.width / 100} scaleY={s.height / 100} fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth / (s.width / 100)} />
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

    case 'sticker': {
      const sk = el as StickerElement
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

/** non-interactive renderer used inside thumbnails / previews */
export function PreviewElements({ elements }: { elements: AnyElement[] }) {
  const reg = useCallback(() => undefined, [])
  return (
    <Group listening={false}>
      {elements.map((el) => (
        <ElementNode key={el.id} element={el} interactive={false} registerNode={reg} />
      ))}
    </Group>
  )
}
