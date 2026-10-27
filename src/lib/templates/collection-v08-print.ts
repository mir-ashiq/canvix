// ─────────────────────────────────────────────────────────────
// collection-v08/print — 9 new premium print templates:
// invitations, flyers, menus, posters, cards & certificates.
// Original designs with print-grade margins and hierarchy.
// ─────────────────────────────────────────────────────────────

import type { TemplateDef } from './helpers'
import { tx, sh, ln, st, gr } from './helpers'

export const COLLECTION_V08_PRINT: TemplateDef[] = [
  // 1 ── Wedding invitation · ivory classic
  {
    slug: 'wedding-invitation',
    name: 'Wedding Invitation',
    category: 'print',
    width: 1080,
    height: 1350,
    accent: '#B08D57',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#FFFDF8' },
        elements: [
          sh('rect', { x: 60, y: 60, width: 960, height: 1230, fill: 'transparent', stroke: '#B08D57', strokeWidth: 3 }),
          sh('rect', { x: 80, y: 80, width: 920, height: 1190, fill: 'transparent', stroke: '#D9C6A5', strokeWidth: 1.5 }),
          tx({ x: 140, y: 190, width: 800, height: 60, text: 'TOGETHER WITH THEIR FAMILIES', fontFamily: 'Cormorant Garamond', fontSize: 28, letterSpacing: 6, fill: '#8C7355', align: 'center' }),
          tx({ x: 140, y: 280, width: 800, height: 130, text: 'Amara', fontFamily: 'Great Vibes', fontSize: 110, fill: '#3E3226', align: 'center' }),
          tx({ x: 140, y: 430, width: 800, height: 70, text: 'and', fontFamily: 'Cormorant Garamond', italic: true, fontSize: 46, fill: '#B08D57', align: 'center' }),
          tx({ x: 140, y: 510, width: 800, height: 130, text: 'Julian', fontFamily: 'Great Vibes', fontSize: 110, fill: '#3E3226', align: 'center' }),
          ln({ x: 390, y: 700, width: 300, height: 0, stroke: '#B08D57', strokeWidth: 2 }),
          gr('diamond', { x: 516, y: 686, width: 28, height: 28, fill: '#B08D57' }),
          tx({ x: 140, y: 750, width: 800, height: 60, text: 'INVITE YOU TO CELEBRATE THEIR MARRIAGE', fontFamily: 'Cormorant Garamond', fontSize: 28, letterSpacing: 4, fill: '#8C7355', align: 'center' }),
          tx({ x: 140, y: 830, width: 800, height: 70, text: 'Saturday · the nineteenth of June', fontFamily: 'Cormorant Garamond', fontSize: 44, fill: '#3E3226', align: 'center' }),
          tx({ x: 140, y: 895, width: 800, height: 70, text: 'at half past four in the afternoon', fontFamily: 'Cormorant Garamond', italic: true, fontSize: 36, fill: '#8C7355', align: 'center' }),
          tx({ x: 140, y: 980, width: 800, height: 60, text: 'THE ORCHARD HOUSE · WILLOW CREEK', fontFamily: 'Inter', bold: true, fontSize: 26, letterSpacing: 4, fill: '#3E3226', align: 'center' }),
          tx({ x: 140, y: 1050, width: 800, height: 60, text: 'DINNER, DANCING & JOY TO FOLLOW', fontFamily: 'Inter', fontSize: 22, letterSpacing: 5, fill: '#B08D57', align: 'center' }),
          st('💍', { x: 490, y: 1130, width: 100, height: 100, fontSize: 70 }),
        ],
      },
    ],
  },

  // 2 ── Gym membership flyer · A4 black/lime
  {
    slug: 'gym-flyer',
    name: 'Gym Membership Flyer',
    category: 'print',
    width: 1240,
    height: 1754,
    accent: '#A3E635',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#0C0C0C' },
        elements: [
          sh('rect', { x: 0, y: 0, width: 1240, height: 24, fill: '#A3E635' }),
          tx({ x: 100, y: 120, width: 1040, height: 60, text: 'IRON DISTRICT GYM · MEMBERSHIP DRIVE', fontFamily: 'DM Mono', bold: true, fontSize: 28, letterSpacing: 5, fill: '#A3E635', align: 'left' }),
          tx({ x: 90, y: 200, width: 1060, height: 220, text: 'GET', fontFamily: 'Anton', fontSize: 200, fill: '#FFFFFF', align: 'left' }),
          tx({ x: 90, y: 420, width: 1060, height: 220, text: 'STRONG', fontFamily: 'Anton', fontSize: 200, fill: '#A3E635', align: 'left' }),
          tx({ x: 90, y: 640, width: 1060, height: 220, text: 'HERE', fontFamily: 'Anton', fontSize: 200, fill: '#FFFFFF', align: 'left' }),
          tx({ x: 100, y: 890, width: 800, height: 60, text: 'No contracts. No crowds. Just iron and coaches who show up.', fontFamily: 'Inter', fontSize: 30, fill: '#D4D4D4', align: 'left' }),
          sh('rect', { x: 90, y: 990, width: 1060, height: 420, fill: '#161616', cornerRadius: 24 }),
          tx({ x: 140, y: 1030, width: 900, height: 55, text: 'SPRING RATES — FIRST 100 JOINERS', fontFamily: 'DM Mono', bold: true, fontSize: 26, letterSpacing: 3, fill: '#A3E635', align: 'left' }),
          tx({ x: 140, y: 1100, width: 960, height: 60, text: 'Monthly · $39', fontFamily: 'Outfit', bold: true, fontSize: 44, fill: '#FFFFFF', align: 'left' }),
          tx({ x: 700, y: 1100, width: 420, height: 60, text: 'no sign-up fee', fontFamily: 'Inter', italic: true, fontSize: 28, fill: '#737373', align: 'left' }),
          tx({ x: 140, y: 1180, width: 960, height: 60, text: 'Annual · $349', fontFamily: 'Outfit', bold: true, fontSize: 44, fill: '#FFFFFF', align: 'left' }),
          tx({ x: 700, y: 1180, width: 420, height: 60, text: 'two months free', fontFamily: 'Inter', italic: true, fontSize: 28, fill: '#737373', align: 'left' }),
          tx({ x: 140, y: 1260, width: 960, height: 60, text: 'Student · $29', fontFamily: 'Outfit', bold: true, fontSize: 44, fill: '#A3E635', align: 'left' }),
          tx({ x: 700, y: 1260, width: 420, height: 60, text: 'with valid ID', fontFamily: 'Inter', italic: true, fontSize: 28, fill: '#737373', align: 'left' }),
          ln({ x: 100, y: 1490, width: 1040, height: 0, stroke: '#333333', strokeWidth: 2 }),
          tx({ x: 100, y: 1530, width: 700, height: 55, text: '118 Foundry St · opendaily 5 AM – 11 PM', fontFamily: 'Inter', bold: true, fontSize: 30, fill: '#FFFFFF', align: 'left' }),
          tx({ x: 100, y: 1590, width: 700, height: 50, text: 'irondistrict.fit · @irondistrictgym', fontFamily: 'Inter', fontSize: 26, fill: '#737373', align: 'left' }),
          st('💪', { x: 950, y: 1470, width: 200, height: 200, fontSize: 150 }),
        ],
      },
    ],
  },

  // 3 ── Cafe menu · kraft board
  {
    slug: 'cafe-menu',
    name: 'Cafe Menu Board',
    category: 'print',
    width: 1080,
    height: 1350,
    accent: '#7C5A3A',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#EFE6D8' },
        elements: [
          sh('rect', { x: 0, y: 0, width: 1080, height: 250, fill: '#7C5A3A' }),
          tx({ x: 90, y: 60, width: 900, height: 100, text: 'GROUND & CO', fontFamily: 'Abril Fatface', fontSize: 72, fill: '#F5EDE0', align: 'center' }),
          tx({ x: 90, y: 170, width: 900, height: 50, text: 'COFFEE BAR · BAKERY · SINCE 2019', fontFamily: 'Inter', bold: true, fontSize: 22, letterSpacing: 6, fill: '#D9BE96', align: 'center' }),
          tx({ x: 90, y: 310, width: 900, height: 50, text: '— ESPRESSO —', fontFamily: 'Caveat', bold: true, fontSize: 48, fill: '#7C5A3A', align: 'center' }),
          tx({ x: 100, y: 390, width: 420, height: 45, text: 'Espresso', fontFamily: 'Lora', bold: true, fontSize: 30, fill: '#3B2D20', align: 'left' }),
          ln({ x: 130, y: 412, width: 200, height: 0, stroke: '#C4AF94', strokeWidth: 2, dashed: true }),
          tx({ x: 660, y: 390, width: 320, height: 45, text: '3.2', fontFamily: 'Lora', bold: true, fontSize: 30, fill: '#7C5A3A', align: 'right' }),
          tx({ x: 100, y: 455, width: 420, height: 45, text: 'Flat white', fontFamily: 'Lora', bold: true, fontSize: 30, fill: '#3B2D20', align: 'left' }),
          ln({ x: 130, y: 477, width: 190, height: 0, stroke: '#C4AF94', strokeWidth: 2, dashed: true }),
          tx({ x: 660, y: 455, width: 320, height: 45, text: '4.0', fontFamily: 'Lora', bold: true, fontSize: 30, fill: '#7C5A3A', align: 'right' }),
          tx({ x: 100, y: 520, width: 420, height: 45, text: 'Cortado', fontFamily: 'Lora', bold: true, fontSize: 30, fill: '#3B2D20', align: 'left' }),
          ln({ x: 130, y: 542, width: 205, height: 0, stroke: '#C4AF94', strokeWidth: 2, dashed: true }),
          tx({ x: 660, y: 520, width: 320, height: 45, text: '3.8', fontFamily: 'Lora', bold: true, fontSize: 30, fill: '#7C5A3A', align: 'right' }),
          tx({ x: 100, y: 585, width: 420, height: 45, text: 'Honey oat latte', fontFamily: 'Lora', bold: true, fontSize: 30, fill: '#3B2D20', align: 'left' }),
          ln({ x: 130, y: 607, width: 115, height: 0, stroke: '#C4AF94', strokeWidth: 2, dashed: true }),
          tx({ x: 660, y: 585, width: 320, height: 45, text: '4.6', fontFamily: 'Lora', bold: true, fontSize: 30, fill: '#7C5A3A', align: 'right' }),
          ln({ x: 90, y: 680, width: 900, height: 0, stroke: '#D2C0A6', strokeWidth: 2 }),
          tx({ x: 90, y: 720, width: 900, height: 50, text: '— FROM THE OVEN —', fontFamily: 'Caveat', bold: true, fontSize: 48, fill: '#7C5A3A', align: 'center' }),
          tx({ x: 100, y: 800, width: 420, height: 45, text: 'Cardamom bun', fontFamily: 'Lora', bold: true, fontSize: 30, fill: '#3B2D20', align: 'left' }),
          ln({ x: 130, y: 822, width: 195, height: 0, stroke: '#C4AF94', strokeWidth: 2, dashed: true }),
          tx({ x: 660, y: 800, width: 320, height: 45, text: '3.5', fontFamily: 'Lora', bold: true, fontSize: 30, fill: '#7C5A3A', align: 'right' }),
          tx({ x: 100, y: 865, width: 420, height: 45, text: 'Sourdough toast + jam', fontFamily: 'Lora', bold: true, fontSize: 30, fill: '#3B2D20', align: 'left' }),
          ln({ x: 130, y: 887, width: 105, height: 0, stroke: '#C4AF94', strokeWidth: 2, dashed: true }),
          tx({ x: 660, y: 865, width: 320, height: 45, text: '5.0', fontFamily: 'Lora', bold: true, fontSize: 30, fill: '#7C5A3A', align: 'right' }),
          tx({ x: 100, y: 930, width: 420, height: 45, text: 'Breakfast sandwich', fontFamily: 'Lora', bold: true, fontSize: 30, fill: '#3B2D20', align: 'left' }),
          ln({ x: 130, y: 952, width: 125, height: 0, stroke: '#C4AF94', strokeWidth: 2, dashed: true }),
          tx({ x: 660, y: 930, width: 320, height: 45, text: '6.5', fontFamily: 'Lora', bold: true, fontSize: 30, fill: '#7C5A3A', align: 'right' }),
          st('☕', { x: 760, y: 380, width: 220, height: 220, fontSize: 160 }),
          sh('rect', { x: 90, y: 1060, width: 900, height: 130, fill: '#7C5A3A', cornerRadius: 16 }),
          tx({ x: 120, y: 1090, width: 840, height: 70, text: 'Bring this menu back with 10 stamps → your 11th coffee is on us.', fontFamily: 'Inter', fontSize: 27, lineHeight: 1.4, fill: '#F5EDE0', align: 'center' }),
          tx({ x: 90, y: 1250, width: 900, height: 45, text: 'OPEN 6:30 AM – 4 PM · 44 MILL LANE', fontFamily: 'Inter', bold: true, fontSize: 22, letterSpacing: 3, fill: '#A18A6E', align: 'center' }),
        ],
      },
    ],
  },

  // 4 ── Concert poster · stacked Bungee night show
  {
    slug: 'concert-poster',
    name: 'Concert Poster',
    category: 'print',
    width: 1240,
    height: 1754,
    accent: '#E11D48',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#1A0B2E' },
        elements: [
          sh('ellipse', { x: 170, y: 130, width: 900, height: 900, fill: 'transparent', stroke: '#E11D48', strokeWidth: 5 }),
          sh('ellipse', { x: 220, y: 180, width: 800, height: 800, fill: 'transparent', stroke: '#F59E0B', strokeWidth: 3 }),
          st('🎸', { x: 430, y: 330, width: 380, height: 380, fontSize: 280 }),
          tx({ x: 90, y: 1090, width: 1060, height: 130, text: 'STATIC', fontFamily: 'Bungee', fontSize: 120, fill: '#FFFFFF', align: 'center' }),
          tx({ x: 90, y: 1220, width: 1060, height: 130, text: 'BLOOM', fontFamily: 'Bungee', fontSize: 120, fill: '#E11D48', align: 'center' }),
          tx({ x: 90, y: 1390, width: 1060, height: 60, text: 'WORLD TOUR 2026 · WITH SPECIAL GUESTS NOVA KID', fontFamily: 'Inter', bold: true, fontSize: 28, letterSpacing: 2, fill: '#F59E0B', align: 'center' }),
          sh('rect', { x: 170, y: 1480, width: 900, height: 100, fill: '#E11D48', cornerRadius: 12 }),
          tx({ x: 190, y: 1508, width: 860, height: 50, text: 'FRI · JUL 17 · THE GLASSHOUSE · DOORS 7 PM', fontFamily: 'Outfit', bold: true, fontSize: 34, fill: '#FFFFFF', align: 'center' }),
          tx({ x: 90, y: 1620, width: 1060, height: 45, text: 'TICKETS AT STATICBLOOM.BAND · ALL AGES', fontFamily: 'DM Mono', fontSize: 24, letterSpacing: 3, fill: '#A78BFA', align: 'center' }),
        ],
      },
    ],
  },

  // 5 ── Yoga studio flyer · sage calm
  {
    slug: 'yoga-flyer',
    name: 'Yoga Studio Flyer',
    category: 'print',
    width: 1080,
    height: 1560,
    accent: '#7C9885',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#F2F5F0' },
        elements: [
          gr('moon', { x: 400, y: 120, width: 280, height: 280, fill: '#C9D8CC' }),
          gr('cloud', { x: 150, y: 260, width: 220, height: 130, fill: '#DCE7DD' }),
          gr('cloud', { x: 700, y: 300, width: 180, height: 110, fill: '#DCE7DD' }),
          tx({ x: 90, y: 470, width: 900, height: 130, text: 'Breathe.', fontFamily: 'Amatic SC', bold: true, fontSize: 130, fill: '#3E5347', align: 'center' }),
          tx({ x: 90, y: 610, width: 900, height: 60, text: 'MOVE. RETURN.', fontFamily: 'Amatic SC', bold: true, fontSize: 64, letterSpacing: 8, fill: '#7C9885', align: 'center' }),
          ln({ x: 390, y: 720, width: 300, height: 0, stroke: '#C9D8CC', strokeWidth: 3 }),
          tx({ x: 90, y: 760, width: 900, height: 90, text: 'Morning flow, yin nights and everything between —\na small studio for busy people.', fontFamily: 'Lora', fontSize: 30, lineHeight: 1.5, fill: '#5C6F62', align: 'center' }),
          sh('rect', { x: 90, y: 910, width: 900, height: 400, fill: '#FFFFFF', cornerRadius: 24 }),
          tx({ x: 140, y: 950, width: 800, height: 50, text: 'THIS WEEK AT STILL POINT', fontFamily: 'DM Mono', bold: true, fontSize: 24, letterSpacing: 4, fill: '#7C9885', align: 'left' }),
          tx({ x: 140, y: 1015, width: 800, height: 45, text: 'Mon – Fri · Sunrise flow · 6:30 am', fontFamily: 'Inter', bold: true, fontSize: 28, fill: '#3E5347', align: 'left' }),
          tx({ x: 140, y: 1075, width: 800, height: 45, text: 'Wed · Yin + sound bath · 7:30 pm', fontFamily: 'Inter', bold: true, fontSize: 28, fill: '#3E5347', align: 'left' }),
          tx({ x: 140, y: 1135, width: 800, height: 45, text: 'Sat · Family yoga · 10:00 am', fontFamily: 'Inter', bold: true, fontSize: 28, fill: '#3E5347', align: 'left' }),
          tx({ x: 140, y: 1195, width: 800, height: 45, text: 'Sun · Slow restore · 5:00 pm', fontFamily: 'Inter', bold: true, fontSize: 28, fill: '#3E5347', align: 'left' }),
          tx({ x: 140, y: 1255, width: 800, height: 40, text: 'Drop-in $18 · 10-class pass $150 · first class free', fontFamily: 'Inter', fontSize: 24, fill: '#7C9885', align: 'left' }),
          st('🧘', { x: 465, y: 1350, width: 150, height: 150, fontSize: 110 }),
          tx({ x: 90, y: 1500, width: 900, height: 45, text: 'STILL POINT YOGA · 8 HARBOR LANE · stillpoint.studio', fontFamily: 'DM Mono', fontSize: 22, letterSpacing: 2, fill: '#8FA396', align: 'center' }),
        ],
      },
    ],
  },

  // 6 ── Gift certificate · gold border
  {
    slug: 'gift-certificate',
    name: 'Gift Certificate',
    category: 'print',
    width: 1123,
    height: 794,
    accent: '#B8860B',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#FFFCF5' },
        elements: [
          sh('rect', { x: 40, y: 40, width: 1043, height: 714, fill: 'transparent', stroke: '#B8860B', strokeWidth: 4 }),
          sh('rect', { x: 56, y: 56, width: 1011, height: 682, fill: 'transparent', stroke: '#D4AF37', strokeWidth: 1.5 }),
          tx({ x: 120, y: 120, width: 880, height: 60, text: 'GIFT CERTIFICATE', fontFamily: 'Cinzel', bold: true, fontSize: 44, letterSpacing: 8, fill: '#8B6914', align: 'center' }),
          ln({ x: 340, y: 210, width: 440, height: 0, stroke: '#D4AF37', strokeWidth: 2 }),
          tx({ x: 120, y: 260, width: 880, height: 60, text: 'This certificate is presented to', fontFamily: 'Cormorant Garamond', italic: true, fontSize: 34, fill: '#7A6A45', align: 'center' }),
          tx({ x: 120, y: 330, width: 880, height: 90, text: '_________________________', fontFamily: 'Cormorant Garamond', fontSize: 48, fill: '#3E3623', align: 'center' }),
          tx({ x: 120, y: 470, width: 880, height: 70, text: 'for one spa day of your choosing', fontFamily: 'Cormorant Garamond', fontSize: 38, fill: '#7A6A45', align: 'center' }),
          sh('rect', { x: 430, y: 570, width: 260, height: 110, fill: '#8B6914', cornerRadius: 12 }),
          tx({ x: 450, y: 598, width: 220, height: 55, text: 'VALUE $150', fontFamily: 'Cinzel', bold: true, fontSize: 32, fill: '#FFF8E1', align: 'center' }),
          tx({ x: 120, y: 700, width: 460, height: 40, text: 'MAISON SERENITY DAY SPA', fontFamily: 'Inter', bold: true, fontSize: 20, letterSpacing: 3, fill: '#8B6914', align: 'left' }),
          tx({ x: 560, y: 700, width: 440, height: 40, text: 'EXPIRES ONE YEAR FROM ISSUE · NO. 0218', fontFamily: 'Inter', fontSize: 18, letterSpacing: 1, fill: '#A08B5F', align: 'right' }),
          st('🌿', { x: 130, y: 560, width: 130, height: 130, fontSize: 90 }),
          st('🌿', { x: 860, y: 560, width: 130, height: 130, fontSize: 90 }),
        ],
      },
    ],
  },

  // 7 ── Business card · modern dark
  {
    slug: 'modern-business-card',
    name: 'Modern Business Card',
    category: 'print',
    width: 1050,
    height: 600,
    accent: '#F59E0B',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#111827' },
        elements: [
          sh('rect', { x: 0, y: 0, width: 46, height: 600, fill: '#F59E0B' }),
          tx({ x: 110, y: 120, width: 700, height: 70, text: 'Maya Torres', fontFamily: 'Outfit', bold: true, fontSize: 56, fill: '#FFFFFF', align: 'left' }),
          tx({ x: 112, y: 200, width: 700, height: 50, text: 'Architect · Studio Principal', fontFamily: 'Inter', fontSize: 27, letterSpacing: 1, fill: '#F59E0B', align: 'left' }),
          ln({ x: 112, y: 290, width: 90, height: 0, stroke: '#374151', strokeWidth: 3 }),
          tx({ x: 112, y: 330, width: 700, height: 45, text: 'maya@torresworks.studio', fontFamily: 'Inter', fontSize: 24, fill: '#9CA3AF', align: 'left' }),
          tx({ x: 112, y: 380, width: 700, height: 45, text: '+1 (555) 061-2240', fontFamily: 'Inter', fontSize: 24, fill: '#9CA3AF', align: 'left' }),
          tx({ x: 112, y: 430, width: 700, height: 45, text: 'torresworks.studio', fontFamily: 'Inter', fontSize: 24, fill: '#9CA3AF', align: 'left' }),
          gr('hexagon', { x: 820, y: 210, width: 150, height: 150, fill: 'transparent', stroke: '#F59E0B', strokeWidth: 6 }),
          tx({ x: 835, y: 250, width: 120, height: 80, text: 'MT', fontFamily: 'Outfit', bold: true, fontSize: 44, fill: '#F59E0B', align: 'center' }),
          tx({ x: 110, y: 530, width: 500, height: 40, text: 'TORRES WORKS · BUILD SINCE 2016', fontFamily: 'DM Mono', fontSize: 18, letterSpacing: 3, fill: '#4B5563', align: 'left' }),
        ],
      },
    ],
  },

  // 8 ── Open mic night flyer · purple stage
  {
    slug: 'open-mic-flyer',
    name: 'Open Mic Flyer',
    category: 'print',
    width: 1080,
    height: 1560,
    accent: '#8B5CF6',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'gradient', from: '#2E1065', to: '#6D28D9', angle: 160 },
        elements: [
          sh('ellipse', { x: 290, y: 120, width: 500, height: 500, fill: '#8B5CF6', opacity: 0.4 }),
          st('🎤', { x: 400, y: 230, width: 280, height: 280, fontSize: 210 }),
          tx({ x: 90, y: 700, width: 900, height: 60, text: 'EVERY THURSDAY NIGHT', fontFamily: 'DM Mono', bold: true, fontSize: 28, letterSpacing: 6, fill: '#C4B5FD', align: 'center' }),
          tx({ x: 90, y: 770, width: 900, height: 150, text: 'OPEN MIC', fontFamily: 'Righteous', fontSize: 130, fill: '#FFFFFF', align: 'center' }),
          tx({ x: 90, y: 930, width: 900, height: 60, text: 'poetry · music · stand-up · stories', fontFamily: 'Quicksand', bold: true, fontSize: 34, letterSpacing: 2, fill: '#DDD6FE', align: 'center' }),
          ln({ x: 390, y: 1040, width: 300, height: 0, stroke: '#8B5CF6', strokeWidth: 4 }),
          tx({ x: 90, y: 1080, width: 900, height: 100, text: '5-minute slots · sign-up at 7, show at 8\nall levels, all voices, warm room', fontFamily: 'Quicksand', fontSize: 29, lineHeight: 1.5, fill: '#EDE9FE', align: 'center' }),
          sh('rect', { x: 240, y: 1240, width: 600, height: 110, fill: '#FFFFFF', cornerRadius: 55 }),
          tx({ x: 260, y: 1272, width: 560, height: 55, text: 'FIRST TIMERS GET FREE COOKIES 🍪', fontFamily: 'Outfit', bold: true, fontSize: 29, fill: '#5B21B6', align: 'center' }),
          tx({ x: 90, y: 1430, width: 900, height: 45, text: 'THE VELVET ROOM · 32 CEDAR ST · ALL AGES', fontFamily: 'DM Mono', fontSize: 22, letterSpacing: 2, fill: '#A78BFA', align: 'center' }),
        ],
      },
    ],
  },

  // 9 ── Moving sale sign · loud retail
  {
    slug: 'moving-sale',
    name: 'Moving Sale Sign',
    category: 'print',
    width: 1080,
    height: 1350,
    accent: '#FACC15',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#FACC15' },
        elements: [
          tx({ x: 90, y: 110, width: 900, height: 70, text: 'THIS SATURDAY · 8 AM – 2 PM · RAIN OR SHINE', fontFamily: 'Archivo Black', fontSize: 34, fill: '#1C1917', align: 'center' }),
          tx({ x: 90, y: 220, width: 900, height: 200, text: 'MOVING', fontFamily: 'Archivo Black', fontSize: 170, fill: '#1C1917', align: 'center' }),
          tx({ x: 90, y: 420, width: 900, height: 200, text: 'SALE', fontFamily: 'Archivo Black', fontSize: 170, fill: '#DC2626', align: 'center' }),
          tx({ x: 90, y: 660, width: 900, height: 70, text: 'EVERYTHING MUST GO', fontFamily: 'Archivo Black', fontSize: 54, fill: '#1C1917', align: 'center' }),
          sh('rect', { x: 90, y: 790, width: 900, height: 330, fill: '#1C1917', cornerRadius: 24 }),
          tx({ x: 130, y: 830, width: 820, height: 55, text: 'FURNITURE · TOOLS · KITCHEN · BOOKS · KID STUFF', fontFamily: 'Inter', bold: true, fontSize: 28, letterSpacing: 1, fill: '#FACC15', align: 'center' }),
          tx({ x: 130, y: 910, width: 820, height: 55, text: 'Prices drop every hour — come early, haggle kindly.', fontFamily: 'Inter', fontSize: 27, fill: '#E7E5E4', align: 'center' }),
          tx({ x: 130, y: 990, width: 820, height: 55, text: 'CASH & VENMO · NO HOLDS · BRING A FRIEND', fontFamily: 'Inter', bold: true, fontSize: 27, fill: '#A8A29E', align: 'center' }),
          gr('arrow', { x: 430, y: 1180, width: 220, height: 140, fill: '#DC2626' }),
          tx({ x: 90, y: 1230, width: 340, height: 55, text: '47 BIRCH RD', fontFamily: 'Archivo Black', fontSize: 40, fill: '#1C1917', align: 'left' }),
          tx({ x: 660, y: 1240, width: 330, height: 55, text: '→  Follow the signs', fontFamily: 'Caveat', bold: true, fontSize: 44, fill: '#DC2626', align: 'right' }),
        ],
      },
    ],
  },
]
