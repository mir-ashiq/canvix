// ─────────────────────────────────────────────────────────────
// Canvix editor utilities — fonts, palettes, graphics, helpers
// ─────────────────────────────────────────────────────────────

import type { AnyElement, GradientFill, PageData } from './types'

// ── Fonts (loaded in layout via Google Fonts) ────────────────

export interface FontOption {
  family: string
  label: string
  weights: string
  category: 'sans' | 'serif' | 'display' | 'handwriting' | 'mono'
}

export const FONTS: FontOption[] = [
  // ── Sans (18) ──
  { family: 'Inter', label: 'Inter', weights: '400,500,600,700,800', category: 'sans' },
  { family: 'Poppins', label: 'Poppins', weights: '400,600,700,800', category: 'sans' },
  { family: 'Montserrat', label: 'Montserrat', weights: '600,700,800,900', category: 'sans' },
  { family: 'Space Grotesk', label: 'Space Grotesk', weights: '500,700', category: 'sans' },
  { family: 'Oswald', label: 'Oswald', weights: '500,700', category: 'sans' },
  { family: 'Raleway', label: 'Raleway', weights: '400,700', category: 'sans' },
  { family: 'Lato', label: 'Lato', weights: '400,700', category: 'sans' },
  { family: 'Open Sans', label: 'Open Sans', weights: '400,700', category: 'sans' },
  { family: 'Nunito', label: 'Nunito', weights: '400,700', category: 'sans' },
  { family: 'Quicksand', label: 'Quicksand', weights: '400,700', category: 'sans' },
  { family: 'Rubik', label: 'Rubik', weights: '400,700', category: 'sans' },
  { family: 'Work Sans', label: 'Work Sans', weights: '400,700', category: 'sans' },
  { family: 'DM Sans', label: 'DM Sans', weights: '400,700', category: 'sans' },
  { family: 'Josefin Sans', label: 'Josefin Sans', weights: '400,700', category: 'sans' },
  { family: 'Barlow', label: 'Barlow', weights: '400,700', category: 'sans' },
  { family: 'Manrope', label: 'Manrope', weights: '400,700', category: 'sans' },
  { family: 'Outfit', label: 'Outfit', weights: '400,700', category: 'sans' },
  { family: 'Figtree', label: 'Figtree', weights: '400,700', category: 'sans' },
  // ── Serif (14) ──
  { family: 'Playfair Display', label: 'Playfair Display', weights: '400,700,800', category: 'serif' },
  { family: 'Abril Fatface', label: 'Abril Fatface', weights: '400', category: 'serif' },
  { family: 'Roboto Slab', label: 'Roboto Slab', weights: '400,700', category: 'serif' },
  { family: 'Lora', label: 'Lora', weights: '400,700', category: 'serif' },
  { family: 'Merriweather', label: 'Merriweather', weights: '400,700', category: 'serif' },
  { family: 'Libre Baskerville', label: 'Libre Baskerville', weights: '400,700', category: 'serif' },
  { family: 'EB Garamond', label: 'EB Garamond', weights: '400,700', category: 'serif' },
  { family: 'Cormorant Garamond', label: 'Cormorant Garamond', weights: '400,700', category: 'serif' },
  { family: 'DM Serif Display', label: 'DM Serif Display', weights: '400', category: 'serif' },
  { family: 'Prata', label: 'Prata', weights: '400', category: 'serif' },
  { family: 'Bitter', label: 'Bitter', weights: '400,700', category: 'serif' },
  { family: 'Fraunces', label: 'Fraunces', weights: '400,700', category: 'serif' },
  { family: 'Bodoni Moda', label: 'Bodoni Moda', weights: '400,700', category: 'serif' },
  { family: 'Cinzel', label: 'Cinzel', weights: '400,700', category: 'serif' },
  // ── Display (14) ──
  { family: 'Bebas Neue', label: 'Bebas Neue', weights: '400', category: 'display' },
  { family: 'Anton', label: 'Anton', weights: '400', category: 'display' },
  { family: 'Archivo Black', label: 'Archivo Black', weights: '400', category: 'display' },
  { family: 'Lobster', label: 'Lobster', weights: '400', category: 'display' },
  { family: 'Alfa Slab One', label: 'Alfa Slab One', weights: '400', category: 'display' },
  { family: 'Bungee', label: 'Bungee', weights: '400', category: 'display' },
  { family: 'Righteous', label: 'Righteous', weights: '400', category: 'display' },
  { family: 'Ultra', label: 'Ultra', weights: '400', category: 'display' },
  { family: 'Passion One', label: 'Passion One', weights: '400,700', category: 'display' },
  { family: 'Monoton', label: 'Monoton', weights: '400', category: 'display' },
  { family: 'Rye', label: 'Rye', weights: '400', category: 'display' },
  { family: 'Titan One', label: 'Titan One', weights: '400', category: 'display' },
  { family: 'Luckiest Guy', label: 'Luckiest Guy', weights: '400', category: 'display' },
  { family: 'Permanent Marker', label: 'Permanent Marker', weights: '400', category: 'display' },
  // ── Handwriting (14) ──
  { family: 'Pacifico', label: 'Pacifico', weights: '400', category: 'handwriting' },
  { family: 'Caveat', label: 'Caveat', weights: '400,700', category: 'handwriting' },
  { family: 'Dancing Script', label: 'Dancing Script', weights: '400,700', category: 'handwriting' },
  { family: 'Great Vibes', label: 'Great Vibes', weights: '400', category: 'handwriting' },
  { family: 'Sacramento', label: 'Sacramento', weights: '400', category: 'handwriting' },
  { family: 'Satisfy', label: 'Satisfy', weights: '400', category: 'handwriting' },
  { family: 'Kaushan Script', label: 'Kaushan Script', weights: '400', category: 'handwriting' },
  { family: 'Alex Brush', label: 'Alex Brush', weights: '400', category: 'handwriting' },
  { family: 'Allura', label: 'Allura', weights: '400', category: 'handwriting' },
  { family: 'Parisienne', label: 'Parisienne', weights: '400', category: 'handwriting' },
  { family: 'Amatic SC', label: 'Amatic SC', weights: '400,700', category: 'handwriting' },
  { family: 'Shadows Into Light', label: 'Shadows Into Light', weights: '400', category: 'handwriting' },
  { family: 'Indie Flower', label: 'Indie Flower', weights: '400', category: 'handwriting' },
  { family: 'Kalam', label: 'Kalam', weights: '400,700', category: 'handwriting' },
  // ── Mono (3) ──
  { family: 'DM Mono', label: 'DM Mono', weights: '400,500', category: 'mono' },
  { family: 'JetBrains Mono', label: 'JetBrains Mono', weights: '400,700', category: 'mono' },
  { family: 'Space Mono', label: 'Space Mono', weights: '400,700', category: 'mono' },
]

// Curated "font pairings" shown in the Text panel (Canva-style)
export const FONT_STYLES: {
  id: string
  name: string
  heading: { family: string; weight: number; size: number }
  body: { family: string; weight: number; size: number }
}[] = [
  {
    id: 'bold-modern',
    name: 'Bold modern',
    heading: { family: 'Montserrat', weight: 800, size: 64 },
    body: { family: 'Inter', weight: 400, size: 24 },
  },
  {
    id: 'elegant-serif',
    name: 'Elegant editorial',
    heading: { family: 'Playfair Display', weight: 700, size: 64 },
    body: { family: 'Roboto Slab', weight: 400, size: 24 },
  },
  {
    id: 'loud-display',
    name: 'Loud & proud',
    heading: { family: 'Anton', weight: 400, size: 72 },
    body: { family: 'Space Grotesk', weight: 500, size: 22 },
  },
  {
    id: 'friendly-hand',
    name: 'Friendly & casual',
    heading: { family: 'Caveat', weight: 700, size: 72 },
    body: { family: 'Poppins', weight: 400, size: 24 },
  },
  {
    id: 'retro-poster',
    name: 'Retro poster',
    heading: { family: 'Abril Fatface', weight: 400, size: 64 },
    body: { family: 'Oswald', weight: 500, size: 22 },
  },
  {
    id: 'clean-tech',
    name: 'Clean tech',
    heading: { family: 'Space Grotesk', weight: 700, size: 60 },
    body: { family: 'Inter', weight: 400, size: 22 },
  },
]

// ── Color palettes ───────────────────────────────────────────

export const BRAND = {
  teal: '#00C4CC',
  violet: '#7D2AE8',
  magenta: '#FF5C8A',
  ink: '#1F2226',
  rail: '#17181D',
  workspace: '#E9EAF0',
}

export const SOLID_SWATCHES: string[] = [
  '#FFFFFF', '#F4F5F7', '#E0E1E6', '#A9ABB6', '#6E717F', '#3D3F47', '#1F2226', '#000000',
  '#FF5C8A', '#FF7A59', '#FFB84C', '#FFE066', '#B8E986', '#7ED957', '#34C77B', '#0FA968',
  '#00C4CC', '#0BBBCD', '#00B8D9', '#5AC8FA', '#7D2AE8', '#9B6BFF', '#C3A6FF', '#F4A7FF',
  '#F8C8DC', '#FDE2E4', '#FFD6A5', '#FDF6B3', '#CDEAC0', '#B7E4C7', '#A2D2FF', '#ADC6FF',
]

export const GRADIENT_PRESETS: { from: string; to: string; angle: number }[] = [
  { from: '#00C4CC', to: '#7D2AE8', angle: 135 },
  { from: '#FF5C8A', to: '#FFB84C', angle: 135 },
  { from: '#7D2AE8', to: '#C3A6FF', angle: 160 },
  { from: '#00C4CC', to: '#5AC8FA', angle: 120 },
  { from: '#FDE2E4', to: '#F8C8DC', angle: 120 },
  { from: '#B8E986', to: '#7ED957', angle: 130 },
  { from: '#FFE066', to: '#FF7A59', angle: 140 },
  { from: '#1F2226', to: '#3D3F47', angle: 140 },
  { from: '#34C77B', to: '#0BBBCD', angle: 150 },
  { from: '#FF5C8A', to: '#7D2AE8', angle: 150 },
  { from: '#FFD6A5', to: '#FFE066', angle: 120 },
  { from: '#0FA968', to: '#FFE066', angle: 160 },
]

// ── Graphics (filled paths authored in a 100×100 box) ────────

export interface GraphicDef {
  id: string
  name: string
  path: string
}

export const GRAPHICS: GraphicDef[] = [
  {
    id: 'heart',
    name: 'Heart',
    path: 'M50 88 C22 66 4 48 4 28 C4 12 17 2 31 2 C40 2 47 7 50 13 C53 7 60 2 69 2 C83 2 96 12 96 28 C96 48 78 66 50 88 Z',
  },
  {
    id: 'burst',
    name: 'Starburst',
    path: 'M50 0 L58 14 L74 8 L76 26 L92 30 L84 44 L96 54 L82 64 L88 80 L70 78 L64 94 L50 84 L36 94 L30 78 L12 80 L18 64 L4 54 L16 44 L8 30 L24 26 L26 8 L42 14 Z',
  },
  {
    id: 'blob',
    name: 'Blob',
    path: 'M42 2 C70 -6 98 16 96 46 C94 78 68 100 40 96 C12 92 -4 66 6 40 C14 18 24 8 42 2 Z',
  },
  {
    id: 'badge',
    name: 'Badge',
    path: 'M50 2 L62 10 L77 6 L82 21 L96 27 L92 42 L99 55 L87 64 L87 79 L72 82 L64 96 L50 91 L36 96 L28 82 L13 79 L13 64 L1 55 L8 42 L4 27 L18 21 L23 6 L38 10 Z',
  },
  {
    id: 'arrow',
    name: 'Arrow',
    path: 'M8 38 L38 38 L38 12 L64 50 L38 88 L38 62 L8 62 Z',
  },
  {
    id: 'ribbon',
    name: 'Ribbon',
    path: 'M2 26 L50 2 L98 26 L98 74 L50 98 L2 74 Z M50 24 L18 42 L50 60 L82 42 Z',
  },
  {
    id: 'speech',
    name: 'Speech bubble',
    path: 'M12 2 H88 C94 2 98 6 98 12 V62 C98 68 94 72 88 72 H44 L24 96 L26 72 H12 C6 72 2 68 2 62 V12 C2 6 6 2 12 2 Z',
  },
  {
    id: 'sparkle',
    name: 'Sparkle',
    path: 'M50 0 C54 26 62 34 88 38 L96 50 L88 62 C62 66 54 74 50 100 L46 74 C38 66 26 62 12 62 L4 50 L12 38 C26 34 38 26 42 0 Z',
  },
  {
    id: 'wave',
    name: 'Wave',
    path: 'M2 60 C20 30 40 30 58 50 C72 66 86 66 98 46 L98 70 H2 Z M2 40 H98 V46 C84 58 70 56 56 40 C38 20 18 20 2 48 Z',
  },
  {
    id: 'banner',
    name: 'Banner',
    path: 'M2 10 H98 V74 L82 62 L66 74 L50 62 L34 74 L18 62 L2 74 Z',
  },
  {
    id: 'pentagon',
    name: 'Pentagon',
    path: 'M50 2 L96 36 L78 94 H22 L4 36 Z',
  },
  {
    id: 'hexagon',
    name: 'Hexagon',
    path: 'M25 4 H75 L96 50 L75 96 H25 L4 50 Z',
  },
  {
    id: 'octagon',
    name: 'Octagon',
    path: 'M30 2 H70 L96 30 V70 L70 98 H30 L4 70 V30 Z',
  },
  {
    id: 'cloud',
    name: 'Cloud',
    path: 'M24 76 C10 76 2 66 2 54 C2 42 12 33 24 34 C28 18 42 8 58 8 C76 8 90 20 92 38 C96 44 98 50 96 58 C94 70 84 76 74 76 Z',
  },
  {
    id: 'moon',
    name: 'Moon',
    path: 'M62 2 C30 8 6 34 6 62 C6 86 26 98 40 98 C20 88 12 64 22 42 C32 22 52 8 78 8 C74 4 68 2 62 2 Z',
  },
  {
    id: 'bolt',
    name: 'Bolt',
    path: 'M56 2 L18 56 H44 L38 98 L82 40 H54 Z',
  },
  {
    id: 'check-circle',
    name: 'Check circle',
    path: 'M50 2 C76 2 98 24 98 50 C98 76 76 98 50 98 C24 98 2 76 2 50 C2 24 24 2 50 2 Z M44 72 L76 40 L68 32 L44 56 L32 44 L24 52 Z',
  },
  {
    id: 'diamond',
    name: 'Diamond',
    path: 'M50 2 L98 50 L50 98 L2 50 Z',
  },
  {
    id: 'semi-circle',
    name: 'Semicircle',
    path: 'M2 50 A48 48 0 0 1 98 50 Z',
  },
  {
    id: 'frame',
    name: 'Frame',
    path: 'M2 2 H98 V98 H2 Z M14 14 V86 H86 V14 Z',
  },
]

// ── Stickers (emoji) ─────────────────────────────────────────

export const STICKER_GROUPS: { name: string; emojis: string[] }[] = [
  {
    name: 'Popular',
    emojis: ['😀', '😍', '🤩', '😎', '🥳', '🤗', '🤔', '😅', '😂', '🥰', '😴', '🤯', '👀', '🔥', '✨', '💯', '🎉', '🎈', '🎁', '🏆', '🥇', '⚡', '💜', '⭐'],
  },
  {
    name: 'Hearts & symbols',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💗', '💖', '💘', '💝', '✔️', '❌', '➕', '➖', '✖️', '♾️', '🔆', '🎵', '📌', '🔗', '💬', '🕐'],
  },
  {
    name: 'Nature & food',
    emojis: ['🌸', '🌺', '🌻', '🌷', '🌿', '🍀', '🌵', '🌴', '🌈', '☀️', '🌙', '☁️', '💧', '🌊', '🍎', '🍋', '🍓', '🥑', '☕', '🍰', '🍩', '🍕', '🧋', '🍪'],
  },
  {
    name: 'Objects',
    emojis: ['📱', '💻', '🎧', '📷', '🎬', '🎨', '✏️', '📚', '💼', '💰', '🔮', '🧭', '🏠', '✈️', '🚗', '🚀', '⚽', '🎯', '🎮', '🪄', '💎', '👑', '🕯️', '🛍️'],
  },
]

// ── Snap helpers ─────────────────────────────────────────────

export interface GuideLine {
  axis: 'x' | 'y'
  position: number // page-space coordinate
}

export const SNAP_THRESHOLD = 6 // page units (pre-zoom)

export function computeSnap(
  moving: { x: number; y: number; width: number; height: number; rotation: number },
  others: { x: number; y: number; width: number; height: number; rotation: number }[],
  page: { width: number; height: number }
): { dx: number; dy: number; guides: GuideLine[] } {
  const guides: GuideLine[] = []
  let dx = 0
  let dy = 0

  const movingCx = moving.x + moving.width / 2
  const movingCy = moving.y + moving.height / 2

  const xTargets: number[] = [page.width / 2, 0, page.width]
  const yTargets: number[] = [page.height / 2, 0, page.height]
  for (const o of others) {
    xTargets.push(o.x + o.width / 2, o.x, o.x + o.width)
    yTargets.push(o.y + o.height / 2, o.y, o.y + o.height)
  }

  let bestX: { dist: number; pos: number } | null = null
  for (const target of xTargets) {
    for (const edge of [moving.x, movingCx, moving.x + moving.width]) {
      const d = target - edge
      if (Math.abs(d) <= SNAP_THRESHOLD && (bestX === null || Math.abs(d) < Math.abs(bestX.dist))) {
        bestX = { dist: d, pos: target }
      }
    }
  }
  let bestY: { dist: number; pos: number } | null = null
  for (const target of yTargets) {
    for (const edge of [moving.y, movingCy, moving.y + moving.height]) {
      const d = target - edge
      if (Math.abs(d) <= SNAP_THRESHOLD && (bestY === null || Math.abs(d) < Math.abs(bestY.dist))) {
        bestY = { dist: d, pos: target }
      }
    }
  }

  if (bestX) {
    dx = bestX.dist
    guides.push({ axis: 'x', position: bestX.pos })
  }
  if (bestY) {
    dy = bestY.dist
    guides.push({ axis: 'y', position: bestY.pos })
  }
  return { dx, dy, guides }
}

// ── Misc helpers ─────────────────────────────────────────────

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export function pageElements(page: PageData): AnyElement[] {
  return page.elements.filter((e) => e.visible)
}

/** Konva linear gradient helper — returns props for a Rect fill. */
export function gradientProps(from: string, to: string, angle: number, w: number, h: number) {
  const rad = (angle * Math.PI) / 180
  const dx = Math.cos(rad) * w
  const dy = Math.sin(rad) * h
  const cx = w / 2
  const cy = h / 2
  const halfLen = Math.sqrt(dx * dx + dy * dy) / 2
  const ux = (Math.cos(rad) * halfLen) / 1
  const uy = (Math.sin(rad) * halfLen) / 1
  return {
    fillLinearGradientStartPoint: { x: cx - ux, y: cy - uy },
    fillLinearGradientEndPoint: { x: cx + ux, y: cy + uy },
    fillLinearGradientColorStops: [0, from, 1, to],
  }
}

/**
 * Konva gradient props for an element's GradientFill.
 * `origin` selects the shape's local coordinate frame:
 *  - 'corner'  : rect / triangle / text — (0,0)..(w,h)
 *  - 'center'  : ellipse / star — local origin is the shape centre
 *  - 'box100'  : path — authored in a 100×100 box (scaled by shape w/h)
 */
export function elementGradientProps(
  g: GradientFill,
  w: number,
  h: number,
  origin: 'corner' | 'center' | 'box100' = 'corner'
): Record<string, unknown> {
  const bw = origin === 'box100' ? 100 : w
  const bh = origin === 'box100' ? 100 : h
  const cx = origin === 'center' ? 0 : bw / 2
  const cy = origin === 'center' ? 0 : bh / 2

  if (g.type === 'radial') {
    const r = Math.max(bw, bh) / 2
    return {
      fillRadialGradientStartPoint: { x: cx, y: cy },
      fillRadialGradientStartRadius: 0,
      fillRadialGradientEndPoint: { x: cx, y: cy },
      fillRadialGradientEndRadius: r,
      fillRadialGradientColorStops: [0, g.from, 1, g.to],
    }
  }

  const rad = (g.angle * Math.PI) / 180
  const halfLen = Math.sqrt((Math.cos(rad) * bw) ** 2 + (Math.sin(rad) * bh) ** 2) / 2
  const ux = Math.cos(rad) * halfLen
  const uy = Math.sin(rad) * halfLen
  return {
    fillLinearGradientStartPoint: { x: cx - ux, y: cy - uy },
    fillLinearGradientEndPoint: { x: cx + ux, y: cy + uy },
    fillLinearGradientColorStops: [0, g.from, 1, g.to],
  }
}

export const PRESET_SIZES = [
  { name: 'Instagram post', width: 1080, height: 1080, hint: '1080 × 1080 px' },
  { name: 'Instagram story', width: 1080, height: 1920, hint: '1080 × 1920 px' },
  { name: 'Presentation', width: 1920, height: 1080, hint: '1920 × 1080 px' },
  { name: 'Poster', width: 1240, height: 1754, hint: 'A4 poster' },
  { name: 'Logo', width: 500, height: 500, hint: '500 × 500 px' },
  { name: 'YouTube thumbnail', width: 1280, height: 720, hint: '1280 × 720 px' },
  { name: 'Facebook cover', width: 1640, height: 856, hint: '1640 × 856 px' },
  { name: 'Business card', width: 1050, height: 600, hint: '1.75 × 1 in' },
] as const
