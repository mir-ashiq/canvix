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
  | 'stroke'
  | 'image'
  | 'sticker'
  | 'group'

export type TextAlign = 'left' | 'center' | 'right' | 'justify'

/** Canva-style text effects (v0.3: aligned to canva 2026 naming) */
export type TextEffect = 'none' | 'shadow' | 'lift' | 'hollow' | 'neon' | 'echo' | 'glow' | 'outline' | 'background' | 'splice'

export const TEXT_EFFECTS: { id: TextEffect; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'shadow', label: 'Drop' },
  { id: 'lift', label: 'Lift' },
  { id: 'glow', label: 'Glow' },
  { id: 'hollow', label: 'Hollow' },
  { id: 'outline', label: 'Outline' },
  { id: 'background', label: 'Background' },
  { id: 'splice', label: 'Splice' },
  { id: 'neon', label: 'Neon' },
  { id: 'echo', label: 'Echo' },
]

export interface ShadowConfig {
  enabled: boolean
  color: string
  blur: number
  offsetX: number
  offsetY: number
}

/** Canva-style element gradient fill (shapes + text) */
export interface GradientFill {
  type: 'linear' | 'radial'
  from: string
  to: string
  /** linear direction in degrees (0 = →, 90 = ↓) */
  angle: number
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
  /** user-facing layer name (Layers panel; falls back to an auto label) */
  name?: string
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
  uppercase: boolean
  fill: string
  /** gradient fill — when set, renders instead of the solid fill */
  fillGradient?: GradientFill | null
  align: TextAlign
  lineHeight: number
  letterSpacing: number
  /** text background block colour (canva "Background" effect) */
  effectBackground?: string
  /** canva-style effect preset */
  effect?: TextEffect
}

export interface ShapeElement extends BaseElement {
  type: 'rect' | 'ellipse' | 'triangle' | 'star' | 'path'
  fill: string
  /** gradient fill — when set, renders instead of the solid fill */
  fillGradient?: GradientFill | null
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
  flipH?: boolean
  flipV?: boolean
  /** basic adjustments (0 = neutral, applied via Konva filters) */
  brightness?: number // -100..100
  contrast?: number // -100..100
  saturation?: number // -100..100
}

export interface StickerElement extends BaseElement {
  type: 'sticker'
  char: string // emoji glyph
  fontSize: number
}

/** A group nests child elements at their original page coordinates.
 *  Selecting/moving/transforming the group transforms children with it. */
export interface GroupElement extends BaseElement {
  type: 'group'
  /** full child elements (positions relative to the page, same as before grouping) */
  children: AnyElement[]
}

/** Freehand stroke — points are [x0,y0,x1,y1,…] relative to (x, y). */
export interface StrokeElement extends BaseElement {
  type: 'stroke'
  points: number[]
  stroke: string
  strokeWidth: number
}

/** Brand kit — persisted per browser (localStorage) */
export interface BrandKit {
  colors: string[]
  headingFont: string
  bodyFont: string
  /** saved colour palettes (swatch rows) */
  palettes?: string[][]
  /** uploaded logo dataURLs */
  logos?: string[]
}

export const DEFAULT_BRAND: BrandKit = {
  colors: ['#7630D7', '#02C0CC', '#FF5C8A', '#1F142E', '#FFD166'],
  headingFont: 'Archivo Black',
  bodyFont: 'Inter',
  palettes: [
    ['#7630D7', '#02C0CC', '#FF5C8A'],
    ['#1F142E', '#6E717F', '#E0E1E6'],
    ['#FF5C8A', '#FFB84C', '#FFE066'],
  ],
  logos: [],
}

export type AnyElement =
  | TextElement
  | ShapeElement
  | LineElement
  | StrokeElement
  | ImageElement
  | StickerElement
  | GroupElement

export type Background =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; from: string; to: string; angle: number }

export interface PageData {
  id: string
  background: Background
  elements: AnyElement[]
}

/** user-placed ruler guide (position in page px; scoped to a page) */
export interface ManualGuide {
  id: string
  axis: 'x' | 'y'
  position: number
  /** owning page — guides are per-page since v0.3.2 */
  pageId: string
}

/** saved version snapshot (per design, persisted to localStorage) */
export interface DesignVersion {
  id: string
  label: string
  at: number
  name: string
  width: number
  height: number
  pages: PageData[]
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
    uppercase: false,
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
    flipH: false,
    flipV: false,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    ...init,
  }
}

/** wrap child elements into a group; children keep page coords */
export function createGroupElement(children: AnyElement[]): GroupElement {
  const xs = children.map((c) => c.x)
  const ys = children.map((c) => c.y)
  const x1 = Math.min(...xs)
  const y1 = Math.min(...ys)
  const x2 = Math.max(...children.map((c) => c.x + c.width))
  const y2 = Math.max(...children.map((c) => c.y + c.height))
  return {
    ...baseElement('group', { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }),
    type: 'group',
    children: children.map((c) => ({ ...c })),
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

export function createStrokeElement(init: BaseInit & Partial<StrokeElement>): StrokeElement {
  return {
    ...baseElement('stroke', init),
    type: 'stroke',
    points: [],
    stroke: '#FFFFFF',
    strokeWidth: 6,
    ...init,
  }
}

/** hex/rgb → rgba with alpha — used by text effect rendering */
export function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
    const r = parseInt(full.slice(0, 2), 16)
    const g = parseInt(full.slice(2, 4), 16)
    const b = parseInt(full.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  if (color.startsWith('rgb(')) return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`)
  return color
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
export function isStroke(el: AnyElement): el is StrokeElement {
  return el.type === 'stroke'
}
export function isImage(el: AnyElement): el is ImageElement {
  return el.type === 'image'
}
export function isSticker(el: AnyElement): el is StickerElement {
  return el.type === 'sticker'
}
export function isGroup(el: AnyElement): el is GroupElement {
  return el.type === 'group'
}
