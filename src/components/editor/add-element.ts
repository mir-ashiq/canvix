'use client'

import {
  createImageElement,
  createTextElement,
  createShapeElement,
  createStickerElement,
  createLineElement,
  type AnyElement,
} from '@/lib/types'
import { useEditorStore } from '@/store/editor-store'
import { GRAPHICS } from '@/lib/editor-utils'

/** center-ish placement with a small cascade so stacked adds are visible */
function placement(width: number, height: number, count: number) {
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

/** loads an image then adds it to the canvas */
export function addImageFromFile(file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Not an image'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result)
      const img = new window.Image()
      img.onload = () => {
        addImageFromSrc(src, img.naturalWidth, img.naturalHeight)
        resolve()
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
