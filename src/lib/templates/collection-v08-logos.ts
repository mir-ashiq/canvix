// ─────────────────────────────────────────────────────────────
// collection-v08/logos — 3 new premium logo templates (800×800).
// Badge marks, geometric wordmarks and elegant monograms —
// original designs ready to restyle with brand colors.
// ─────────────────────────────────────────────────────────────

import type { TemplateDef } from './helpers'
import { tx, sh, ln, st, gr } from './helpers'

export const COLLECTION_V08_LOGOS: TemplateDef[] = [
  // 1 ── Coffee roastery · stamped badge
  {
    slug: 'roastery-badge-logo',
    name: 'Roastery Badge Logo',
    category: 'logo',
    width: 800,
    height: 800,
    accent: '#78350F',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#FDFBF7' },
        elements: [
          sh('ellipse', { x: 100, y: 100, width: 600, height: 600, fill: 'transparent', stroke: '#78350F', strokeWidth: 10 }),
          sh('ellipse', { x: 125, y: 125, width: 550, height: 550, fill: 'transparent', stroke: '#B45309', strokeWidth: 3 }),
          sh('ellipse', { x: 150, y: 150, width: 500, height: 500, fill: '#78350F' }),
          tx({ x: 200, y: 195, width: 400, height: 55, text: 'EST. 2018', fontFamily: 'Cinzel', bold: true, fontSize: 30, letterSpacing: 6, fill: '#FCD9A8', align: 'center' }),
          ln({ x: 250, y: 265, width: 300, height: 0, stroke: '#B45309', strokeWidth: 2 }),
          st('☕', { x: 330, y: 290, width: 140, height: 140, fontSize: 100 }),
          tx({ x: 175, y: 450, width: 450, height: 90, text: 'NORTH PEAK', fontFamily: 'Prata', fontSize: 56, fill: '#FFF7E8', align: 'center' }),
          tx({ x: 175, y: 530, width: 450, height: 50, text: 'COFFEE ROASTERS', fontFamily: 'Inter', bold: true, fontSize: 26, letterSpacing: 5, fill: '#FCD9A8', align: 'center' }),
          ln({ x: 250, y: 590, width: 300, height: 0, stroke: '#B45309', strokeWidth: 2 }),
          tx({ x: 175, y: 605, width: 450, height: 45, text: 'SMALL BATCH · HIGH ALTITUDE', fontFamily: 'Inter', fontSize: 19, letterSpacing: 3, fill: '#D9A45B', align: 'center' }),
        ],
      },
    ],
  },

  // 2 ── Tech startup · geometric hex
  {
    slug: 'nova-labs-logo',
    name: 'Tech Startup Logo',
    category: 'logo',
    width: 800,
    height: 800,
    accent: '#06B6D4',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#FFFFFF' },
        elements: [
          gr('hexagon', { x: 250, y: 130, width: 300, height: 300, fill: '#0F172A' }),
          gr('hexagon', { x: 290, y: 170, width: 220, height: 220, fill: 'transparent', stroke: '#06B6D4', strokeWidth: 8 }),
          sh('ellipse', { x: 385, y: 265, width: 30, height: 30, fill: '#06B6D4' }),
          tx({ x: 100, y: 490, width: 600, height: 110, text: 'NOVA LABS', fontFamily: 'Space Grotesk', bold: true, fontSize: 84, letterSpacing: 4, fill: '#0F172A', align: 'center' }),
          tx({ x: 100, y: 610, width: 600, height: 45, text: 'Q U A N T U M   S Y S T E M S', fontFamily: 'Inter', fontSize: 26, letterSpacing: 2, fill: '#06B6D4', align: 'center' }),
          ln({ x: 280, y: 690, width: 240, height: 0, stroke: '#E2E8F0', strokeWidth: 4 }),
        ],
      },
    ],
  },

  // 3 ── Salon monogram · framed serif
  {
    slug: 'monogram-salon-logo',
    name: 'Elegant Monogram Logo',
    category: 'logo',
    width: 800,
    height: 800,
    accent: '#9D174D',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#FDF8F6' },
        elements: [
          sh('rect', { x: 110, y: 110, width: 580, height: 580, fill: 'transparent', stroke: '#9D174D', strokeWidth: 2 }),
          gr('frame', { x: 90, y: 90, width: 620, height: 620, fill: 'transparent', stroke: '#D4AF37', strokeWidth: 3 }),
          tx({ x: 150, y: 180, width: 500, height: 300, text: 'ÉM', fontFamily: 'Cormorant Garamond', bold: true, fontSize: 200, fill: '#831843', align: 'center' }),
          ln({ x: 300, y: 480, width: 200, height: 0, stroke: '#D4AF37', strokeWidth: 2 }),
          gr('diamond', { x: 386, y: 466, width: 28, height: 28, fill: '#D4AF37' }),
          tx({ x: 150, y: 510, width: 500, height: 70, text: 'ÉLAN', fontFamily: 'Cormorant Garamond', bold: true, fontSize: 54, letterSpacing: 14, fill: '#831843', align: 'center' }),
          tx({ x: 150, y: 590, width: 500, height: 45, text: 'HAIR · BEAUTY · SANCTUARY', fontFamily: 'Inter', fontSize: 22, letterSpacing: 4, fill: '#9D174D', align: 'center' }),
        ],
      },
    ],
  },
]
