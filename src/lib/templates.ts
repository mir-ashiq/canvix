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

  // ── Design Trends 2026 (research/CANVA-V032-RESEARCH.md) ──
  {
    slug: 'prompt-playground',
    name: 'Prompt Playground',
    category: 'social',
    width: 1080,
    height: 1080,
    accent: '#8B3DFF',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#0F1015' },
        elements: [
          // playful productivity: gradient blob + prompt-bar aesthetic
          sh('ellipse', { x: 560, y: -140, width: 620, height: 620, fill: '#8B3DFF', fillGradient: { type: 'radial', from: '#9E9EFF', to: '#8B3DFF', angle: 0 } }),
          sh('rect', { x: 90, y: 330, width: 900, height: 110, fill: '#FFFFFF', cornerRadius: 55 }),
          tx({ x: 130, y: 360, width: 700, height: 60, text: 'ask me anything →', fontFamily: 'Manrope', bold: true, fontSize: 38, fill: '#0F1015', align: 'left' }),
          sh('rect', { x: 90, y: 480, width: 440, height: 90, fill: '#8B3DFF', fillGradient: { type: 'linear', from: '#8B3DFF', to: '#C3A6FF', angle: 90 }, cornerRadius: 24 }),
          tx({ x: 110, y: 506, width: 400, height: 50, text: 'make it playful', fontFamily: 'Outfit', bold: true, fontSize: 30, fill: '#FFFFFF', align: 'center' }),
          tx({ x: 90, y: 620, width: 900, height: 130, text: 'PRODUCTIVITY,\nBUT MAKE IT FUN', fontFamily: 'Outfit', bold: true, fontSize: 84, fill: '#FFFFFF', align: 'left', lineHeight: 1.1 }),
          tx({ x: 90, y: 800, width: 900, height: 60, text: 'the prompt playground trend — canva design trends 2026', fontFamily: 'Figtree', fontSize: 26, fill: '#9E9EFF', align: 'left' }),
          st('✨', { x: 850, y: 880, width: 160, height: 160, fontSize: 120 }),
        ],
      },
    ],
  },
  {
    slug: 'notes-app-chic',
    name: 'Notes App Chic',
    category: 'social',
    width: 1080,
    height: 1080,
    accent: '#E8DFC8',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#F6F0E1' },
        elements: [
          // raw, honest, human: paper + handwriting
          sh('rect', { x: 80, y: 80, width: 920, height: 920, fill: '#FFFDF4', cornerRadius: 28, stroke: '#D9CFB4', strokeWidth: 2 }),
          tx({ x: 140, y: 150, width: 780, height: 90, text: 'things i want to remember', fontFamily: 'Caveat', fontSize: 76, fill: '#2B2B26', align: 'left' }),
          ln({ x: 140, y: 280, width: 800, height: 0, stroke: '#E4D9BC', strokeWidth: 3, dashed: true }),
          tx({ x: 140, y: 320, width: 760, height: 70, text: '◦ slow mornings, good coffee', fontFamily: 'Kalam', fontSize: 42, fill: '#4A4A40', align: 'left' }),
          tx({ x: 140, y: 420, width: 760, height: 70, text: '◦ calling people back', fontFamily: 'Kalam', fontSize: 42, fill: '#4A4A40', align: 'left' }),
          tx({ x: 140, y: 520, width: 760, height: 70, text: '◦ less scrolling, more making', fontFamily: 'Kalam', fontSize: 42, fill: '#4A4A40', align: 'left' }),
          tx({ x: 140, y: 620, width: 760, height: 70, text: '◦ being honest about the mess', fontFamily: 'Kalam', fontSize: 42, fill: '#4A4A40', align: 'left' }),
          tx({ x: 140, y: 830, width: 500, height: 60, text: '— notes app, 6:41 am', fontFamily: 'Indie Flower', fontSize: 34, fill: '#8A8672', align: 'left' }),
          sh('rect', { x: 140, y: 740, width: 330, height: 56, fill: '#FFE8A3', rotation: -2, cornerRadius: 10 }),
          tx({ x: 158, y: 754, width: 300, height: 44, text: 'keep it human ★', fontFamily: 'Caveat', fontSize: 36, fill: '#5C4A00', align: 'left' }),
        ],
      },
    ],
  },
  {
    slug: 'texture-check',
    name: 'Texture Check',
    category: 'presentation',
    width: 1920,
    height: 1080,
    accent: '#B86B4F',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#EAD9C2' },
        elements: [
          // tactile design: layered warm gradients + serif elegance
          sh('rect', { x: -80, y: -80, width: 900, height: 1240, rotation: -6, fill: '#D9A47E', fillGradient: { type: 'linear', from: '#D9A47E', to: '#B86B4F', angle: 120 } }),
          sh('rect', { x: 120, y: 140, width: 1240, height: 800, fill: '#F7EDE0', cornerRadius: 40 }),
          tx({ x: 200, y: 260, width: 1080, height: 200, text: 'Design you can\nalmost feel', fontFamily: 'Fraunces', bold: true, fontSize: 110, fill: '#3E2A1C', align: 'left', lineHeight: 1.05 }),
          ln({ x: 200, y: 520, width: 220, height: 0, stroke: '#B86B4F', strokeWidth: 8 }),
          tx({ x: 200, y: 560, width: 1000, height: 140, text: 'Tactile surfaces, warm neutrals and honest materials — the 2026 answer to cold, flat screens.', fontFamily: 'Lora', fontSize: 38, fill: '#6B5340', align: 'left', lineHeight: 1.5 }),
          sh('ellipse', { x: 1490, y: 190, width: 260, height: 260, fill: '#E2906B', fillGradient: { type: 'radial', from: '#F3C4A6', to: '#D97747', angle: 0 } }),
          sh('ellipse', { x: 1560, y: 560, width: 180, height: 180, fill: '#C49A6C' }),
          st('🌾', { x: 1470, y: 820, width: 200, height: 200, fontSize: 150 }),
        ],
      },
    ],
  },
  {
    slug: 'opt-out-era',
    name: 'Opt Out Era',
    category: 'presentation',
    width: 1920,
    height: 1080,
    accent: '#0F1015',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#F4F3EF' },
        elements: [
          // structured simplicity: grid lines, whitespace, restraint
          ln({ x: 960, y: 0, width: 0, height: 1080, stroke: '#E3E1D8', strokeWidth: 2 }),
          ln({ x: 0, y: 620, width: 1920, height: 0, stroke: '#E3E1D8', strokeWidth: 2 }),
          tx({ x: 110, y: 170, width: 700, height: 300, text: 'Opt out\nof the noise.', fontFamily: 'Manrope', bold: true, fontSize: 120, fill: '#0F1015', align: 'left', lineHeight: 1.02 }),
          tx({ x: 110, y: 520, width: 620, height: 120, text: 'Structured simplicity. Fewer things, better made.', fontFamily: 'Manrope', fontSize: 34, fill: '#6E6E66', align: 'left', lineHeight: 1.5 }),
          tx({ x: 110, y: 900, width: 400, height: 40, text: 'LESS, BETTER — 2026', fontFamily: 'Manrope', bold: true, fontSize: 22, letterSpacing: 4, fill: '#0F1015', align: 'left' }),
          sh('rect', { x: 1100, y: 180, width: 700, height: 330, fill: '#0F1015', cornerRadius: 0 }),
          tx({ x: 1140, y: 260, width: 620, height: 80, text: '01 — declutter', fontFamily: 'DM Mono', bold: true, fontSize: 30, fill: '#F4F3EF', align: 'left' }),
          tx({ x: 1140, y: 340, width: 620, height: 80, text: '02 — slow down', fontFamily: 'DM Mono', bold: true, fontSize: 30, fill: '#F4F3EF', align: 'left' }),
          tx({ x: 1140, y: 420, width: 620, height: 80, text: '03 — keep what matters', fontFamily: 'DM Mono', bold: true, fontSize: 30, fill: '#F4F3EF', align: 'left' }),
          tx({ x: 1100, y: 720, width: 700, height: 200, text: '“Simplicity is the\nultimate sophistication.”', fontFamily: 'Bodoni Moda', italic: true, fontSize: 52, fill: '#0F1015', align: 'left', lineHeight: 1.25 }),
        ],
      },
    ],
  },
  {
    slug: 'granny-wave',
    name: 'Granny Wave',
    category: 'social',
    width: 1080,
    height: 1080,
    accent: '#8E2A3C',
    pages: [
      {
        id: 'p1',
        background: { type: 'gradient', from: '#4A0F22', to: '#8E2A3C', angle: 160 },
        elements: [
          // maximalist heritage remix: ornamental shapes, gold + heritage tones
          sh('ellipse', { x: 140, y: 140, width: 800, height: 800, fill: '#C9A24B', fillGradient: { type: 'radial', from: '#E8C877', to: '#A67C2E', angle: 0 } }),
          sh('ellipse', { x: 190, y: 190, width: 700, height: 700, fill: '#5E1230' }),
          gr('badge', { x: 415, y: 115, width: 250, height: 250, fill: '#C9A24B' }),
          tx({ x: 240, y: 420, width: 600, height: 130, text: 'GRANNY', fontFamily: 'Cinzel', bold: true, fontSize: 96, fill: '#F3DFA2', align: 'center' }),
          tx({ x: 240, y: 550, width: 600, height: 130, text: 'WAVE', fontFamily: 'Cinzel', bold: true, fontSize: 96, fill: '#F3DFA2', align: 'center' }),
          ln({ x: 300, y: 700, width: 480, height: 0, stroke: '#C9A24B', strokeWidth: 4 }),
          tx({ x: 240, y: 730, width: 600, height: 90, text: 'heritage remixed for 2026', fontFamily: 'Cormorant Garamond', italic: true, fontSize: 44, fill: '#E8C877', align: 'center' }),
          st('🌺', { x: 60, y: 800, width: 140, height: 140, fontSize: 100 }),
          st('🪭', { x: 880, y: 800, width: 140, height: 140, fontSize: 100 }),
        ],
      },
    ],
  },

  // ── Documents & office (v0.4 — canva.com/templates categories) ──
  {
    slug: 'minimal-resume',
    name: 'Minimal Resume',
    category: 'document',
    width: 1240,
    height: 1754,
    accent: '#1F2937',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#FFFFFF' },
        elements: [
          // sidebar
          sh('rect', { x: 0, y: 0, width: 420, height: 1754, fill: '#1F2937' }),
          tx({ x: 60, y: 120, width: 300, height: 70, text: 'ALEX MORGAN', fontFamily: 'Archivo', bold: true, fontSize: 40, fill: '#FFFFFF', align: 'left', letterSpacing: 2 }),
          tx({ x: 60, y: 200, width: 300, height: 50, text: 'Product Designer', fontFamily: 'Inter', fontSize: 22, fill: '#9CA3AF', align: 'left' }),
          ln({ x: 60, y: 300, width: 80, height: 0, stroke: '#02C0CC', strokeWidth: 4 }),
          tx({ x: 60, y: 340, width: 300, height: 40, text: 'CONTACT', fontFamily: 'Inter', bold: true, fontSize: 16, fill: '#02C0CC', align: 'left', letterSpacing: 3 }),
          tx({ x: 60, y: 390, width: 300, height: 160, text: 'alex@design.co\n+1 555 0100\nBrooklyn, NY', fontFamily: 'Inter', fontSize: 17, fill: '#D1D5DB', align: 'left', lineHeight: 1.7 }),
          tx({ x: 60, y: 620, width: 300, height: 40, text: 'SKILLS', fontFamily: 'Inter', bold: true, fontSize: 16, fill: '#02C0CC', align: 'left', letterSpacing: 3 }),
          tx({ x: 60, y: 670, width: 300, height: 260, text: 'UI / UX Design\nDesign Systems\nPrototyping\nFigma\nUser Research\nMotion Design', fontFamily: 'Inter', fontSize: 17, fill: '#D1D5DB', align: 'left', lineHeight: 1.9 }),
          // main column
          tx({ x: 480, y: 120, width: 700, height: 50, text: 'EXPERIENCE', fontFamily: 'Archivo', bold: true, fontSize: 26, fill: '#1F2937', align: 'left' }),
          tx({ x: 480, y: 190, width: 700, height: 40, text: 'Senior Product Designer — Nova Labs', fontFamily: 'Inter', bold: true, fontSize: 19, fill: '#111827', align: 'left' }),
          tx({ x: 480, y: 230, width: 700, height: 30, text: '2022 – present', fontFamily: 'Inter', fontSize: 15, fill: '#6B7280', align: 'left' }),
          tx({ x: 480, y: 270, width: 700, height: 110, text: 'Led the redesign of the flagship analytics suite; shipped a design system used by 40+ engineers.', fontFamily: 'Inter', fontSize: 16, fill: '#374151', align: 'left', lineHeight: 1.6 }),
          tx({ x: 480, y: 420, width: 700, height: 40, text: 'Product Designer — Loop', fontFamily: 'Inter', bold: true, fontSize: 19, fill: '#111827', align: 'left' }),
          tx({ x: 480, y: 460, width: 700, height: 30, text: '2019 – 2022', fontFamily: 'Inter', fontSize: 15, fill: '#6B7280', align: 'left' }),
          tx({ x: 480, y: 500, width: 700, height: 110, text: 'Owned onboarding flows end-to-end; lifted activation by 24% through iterative testing.', fontFamily: 'Inter', fontSize: 16, fill: '#374151', align: 'left', lineHeight: 1.6 }),
          tx({ x: 480, y: 680, width: 700, height: 50, text: 'EDUCATION', fontFamily: 'Archivo', bold: true, fontSize: 26, fill: '#1F2937', align: 'left' }),
          tx({ x: 480, y: 750, width: 700, height: 90, text: 'B.A. Interaction Design\nRhode Island School of Design · 2019', fontFamily: 'Inter', fontSize: 16, fill: '#374151', align: 'left', lineHeight: 1.7 }),
        ],
      },
    ],
  },
  {
    slug: 'elegant-certificate',
    name: 'Certificate of Achievement',
    category: 'document',
    width: 1754,
    height: 1240,
    accent: '#C9A24B',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#FBF7EF' },
        elements: [
          // ornamental double border
          sh('rect', { x: 50, y: 50, width: 1654, height: 1140, fill: 'transparent', stroke: '#C9A24B', strokeWidth: 8, cornerRadius: 0 }),
          sh('rect', { x: 80, y: 80, width: 1594, height: 1080, fill: 'transparent', stroke: '#C9A24B', strokeWidth: 2, cornerRadius: 0 }),
          gr('badge', { x: 777, y: 150, width: 200, height: 200, fill: '#C9A24B' }),
          tx({ x: 277, y: 400, width: 1200, height: 90, text: 'CERTIFICATE', fontFamily: 'Cinzel', bold: true, fontSize: 72, fill: '#1F2937', align: 'center', letterSpacing: 12 }),
          tx({ x: 277, y: 490, width: 1200, height: 60, text: 'OF ACHIEVEMENT', fontFamily: 'Cinzel', fontSize: 36, fill: '#6B7280', align: 'center', letterSpacing: 10 }),
          tx({ x: 377, y: 610, width: 1000, height: 50, text: 'This certificate is proudly presented to', fontFamily: 'Cormorant Garamond', italic: true, fontSize: 30, fill: '#6B7280', align: 'center' }),
          tx({ x: 277, y: 680, width: 1200, height: 100, text: 'Jordan Reyes', fontFamily: 'Great Vibes', fontSize: 84, fill: '#8E2A3C', align: 'center' }),
          ln({ x: 657, y: 810, width: 440, height: 0, stroke: '#C9A24B', strokeWidth: 3 }),
          tx({ x: 377, y: 850, width: 1000, height: 90, text: 'for outstanding performance and dedication\nin the Design Excellence Program', fontFamily: 'Cormorant Garamond', fontSize: 28, fill: '#374151', align: 'center', lineHeight: 1.6 }),
          tx({ x: 400, y: 1040, width: 360, height: 40, text: '____________________', fontFamily: 'Inter', fontSize: 24, fill: '#6B7280', align: 'center' }),
          tx({ x: 400, y: 1080, width: 360, height: 30, text: 'Program Director', fontFamily: 'Inter', bold: true, fontSize: 16, fill: '#6B7280', align: 'center', letterSpacing: 2 }),
          tx({ x: 994, y: 1040, width: 360, height: 40, text: '____________________', fontFamily: 'Inter', fontSize: 24, fill: '#6B7280', align: 'center' }),
          tx({ x: 994, y: 1080, width: 360, height: 30, text: 'Date', fontFamily: 'Inter', bold: true, fontSize: 16, fill: '#6B7280', align: 'center', letterSpacing: 2 }),
        ],
      },
    ],
  },
  {
    slug: 'clean-invoice',
    name: 'Clean Invoice',
    category: 'document',
    width: 1240,
    height: 1754,
    accent: '#0EA5E9',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#FFFFFF' },
        elements: [
          sh('rect', { x: 0, y: 0, width: 1240, height: 20, fill: '#0EA5E9' }),
          tx({ x: 70, y: 80, width: 500, height: 70, text: 'INVOICE', fontFamily: 'Archivo', bold: true, fontSize: 52, fill: '#0F172A', align: 'left', letterSpacing: 4 }),
          tx({ x: 70, y: 160, width: 500, height: 40, text: '# INV-2026-014', fontFamily: 'DM Mono', fontSize: 22, fill: '#64748B', align: 'left' }),
          tx({ x: 770, y: 90, width: 400, height: 120, text: 'Studio Canvix\n42 Design Lane\nhello@studio.co', fontFamily: 'Inter', fontSize: 16, fill: '#334155', align: 'right', lineHeight: 1.6 }),
          ln({ x: 70, y: 260, width: 1100, height: 0, stroke: '#E2E8F0', strokeWidth: 2 }),
          tx({ x: 70, y: 300, width: 250, height: 30, text: 'BILLED TO', fontFamily: 'Inter', bold: true, fontSize: 14, fill: '#94A3B8', align: 'left', letterSpacing: 2 }),
          tx({ x: 70, y: 335, width: 400, height: 100, text: 'Acme Corporation\n200 Sunrise Blvd\nAustin, TX', fontFamily: 'Inter', fontSize: 16, fill: '#334155', align: 'left', lineHeight: 1.6 }),
          tx({ x: 820, y: 300, width: 350, height: 30, text: 'DUE DATE', fontFamily: 'Inter', bold: true, fontSize: 14, fill: '#94A3B8', align: 'left', letterSpacing: 2 }),
          tx({ x: 820, y: 335, width: 350, height: 40, text: 'March 31, 2026', fontFamily: 'Inter', bold: true, fontSize: 20, fill: '#0F172A', align: 'left' }),
          // line items header
          sh('rect', { x: 70, y: 470, width: 1100, height: 56, fill: '#F1F5F9', cornerRadius: 8 }),
          tx({ x: 90, y: 487, width: 500, height: 30, text: 'DESCRIPTION', fontFamily: 'Inter', bold: true, fontSize: 13, fill: '#64748B', align: 'left', letterSpacing: 2 }),
          tx({ x: 640, y: 487, width: 150, height: 30, text: 'QTY', fontFamily: 'Inter', bold: true, fontSize: 13, fill: '#64748B', align: 'center', letterSpacing: 2 }),
          tx({ x: 850, y: 487, width: 300, height: 30, text: 'AMOUNT', fontFamily: 'Inter', bold: true, fontSize: 13, fill: '#64748B', align: 'right', letterSpacing: 2 }),
          tx({ x: 90, y: 560, width: 500, height: 36, text: 'Brand identity design', fontFamily: 'Inter', fontSize: 17, fill: '#0F172A', align: 'left' }),
          tx({ x: 640, y: 560, width: 150, height: 36, text: '1', fontFamily: 'Inter', fontSize: 17, fill: '#334155', align: 'center' }),
          tx({ x: 850, y: 560, width: 300, height: 36, text: '$2,400', fontFamily: 'DM Mono', fontSize: 17, fill: '#0F172A', align: 'right' }),
          tx({ x: 90, y: 620, width: 500, height: 36, text: 'Landing page design', fontFamily: 'Inter', fontSize: 17, fill: '#0F172A', align: 'left' }),
          tx({ x: 640, y: 620, width: 150, height: 36, text: '1', fontFamily: 'Inter', fontSize: 17, fill: '#334155', align: 'center' }),
          tx({ x: 850, y: 620, width: 300, height: 36, text: '$1,800', fontFamily: 'DM Mono', fontSize: 17, fill: '#0F172A', align: 'right' }),
          ln({ x: 70, y: 700, width: 1100, height: 0, stroke: '#E2E8F0', strokeWidth: 2 }),
          tx({ x: 850, y: 730, width: 300, height: 36, text: 'Subtotal', fontFamily: 'Inter', fontSize: 17, fill: '#64748B', align: 'right' }),
          tx({ x: 850, y: 766, width: 300, height: 36, text: '$4,200', fontFamily: 'DM Mono', fontSize: 17, fill: '#0F172A', align: 'right' }),
          tx({ x: 850, y: 802, width: 300, height: 36, text: 'Tax (8%)', fontFamily: 'Inter', fontSize: 17, fill: '#64748B', align: 'right' }),
          tx({ x: 850, y: 838, width: 300, height: 36, text: '$336', fontFamily: 'DM Mono', fontSize: 17, fill: '#0F172A', align: 'right' }),
          sh('rect', { x: 790, y: 900, width: 380, height: 70, fill: '#0EA5E9', cornerRadius: 12 }),
          tx({ x: 810, y: 920, width: 180, height: 36, text: 'TOTAL', fontFamily: 'Inter', bold: true, fontSize: 17, fill: '#FFFFFF', align: 'left' }),
          tx({ x: 990, y: 920, width: 160, height: 36, text: '$4,536', fontFamily: 'DM Mono', bold: true, fontSize: 19, fill: '#FFFFFF', align: 'right' }),
          tx({ x: 70, y: 1000, width: 600, height: 60, text: 'Thank you for your business!', fontFamily: 'Caveat', fontSize: 30, fill: '#0EA5E9', align: 'left' }),
        ],
      },
    ],
  },
  {
    slug: 'monthly-calendar',
    name: 'Monthly Calendar',
    category: 'document',
    width: 1240,
    height: 1754,
    accent: '#F97316',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#FFFFFF' },
        elements: [
          sh('rect', { x: 0, y: 0, width: 1240, height: 300, fill: '#F97316' }),
          tx({ x: 70, y: 90, width: 800, height: 110, text: 'MARCH', fontFamily: 'Archivo Black', fontSize: 88, fill: '#FFFFFF', align: 'left' }),
          tx({ x: 74, y: 205, width: 800, height: 60, text: '2026  ·  spring into it', fontFamily: 'Inter', fontSize: 26, fill: '#FFEDD5', align: 'left', letterSpacing: 3 }),
          st('🌸', { x: 1020, y: 80, width: 160, height: 160, fontSize: 110 }),
          // weekday header
          { ...tx({ x: 70, y: 330, width: 160, height: 40, text: 'MON', fontFamily: 'Inter', bold: true, fontSize: 15, fill: '#9A3412', align: 'center', letterSpacing: 1 }) },
          tx({ x: 246, y: 330, width: 160, height: 40, text: 'TUE', fontFamily: 'Inter', bold: true, fontSize: 15, fill: '#9A3412', align: 'center' }),
          tx({ x: 422, y: 330, width: 160, height: 40, text: 'WED', fontFamily: 'Inter', bold: true, fontSize: 15, fill: '#9A3412', align: 'center' }),
          tx({ x: 598, y: 330, width: 160, height: 40, text: 'THU', fontFamily: 'Inter', bold: true, fontSize: 15, fill: '#9A3412', align: 'center' }),
          tx({ x: 774, y: 330, width: 160, height: 40, text: 'FRI', fontFamily: 'Inter', bold: true, fontSize: 15, fill: '#9A3412', align: 'center' }),
          tx({ x: 950, y: 330, width: 160, height: 40, text: 'SAT · SUN', fontFamily: 'Inter', bold: true, fontSize: 15, fill: '#9A3412', align: 'center' }),
          // week rows (grid separators)
          ln({ x: 70, y: 395, width: 1040, height: 0, stroke: '#FED7AA', strokeWidth: 2 }),
          ln({ x: 70, y: 560, width: 1040, height: 0, stroke: '#FFEDD5', strokeWidth: 2 }),
          ln({ x: 70, y: 725, width: 1040, height: 0, stroke: '#FFEDD5', strokeWidth: 2 }),
          ln({ x: 70, y: 890, width: 1040, height: 0, stroke: '#FFEDD5', strokeWidth: 2 }),
          ln({ x: 70, y: 1055, width: 1040, height: 0, stroke: '#FFEDD5', strokeWidth: 2 }),
          ln({ x: 218, y: 390, width: 0, height: 670, stroke: '#FFEDD5', strokeWidth: 2 }),
          ln({ x: 394, y: 390, width: 0, height: 670, stroke: '#FFEDD5', strokeWidth: 2 }),
          ln({ x: 570, y: 390, width: 0, height: 670, stroke: '#FFEDD5', strokeWidth: 2 }),
          ln({ x: 746, y: 390, width: 0, height: 670, stroke: '#FFEDD5', strokeWidth: 2 }),
          ln({ x: 922, y: 390, width: 0, height: 670, stroke: '#FFEDD5', strokeWidth: 2 }),
          // a few day numbers
          tx({ x: 90, y: 420, width: 80, height: 36, text: '2', fontFamily: 'Inter', bold: true, fontSize: 22, fill: '#1C1917', align: 'left' }),
          tx({ x: 266, y: 420, width: 80, height: 36, text: '3', fontFamily: 'Inter', bold: true, fontSize: 22, fill: '#1C1917', align: 'left' }),
          tx({ x: 442, y: 420, width: 80, height: 36, text: '4', fontFamily: 'Inter', bold: true, fontSize: 22, fill: '#1C1917', align: 'left' }),
          tx({ x: 618, y: 420, width: 80, height: 36, text: '5', fontFamily: 'Inter', bold: true, fontSize: 22, fill: '#1C1917', align: 'left' }),
          tx({ x: 794, y: 420, width: 80, height: 36, text: '6', fontFamily: 'Inter', bold: true, fontSize: 22, fill: '#1C1917', align: 'left' }),
          tx({ x: 970, y: 420, width: 140, height: 36, text: '7 / 8', fontFamily: 'Inter', bold: true, fontSize: 22, fill: '#A8A29E', align: 'left' }),
          // highlight a special day
          sh('ellipse', { x: 630, y: 590, width: 60, height: 60, fill: '#F97316' }),
          tx({ x: 640, y: 604, width: 44, height: 36, text: '14', fontFamily: 'Inter', bold: true, fontSize: 20, fill: '#FFFFFF', align: 'center' }),
          tx({ x: 610, y: 662, width: 180, height: 30, text: 'launch day ✦', fontFamily: 'Caveat', bold: true, fontSize: 24, fill: '#9A3412', align: 'center' }),
          tx({ x: 90, y: 585, width: 80, height: 36, text: '9', fontFamily: 'Inter', bold: true, fontSize: 22, fill: '#1C1917', align: 'left' }),
          tx({ x: 90, y: 750, width: 80, height: 36, text: '16', fontFamily: 'Inter', bold: true, fontSize: 22, fill: '#1C1917', align: 'left' }),
          tx({ x: 90, y: 915, width: 80, height: 36, text: '23', fontFamily: 'Inter', bold: true, fontSize: 22, fill: '#1C1917', align: 'left' }),
          tx({ x: 90, y: 1080, width: 80, height: 36, text: '30', fontFamily: 'Inter', bold: true, fontSize: 22, fill: '#1C1917', align: 'left' }),
          // footer note
          ln({ x: 70, y: 1230, width: 1040, height: 0, stroke: '#FED7AA', strokeWidth: 2 }),
          tx({ x: 70, y: 1260, width: 1040, height: 44, text: 'notes —  ·  ideas —  ·  reminders —', fontFamily: 'Caveat', fontSize: 26, fill: '#78716C', align: 'left' }),
        ],
      },
    ],
  },
  {
    slug: 'business-card',
    name: 'Business Card',
    category: 'document',
    width: 1050,
    height: 600,
    accent: '#7630D7',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#0F1015' },
        elements: [
          sh('ellipse', { x: -260, y: -220, width: 560, height: 560, fill: '#7630D7' }),
          sh('ellipse', { x: 820, y: 380, width: 400, height: 400, fill: '#02C0CC' }),
          tx({ x: 80, y: 210, width: 600, height: 60, text: 'JORDAN REYES', fontFamily: 'Archivo', bold: true, fontSize: 40, fill: '#FFFFFF', align: 'left', letterSpacing: 2 }),
          tx({ x: 82, y: 275, width: 600, height: 40, text: 'Creative Director', fontFamily: 'Inter', fontSize: 20, fill: '#02C0CC', align: 'left' }),
          ln({ x: 82, y: 345, width: 70, height: 0, stroke: '#7630D7', strokeWidth: 4 }),
          tx({ x: 82, y: 380, width: 640, height: 130, text: 'hello@jordanreyes.co\n+1 555 0199\njordanreyes.co', fontFamily: 'DM Mono', fontSize: 16, fill: '#D1D5DB', align: 'left', lineHeight: 1.8 }),
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
