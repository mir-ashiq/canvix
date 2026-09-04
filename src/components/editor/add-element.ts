'use client'

import {
  createImageElement,
  createTextElement,
  createShapeElement,
  createStickerElement,
  createLineElement,
  createTableElement,
  createFrameElement,
  createEmbedElement,
  type AnyElement,
  type FrameShape,
} from '@/lib/types'
import { useEditorStore } from '@/store/editor-store'
import { GRAPHICS } from '@/lib/editor-utils'

/** center-ish placement with a small cascade so stacked adds are visible */
export function placement(width: number, height: number, count: number) {
  const state = useEditorStore.getState()
  return {
    x: Math.max(0, (state.width - width) / 2 + ((count % 7) - 3) * 18),
    y: Math.max(0, (state.height - height) / 2 + ((count % 7) - 3) * 18),
  }
}

function addCentered(el: AnyElement) {
  const store = useEditorStore.getState()
  const page = store.pages[store.currentPage]
  const pos = placement(el.width, el.height, page.elements.length)
  Object.assign(el, pos)
  store.addElement(el)
}

export function addText(preset: 'heading' | 'subheading' | 'body') {
  const configs = {
    heading: { text: 'Add a heading', fontSize: 96, bold: true, fontFamily: 'Montserrat' },
    subheading: { text: 'Add a subheading', fontSize: 56, bold: true, fontFamily: 'Poppins' },
    body: { text: 'Add a little bit of body text', fontSize: 32, fontFamily: 'Poppins' },
  } as const
  const c = configs[preset]
  addCentered(
    createTextElement({
      ...c,
      width: 760,
      align: 'center',
    })
  )
}

export function addTextStyled(opts: Partial<import('@/lib/types').TextElement>) {
  addCentered(createTextElement({ width: 760, align: 'center', ...opts }))
}

export function addShape(kind: 'rect' | 'rounded' | 'ellipse' | 'triangle' | 'star') {
  const size = 320
  if (kind === 'rect') addCentered(createShapeElement('rect', { width: size, height: size * 0.7, cornerRadius: 0 }))
  else if (kind === 'rounded') addCentered(createShapeElement('rect', { width: size, height: size * 0.7, cornerRadius: 40 }))
  else if (kind === 'ellipse') addCentered(createShapeElement('ellipse', { width: size, height: size }))
  else if (kind === 'triangle') addCentered(createShapeElement('triangle', { width: size, height: size * 0.85 }))
  else addCentered(createShapeElement('star', { width: size, height: size }))
}

export function addGraphic(graphicId: string, fill?: string) {
  const def = GRAPHICS.find((g) => g.id === graphicId)
  if (!def) return
  addCentered(createShapeElement('path', { width: 300, height: 300, pathData: def.path, ...(fill ? { fill } : {}) }))
}

export function addLine(variant: 'solid' | 'dashed' | 'arrow' | 'arrowBoth') {
  const state = useEditorStore.getState()
  const width = Math.min(420, state.width * 0.6)
  const el = createLineElement({
    x: (state.width - width) / 2,
    y: state.height / 2,
    width,
    ...(variant === 'dashed' ? { dashed: true } : {}),
    ...(variant === 'arrow' ? { arrowEnd: true } : {}),
    ...(variant === 'arrowBoth' ? { arrowStart: true, arrowEnd: true } : {}),
  })
  state.addElement(el)
}

export function addSticker(char: string) {
  addCentered(createStickerElement(char, { width: 200, height: 200, fontSize: 150 }))
}

// ── v0.6: tables, frames, embeds ───────────────────────────

export type TableStyle = 'classic' | 'minimal' | 'bold' | 'soft'

/** Add a native table — every cell stays editable on the canvas. */
export function addTable(style: TableStyle = 'classic') {
  const styles: Record<TableStyle, Partial<import('@/lib/types').TableElement> & { header?: string[] }> = {
    classic: {
      header: ['Header 1', 'Header 2', 'Header 3'],
      rows: 4,
      cols: 3,
      headerFill: '#1F142E',
      borderColor: '#E0E1E6',
      fill: 'transparent',
      textColor: '#1F2226',
    },
    minimal: {
      header: ['Item', 'Qty', 'Price'],
      rows: 4,
      cols: 3,
      headerFill: 'transparent',
      headerTextColor: '#7630D7',
      borderColor: '#EDEFF2',
      borderWidth: 1,
      fill: 'transparent',
      textColor: '#1F2226',
    },
    bold: {
      header: ['Plan', 'Features', 'Price'],
      rows: 4,
      cols: 3,
      headerFill: '#7630D7',
      borderColor: '#7630D7',
      borderWidth: 2,
      fill: '#F6F2FC',
      textColor: '#1F142E',
    },
    soft: {
      header: ['Task', 'Owner', 'Due'],
      rows: 4,
      cols: 3,
      headerFill: '#02C0CC',
      borderColor: '#C8EDF0',
      borderWidth: 1.5,
      fill: '#F2FBFC',
      textColor: '#0E3A40',
    },
  }
  const s = styles[style]
  addCentered(createTableElement({ width: 480, rowHeight: 46, ...s }))
}

export function addFrame(frameShape: FrameShape) {
  const size = 340
  addCentered(
    createFrameElement(frameShape, {
      width: size,
      height: frameShape === 'circle' || frameShape === 'ellipse' ? size : Math.round(size * 0.66),
    })
  )
}

/** Add an embed link card (YouTube / Maps / generic URL). */
export function addEmbed(url: string, title?: string) {
  const trimmed = url.trim()
  if (!trimmed) return
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  addCentered(createEmbedElement(withProto, { width: 340, height: 214, ...(title ? { title } : {}) }))
}

/** If a page point lands inside a frame element, fill that frame with the image (canva drop-to-fill). */
export function fillFrameAt(pageX: number, pageY: number, src: string, naturalWidth: number, naturalHeight: number): boolean {
  const state = useEditorStore.getState()
  const page = state.pages[state.currentPage]
  const hit = [...page.elements]
    .reverse()
    .find(
      (el) =>
        el.type === 'frame' &&
        el.visible &&
        pageX >= el.x &&
        pageX <= el.x + el.width &&
        pageY >= el.y &&
        pageY <= el.y + el.height
    ) as import('@/lib/types').FrameElement | undefined
  if (!hit) return false
  state.updateElements([hit.id], { src, naturalWidth, naturalHeight })
  return true
}

/** replace the image inside a selected frame (canva "Fill frame") */
export function fillSelectedFrame(src: string, naturalWidth: number, naturalHeight: number): boolean {
  const state = useEditorStore.getState()
  const sel = state.pages[state.currentPage].elements.find(
    (e) => state.selectedIds.includes(e.id) && e.type === 'frame'
  )
  if (!sel) return false
  state.updateElements([sel.id], { src, naturalWidth, naturalHeight })
  return true
}

/**
 * v0.5 perf: downscale oversized uploads before embedding. Huge photos (e.g. 12 MP)
 * used to bloat the jsonb document; we cap the stored dataURL at 2048px longest edge
 * (print-quality for typical designs, ~85% smaller documents). PNGs with transparency
 * keep their alpha; opaque images become JPEG.
 */
export async function downscaleForEmbed(src: string, maxEdge = 2048): Promise<{ src: string; width: number; height: number }> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new window.Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('load failed'))
    i.src = src
  })
  const longest = Math.max(img.naturalWidth, img.naturalHeight)
  if (longest <= maxEdge) {
    return { src, width: img.naturalWidth, height: img.naturalHeight } // already small enough
  }
  const scale = maxEdge / longest
  const w = Math.round(img.naturalWidth * scale)
  const h = Math.round(img.naturalHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return { src, width: img.naturalWidth, height: img.naturalHeight }
  ctx.drawImage(img, 0, 0, w, h)
  // detect alpha: sample the corners… simple heuristic — if the source is a
  // data:image/png keep PNG, otherwise JPEG
  const isPng = src.startsWith('data:image/png')
  const out = isPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.9)
  // if PNG ballooned larger than the original, keep the original
  if (out.length > src.length && src.startsWith('data:')) return { src, width: img.naturalWidth, height: img.naturalHeight }
  return { src: out, width: w, height: h }
}

export function addImageFromSrc(src: string, naturalWidth: number, naturalHeight: number) {
  const state = useEditorStore.getState()
  const maxW = state.width * 0.7
  const maxH = state.height * 0.7
  const scale = Math.min(maxW / naturalWidth, maxH / naturalHeight, 1)
  const w = Math.round(naturalWidth * scale)
  const h = Math.round(naturalHeight * scale)
  const pos = placement(w, h, state.pages[state.currentPage].elements.length)
  state.addElement(
    createImageElement(src, naturalWidth, naturalHeight, {
      ...pos,
      width: w,
      height: h,
    })
  )
}

/** loads an image, downscales oversized sources, then adds it to the canvas */
export function addImageFromFile(file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Not an image'))
      return
    }
    if (file.size > 25 * 1024 * 1024) {
      reject(new Error('Image too large (max 25 MB)'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result)
      const img = new window.Image()
      img.onload = () => {
        void downscaleForEmbed(src).then(({ src: scaled, width, height }) => {
          addImageFromSrc(scaled, width, height)
          resolve()
        }).catch(() => {
          addImageFromSrc(src, img.naturalWidth, img.naturalHeight)
          resolve()
        })
      }
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = src
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

/** replace the src of the currently selected image element (canva "Replace") */
export function replaceSelectedImage(src: string, naturalWidth: number, naturalHeight: number) {
  const state = useEditorStore.getState()
  const sel = state.pages[state.currentPage].elements.filter((e) => state.selectedIds.includes(e.id) && e.type === 'image')
  if (!sel.length) {
    addImageFromSrc(src, naturalWidth, naturalHeight)
    return
  }
  for (const el of sel) {
    const im = el as import('@/lib/types').ImageElement
    // keep the box, refit aspect if it distorts more than 15%
    const boxRatio = im.width / im.height
    const imgRatio = naturalWidth / naturalHeight
    let { width, height } = im
    if (Math.abs(boxRatio - imgRatio) / imgRatio > 0.15) {
      const refit = Math.min(im.width / naturalWidth, im.height / naturalHeight)
      width = Math.round(naturalWidth * refit)
      height = Math.round(naturalHeight * refit)
    }
    state.updateElements([im.id], { src, naturalWidth, naturalHeight, width, height })
  }
}

/** load a File → {src, w, h} without touching the canvas */
export function readImageFile(file: File): Promise<{ src: string; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Not an image'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result)
      const img = new window.Image()
      img.onload = () => resolve({ src, w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = () => resolve({ src, w: 500, h: 500 })
      img.src = src
    }
    reader.onerror = () => reject(new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

/** add an image dropped at a page position */
export function addImageAt(src: string, naturalWidth: number, naturalHeight: number, x: number, y: number) {
  const state = useEditorStore.getState()
  const maxW = state.width * 0.7
  const scale = Math.min(maxW / naturalWidth, 1)
  const w = Math.round(naturalWidth * scale)
  const h = Math.round(naturalHeight * scale)
  state.addElement(
    createImageElement(src, naturalWidth, naturalHeight, {
      x: Math.max(0, Math.round(x - w / 2)),
      y: Math.max(0, Math.round(y - h / 2)),
      width: w,
      height: h,
    })
  )
}
