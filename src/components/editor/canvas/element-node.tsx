'use client'

import Konva from 'konva'
import { Circle, Ellipse, Group, Image as KonvaImage, Line, Path, Rect, Star, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type {
  AnyElement,
  ImageElement,
  LineElement,
  ShapeElement,
  StickerElement,
  TextElement,
} from '@/lib/types'
import { isLine } from '@/lib/types'
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

export function ElementNode({ element: el, interactive, hiding, registerNode, onDragMoveNode, onDragEndNode, onDoubleClick }: ElementNodeProps) {
  const store = useEditorStore()
  const image = useLoadedImage(el.type === 'image' ? (el as ImageElement).src : undefined)

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
    const sx = node.scaleX()
    const sy = node.scaleY()
    node.scaleX(1)
    node.scaleY(1)

    const patch: Record<string, number> = {}

    if (el.type === 'path') {
      // paths live in a 100×100 box, scaled into place
      const newW = Math.max(8, 100 * sx)
      const newH = Math.max(8, 100 * sy)
      patch.width = newW
      patch.height = newH
      patch.x = node.x()
      patch.y = node.y()
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
      return (
        <Text
          {...common}
          text={t.text}
          fontSize={t.fontSize}
          fontFamily={t.fontFamily}
          fontStyle={`${t.italic ? 'italic ' : ''}${t.bold ? 'bold' : 'normal'}`}
          textDecoration={[t.underline ? 'underline' : '', t.strike ? 'line-through' : ''].filter(Boolean).join(' ')}
          fill={t.fill}
          align={t.align}
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

    case 'image': {
      const im = el as ImageElement
      return <KonvaImage {...common} image={image ?? undefined} width={im.width} height={im.height} cornerRadius={im.radius} />
    }

    case 'sticker': {
      const sk = el as StickerElement
      return <Text {...common} text={sk.char} fontSize={sk.fontSize} fontFamily="'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif" width={sk.width} height={sk.height} align="center" />
    }

    default:
      return <Circle {...common} radius={Math.min(el.width, el.height) / 2} />
  }
}

/** non-interactive renderer used inside thumbnails / previews */
export function PreviewElements({ elements }: { elements: AnyElement[] }) {
  return (
    <Group listening={false}>
      {elements.map((el) => (
        <ElementNode key={el.id} element={el} interactive={false} />
      ))}
    </Group>
  )
}
