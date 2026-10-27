// ─────────────────────────────────────────────────────────────
// collection-v08/thumbnails — 7 new premium video thumbnail
// templates (1280×720). Big type, strong contrast, mobile-first
// legibility — the click-through patterns that work.
// ─────────────────────────────────────────────────────────────

import type { TemplateDef } from './helpers'
import { tx, sh, ln, st, gr } from './helpers'

export const COLLECTION_V08_THUMBNAILS: TemplateDef[] = [
  // 1 ── Gaming · red/blue split
  {
    slug: 'yt-gaming-thumb',
    name: 'Gaming Thumbnail',
    category: 'thumbnail',
    width: 1280,
    height: 720,
    accent: '#EF4444',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#0F172A' },
        elements: [
          sh('rect', { x: 640, y: 0, width: 640, height: 720, fill: '#1D4ED8' }),
          sh('rect', { x: 0, y: 0, width: 1280, height: 720, fill: 'transparent' }),
          ln({ x: 640, y: 60, width: 0, height: 600, stroke: '#FFFFFF', strokeWidth: 8 }),
          tx({ x: 60, y: 150, width: 520, height: 100, text: 'I HIT', fontFamily: 'Luckiest Guy', fontSize: 90, fill: '#FFFFFF', align: 'left' }),
          tx({ x: 60, y: 260, width: 520, height: 100, text: 'RANK 1', fontFamily: 'Luckiest Guy', fontSize: 90, fill: '#FACC15', align: 'left' }),
          tx({ x: 60, y: 380, width: 520, height: 60, text: 'IN ONE NIGHT', fontFamily: 'Bebas Neue', fontSize: 52, letterSpacing: 2, fill: '#FCA5A5', align: 'left' }),
          tx({ x: 60, y: 480, width: 520, height: 120, text: 'no sleep · pure skill\n· maybe 4 energy drinks', fontFamily: 'Inter', bold: true, fontSize: 27, lineHeight: 1.5, fill: '#CBD5E1', align: 'left' }),
          st('😱', { x: 700, y: 120, width: 240, height: 240, fontSize: 180 }),
          tx({ x: 740, y: 420, width: 480, height: 130, text: 'FINAL\nGAMEPLAY', fontFamily: 'Luckiest Guy', fontSize: 72, fill: '#FFFFFF', align: 'center' }),
          gr('arrow', { x: 950, y: 560, width: 180, height: 110, fill: '#FACC15' }),
        ],
      },
    ],
  },

  // 2 ── Tech review · clean product
  {
    slug: 'yt-tech-review',
    name: 'Tech Review Thumbnail',
    category: 'thumbnail',
    width: 1280,
    height: 720,
    accent: '#0EA5E9',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#FFFFFF' },
        elements: [
          sh('rect', { x: 0, y: 0, width: 620, height: 720, fill: '#F8FAFC' }),
          sh('rect', { x: 120, y: 130, width: 380, height: 460, fill: '#1E293B', cornerRadius: 40 }),
          sh('rect', { x: 150, y: 170, width: 320, height: 340, fill: '#0EA5E9', cornerRadius: 24 }),
          sh('ellipse', { x: 255, y: 280, width: 110, height: 110, fill: '#334155' }),
          sh('rect', { x: 150, y: 540, width: 320, height: 26, fill: '#334155', cornerRadius: 13 }),
          tx({ x: 700, y: 120, width: 520, height: 60, text: 'AFTER 6 MONTHS', fontFamily: 'DM Mono', bold: true, fontSize: 30, letterSpacing: 3, fill: '#0EA5E9', align: 'left' }),
          tx({ x: 695, y: 190, width: 560, height: 130, text: 'The Honest', fontFamily: 'Outfit', bold: true, fontSize: 84, fill: '#0F172A', align: 'left' }),
          tx({ x: 695, y: 305, width: 560, height: 130, text: 'Review', fontFamily: 'Outfit', bold: true, fontSize: 84, fill: '#0EA5E9', align: 'left' }),
          ln({ x: 700, y: 470, width: 120, height: 0, stroke: '#0EA5E9', strokeWidth: 6 }),
          tx({ x: 700, y: 500, width: 520, height: 60, text: 'what broke · what surprised me', fontFamily: 'Inter', fontSize: 29, fill: '#475569', align: 'left' }),
          sh('rect', { x: 700, y: 580, width: 480, height: 80, fill: '#0F172A', cornerRadius: 40 }),
          tx({ x: 720, y: 602, width: 440, height: 45, text: 'SUBSCRIBE FOR PART 2 →', fontFamily: 'Outfit', bold: true, fontSize: 27, fill: '#FFFFFF', align: 'center' }),
        ],
      },
    ],
  },

  // 3 ── Daily vlog · pastel life
  {
    slug: 'yt-vlog-thumb',
    name: 'Daily Vlog Thumbnail',
    category: 'thumbnail',
    width: 1280,
    height: 720,
    accent: '#FB7185',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'gradient', from: '#FDF2F8', to: '#E0E7FF', angle: 120 },
        elements: [
          sh('ellipse', { x: 780, y: 60, width: 440, height: 440, fill: '#FFFFFF', opacity: 0.7 }),
          st('☕', { x: 850, y: 110, width: 200, height: 200, fontSize: 150 }),
          st('🌱', { x: 800, y: 300, width: 160, height: 160, fontSize: 120 }),
          st('🎧', { x: 1010, y: 300, width: 160, height: 160, fontSize: 120 }),
          sh('rect', { x: 70, y: 170, width: 660, height: 100, fill: '#FB7185', cornerRadius: 50 }),
          tx({ x: 100, y: 195, width: 600, height: 60, text: 'a day in my life', fontFamily: 'Quicksand', bold: true, fontSize: 48, fill: '#FFFFFF', align: 'center' }),
          tx({ x: 70, y: 310, width: 660, height: 140, text: 'slow morning,', fontFamily: 'Sacramento', bold: true, fontSize: 100, fill: '#4C1D95', align: 'left' }),
          tx({ x: 70, y: 430, width: 660, height: 140, text: 'big news 🤍', fontFamily: 'Sacramento', bold: true, fontSize: 100, fill: '#BE185D', align: 'left' }),
          tx({ x: 70, y: 610, width: 660, height: 45, text: 'NEW APARTMENT TOUR AT 8:12', fontFamily: 'Inter', bold: true, fontSize: 26, letterSpacing: 1, fill: '#6D28D9', align: 'left' }),
          sh('rect', { x: 0, y: 660, width: 1280, height: 60, fill: '#4C1D95' }),
          tx({ x: 40, y: 675, width: 500, height: 35, text: '@liam.makes · vlog #214', fontFamily: 'DM Mono', fontSize: 20, letterSpacing: 2, fill: '#E9D5FF', align: 'left' }),
        ],
      },
    ],
  },

  // 4 ── Tutorial · step chips
  {
    slug: 'yt-tutorial-thumb',
    name: 'Tutorial Thumbnail',
    category: 'thumbnail',
    width: 1280,
    height: 720,
    accent: '#16A34A',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#F0FDF4' },
        elements: [
          tx({ x: 70, y: 90, width: 700, height: 60, text: 'BEGINNER FRIENDLY · 15 MIN', fontFamily: 'DM Mono', bold: true, fontSize: 27, letterSpacing: 2, fill: '#16A34A', align: 'left' }),
          tx({ x: 65, y: 160, width: 760, height: 130, text: 'How to Draw', fontFamily: 'Poppins', bold: true, fontSize: 80, fill: '#052E16', align: 'left' }),
          tx({ x: 65, y: 280, width: 760, height: 130, text: 'Anything', fontFamily: 'Poppins', bold: true, fontSize: 80, fill: '#16A34A', align: 'left' }),
          sh('rect', { x: 70, y: 460, width: 200, height: 90, fill: '#052E16', cornerRadius: 45 }),
          tx({ x: 90, y: 483, width: 160, height: 50, text: 'STEP 1', fontFamily: 'Poppins', bold: true, fontSize: 30, fill: '#FFFFFF', align: 'center' }),
          sh('rect', { x: 300, y: 460, width: 200, height: 90, fill: '#16A34A', cornerRadius: 45 }),
          tx({ x: 320, y: 483, width: 160, height: 50, text: 'STEP 2', fontFamily: 'Poppins', bold: true, fontSize: 30, fill: '#FFFFFF', align: 'center' }),
          sh('rect', { x: 530, y: 460, width: 200, height: 90, fill: '#052E16', cornerRadius: 45 }),
          tx({ x: 550, y: 483, width: 160, height: 50, text: 'STEP 3', fontFamily: 'Poppins', bold: true, fontSize: 30, fill: '#FFFFFF', align: 'center' }),
          tx({ x: 70, y: 610, width: 700, height: 45, text: 'the 3-shape method artists actually use', fontFamily: 'Lora', italic: true, fontSize: 29, fill: '#166534', align: 'left' }),
          sh('rect', { x: 860, y: 100, width: 360, height: 500, fill: '#FFFFFF', cornerRadius: 28 }),
          sh('ellipse', { x: 920, y: 180, width: 240, height: 200, fill: '#DCFCE7' }),
          sh('triangle', { x: 960, y: 380, width: 160, height: 140, fill: '#BBF7D0' }),
          ln({ x: 920, y: 540, width: 240, height: 0, stroke: '#86EFAC', strokeWidth: 8 }),
          st('✏️', { x: 1080, y: 120, width: 120, height: 120, fontSize: 90 }),
        ],
      },
    ],
  },

  // 5 ── Podcast episode · dark studio
  {
    slug: 'yt-podcast-thumb',
    name: 'Podcast Episode Thumbnail',
    category: 'thumbnail',
    width: 1280,
    height: 720,
    accent: '#F59E0B',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#18181B' },
        elements: [
          sh('ellipse', { x: 120, y: 130, width: 420, height: 420, fill: '#27272A' }),
          sh('ellipse', { x: 155, y: 165, width: 350, height: 350, fill: '#3F3F46' }),
          st('🎙️', { x: 200, y: 210, width: 260, height: 260, fontSize: 190 }),
          tx({ x: 620, y: 110, width: 580, height: 60, text: 'THE DEEP WORK PODCAST · EP. 42', fontFamily: 'DM Mono', bold: true, fontSize: 24, letterSpacing: 2, fill: '#F59E0B', align: 'left' }),
          tx({ x: 615, y: 180, width: 620, height: 200, text: '“Focus is a\nskill, not a\nmood.”', fontFamily: 'Playfair Display', bold: true, fontSize: 72, lineHeight: 1.2, fill: '#FFFFFF', align: 'left' }),
          ln({ x: 620, y: 430, width: 120, height: 0, stroke: '#F59E0B', strokeWidth: 5 }),
          tx({ x: 620, y: 460, width: 580, height: 55, text: 'Cal Newport unplugged — part two', fontFamily: 'Inter', fontSize: 29, fill: '#A1A1AA', align: 'left' }),
          sh('rect', { x: 620, y: 540, width: 420, height: 90, fill: '#F59E0B', cornerRadius: 12 }),
          tx({ x: 640, y: 565, width: 380, height: 50, text: 'WATCH — 58 MIN, NO ADS', fontFamily: 'Outfit', bold: true, fontSize: 28, fill: '#18181B', align: 'center' }),
        ],
      },
    ],
  },

  // 6 ── Fitness · bold transformation
  {
    slug: 'yt-fitness-thumb',
    name: 'Fitness Thumbnail',
    category: 'thumbnail',
    width: 1280,
    height: 720,
    accent: '#F97316',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#0C0A09' },
        elements: [
          sh('rect', { x: 0, y: 0, width: 1280, height: 130, fill: '#F97316' }),
          tx({ x: 60, y: 30, width: 1160, height: 75, text: 'THE 30-DAY CHALLENGE', fontFamily: 'Anton', fontSize: 56, letterSpacing: 2, fill: '#0C0A09', align: 'center' }),
          tx({ x: 60, y: 190, width: 620, height: 140, text: 'SHRED', fontFamily: 'Anton', fontSize: 120, fill: '#FFFFFF', align: 'left' }),
          tx({ x: 60, y: 320, width: 620, height: 140, text: 'PLAN', fontFamily: 'Anton', fontSize: 120, fill: '#F97316', align: 'left' }),
          tx({ x: 70, y: 490, width: 560, height: 60, text: 'real results · no gym needed', fontFamily: 'Inter', bold: true, fontSize: 30, fill: '#D6D3D1', align: 'left' }),
          sh('rect', { x: 70, y: 570, width: 360, height: 80, fill: '#FFFFFF', cornerRadius: 40 }),
          tx({ x: 90, y: 592, width: 320, height: 45, text: 'DAY 1 vs DAY 30 →', fontFamily: 'Outfit', bold: true, fontSize: 27, fill: '#0C0A09', align: 'center' }),
          sh('rect', { x: 730, y: 190, width: 500, height: 400, fill: '#1C1917', cornerRadius: 24 }),
          st('💪', { x: 820, y: 250, width: 320, height: 320, fontSize: 240 }),
          tx({ x: 760, y: 570, width: 440, height: 0, text: '', fontFamily: 'Inter', fontSize: 10, fill: '#0C0A09', align: 'center' }),
          tx({ x: 760, y: 590, width: 440, height: 50, text: '-4.2 KG · +9 CM', fontFamily: 'Anton', fontSize: 44, fill: '#F97316', align: 'center' }),
        ],
      },
    ],
  },

  // 7 ── Cooking · warm recipe
  {
    slug: 'yt-cooking-thumb',
    name: 'Cooking Thumbnail',
    category: 'thumbnail',
    width: 1280,
    height: 720,
    accent: '#EA580C',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#FFF7ED' },
        elements: [
          sh('ellipse', { x: 720, y: 80, width: 560, height: 560, fill: '#FED7AA' }),
          st('🍝', { x: 800, y: 160, width: 400, height: 400, fontSize: 300 }),
          tx({ x: 70, y: 120, width: 620, height: 60, text: 'WEEKNIGHT DINNER · UNDER $10', fontFamily: 'DM Mono', bold: true, fontSize: 25, letterSpacing: 2, fill: '#EA580C', align: 'left' }),
          tx({ x: 65, y: 190, width: 660, height: 130, text: '5-Minute', fontFamily: 'Playfair Display', bold: true, fontSize: 86, fill: '#431407', align: 'left' }),
          tx({ x: 65, y: 310, width: 660, height: 130, text: 'Pasta', fontFamily: 'Playfair Display', bold: true, fontSize: 86, fill: '#EA580C', align: 'left' }),
          ln({ x: 70, y: 470, width: 120, height: 0, stroke: '#EA580C', strokeWidth: 6 }),
          tx({ x: 70, y: 500, width: 620, height: 60, text: 'better than the restaurant version', fontFamily: 'Lora', italic: true, fontSize: 31, fill: '#7C2D12', align: 'left' }),
          sh('rect', { x: 70, y: 580, width: 560, height: 90, fill: '#431407', cornerRadius: 45 }),
          tx({ x: 90, y: 605, width: 520, height: 50, text: '5 INGREDIENTS · 1 PAN 🍳', fontFamily: 'Outfit', bold: true, fontSize: 30, fill: '#FFF7ED', align: 'center' }),
        ],
      },
    ],
  },
]
