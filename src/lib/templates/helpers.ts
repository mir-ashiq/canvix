import {
  createShapeElement,
  createTextElement,
  createLineElement,
  createStickerElement,
  type PageData,
} from '../types'
import { GRAPHICS } from '../editor-utils'

export interface TemplateDef {
  slug: string
  name: string
  category: string
  width: number
  height: number
  accent: string
  /** v0.7: premium library expansion — every template stays 100% free,
   *  the badge is a quality label only (never a paywall). */
  badge?: 'premium' | 'new'
  pages: PageData[]
}

// compact element builders
export const tx = (o: Record<string, unknown>) =>
  createTextElement(o as Parameters<typeof createTextElement>[0])
export const sh = (type: 'rect' | 'ellipse' | 'triangle' | 'star' | 'path', o: Record<string, unknown>) =>
  createShapeElement(type, o as Parameters<typeof createShapeElement>[1])
export const ln = (o: Record<string, unknown>) =>
  createLineElement(o as Parameters<typeof createLineElement>[0])
export const st = (char: string, o: Record<string, unknown>) =>
  createStickerElement(char, o as Parameters<typeof createStickerElement>[1])
export const gr = (graphicId: string, o: Record<string, unknown>) =>
  createShapeElement('path', {
    pathData: GRAPHICS.find((g) => g.id === graphicId)?.path ?? GRAPHICS[0].path,
    ...(o as Parameters<typeof createShapeElement>[1]),
  })

