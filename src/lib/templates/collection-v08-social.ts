// ─────────────────────────────────────────────────────────────
// collection-v08/social — 14 new premium-grade social templates.
// Original designs (nothing copied), styled after what's trending
// across the big template platforms in 2026: bold maxiform type,
// quiet-luxury minimalism, deep-dark canvases with one neon accent,
// and editorial serif/sans pairings.
// ─────────────────────────────────────────────────────────────

import type { TemplateDef } from './helpers'
import { tx, sh, ln, st, gr } from './helpers'

export const COLLECTION_V08_SOCIAL: TemplateDef[] = [
  // 1 ── Podcast quote card · deep space + signal green
  {
    slug: 'podcast-quote-card',
    name: 'Podcast Quote Card',
    category: 'social',
    width: 1080,
    height: 1080,
    accent: '#00E5A0',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#0B1120' },
        elements: [
          sh('rect', { x: 0, y: 0, width: 1080, height: 14, fill: '#00E5A0' }),
          tx({ x: 90, y: 130, width: 900, height: 240, text: '“', fontFamily: 'Playfair Display', fontSize: 260, fill: '#00E5A0', align: 'left' }),
          tx({ x: 120, y: 350, width: 840, height: 200, text: 'The best interface', fontFamily: 'Space Grotesk', bold: true, fontSize: 78, fill: '#F8FAFC', align: 'left' }),
          tx({ x: 120, y: 470, width: 840, height: 200, text: 'is a story well', fontFamily: 'Space Grotesk', bold: true, fontSize: 78, fill: '#F8FAFC', align: 'left' }),
          tx({ x: 120, y: 590, width: 840, height: 200, text: 'told.”', fontFamily: 'Space Grotesk', bold: true, fontSize: 78, fill: '#00E5A0', align: 'left' }),
          ln({ x: 120, y: 770, width: 90, height: 0, stroke: '#334155', strokeWidth: 4 }),
          tx({ x: 120, y: 800, width: 600, height: 50, text: 'MARA CHEN · DESIGN LEAD', fontFamily: 'DM Mono', fontSize: 26, letterSpacing: 3, fill: '#94A3B8', align: 'left' }),
          tx({ x: 120, y: 845, width: 600, height: 45, text: 'EPISODE 42 — BUILDING FOR HUMANS', fontFamily: 'DM Mono', fontSize: 24, letterSpacing: 2, fill: '#64748B', align: 'left' }),
          st('🎙️', { x: 800, y: 800, width: 180, height: 180, fontSize: 130 }),
        ],
      },
    ],
  },

  // 2 ── Real estate new listing · sage & cream property card
  {
    slug: 'realestate-new-listing',
    name: 'New Listing Post',
    category: 'social',
    width: 1080,
    height: 1350,
    accent: '#3F5E52',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#F4F1EA' },
        elements: [
          sh('rect', { x: 0, y: 0, width: 1080, height: 300, fill: '#3F5E52' }),
          tx({ x: 90, y: 90, width: 900, height: 60, text: 'JUST LISTED', fontFamily: 'DM Mono', bold: true, fontSize: 30, letterSpacing: 8, fill: '#C9D8CE', align: 'left' }),
          tx({ x: 90, y: 140, width: 900, height: 120, text: 'Maple Grove 12', fontFamily: 'Playfair Display', fontSize: 84, fill: '#FFFFFF', align: 'left' }),
          sh('rect', { x: 700, y: 250, width: 300, height: 130, fill: '#F4F1EA', cornerRadius: 20 }),
          tx({ x: 715, y: 270, width: 270, height: 60, text: '$ 845,000', fontFamily: 'Outfit', bold: true, fontSize: 48, fill: '#3F5E52', align: 'center' }),
          tx({ x: 715, y: 330, width: 270, height: 40, text: '4 BD · 3 BA · 2,140 SQFT', fontFamily: 'Inter', bold: true, fontSize: 19, letterSpacing: 1, fill: '#7A8B82', align: 'center' }),
          st('🏡', { x: 110, y: 390, width: 260, height: 260, fontSize: 200 }),
          tx({ x: 90, y: 700, width: 900, height: 50, text: 'A SUNLIT FAMILY HOME ON A QUIET CUL-DE-SAC', fontFamily: 'Inter', bold: true, fontSize: 27, letterSpacing: 2, fill: '#3F5E52', align: 'left' }),
          ln({ x: 90, y: 770, width: 900, height: 0, stroke: '#D8D2C4', strokeWidth: 3 }),
          gr('check-circle', { x: 100, y: 810, width: 44, height: 44, fill: '#3F5E52' }),
          tx({ x: 165, y: 815, width: 780, height: 45, text: 'Renovated chef’s kitchen with quartz island', fontFamily: 'Inter', fontSize: 29, fill: '#2E3A34', align: 'left' }),
          gr('check-circle', { x: 100, y: 885, width: 44, height: 44, fill: '#3F5E52' }),
          tx({ x: 165, y: 890, width: 780, height: 45, text: 'South-facing garden + covered patio', fontFamily: 'Inter', fontSize: 29, fill: '#2E3A34', align: 'left' }),
          gr('check-circle', { x: 100, y: 960, width: 44, height: 44, fill: '#3F5E52' }),
          tx({ x: 165, y: 965, width: 780, height: 45, text: 'Top school district, 8 min to downtown', fontFamily: 'Inter', fontSize: 29, fill: '#2E3A34', align: 'left' }),
          sh('rect', { x: 90, y: 1060, width: 620, height: 110, fill: '#3F5E52', cornerRadius: 55 }),
          tx({ x: 110, y: 1092, width: 580, height: 55, text: 'BOOK A TOUR →  (555) 210-4477', fontFamily: 'Outfit', bold: true, fontSize: 32, fill: '#FFFFFF', align: 'center' }),
          tx({ x: 90, y: 1210, width: 900, height: 40, text: 'HELEN PARK · PARK & CO REAL ESTATE', fontFamily: 'DM Mono', fontSize: 22, letterSpacing: 3, fill: '#9AA79F', align: 'left' }),
        ],
      },
    ],
  },

  // 3 ── Fitness bootcamp · black + volt
  {
    slug: 'no-excuses-bootcamp',
    name: 'Fitness Bootcamp',
    category: 'social',
    width: 1080,
    height: 1080,
    accent: '#C6FF3D',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#0D0D0D' },
        elements: [
          sh('rect', { x: -120, y: 780, width: 700, height: 420, fill: '#C6FF3D', rotation: -18 }),
          tx({ x: 90, y: 150, width: 900, height: 90, text: 'SUMMER SHRED · 6-WEEK BOOTCAMP', fontFamily: 'DM Mono', bold: true, fontSize: 28, letterSpacing: 4, fill: '#C6FF3D', align: 'left' }),
          tx({ x: 80, y: 240, width: 940, height: 200, text: 'NO', fontFamily: 'Bebas Neue', fontSize: 190, fill: '#FFFFFF', align: 'left' }),
          tx({ x: 80, y: 420, width: 940, height: 200, text: 'EXCUSES', fontFamily: 'Bebas Neue', fontSize: 190, fill: '#FFFFFF', align: 'left' }),
          st('💪', { x: 700, y: 180, width: 220, height: 220, fontSize: 160 }),
          tx({ x: 90, y: 640, width: 700, height: 60, text: 'Mon · Wed · Fri — 6:00 AM @ Riverside Park', fontFamily: 'Inter', fontSize: 32, fill: '#D4D4D4', align: 'left' }),
          tx({ x: 80, y: 880, width: 800, height: 100, text: 'FIRST SESSION FREE', fontFamily: 'Bebas Neue', fontSize: 76, fill: '#0D0D0D', align: 'left' }),
          tx({ x: 82, y: 975, width: 700, height: 50, text: 'COACH D  ·  @SHREDCAMP', fontFamily: 'DM Mono', bold: true, fontSize: 26, letterSpacing: 3, fill: '#0D0D0D', align: 'left' }),
        ],
      },
    ],
  },

  // 4 ── Restaurant daily special · terracotta warmth
  {
    slug: 'restaurant-special',
    name: 'Daily Special Post',
    category: 'social',
    width: 1080,
    height: 1080,
    accent: '#B4441C',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#F6EBDD' },
        elements: [
          sh('ellipse', { x: 690, y: -160, width: 620, height: 620, fill: '#E8C9A0', opacity: 0.55 }),
          tx({ x: 90, y: 140, width: 700, height: 60, text: 'TONIGHT AT CASA VERDE', fontFamily: 'DM Mono', bold: true, fontSize: 27, letterSpacing: 5, fill: '#B4441C', align: 'left' }),
          tx({ x: 80, y: 210, width: 800, height: 150, text: 'Taco', fontFamily: 'Fraunces', fontSize: 130, fill: '#3D2B1F', align: 'left' }),
          tx({ x: 80, y: 350, width: 800, height: 150, text: 'Tuesday', fontFamily: 'Caveat', bold: true, fontSize: 120, fill: '#B4441C', align: 'left' }),
          tx({ x: 90, y: 540, width: 620, height: 140, text: 'Street-style tacos, hand-pressed tortillas, slow-braised fillings — three for $12 all evening.', fontFamily: 'Lora', fontSize: 33, lineHeight: 1.4, fill: '#5C4633', align: 'left' }),
          ln({ x: 90, y: 720, width: 160, height: 0, stroke: '#B4441C', strokeWidth: 6 }),
          tx({ x: 90, y: 755, width: 700, height: 50, text: 'EVERY TUESDAY · 5 PM – CLOSE', fontFamily: 'Inter', bold: true, fontSize: 27, letterSpacing: 2, fill: '#3D2B1F', align: 'left' }),
          st('🌮', { x: 700, y: 600, width: 300, height: 300, fontSize: 220 }),
          sh('rect', { x: 90, y: 880, width: 460, height: 96, fill: '#B4441C', cornerRadius: 48 }),
          tx({ x: 110, y: 908, width: 420, height: 50, text: 'RESERVE: (555) 431-0092', fontFamily: 'Outfit', bold: true, fontSize: 27, fill: '#FFF6EC', align: 'center' }),
        ],
      },
    ],
  },

  // 5 ── Fashion lookbook · quiet luxury editorial
  {
    slug: 'fashion-lookbook',
    name: 'Fashion Lookbook',
    category: 'social',
    width: 1080,
    height: 1080,
    accent: '#8A7B5C',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#EFEBE3' },
        elements: [
          tx({ x: 90, y: 100, width: 900, height: 50, text: 'ATELIER NOIR — COLLECTION JOURNAL', fontFamily: 'DM Mono', fontSize: 24, letterSpacing: 6, fill: '#8A7B5C', align: 'left' }),
          ln({ x: 90, y: 175, width: 900, height: 0, stroke: '#C9C1B0', strokeWidth: 2 }),
          tx({ x: 90, y: 230, width: 900, height: 130, text: 'The Summer', fontFamily: 'Cormorant Garamond', fontSize: 100, fill: '#26221C', align: 'left' }),
          tx({ x: 90, y: 350, width: 900, height: 130, text: 'Edit — SS26', fontFamily: 'Cormorant Garamond', italic: true, fontSize: 100, fill: '#8A7B5C', align: 'left' }),
          sh('rect', { x: 90, y: 530, width: 430, height: 560, fill: '#DCD5C6' }),
          sh('rect', { x: 560, y: 530, width: 430, height: 560, fill: '#CFC6B2' }),
          sh('rect', { x: 130, y: 570, width: 350, height: 440, fill: '#B8AE97', opacity: 0.5 }),
          sh('rect', { x: 600, y: 570, width: 350, height: 440, fill: '#A79A7E', opacity: 0.45 }),
          tx({ x: 130, y: 1035, width: 350, height: 45, text: 'LINEN SUIT — No. 04', fontFamily: 'Inter', fontSize: 22, letterSpacing: 2, fill: '#5C5442', align: 'left' }),
          tx({ x: 600, y: 1035, width: 350, height: 45, text: 'SILK SLIP — No. 11', fontFamily: 'Inter', fontSize: 22, letterSpacing: 2, fill: '#5C5442', align: 'left' }),
          tx({ x: 560, y: 230, width: 430, height: 220, text: 'Twelve quiet pieces in linen, silk and raw cotton. Made in small runs, numbered by hand.', fontFamily: 'Lora', fontSize: 30, lineHeight: 1.45, fill: '#5C5442', align: 'left' }),
        ],
      },
    ],
  },

  // 6 ── Webinar announcement · indigo professional (LinkedIn size)
  {
    slug: 'webinar-announcement',
    name: 'Webinar Announcement',
    category: 'social',
    width: 1200,
    height: 627,
    accent: '#4F46E5',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'gradient', from: '#1E1B4B', to: '#312E81', angle: 135 },
        elements: [
          sh('ellipse', { x: 880, y: -140, width: 480, height: 480, fill: '#4F46E5', opacity: 0.35 }),
          sh('ellipse', { x: 1000, y: 330, width: 340, height: 340, fill: '#818CF8', opacity: 0.18 }),
          tx({ x: 70, y: 70, width: 700, height: 50, text: 'FREE LIVE WEBINAR — SEAT 7', fontFamily: 'DM Mono', bold: true, fontSize: 24, letterSpacing: 4, fill: '#A5B4FC', align: 'left' }),
          tx({ x: 70, y: 130, width: 760, height: 90, text: 'Shipping AI Features', fontFamily: 'Outfit', bold: true, fontSize: 62, fill: '#FFFFFF', align: 'left' }),
          tx({ x: 70, y: 205, width: 760, height: 90, text: 'That Survive Production', fontFamily: 'Outfit', bold: true, fontSize: 62, fill: '#A5B4FC', align: 'left' }),
          ln({ x: 70, y: 320, width: 100, height: 0, stroke: '#A5B4FC', strokeWidth: 5 }),
          tx({ x: 70, y: 350, width: 700, height: 50, text: 'THU · JUNE 12 · 11:00 ET · 45 MIN + LIVE Q&A', fontFamily: 'Inter', bold: true, fontSize: 26, letterSpacing: 2, fill: '#E0E7FF', align: 'left' }),
          sh('ellipse', { x: 70, y: 430, width: 84, height: 84, fill: '#4F46E5' }),
          tx({ x: 82, y: 442, width: 60, height: 60, text: 'DK', fontFamily: 'Outfit', bold: true, fontSize: 30, fill: '#FFFFFF', align: 'center' }),
          tx({ x: 175, y: 437, width: 500, height: 40, text: 'Dana Kim — Principal Engineer, Loop', fontFamily: 'Inter', bold: true, fontSize: 26, fill: '#FFFFFF', align: 'left' }),
          tx({ x: 175, y: 477, width: 500, height: 40, text: 'Host of The Shipping Podcast', fontFamily: 'Inter', fontSize: 23, fill: '#A5B4FC', align: 'left' }),
          sh('rect', { x: 820, y: 440, width: 310, height: 92, fill: '#FFFFFF', cornerRadius: 46 }),
          tx({ x: 840, y: 468, width: 270, height: 45, text: 'SAVE MY SEAT →', fontFamily: 'Outfit', bold: true, fontSize: 26, fill: '#1E1B4B', align: 'center' }),
        ],
      },
    ],
  },

  // 7 ── Personal LinkedIn banner · teal professional
  {
    slug: 'linkedin-banner',
    name: 'LinkedIn Banner',
    category: 'social',
    width: 1584,
    height: 396,
    accent: '#0D9488',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'gradient', from: '#042F2E', to: '#0F766E', angle: 105 },
        elements: [
          sh('ellipse', { x: -160, y: 120, width: 420, height: 420, fill: '#14B8A6', opacity: 0.25 }),
          sh('ellipse', { x: 1150, y: -220, width: 560, height: 560, fill: '#2DD4BF', opacity: 0.16 }),
          gr('hexagon', { x: 1180, y: 120, width: 190, height: 190, fill: '#2DD4BF', opacity: 0.5 }),
          tx({ x: 120, y: 95, width: 900, height: 60, text: 'PRODUCT DESIGN · DESIGN SYSTEMS · TEAM LEADERSHIP', fontFamily: 'DM Mono', bold: true, fontSize: 25, letterSpacing: 5, fill: '#5EEAD4', align: 'left' }),
          tx({ x: 120, y: 150, width: 980, height: 110, text: 'Building calm software for busy teams.', fontFamily: 'Fraunces', fontSize: 60, fill: '#FFFFFF', align: 'left' }),
          tx({ x: 120, y: 280, width: 900, height: 50, text: 'Currently: Design Lead @ Northwind · Open to advisory', fontFamily: 'Inter', fontSize: 27, fill: '#CCFBF1', align: 'left' }),
        ],
      },
    ],
  },

  // 8 ── Pinterest recipe pin · tall warm kitchen card
  {
    slug: 'pinterest-recipe',
    name: 'Recipe Pin',
    category: 'social',
    width: 1000,
    height: 1500,
    accent: '#D97706',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#FFF9F0' },
        elements: [
          sh('rect', { x: 0, y: 0, width: 1000, height: 430, fill: '#F59E0B' }),
          st('🍝', { x: 350, y: 60, width: 300, height: 300, fontSize: 220 }),
          tx({ x: 80, y: 470, width: 840, height: 55, text: 'WEEKNIGHT DINNER', fontFamily: 'DM Mono', bold: true, fontSize: 26, letterSpacing: 6, fill: '#B45309', align: 'left' }),
          tx({ x: 70, y: 525, width: 880, height: 110, text: '5-Ingredient', fontFamily: 'Playfair Display', bold: true, fontSize: 84, fill: '#292014', align: 'left' }),
          tx({ x: 70, y: 635, width: 880, height: 110, text: 'Creamy Pasta', fontFamily: 'Playfair Display', italic: true, fontSize: 84, fill: '#B45309', align: 'left' }),
          ln({ x: 80, y: 790, width: 840, height: 0, stroke: '#F0E4D0', strokeWidth: 3 }),
          tx({ x: 80, y: 830, width: 400, height: 45, text: 'YOU NEED', fontFamily: 'Inter', bold: true, fontSize: 25, letterSpacing: 4, fill: '#92400E', align: 'left' }),
          tx({ x: 80, y: 895, width: 840, height: 360, text: 'Fusilli pasta · 500 g\nParmesan, freshly grated · 120 g\nHeavy cream · 250 ml\nGarlic · 3 cloves, thinly sliced\nButter · 2 tbsp + cracked pepper', fontFamily: 'Lora', fontSize: 33, lineHeight: 1.75, fill: '#443626', align: 'left' }),
          sh('rect', { x: 80, y: 1290, width: 460, height: 100, fill: '#292014', cornerRadius: 50 }),
          tx({ x: 100, y: 1320, width: 420, height: 45, text: 'FULL RECIPE — 25 MIN', fontFamily: 'Outfit', bold: true, fontSize: 27, letterSpacing: 1, fill: '#FFF9F0', align: 'center' }),
          tx({ x: 590, y: 1325, width: 330, height: 45, text: '@thebusy.kitchen', fontFamily: 'Caveat', bold: true, fontSize: 40, fill: '#B45309', align: 'left' }),
        ],
      },
    ],
  },

  // 9 ── Birthday story · confetti celebration
  {
    slug: 'birthday-story',
    name: 'Birthday Story',
    category: 'social',
    width: 1080,
    height: 1920,
    accent: '#F472B6',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'gradient', from: '#FDF2F8', to: '#FDE68A', angle: 160 },
        elements: [
          sh('rect', { x: 140, y: 200, width: 46, height: 46, fill: '#F472B6', rotation: 28 }),
          sh('rect', { x: 860, y: 320, width: 38, height: 38, fill: '#818CF8', rotation: -20 }),
          sh('rect', { x: 220, y: 480, width: 34, height: 34, fill: '#34D399', rotation: 45 }),
          sh('rect', { x: 780, y: 620, width: 42, height: 42, fill: '#F472B6', rotation: 12 }),
          sh('star', { x: 820, y: 150, width: 90, height: 90, fill: '#FBBF24' }),
          sh('star', { x: 160, y: 760, width: 70, height: 70, fill: '#FBBF24' }),
          sh('star', { x: 880, y: 980, width: 60, height: 60, fill: '#FB7185' }),
          st('🎂', { x: 390, y: 430, width: 300, height: 300, fontSize: 220 }),
          tx({ x: 90, y: 820, width: 900, height: 80, text: 'IT’S YOUR DAY', fontFamily: 'DM Mono', bold: true, fontSize: 34, letterSpacing: 8, fill: '#9D174D', align: 'center' }),
          tx({ x: 90, y: 900, width: 900, height: 160, text: 'Happy', fontFamily: 'Pacifico', fontSize: 130, fill: '#9D174D', align: 'center' }),
          tx({ x: 90, y: 1080, width: 900, height: 160, text: 'Birthday!', fontFamily: 'Pacifico', fontSize: 130, fill: '#BE185D', align: 'center' }),
          sh('rect', { x: 290, y: 1330, width: 500, height: 110, fill: '#9D174D', cornerRadius: 55 }),
          tx({ x: 310, y: 1362, width: 460, height: 55, text: 'PARTY AT 8 · ROOFTOP', fontFamily: 'Outfit', bold: true, fontSize: 34, letterSpacing: 1, fill: '#FFF1F7', align: 'center' }),
          st('🎈', { x: 120, y: 1400, width: 160, height: 160, fontSize: 120 }),
          st('🎈', { x: 810, y: 1400, width: 160, height: 160, fontSize: 120 }),
          tx({ x: 90, y: 1600, width: 900, height: 50, text: 'SWIPE UP FOR THE PLAYLIST 🎶', fontFamily: 'Inter', bold: true, fontSize: 27, letterSpacing: 2, fill: '#9D174D', align: 'center' }),
        ],
      },
    ],
  },

  // 10 ── Black Friday · maximum contrast retail
  {
    slug: 'black-friday-post',
    name: 'Black Friday Post',
    category: 'social',
    width: 1080,
    height: 1080,
    accent: '#EF4444',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#0A0A0A' },
        elements: [
          tx({ x: 90, y: 130, width: 900, height: 60, text: '48 HOURS ONLY · ONLINE & IN-STORE', fontFamily: 'Inter', bold: true, fontSize: 26, letterSpacing: 4, fill: '#737373', align: 'center' }),
          tx({ x: 90, y: 200, width: 900, height: 170, text: 'BLACK', fontFamily: 'Anton', fontSize: 150, fill: '#FFFFFF', align: 'center' }),
          tx({ x: 90, y: 360, width: 900, height: 170, text: 'FRIDAY', fontFamily: 'Anton', fontSize: 150, fill: '#EF4444', align: 'center' }),
          ln({ x: 340, y: 570, width: 400, height: 0, stroke: '#EF4444', strokeWidth: 6 }),
          tx({ x: 90, y: 600, width: 900, height: 130, text: 'UP TO 70% OFF', fontFamily: 'Bebas Neue', fontSize: 100, fill: '#FFFFFF', align: 'center' }),
          tx({ x: 90, y: 740, width: 900, height: 50, text: 'USE CODE: BFRIDAY70', fontFamily: 'DM Mono', bold: true, fontSize: 30, letterSpacing: 3, fill: '#EF4444', align: 'center' }),
          sh('rect', { x: 315, y: 830, width: 450, height: 100, fill: '#EF4444', cornerRadius: 12 }),
          tx({ x: 335, y: 862, width: 410, height: 45, text: 'SHOP THE SALE →', fontFamily: 'Outfit', bold: true, fontSize: 32, fill: '#FFFFFF', align: 'center' }),
          st('🛍️', { x: 60, y: 850, width: 180, height: 180, fontSize: 130 }),
          st('🛍️', { x: 840, y: 850, width: 180, height: 180, fontSize: 130 }),
        ],
      },
    ],
  },

  // 11 ── Playlist cover · retro night drive
  {
    slug: 'playlist-cover',
    name: 'Playlist Cover',
    category: 'social',
    width: 1080,
    height: 1080,
    accent: '#A855F7',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'gradient', from: '#4C1D95', to: '#F97316', angle: 145 },
        elements: [
          sh('ellipse', { x: 240, y: 260, width: 600, height: 600, fill: '#FACC15', opacity: 0.9 }),
          sh('ellipse', { x: 320, y: 340, width: 440, height: 440, fill: '#FB923C', opacity: 0.95 }),
          sh('ellipse', { x: 400, y: 420, width: 280, height: 280, fill: '#7C3AED' }),
          sh('rect', { x: 0, y: 700, width: 1080, height: 380, fill: '#1E1045', opacity: 0.88 }),
          tx({ x: 90, y: 120, width: 900, height: 90, text: 'MIDNIGHT MIXTAPE · VOL. 03', fontFamily: 'Space Mono', bold: true, fontSize: 30, letterSpacing: 5, fill: '#FFF7ED', align: 'center' }),
          tx({ x: 90, y: 745, width: 900, height: 130, text: 'LATE NIGHT', fontFamily: 'Monoton', fontSize: 100, fill: '#FACC15', align: 'center' }),
          tx({ x: 90, y: 870, width: 900, height: 100, text: 'DRIVE', fontFamily: 'Monoton', fontSize: 100, fill: '#FFFFFF', align: 'center' }),
          tx({ x: 90, y: 990, width: 900, height: 45, text: '24 TRACKS · 1 HR 18 MIN · CURATED BY @nightowl', fontFamily: 'Inter', fontSize: 23, letterSpacing: 2, fill: '#C4B5FD', align: 'center' }),
        ],
      },
    ],
  },

  // 12 ── Monday motivation · monochrome gym type
  {
    slug: 'monday-motivation',
    name: 'Monday Motivation',
    category: 'social',
    width: 1080,
    height: 1080,
    accent: '#F5F5F5',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#171717' },
        elements: [
          tx({ x: 80, y: 110, width: 920, height: 340, text: 'MON-', fontFamily: 'Archivo Black', fontSize: 230, fill: '#FFFFFF', align: 'left' }),
          tx({ x: 80, y: 420, width: 920, height: 340, text: 'DAY', fontFamily: 'Archivo Black', fontSize: 230, fill: '#FACC15', align: 'left' }),
          sh('rect', { x: 80, y: 800, width: 920, height: 4, fill: '#404040' }),
          tx({ x: 80, y: 840, width: 920, height: 60, text: 'THE BAR DOESN’T LIFT ITSELF.', fontFamily: 'Inter', bold: true, fontSize: 33, letterSpacing: 3, fill: '#D4D4D4', align: 'left' }),
          st('🏋️', { x: 790, y: 740, width: 210, height: 210, fontSize: 150 }),
          tx({ x: 80, y: 960, width: 920, height: 45, text: '#TEAMNOSLEEPSQUAD · GYM OPENS 5 AM', fontFamily: 'DM Mono', fontSize: 24, letterSpacing: 2, fill: '#737373', align: 'left' }),
        ],
      },
    ],
  },

  // 13 ── Flash sale story · urgency countdown
  {
    slug: 'ends-tonight-story',
    name: 'Flash Sale Story',
    category: 'social',
    width: 1080,
    height: 1920,
    accent: '#DC2626',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'gradient', from: '#7F1D1D', to: '#DC2626', angle: 165 },
        elements: [
          tx({ x: 90, y: 260, width: 900, height: 70, text: '⚡ FLASH SALE ⚡', fontFamily: 'Bebas Neue', fontSize: 58, letterSpacing: 6, fill: '#FFE4E6', align: 'center' }),
          tx({ x: 90, y: 360, width: 900, height: 200, text: 'ENDS', fontFamily: 'Anton', fontSize: 150, fill: '#FFFFFF', align: 'center' }),
          tx({ x: 90, y: 500, width: 900, height: 200, text: 'TONIGHT', fontFamily: 'Anton', fontSize: 150, fill: '#FCA5A5', align: 'center' }),
          sh('rect', { x: 150, y: 760, width: 220, height: 240, fill: '#FFFFFF', cornerRadius: 24 }),
          sh('rect', { x: 430, y: 760, width: 220, height: 240, fill: '#FFFFFF', cornerRadius: 24 }),
          sh('rect', { x: 710, y: 760, width: 220, height: 240, fill: '#FFFFFF', cornerRadius: 24 }),
          tx({ x: 150, y: 800, width: 220, height: 130, text: '04', fontFamily: 'Outfit', bold: true, fontSize: 100, fill: '#7F1D1D', align: 'center' }),
          tx({ x: 430, y: 800, width: 220, height: 130, text: '12', fontFamily: 'Outfit', bold: true, fontSize: 100, fill: '#7F1D1D', align: 'center' }),
          tx({ x: 710, y: 800, width: 220, height: 130, text: '33', fontFamily: 'Outfit', bold: true, fontSize: 100, fill: '#7F1D1D', align: 'center' }),
          tx({ x: 150, y: 940, width: 220, height: 45, text: 'HOURS', fontFamily: 'Inter', bold: true, fontSize: 24, letterSpacing: 3, fill: '#7F1D1D', align: 'center' }),
          tx({ x: 430, y: 940, width: 220, height: 45, text: 'MINUTES', fontFamily: 'Inter', bold: true, fontSize: 24, letterSpacing: 2, fill: '#7F1D1D', align: 'center' }),
          tx({ x: 710, y: 940, width: 220, height: 45, text: 'SECONDS', fontFamily: 'Inter', bold: true, fontSize: 24, letterSpacing: 2, fill: '#7F1D1D', align: 'center' }),
          tx({ x: 90, y: 1100, width: 900, height: 60, text: 'EVERYTHING 30% OFF — NO CODE NEEDED', fontFamily: 'Inter', bold: true, fontSize: 30, letterSpacing: 1, fill: '#FFFFFF', align: 'center' }),
          sh('rect', { x: 240, y: 1210, width: 600, height: 110, fill: '#FFFFFF', cornerRadius: 55 }),
          tx({ x: 260, y: 1242, width: 560, height: 55, text: 'TAP TO SHOP BEFORE IT’S GONE', fontFamily: 'Outfit', bold: true, fontSize: 31, fill: '#7F1D1D', align: 'center' }),
          st('⏰', { x: 440, y: 1420, width: 220, height: 220, fontSize: 160 }),
        ],
      },
    ],
  },

  // 14 ── Grand opening · sage ribbon
  {
    slug: 'grand-opening',
    name: 'Grand Opening',
    category: 'social',
    width: 1080,
    height: 1080,
    accent: '#5B7C6A',
    badge: 'premium',
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#F3F6F2' },
        elements: [
          sh('ellipse', { x: 90, y: 90, width: 900, height: 900, fill: 'transparent', stroke: '#5B7C6A', strokeWidth: 3 }),
          sh('ellipse', { x: 120, y: 120, width: 840, height: 840, fill: 'transparent', stroke: '#C8D6CC', strokeWidth: 1.5 }),
          tx({ x: 190, y: 200, width: 700, height: 55, text: 'YOU ARE INVITED', fontFamily: 'DM Mono', fontSize: 26, letterSpacing: 7, fill: '#5B7C6A', align: 'center' }),
          tx({ x: 190, y: 270, width: 700, height: 110, text: 'Grand Opening', fontFamily: 'Prata', fontSize: 88, fill: '#2F4237', align: 'center' }),
          gr('ribbon', { x: 440, y: 400, width: 200, height: 160, fill: '#5B7C6A' }),
          tx({ x: 190, y: 580, width: 700, height: 55, text: 'FERN & FABLE — BOOKS · COFFEE · COMMUNITY', fontFamily: 'Inter', bold: true, fontSize: 25, letterSpacing: 1, fill: '#5B7C6A', align: 'center' }),
          ln({ x: 390, y: 670, width: 300, height: 0, stroke: '#C8D6CC', strokeWidth: 3 }),
          tx({ x: 190, y: 700, width: 700, height: 55, text: 'SATURDAY, MAY 9 · DOORS AT 9 AM', fontFamily: 'Cormorant Garamond', bold: true, fontSize: 40, fill: '#2F4237', align: 'center' }),
          tx({ x: 190, y: 760, width: 700, height: 50, text: '214 Willow Lane · first 50 guests get a free pour', fontFamily: 'Inter', fontSize: 26, fill: '#6B7F72', align: 'center' }),
          st('🌿', { x: 470, y: 830, width: 140, height: 140, fontSize: 100 }),
        ],
      },
    ],
  },
]
