// ─────────────────────────────────────────────────────────────
// Canvix editor utilities — fonts, palettes, graphics, helpers
// ─────────────────────────────────────────────────────────────

import type { AnyElement, GradientFill, PageData } from './types'

// ── Fonts (loaded in layout via Google Fonts) ────────────────

// ── Fonts ────────────────────────────────────────────────────
// v0.17 (Wave 2): the catalog moved to lib/fonts/catalog.ts (63 → 369
// families, on-demand loading via lib/fonts/loader.ts). Re-exported
// here so every historic import keeps working.

export type { FontOption } from './fonts/catalog'
export { FONTS, PRELOADED_FONTS } from './fonts/catalog'

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

export interface SizePreset {
  name: string
  width: number
  height: number
  hint: string
}

/** the eight historic quick-start cards (unchanged) */
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

// ── v0.17 (Wave 2): the full preset catalog — 60+ sizes across five
// groups. The dashboard quick cards stay PRESET_SIZES; the grouped
// browser behind "More sizes" renders PRESET_GROUPS.
export const PRESET_GROUPS: { id: string; label: string; presets: SizePreset[] }[] = [
  {
    id: 'social',
    label: 'Social media',
    presets: [
      { name: 'Instagram post', width: 1080, height: 1080, hint: '1080 × 1080 px' },
      { name: 'Instagram portrait', width: 1080, height: 1350, hint: '1080 × 1350 px' },
      { name: 'Instagram story', width: 1080, height: 1920, hint: '1080 × 1920 px' },
      { name: 'Facebook post', width: 1200, height: 630, hint: '1200 × 630 px' },
      { name: 'Facebook cover', width: 1640, height: 856, hint: '1640 × 856 px' },
      { name: 'Facebook ad', width: 1200, height: 628, hint: '1200 × 628 px' },
      { name: 'X post', width: 1600, height: 900, hint: '1600 × 900 px' },
      { name: 'X header', width: 1500, height: 500, hint: '1500 × 500 px' },
      { name: 'LinkedIn post', width: 1200, height: 1200, hint: '1200 × 1200 px' },
      { name: 'LinkedIn banner', width: 1584, height: 396, hint: '1584 × 396 px' },
      { name: 'Pinterest pin', width: 1000, height: 1500, hint: '1000 × 1500 px' },
      { name: 'Pinterest long pin', width: 1000, height: 2100, hint: '1000 × 2100 px' },
      { name: 'TikTok video', width: 1080, height: 1920, hint: '1080 × 1920 px' },
      { name: 'Threads post', width: 1080, height: 1350, hint: '1080 × 1350 px' },
      { name: 'WhatsApp status', width: 1080, height: 1920, hint: '1080 × 1920 px' },
      { name: 'Twitch banner', width: 1920, height: 480, hint: '1920 × 480 px' },
      { name: 'Discord banner', width: 960, height: 540, hint: '960 × 540 px' },
    ],
  },
  {
    id: 'video',
    label: 'Video & thumbnails',
    presets: [
      { name: 'YouTube thumbnail', width: 1280, height: 720, hint: '1280 × 720 px' },
      { name: 'YouTube banner', width: 2560, height: 1440, hint: '2560 × 1440 px' },
      { name: 'YouTube end screen', width: 1920, height: 1080, hint: '1920 × 1080 px' },
      { name: 'Video 16:9', width: 1920, height: 1080, hint: '1920 × 1080 px' },
      { name: 'Video 9:16', width: 1080, height: 1920, hint: '1080 × 1920 px' },
      { name: 'Video 1:1', width: 1080, height: 1080, hint: '1080 × 1080 px' },
      { name: 'Video 4:5', width: 1080, height: 1350, hint: '1080 × 1350 px' },
      { name: 'Podcast cover', width: 1400, height: 1400, hint: '1400 × 1400 px' },
    ],
  },
  {
    id: 'docs',
    label: 'Presentations & docs',
    presets: [
      { name: 'Presentation 16:9', width: 1920, height: 1080, hint: '1920 × 1080 px' },
      { name: 'Presentation 4:3', width: 1440, height: 1080, hint: '1440 × 1080 px' },
      { name: 'A4 document', width: 1240, height: 1754, hint: 'A4 portrait' },
      { name: 'A4 landscape', width: 1754, height: 1240, hint: 'A4 landscape' },
      { name: 'US Letter doc', width: 1275, height: 1650, hint: '8.5 × 11 in' },
      { name: 'Resume', width: 1240, height: 1754, hint: 'A4 one-pager' },
      { name: 'Invoice', width: 1240, height: 1754, hint: 'A4 one-pager' },
      { name: 'Certificate', width: 1754, height: 1240, hint: 'A4 landscape' },
      { name: 'Ebook page', width: 1600, height: 2400, hint: '1600 × 2400 px' },
    ],
  },
  {
    id: 'print',
    label: 'Print',
    presets: [
      { name: 'Poster A4', width: 1240, height: 1754, hint: 'A4 poster' },
      { name: 'Poster A3', width: 1754, height: 2480, hint: 'A3 poster' },
      { name: 'Poster 18 × 24 in', width: 1800, height: 2400, hint: '18 × 24 in' },
      { name: 'Flyer', width: 1240, height: 1754, hint: 'A4 flyer' },
      { name: 'Business card', width: 1050, height: 600, hint: '1.75 × 1 in' },
      { name: 'Business card EU', width: 1004, height: 650, hint: '85 × 55 mm' },
      { name: 'Postcard', width: 1800, height: 1200, hint: '6 × 4 in' },
      { name: 'Menu', width: 1240, height: 1754, hint: 'A4 menu' },
      { name: 'Ticket', width: 700, height: 350, hint: '700 × 350 px' },
      { name: 'Invitation', width: 1050, height: 750, hint: '5 × 7 in at 150 DPI' },
      { name: 'Book cover', width: 1600, height: 2400, hint: '1600 × 2400 px' },
      { name: 'Album cover', width: 1400, height: 1400, hint: '1400 × 1400 px' },
      { name: 'Sticker sheet', width: 1200, height: 1800, hint: 'A4 sheet' },
    ],
  },
  {
    id: 'web',
    label: 'Web & marketing',
    presets: [
      { name: 'Web banner', width: 1920, height: 600, hint: '1920 × 600 px' },
      { name: 'Hero header', width: 2560, height: 1440, hint: '2560 × 1440 px' },
      { name: 'Leaderboard ad', width: 728, height: 90, hint: '728 × 90 px' },
      { name: 'Square ad', width: 300, height: 250, hint: '300 × 250 px' },
      { name: 'Skyscraper ad', width: 160, height: 600, hint: '160 × 600 px' },
      { name: 'Email header', width: 1200, height: 400, hint: '1200 × 400 px' },
      { name: 'Newsletter', width: 1200, height: 1600, hint: '1200 × 1600 px' },
      { name: 'Infographic', width: 800, height: 2000, hint: '800 × 2000 px' },
      { name: 'Favicon', width: 512, height: 512, hint: '512 × 512 px' },
      { name: 'App icon', width: 1024, height: 1024, hint: '1024 × 1024 px' },
      { name: 'Logo', width: 500, height: 500, hint: '500 × 500 px' },
      { name: 'Desktop wallpaper', width: 1920, height: 1080, hint: '1920 × 1080 px' },
      { name: 'Phone wallpaper', width: 1080, height: 1920, hint: '1080 × 1920 px' },
    ],
  },
]

// ── Interaction mode (v0.11.6 — QA finding F3) ──────────────

/**
 * The single derived interaction mode shown by BOTH the top-bar control and
 * the Tools panel. The two controls used to display separate store fields
 * (`editingMode` vs `tool`), so the UI could show "Draw" pressed while the
 * canvas behaved as read-only Select — the QA pass called it "editing-mode
 * toggles can disagree". One derivation can't disagree with itself:
 *
 *   viewing  — read-only, always wins over the active tool
 *   draw     — editing + the freehand brush tool
 *   editing  — editing + the select tool (move / resize / marquee)
 */
export type InteractionMode = 'editing' | 'draw' | 'viewing'

/** Combine the read-only toggle with the active tool into one visible mode. */
export function interactionMode(
  editingMode: 'editing' | 'viewing',
  tool: 'select' | 'draw',
): InteractionMode {
  if (editingMode === 'viewing') return 'viewing'
  return tool === 'draw' ? 'draw' : 'editing'
}
