// ─────────────────────────────────────────────────────────────
// Canvix built-in templates (seeded into DB + used client-side)
// ─────────────────────────────────────────────────────────────

import {
  createPage,
  createShapeElement,
  createTextElement,
  createLineElement,
  createStickerElement,
  type PageData,
  type TemplateRecord,
} from './types'
import { GRAPHICS } from './editor-utils'

export interface TemplateDef {
  slug: string
  name: string
  category: string
  width: number
  height: number
  accent: string
  pages: PageData[]
}

// compact element builders
const tx = (o: Record<string, unknown>) =>
  createTextElement(o as Parameters<typeof createTextElement>[0])
const sh = (type: 'rect' | 'ellipse' | 'triangle' | 'star' | 'path', o: Record<string, unknown>) =>
  createShapeElement(type, o as Parameters<typeof createShapeElement>[1])
const ln = (o: Record<string, unknown>) =>
  createLineElement(o as Parameters<typeof createLineElement>[0])
const st = (char: string, o: Record<string, unknown>) =>
  createStickerElement(char, o as Parameters<typeof createStickerElement>[1])
const gr = (graphicId: string, o: Record<string, unknown>) =>
  createShapeElement('path', {
    pathData: GRAPHICS.find((g) => g.id === graphicId)?.path ?? GRAPHICS[0].path,
    ...(o as Parameters<typeof createShapeElement>[1]),
  })

export const TEMPLATES: TemplateDef[] = [
  // ── Social media ───────────────────────────────────────────
  {
    slug: 'mega-sale',
    name: 'Mega Sale Post',
    category: 'social',
    width: 1080,
    height: 1080,
    accent: '#FF5C8A',
    pages: [
      {
        id: 'p1',
        background: { type: 'gradient', from: '#FF5C8A', to: '#FFB84C', angle: 135 },
        elements: [
          tx({ x: 90, y: 250, width: 900, height: 220, text: 'MEGA', fontFamily: 'Anton', fontSize: 200, fill: '#FFFFFF', align: 'center' }),
          tx({ x: 90, y: 450, width: 900, height: 220, text: 'SALE', fontFamily: 'Anton', fontSize: 200, fill: '#FFFFFF', align: 'center' }),
          sh('rect', { x: 290, y: 730, width: 500, height: 96, fill: '#1F2226', cornerRadius: 48 }),
          tx({ x: 310, y: 758, width: 460, height: 60, text: 'UP TO 50% OFF', fontFamily: 'Poppins', bold: true, fontSize: 36, fill: '#FFFFFF', align: 'center' }),
          tx({ x: 90, y: 940, width: 900, height: 40, text: 'THIS WEEKEND ONLY  •  IN STORE & ONLINE', fontFamily: 'Inter', bold: true, fontSize: 24, letterSpacing: 2, fill: '#5C2E00', align: 'center' }),
          gr('sparkle', { x: 40, y: 70, width: 130, height: 130, fill: '#FFFFFF' }),
          gr('sparkle', { x: 900, y: 850, width: 100, height: 100, fill: '#FFFFFF' }),
        ],
      },
    ],
  },
  {
    slug: 'dream-bigger',
    name: 'Inspirational Quote',
    category: 'social',
    width: 1080,
    height: 1080,
    accent: '#0F4C4C',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#0F4C4C' },
        elements: [
          tx({ x: 90, y: 330, width: 900, height: 180, text: '“Dream', fontFamily: 'Playfair Display', fontSize: 130, fill: '#F4F1E8', align: 'left' }),
          tx({ x: 90, y: 500, width: 900, height: 180, text: 'bigger.”', fontFamily: 'Playfair Display', italic: true, fontSize: 130, fill: '#F4F1E8', align: 'left' }),
          ln({ x: 90, y: 740, width: 160, height: 0, stroke: '#FFD166', strokeWidth: 10 }),
          tx({ x: 90, y: 790, width: 700, height: 50, text: '— your future self', fontFamily: 'Inter', fontSize: 30, fill: '#B8DEDE', align: 'left' }),
          gr('star', { x: 790, y: 190, width: 150, height: 150, fill: '#FFD166' }),
        ],
      },
    ],
  },
  {
    slug: 'coffee-brew',
    name: 'Coffee Promo',
    category: 'social',
    width: 1080,
    height: 1080,
    accent: '#6F4E37',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#F6EFE7' },
        elements: [
          tx({ x: 90, y: 180, width: 900, height: 150, text: 'MORNING', fontFamily: 'Bebas Neue', fontSize: 130, fill: '#4A2F23', align: 'left' }),
          tx({ x: 90, y: 300, width: 900, height: 150, text: 'BREW', fontFamily: 'Bebas Neue', fontSize: 130, fill: '#C87F4A', align: 'left' }),
          tx({ x: 90, y: 470, width: 720, height: 110, text: 'Buy one, get one free', fontFamily: 'Caveat', bold: true, fontSize: 76, fill: '#6F4E37', align: 'left' }),
          tx({ x: 90, y: 620, width: 800, height: 50, text: 'SAT & SUN  •  7 AM – 12 PM', fontFamily: 'Poppins', bold: true, fontSize: 30, fill: '#4A2F23', align: 'left', letterSpacing: 2 }),
          sh('ellipse', { x: -90, y: 660, width: 460, height: 460, fill: '#6F4E37' }),
          sh('ellipse', { x: 120, y: 760, width: 220, height: 220, fill: '#F6EFE7' }),
          st('☕', { x: 660, y: 640, width: 300, height: 300, fontSize: 240 }),
        ],
      },
    ],
  },
  {
    slug: 'sunset-fest',
    name: 'Music Festival',
    category: 'social',
    width: 1080,
    height: 1080,
    accent: '#14141B',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#14141B' },
        elements: [
          tx({ x: 90, y: 170, width: 900, height: 200, text: 'SUNSET', fontFamily: 'Anton', fontSize: 160, fill: '#FF5C8A', align: 'center' }),
          tx({ x: 90, y: 360, width: 900, height: 200, text: 'FEST', fontFamily: 'Anton', fontSize: 160, fill: '#00C4CC', align: 'center' }),
          tx({ x: 90, y: 550, width: 900, height: 200, text: "'26", fontFamily: 'Anton', fontSize: 160, fill: '#FFB84C', align: 'center' }),
          ln({ x: 90, y: 800, width: 400, height: 0, stroke: '#F4F5F7', strokeWidth: 5 }),
          tx({ x: 90, y: 830, width: 900, height: 50, text: 'SAT 22 AUG  •  PIER 17  •  GATES 6 PM', fontFamily: 'Inter', bold: true, fontSize: 28, letterSpacing: 3, fill: '#F4F5F7', align: 'left' }),
          st('🌅', { x: 760, y: 780, width: 220, height: 220, fontSize: 170 }),
        ],
      },
    ],
  },
  {
    slug: 'new-drop-story',
    name: 'New Drop Story',
    category: 'social',
    width: 1080,
    height: 1920,
    accent: '#7ED957',
    pages: [
      {
        id: 'p1',
        background: { type: 'gradient', from: '#B8E986', to: '#7ED957', angle: 120 },
        elements: [
          tx({ x: 60, y: 380, width: 960, height: 330, text: 'NEW', fontFamily: 'Bebas Neue', fontSize: 300, fill: '#FFFFFF', align: 'center' }),
          tx({ x: 60, y: 690, width: 960, height: 330, text: 'DROP', fontFamily: 'Bebas Neue', fontSize: 300, fill: '#1F2226', align: 'center' }),
          tx({ x: 60, y: 1080, width: 900, height: 130, text: 'the summer collection is live', fontFamily: 'Caveat', bold: true, fontSize: 84, fill: '#FFFFFF', align: 'left' }),
          sh('rect', { x: 60, y: 1290, width: 430, height: 110, fill: '#FFFFFF', cornerRadius: 55 }),
          tx({ x: 90, y: 1326, width: 380, height: 60, text: 'SHOP NOW', fontFamily: 'Poppins', bold: true, fontSize: 38, fill: '#1F2226', align: 'center' }),
          gr('sparkle', { x: 720, y: 1010, width: 200, height: 200, fill: '#FFFFFF' }),
          st('🛍️', { x: 730, y: 1560, width: 240, height: 240, fontSize: 190 }),
        ],
      },
    ],
  },
  {
    slug: 'no-excuses',
    name: 'Workout Story',
    category: 'social',
    width: 1080,
    height: 1920,
    accent: '#FF5C8A',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#1F2226' },
        elements: [
          tx({ x: 60, y: 520, width: 960, height: 400, text: 'NO', fontFamily: 'Bebas Neue', fontSize: 330, fill: '#FF5C8A', align: 'center' }),
          tx({ x: 60, y: 900, width: 960, height: 400, text: 'EXCUSES', fontFamily: 'Bebas Neue', fontSize: 250, fill: '#FFFFFF', align: 'center' }),
          ln({ x: 90, y: 1420, width: 220, height: 0, stroke: '#FF5C8A', strokeWidth: 12 }),
          tx({ x: 90, y: 1470, width: 900, height: 60, text: 'MON–FRI  •  6 AM SHRED  •  BRING A FRIEND', fontFamily: 'Poppins', bold: true, fontSize: 34, letterSpacing: 2, fill: '#F4F5F7', align: 'left' }),
          st('💪', { x: 380, y: 300, width: 300, height: 300, fontSize: 240 }),
        ],
      },
    ],
  },

  // ── Presentation ───────────────────────────────────────────
  {
    slug: 'startup-pitch',
    name: 'Startup Pitch Deck',
    category: 'presentation',
    width: 1920,
    height: 1080,
    accent: '#00C4CC',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#FFFFFF' },
        elements: [
          tx({ x: 124, y: 170, width: 500, height: 40, text: '2026 PITCH DECK', fontFamily: 'Inter', bold: true, fontSize: 22, letterSpacing: 6, fill: '#00C4CC', align: 'left' }),
          tx({ x: 120, y: 380, width: 1200, height: 140, text: 'Nimbus', fontFamily: 'Montserrat', bold: true, fontSize: 110, fill: '#1F2226', align: 'left' }),
          sh('rect', { x: 124, y: 530, width: 120, height: 12, fill: '#00C4CC', cornerRadius: 6 }),
          tx({ x: 124, y: 570, width: 1100, height: 90, text: 'Cloud cost intelligence for modern teams', fontFamily: 'Inter', fontSize: 36, fill: '#6E717F', align: 'left' }),
          gr('blob', { x: 1300, y: 120, width: 480, height: 480, fill: '#E0F7F8' }),
          gr('sparkle', { x: 1450, y: 700, width: 140, height: 140, fill: '#00C4CC' }),
        ],
      },
      {
        id: 'p2',
        background: { type: 'solid', color: '#FFFFFF' },
        elements: [
          tx({ x: 124, y: 120, width: 900, height: 80, text: 'The problem', fontFamily: 'Montserrat', bold: true, fontSize: 54, fill: '#1F2226', align: 'left' }),
          sh('rect', { x: 124, y: 220, width: 80, height: 10, fill: '#7D2AE8', cornerRadius: 5 }),
          sh('rect', { x: 124, y: 300, width: 520, height: 180, fill: '#F4F5F7', cornerRadius: 16 }),
          tx({ x: 156, y: 330, width: 460, height: 50, text: 'Bills grow 30% a year', fontFamily: 'Poppins', bold: true, fontSize: 30, fill: '#1F2226', align: 'left' }),
          tx({ x: 156, y: 385, width: 460, height: 70, text: 'Teams only use 40% of provisioned resources.', fontFamily: 'Inter', fontSize: 22, fill: '#6E717F', align: 'left' }),
          sh('rect', { x: 124, y: 510, width: 520, height: 180, fill: '#F4F5F7', cornerRadius: 16 }),
          tx({ x: 156, y: 540, width: 460, height: 50, text: 'Nobody owns the budget', fontFamily: 'Poppins', bold: true, fontSize: 30, fill: '#1F2226', align: 'left' }),
          tx({ x: 156, y: 595, width: 460, height: 70, text: 'Finance and engineering work in different dashboards.', fontFamily: 'Inter', fontSize: 22, fill: '#6E717F', align: 'left' }),
          sh('rect', { x: 124, y: 720, width: 520, height: 180, fill: '#F4F5F7', cornerRadius: 16 }),
          tx({ x: 156, y: 750, width: 460, height: 50, text: 'Waste hides in the dark', fontFamily: 'Poppins', bold: true, fontSize: 30, fill: '#1F2226', align: 'left' }),
          tx({ x: 156, y: 805, width: 460, height: 70, text: 'Idle instances live for months without owners.', fontFamily: 'Inter', fontSize: 22, fill: '#6E717F', align: 'left' }),
          sh('ellipse', { x: 1250, y: 380, width: 480, height: 480, fill: '#EFE7FF' }),
          tx({ x: 1330, y: 560, width: 320, height: 120, text: '40%', fontFamily: 'Anton', fontSize: 120, fill: '#7D2AE8', align: 'center' }),
        ],
      },
      {
        id: 'p3',
        background: { type: 'solid', color: '#FFFFFF' },
        elements: [
          tx({ x: 120, y: 380, width: 1680, height: 200, text: 'THANK YOU', fontFamily: 'Bebas Neue', fontSize: 150, fill: '#1F2226', align: 'center' }),
          sh('rect', { x: 870, y: 600, width: 180, height: 10, fill: '#00C4CC', cornerRadius: 5 }),
          tx({ x: 560, y: 650, width: 800, height: 60, text: 'hello@nimbus.dev  •  nimbus.dev', fontFamily: 'Inter', fontSize: 30, fill: '#6E717F', align: 'center' }),
          gr('sparkle', { x: 260, y: 200, width: 130, height: 130, fill: '#FF5C8A' }),
          gr('sparkle', { x: 1520, y: 800, width: 130, height: 130, fill: '#00C4CC' }),
        ],
      },
    ],
  },

  // ── Print ──────────────────────────────────────────────────
  {
    slug: 'live-music',
    name: 'Live Music Poster',
    category: 'print',
    width: 1240,
    height: 1754,
    accent: '#FFD166',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#FFD166' },
        elements: [
          tx({ x: 80, y: 260, width: 1080, height: 300, text: 'LIVE', fontFamily: 'Anton', fontSize: 250, fill: '#1F2226', align: 'center' }),
          tx({ x: 80, y: 520, width: 1080, height: 300, text: 'MUSIC', fontFamily: 'Anton', fontSize: 250, fill: '#1F2226', align: 'center' }),
          tx({ x: 80, y: 780, width: 1080, height: 300, text: 'NIGHT', fontFamily: 'Anton', fontSize: 250, fill: '#1F2226', align: 'center' }),
          gr('badge', { x: 690, y: 1140, width: 400, height: 400, fill: '#1F2226', rotation: 12 }),
          tx({ x: 720, y: 1260, width: 340, height: 90, text: 'FRI 9 PM', fontFamily: 'Bebas Neue', fontSize: 64, fill: '#FFD166', align: 'center' }),
          tx({ x: 80, y: 1560, width: 1080, height: 50, text: 'THE BASEMENT  •  21+ ONLY  •  TICKETS AT DOOR', fontFamily: 'Inter', bold: true, fontSize: 28, letterSpacing: 2, fill: '#1F2226', align: 'left' }),
          sh('rect', { x: 80, y: 1640, width: 1080, height: 14, fill: '#1F2226', cornerRadius: 7 }),
        ],
      },
    ],
  },
  {
    slug: 'yoga-calm',
    name: 'Yoga Class Flyer',
    category: 'print',
    width: 1240,
    height: 1754,
    accent: '#C9D7BD',
    pages: [
      {
        id: 'p1',
        background: { type: 'gradient', from: '#E8F0E3', to: '#C9D7BD', angle: 160 },
        elements: [
          gr('blob', { x: 170, y: 350, width: 900, height: 800, fill: '#FFFFFF' }),
          tx({ x: 250, y: 520, width: 700, height: 140, text: 'find your', fontFamily: 'Caveat', bold: true, fontSize: 110, fill: '#5A6B5A', align: 'center' }),
          tx({ x: 250, y: 650, width: 700, height: 200, text: 'CALM', fontFamily: 'Playfair Display', bold: true, fontSize: 160, fill: '#2F3E2F', align: 'center' }),
          tx({ x: 250, y: 880, width: 700, height: 60, text: 'Morning yoga  •  Tue & Thu  •  7 AM', fontFamily: 'Poppins', bold: true, fontSize: 34, fill: '#4A5D4A', align: 'center' }),
          tx({ x: 250, y: 950, width: 700, height: 50, text: 'Sunset Rooftop Studio, 12 Marine St', fontFamily: 'Poppins', fontSize: 26, fill: '#6E717F', align: 'center' }),
          sh('ellipse', { x: 470, y: 1300, width: 300, height: 300, fill: '#B7C9A8' }),
          st('🧘', { x: 510, y: 1340, width: 220, height: 220, fontSize: 170 }),
        ],
      },
    ],
  },

  // ── Logo ───────────────────────────────────────────────────
  {
    slug: 'nova-logo',
    name: 'Minimal Logo',
    category: 'logo',
    width: 500,
    height: 500,
    accent: '#1F2226',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#FFFFFF' },
        elements: [
          sh('ellipse', { x: 60, y: 40, width: 220, height: 220, fill: '#1F2226' }),
          sh('ellipse', { x: 220, y: 150, width: 220, height: 220, fill: '#00C4CC' }),
          tx({ x: 80, y: 390, width: 340, height: 80, text: 'NOVA', fontFamily: 'Archivo Black', fontSize: 72, fill: '#1F2226', letterSpacing: 6, align: 'center' }),
          tx({ x: 80, y: 465, width: 340, height: 30, text: 'S T U D I O', fontFamily: 'Inter', fontSize: 16, letterSpacing: 8, fill: '#6E717F', align: 'center' }),
        ],
      },
    ],
  },

  // ── Video / thumbnails ─────────────────────────────────────
  {
    slug: 'ai-tools-thumb',
    name: 'Tech YouTube Thumbnail',
    category: 'thumbnail',
    width: 1280,
    height: 720,
    accent: '#0D1117',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#0D1117' },
        elements: [
          sh('rect', { x: 70, y: 90, width: 16, height: 540, fill: '#3FB950', cornerRadius: 8 }),
          tx({ x: 110, y: 120, width: 800, height: 190, text: 'TOP 10', fontFamily: 'Anton', fontSize: 160, fill: '#3FB950', align: 'left' }),
          tx({ x: 110, y: 300, width: 800, height: 190, text: 'AI TOOLS', fontFamily: 'Anton', fontSize: 160, fill: '#FFFFFF', align: 'left' }),
          sh('rect', { x: 110, y: 530, width: 340, height: 80, fill: '#238636', cornerRadius: 40 }),
          tx({ x: 130, y: 556, width: 300, height: 50, text: '2026 EDITION', fontFamily: 'Inter', bold: true, fontSize: 28, fill: '#FFFFFF', align: 'center' }),
          st('🤖', { x: 880, y: 140, width: 300, height: 300, fontSize: 240 }),
          tx({ x: 850, y: 470, width: 380, height: 70, text: 'new video every friday', fontFamily: 'Caveat', fontSize: 56, fill: '#8B949E', align: 'left' }),
        ],
      },
    ],
  },
]

export function templatesAsRecords(): TemplateRecord[] {
  return TEMPLATES.map((t) => ({
    id: t.slug,
    slug: t.slug,
    name: t.name,
    category: t.category,
    width: t.width,
    height: t.height,
    accent: t.accent,
    pages: t.pages,
  }))
}

export function blankPage(): PageData {
  return createPage()
}
