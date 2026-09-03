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

export function addGraphic(graphicId: string) {
  const def = GRAPHICS.find((g) => g.id === graphicId)
  if (!def) return
  addCentered(createShapeElement('path', { width: 300, height: 300, pathData: def.path }))
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
