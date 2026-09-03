// ─────────────────────────────────────────────────────────────
// Canvix core types — the design document model
// ─────────────────────────────────────────────────────────────

export type ElementType =
  | 'text'
  | 'rect'
  | 'ellipse'
  | 'triangle'
  | 'star'
  | 'line'
  | 'path'
  | 'image'
  | 'sticker'

export type TextAlign = 'left' | 'center' | 'right'

export interface ShadowConfig {
  enabled: boolean
  color: string
  blur: number
  offsetX: number
  offsetY: number
}

export interface BaseElement {
  id: string
  type: ElementType
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  locked: boolean
  visible: boolean
  shadow: ShadowConfig
}

export interface TextElement extends BaseElement {
  type: 'text'
  text: string
  fontSize: number
  fontFamily: string
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  fill: string
  align: TextAlign
  lineHeight: number
  letterSpacing: number
}

export interface ShapeElement extends BaseElement {
  type: 'rect' | 'ellipse' | 'triangle' | 'star' | 'path'
  fill: string
  stroke: string
  strokeWidth: number
  cornerRadius: number // rect only
  pathData?: string // path only — authored in a 100×100 box
}

export interface LineElement extends BaseElement {
  type: 'line'
  stroke: string
  strokeWidth: number
  dashed: boolean
  arrowStart: boolean
  arrowEnd: boolean
  // width = line length, rotation = angle. height kept 0.
}

export interface ImageElement extends BaseElement {
  type: 'image'
  src: string // dataURL or remote URL (CORS-enabled)
  radius: number // corner clip
  naturalWidth: number
  naturalHeight: number
}

export interface StickerElement extends BaseElement {
  type: 'sticker'
  char: string // emoji glyph
  fontSize: number
}

export type AnyElement =
  | TextElement
  | ShapeElement
  | LineElement
  | ImageElement
  | StickerElement

export type Background =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; from: string; to: string; angle: number }

export interface PageData {
  id: string
  background: Background
  elements: AnyElement[]
}

export interface DesignSnapshot {
  // A full serializable design state (also what gets saved to DB)
  name: string
  width: number
  height: number
  pages: PageData[]
}

export interface DesignRecord extends DesignSnapshot {
  id: string
  thumbnail: string | null
  source: string
  createdAt: string
  updatedAt: string
}

export interface TemplateRecord extends DesignSnapshot {
  id: string
  slug: string
  name: string
  category: string
  accent: string
}

export const TEMPLATE_CATEGORIES = [
  { id: 'social', label: 'Social media', icon: 'instagram' },
  { id: 'presentation', label: 'Presentation', icon: 'presentation' },
  { id: 'print', label: 'Print', icon: 'printer' },
  { id: 'logo', label: 'Logos', icon: 'badge' },
  { id: 'thumbnail', label: 'Video & thumbnails', icon: 'video' },
] as const

// ── Defaults factory ─────────────────────────────────────────

let counter = 0
export function uid(prefix = 'el'): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 7)}`
}

export const DEFAULT_SHADOW: ShadowConfig = {
  enabled: false,
  color: '#000000',
  blur: 12,
  offsetX: 0,
  offsetY: 6,
}

interface BaseInit {
  x?: number
  y?: number
  width?: number
  height?: number
}

function baseElement(type: ElementType, init: BaseInit = {}): Omit<BaseElement, never> {
  return {
    id: uid(type),
    type,
    x: init.x ?? 120,
    y: init.y ?? 120,
    width: init.width ?? 240,
    height: init.height ?? 120,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    shadow: { ...DEFAULT_SHADOW },
  }
}

export function createTextElement(init: BaseInit & Partial<TextElement> = {}): TextElement {
  return {
    ...baseElement('text', init),
    type: 'text',
    text: 'Add a little bit of body text',
    fontSize: 32,
    fontFamily: 'Poppins',
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    fill: '#1F2226',
    align: 'center',
    lineHeight: 1.25,
    letterSpacing: 0,
    ...init,
  }
}

export function createShapeElement(
  type: 'rect' | 'ellipse' | 'triangle' | 'star' | 'path',
  init: BaseInit & Partial<ShapeElement> = {}
): ShapeElement {
  return {
    ...baseElement(type, init),
    type,
    fill: '#00C4CC',
    stroke: 'transparent',
    strokeWidth: 0,
    cornerRadius: type === 'rect' ? 24 : 0,
    pathData: init.pathData,
    ...init,
  }
}

export function createLineElement(init: BaseInit & Partial<LineElement> = {}): LineElement {
  return {
    ...baseElement('line', { width: 280, height: 0, ...init }),
    type: 'line',
    stroke: '#1F2226',
    strokeWidth: 6,
    dashed: false,
    arrowStart: false,
    arrowEnd: false,
    ...init,
  }
}

export function createImageElement(
  src: string,
  naturalWidth: number,
  naturalHeight: number,
  init: BaseInit & Partial<ImageElement> = {}
): ImageElement {
  return {
    ...baseElement('image', init),
    type: 'image',
    src,
    radius: 12,
    naturalWidth,
    naturalHeight,
    ...init,
  }
}

export function createStickerElement(char: string, init: BaseInit & Partial<StickerElement> = {}): StickerElement {
  return {
    ...baseElement('sticker', { width: 160, height: 160, ...init }),
    type: 'sticker',
    char,
    fontSize: 120,
    ...init,
  }
}

export function createPage(background: Background = { type: 'solid', color: '#FFFFFF' }): PageData {
  return { id: uid('page'), background, elements: [] }
}

// ── Element helpers ──────────────────────────────────────────

export function isText(el: AnyElement): el is TextElement {
  return el.type === 'text'
}
export function isShape(el: AnyElement): el is ShapeElement {
  return ['rect', 'ellipse', 'triangle', 'star', 'path'].includes(el.type)
}
export function isLine(el: AnyElement): el is LineElement {
  return el.type === 'line'
}
export function isImage(el: AnyElement): el is ImageElement {
  return el.type === 'image'
}
export function isSticker(el: AnyElement): el is StickerElement {
  return el.type === 'sticker'
}
