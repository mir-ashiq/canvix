// ─────────────────────────────────────────────────────────────
// collection-v17/fields — 12 smart templates (v0.17 Wave 2).
// Text elements carry {{key}} markers; the fill dialog, CSV bulk
// fill and the REST fill API substitute per-row values. Fields:
// certificates ×4, business cards ×3, quote posts ×2, event
// flyers ×2, invoice ×1. Original designs.
// ─────────────────────────────────────────────────────────────

import type { TemplateDef } from './helpers'
import { tx, sh, ln, st, gr } from './helpers'

export const COLLECTION_V17_FIELDS: TemplateDef[] = [
  // 1 ── Certificate of excellence · classic serif
  {
    slug: 'certificate-excellence',
    name: 'Certificate of Excellence',
    category: 'print',
    width: 1754,
    height: 1240,
    accent: '#B45309',
    badge: 'new',
    fields: [
      { key: 'recipient_name', label: 'Recipient name', example: 'Ada Lovelace' },
      { key: 'course_name', label: 'Course / achievement', example: 'Advanced Data Structures' },
      { key: 'date', label: 'Date', example: '14 March 2026' },
      { key: 'presenter_name', label: 'Presenter / signatory', example: 'Dr. Grace Hopper' },
    ],
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#FDFBF7' },
        elements: [
          sh('rect', { x: 40, y: 40, width: 1674, height: 1160, cornerRadius: 0, fill: 'transparent', stroke: '#B45309', strokeWidth: 8 }),
          sh('rect', { x: 64, y: 64, width: 1626, height: 1112, cornerRadius: 0, fill: 'transparent', stroke: '#D9A45B', strokeWidth: 2 }),
          gr('badge', { x: 797, y: 120, width: 160, height: 160, fill: '#B45309' }),
          tx({ x: 277, y: 300, width: 1200, height: 70, text: 'CERTIFICATE OF EXCELLENCE', fontFamily: 'Cinzel', bold: true, fontSize: 54, letterSpacing: 10, fill: '#78350F', align: 'center' }),
          ln({ x: 677, y: 400, width: 400, height: 0, stroke: '#B45309', strokeWidth: 3 }),
          tx({ x: 377, y: 440, width: 1000, height: 50, text: 'This certificate is proudly presented to', fontFamily: 'EB Garamond', italic: true, fontSize: 30, fill: '#57534E', align: 'center' }),
          tx({ x: 177, y: 520, width: 1400, height: 110, text: '{{recipient_name}}', fontFamily: 'Playfair Display', bold: true, fontSize: 84, fill: '#1C1917', align: 'center' }),
          ln({ x: 477, y: 660, width: 800, height: 0, stroke: '#D9A45B', strokeWidth: 2 }),
          tx({ x: 377, y: 700, width: 1000, height: 120, text: 'for outstanding achievement in\n{{course_name}}', fontFamily: 'EB Garamond', fontSize: 34, fill: '#44403C', align: 'center' }),
          tx({ x: 227, y: 940, width: 400, height: 50, text: '{{date}}', fontFamily: 'EB Garamond', fontSize: 28, fill: '#57534E', align: 'center' }),
          ln({ x: 247, y: 1000, width: 360, height: 0, stroke: '#B45309', strokeWidth: 2 }),
          tx({ x: 227, y: 1015, width: 400, height: 40, text: 'DATE', fontFamily: 'Inter', bold: true, fontSize: 18, letterSpacing: 4, fill: '#A8A29E', align: 'center' }),
          tx({ x: 1127, y: 940, width: 400, height: 50, text: '{{presenter_name}}', fontFamily: 'Great Vibes', fontSize: 48, fill: '#1C1917', align: 'center' }),
          ln({ x: 1147, y: 1000, width: 360, height: 0, stroke: '#B45309', strokeWidth: 2 }),
          tx({ x: 1127, y: 1015, width: 400, height: 40, text: 'SIGNATURE', fontFamily: 'Inter', bold: true, fontSize: 18, letterSpacing: 4, fill: '#A8A29E', align: 'center' }),
        ],
      },
    ],
  },

  // 2 ── Certificate of achievement · modern colour blocks
  {
    slug: 'certificate-achievement-modern',
    name: 'Modern Achievement Certificate',
    category: 'print',
    width: 1754,
    height: 1240,
    accent: '#0F766E',
    badge: 'new',
    fields: [
      { key: 'recipient_name', label: 'Recipient name', example: 'Grace Hopper' },
      { key: 'achievement', label: 'Achievement', example: ' completing the Mentor Program' },
      { key: 'date', label: 'Date', example: '20 June 2026' },
      { key: 'organisation', label: 'Organisation', example: 'Canvix Academy' },
    ],
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#F0FDFA' },
        elements: [
          sh('rect', { x: 0, y: 0, width: 1754, height: 120, cornerRadius: 0, fill: '#0F766E' }),
          sh('rect', { x: 0, y: 1120, width: 1754, height: 120, cornerRadius: 0, fill: '#0F766E' }),
          st('🏅', { x: 807, y: 170, width: 140, height: 140, fontSize: 100 }),
          tx({ x: 277, y: 330, width: 1200, height: 80, text: 'CERTIFICATE OF ACHIEVEMENT', fontFamily: 'Space Grotesk', bold: true, fontSize: 58, letterSpacing: 6, fill: '#134E4A', align: 'center' }),
          tx({ x: 477, y: 440, width: 800, height: 50, text: 'presented to', fontFamily: 'Inter', fontSize: 28, fill: '#5EEAD4', align: 'center' }),
          tx({ x: 177, y: 500, width: 1400, height: 120, text: '{{recipient_name}}', fontFamily: 'Poppins', bold: true, fontSize: 90, fill: '#0F172A', align: 'center' }),
          tx({ x: 377, y: 650, width: 1000, height: 60, text: 'in recognition of{{achievement}}', fontFamily: 'Inter', fontSize: 32, fill: '#334155', align: 'center' }),
          ln({ x: 727, y: 760, width: 300, height: 0, stroke: '#14B8A6', strokeWidth: 4 }),
          tx({ x: 577, y: 800, width: 600, height: 50, text: '{{date}}', fontFamily: 'Inter', bold: true, fontSize: 30, fill: '#134E4A', align: 'center' }),
          tx({ x: 577, y: 940, width: 600, height: 50, text: '{{organisation}}', fontFamily: 'Space Grotesk', bold: true, fontSize: 40, fill: '#0F766E', align: 'center' }),
        ],
      },
    ],
  },

  // 3 ── Certificate of completion · dark premium
  {
    slug: 'certificate-completion-dark',
    name: 'Dark Premium Certificate',
    category: 'print',
    width: 1754,
    height: 1240,
    accent: '#F59E0B',
    badge: 'new',
    fields: [
      { key: 'recipient_name', label: 'Recipient name', example: 'Alan Turing' },
      { key: 'program', label: 'Program', example: 'Machine Learning Foundations' },
      { key: 'hours', label: 'Hours completed', example: '120' },
      { key: 'date', label: 'Date', example: '1 December 2026' },
    ],
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#111827' },
        elements: [
          sh('rect', { x: 40, y: 40, width: 1674, height: 1160, cornerRadius: 24, fill: 'transparent', stroke: '#F59E0B', strokeWidth: 3 }),
          gr('star', { x: 817, y: 110, width: 120, height: 120, fill: '#F59E0B' }),
          tx({ x: 377, y: 260, width: 1000, height: 70, text: 'CERTIFICATE OF COMPLETION', fontFamily: 'Bebas Neue', fontSize: 72, letterSpacing: 12, fill: '#FBBF24', align: 'center' }),
          tx({ x: 477, y: 360, width: 800, height: 50, text: 'awarded by distinction to', fontFamily: 'Inter', fontSize: 26, letterSpacing: 3, fill: '#9CA3AF', align: 'center' }),
          tx({ x: 177, y: 420, width: 1400, height: 120, text: '{{recipient_name}}', fontFamily: 'Playfair Display', bold: true, fontSize: 92, fill: '#F9FAFB', align: 'center' }),
          tx({ x: 377, y: 580, width: 1000, height: 60, text: '{{program}}', fontFamily: 'Outfit', fontSize: 38, fill: '#FBBF24', align: 'center' }),
          ln({ x: 697, y: 680, width: 360, height: 0, stroke: '#374151', strokeWidth: 3 }),
          tx({ x: 477, y: 720, width: 800, height: 50, text: '{{hours}} hours of study · completed {{date}}', fontFamily: 'Inter', fontSize: 28, fill: '#D1D5DB', align: 'center' }),
          sh('rect', { x: 627, y: 860, width: 500, height: 90, cornerRadius: 45, fill: '#F59E0B' }),
          tx({ x: 627, y: 882, width: 500, height: 50, text: 'WITH DISTINCTION', fontFamily: 'Space Grotesk', bold: true, fontSize: 26, letterSpacing: 5, fill: '#111827', align: 'center' }),
        ],
      },
    ],
  },

  // 4 ── Certificate of appreciation · soft warm
  {
    slug: 'certificate-appreciation',
    name: 'Appreciation Certificate',
    category: 'print',
    width: 1754,
    height: 1240,
    accent: '#DB2777',
    badge: 'new',
    fields: [
      { key: 'recipient_name', label: 'Recipient name', example: 'Katherine Johnson' },
      { key: 'reason', label: 'Reason', example: 'her extraordinary volunteer work' },
      { key: 'date', label: 'Date', example: '5 May 2026' },
      { key: 'from', label: 'From', example: 'The Community Team' },
    ],
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#FDF2F8' },
        elements: [
          sh('ellipse', { x: -120, y: -120, width: 420, height: 420, fill: '#FBCFE8' }),
          sh('ellipse', { x: 1454, y: 940, width: 420, height: 420, fill: '#FBCFE8' }),
          st('🌸', { x: 120, y: 100, width: 120, height: 120, fontSize: 90 }),
          st('🌸', { x: 1514, y: 1020, width: 120, height: 120, fontSize: 90 }),
          tx({ x: 277, y: 240, width: 1200, height: 70, text: 'CERTIFICATE OF APPRECIATION', fontFamily: 'Cormorant Garamond', bold: true, fontSize: 62, letterSpacing: 8, fill: '#9D174D', align: 'center' }),
          tx({ x: 477, y: 350, width: 800, height: 50, text: 'with gratitude, we honour', fontFamily: 'Caveat', fontSize: 40, fill: '#DB2777', align: 'center' }),
          tx({ x: 177, y: 420, width: 1400, height: 110, text: '{{recipient_name}}', fontFamily: 'Dancing Script', bold: true, fontSize: 96, fill: '#831843', align: 'center' }),
          ln({ x: 577, y: 570, width: 600, height: 0, stroke: '#F9A8D4', strokeWidth: 3 }),
          tx({ x: 377, y: 610, width: 1000, height: 120, text: 'in warm appreciation of\n{{reason}}', fontFamily: 'Cormorant Garamond', fontSize: 36, fill: '#500724', align: 'center' }),
          tx({ x: 577, y: 830, width: 600, height: 50, text: '{{date}}', fontFamily: 'Inter', fontSize: 26, fill: '#9D174D', align: 'center' }),
          tx({ x: 577, y: 950, width: 600, height: 50, text: '— {{from}}', fontFamily: 'Caveat', fontSize: 44, fill: '#BE185D', align: 'center' }),
        ],
      },
    ],
  },

  // 5 ── Business card · professional navy
  {
    slug: 'business-card-pro',
    name: 'Professional Business Card',
    category: 'print',
    width: 1050,
    height: 600,
    accent: '#1E3A8A',
    badge: 'new',
    fields: [
      { key: 'full_name', label: 'Full name', example: 'Ada Lovelace' },
      { key: 'job_title', label: 'Job title', example: 'Chief Mathematician' },
      { key: 'company', label: 'Company', example: 'Analytical Engines Ltd' },
      { key: 'phone', label: 'Phone', example: '+44 20 7946 0102' },
      { key: 'email', label: 'Email', example: 'ada@example.com' },
    ],
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#FFFFFF' },
        elements: [
          sh('rect', { x: 0, y: 0, width: 360, height: 600, cornerRadius: 0, fill: '#1E3A8A' }),
          gr('diamond', { x: 130, y: 130, width: 100, height: 100, fill: '#FFFFFF' }),
          tx({ x: 30, y: 470, width: 300, height: 60, text: '{{company}}', fontFamily: 'Montserrat', bold: true, fontSize: 26, letterSpacing: 3, fill: '#FFFFFF', align: 'center' }),
          tx({ x: 400, y: 150, width: 600, height: 70, text: '{{full_name}}', fontFamily: 'Playfair Display', bold: true, fontSize: 52, fill: '#0F172A' }),
          tx({ x: 400, y: 230, width: 600, height: 45, text: '{{job_title}}', fontFamily: 'Inter', fontSize: 24, letterSpacing: 2, fill: '#1E3A8A' }),
          ln({ x: 400, y: 300, width: 120, height: 0, stroke: '#1E3A8A', strokeWidth: 4 }),
          tx({ x: 400, y: 340, width: 600, height: 40, text: '{{phone}}', fontFamily: 'Inter', fontSize: 22, fill: '#334155' }),
          tx({ x: 400, y: 390, width: 600, height: 40, text: '{{email}}', fontFamily: 'Inter', fontSize: 22, fill: '#334155' }),
        ],
      },
    ],
  },

  // 6 ── Business card · creative coral
  {
    slug: 'business-card-creative',
    name: 'Creative Business Card',
    category: 'print',
    width: 1050,
    height: 600,
    accent: '#F97316',
    badge: 'new',
    fields: [
      { key: 'full_name', label: 'Full name', example: 'Frida Vega' },
      { key: 'role', label: 'Role', example: 'Illustrator & Muralist' },
      { key: 'handle', label: 'Social handle', example: '@fridadraws' },
      { key: 'website', label: 'Website', example: 'fridavega.art' },
    ],
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#FFF7ED' },
        elements: [
          sh('ellipse', { x: 770, y: -90, width: 400, height: 400, fill: '#FDBA74' }),
          sh('ellipse', { x: 830, y: 430, width: 340, height: 340, fill: '#FFEDD5' }),
          st('🎨', { x: 60, y: 60, width: 90, height: 90, fontSize: 64 }),
          tx({ x: 60, y: 190, width: 700, height: 80, text: '{{full_name}}', fontFamily: 'Caveat', bold: true, fontSize: 76, fill: '#7C2D12' }),
          tx({ x: 60, y: 290, width: 700, height: 45, text: '{{role}}', fontFamily: 'Poppins', fontSize: 28, fill: '#C2410C' }),
          ln({ x: 60, y: 360, width: 150, height: 0, stroke: '#F97316', strokeWidth: 5 }),
          tx({ x: 60, y: 400, width: 700, height: 40, text: '{{handle}}', fontFamily: 'Space Mono', fontSize: 24, fill: '#431407' }),
          tx({ x: 60, y: 450, width: 700, height: 40, text: '{{website}}', fontFamily: 'Space Mono', fontSize: 24, fill: '#431407' }),
        ],
      },
    ],
  },

  // 7 ── Business card · minimal mono
  {
    slug: 'business-card-minimal',
    name: 'Minimal Business Card',
    category: 'print',
    width: 1050,
    height: 600,
    accent: '#0F172A',
    badge: 'new',
    fields: [
      { key: 'full_name', label: 'Full name', example: 'Kenji Mori' },
      { key: 'title', label: 'Title', example: 'Product Designer' },
      { key: 'email', label: 'Email', example: 'kenji@studio.jp' },
      { key: 'phone', label: 'Phone', example: '+81 3 1234 5678' },
    ],
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#FAFAFA' },
        elements: [
          sh('rect', { x: 44, y: 44, width: 962, height: 512, cornerRadius: 0, fill: 'transparent', stroke: '#0F172A', strokeWidth: 2 }),
          tx({ x: 80, y: 180, width: 600, height: 70, text: '{{full_name}}', fontFamily: 'Inter', bold: true, fontSize: 48, letterSpacing: 1, fill: '#0F172A' }),
          tx({ x: 80, y: 270, width: 600, height: 40, text: '{{title}}', fontFamily: 'Inter', fontSize: 22, letterSpacing: 4, fill: '#64748B' }),
          ln({ x: 80, y: 380, width: 60, height: 0, stroke: '#0F172A', strokeWidth: 3 }),
          tx({ x: 80, y: 410, width: 600, height: 36, text: '{{email}}', fontFamily: 'DM Mono', fontSize: 20, fill: '#334155' }),
          tx({ x: 80, y: 452, width: 600, height: 36, text: '{{phone}}', fontFamily: 'DM Mono', fontSize: 20, fill: '#334155' }),
        ],
      },
    ],
  },

  // 8 ── Quote post · elegant serif (square)
  {
    slug: 'quote-post-elegant',
    name: 'Elegant Quote Post',
    category: 'social',
    width: 1080,
    height: 1080,
    accent: '#7C2D12',
    badge: 'new',
    fields: [
      { key: 'quote', label: 'Quote', example: 'Simplicity is the ultimate sophistication.' },
      { key: 'author', label: 'Author', example: 'Leonardo da Vinci' },
    ],
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#FAF5F0' },
        elements: [
          tx({ x: 465, y: 130, width: 150, height: 140, text: '“', fontFamily: 'Playfair Display', bold: true, fontSize: 160, fill: '#D6BFA8', align: 'center' }),
          tx({ x: 140, y: 320, width: 800, height: 400, text: '{{quote}}', fontFamily: 'Playfair Display', fontSize: 56, italic: true, fill: '#4A2E1A', align: 'center' }),
          ln({ x: 440, y: 790, width: 200, height: 0, stroke: '#B45309', strokeWidth: 3 }),
          tx({ x: 240, y: 830, width: 600, height: 50, text: '{{author}}', fontFamily: 'Inter', bold: true, fontSize: 26, letterSpacing: 5, fill: '#9A6B3F', align: 'center' }),
          sh('rect', { x: 0, y: 1060, width: 1080, height: 20, cornerRadius: 0, fill: '#B45309' }),
        ],
      },
    ],
  },

  // 9 ── Quote post · bold contrast (portrait)
  {
    slug: 'quote-post-bold',
    name: 'Bold Quote Post',
    category: 'social',
    width: 1080,
    height: 1350,
    accent: '#4338CA',
    badge: 'new',
    fields: [
      { key: 'quote', label: 'Quote', example: 'Make it work, make it right, make it fast.' },
      { key: 'author', label: 'Author', example: 'Kent Beck' },
      { key: 'handle', label: 'Your handle', example: '@buildinpublic' },
    ],
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#1E1B4B' },
        elements: [
          sh('rect', { x: 60, y: 60, width: 960, height: 1230, cornerRadius: 24, fill: 'transparent', stroke: '#818CF8', strokeWidth: 2 }),
          tx({ x: 140, y: 240, width: 800, height: 500, text: '{{quote}}', fontFamily: 'Space Grotesk', bold: true, fontSize: 72, fill: '#EEF2FF', align: 'left' }),
          ln({ x: 140, y: 830, width: 260, height: 0, stroke: '#F59E0B', strokeWidth: 6 }),
          tx({ x: 140, y: 870, width: 800, height: 60, text: '{{author}}', fontFamily: 'Space Grotesk', fontSize: 40, fill: '#A5B4FC' }),
          tx({ x: 140, y: 1120, width: 800, height: 45, text: '{{handle}}', fontFamily: 'Space Mono', fontSize: 28, fill: '#F59E0B' }),
        ],
      },
    ],
  },

  // 10 ── Event flyer · modern split
  {
    slug: 'event-flyer-modern',
    name: 'Modern Event Flyer',
    category: 'print',
    width: 1240,
    height: 1754,
    accent: '#6D28D9',
    badge: 'new',
    fields: [
      { key: 'event_name', label: 'Event name', example: 'DESIGN WEEK 26' },
      { key: 'date', label: 'Date', example: 'SAT 12 SEP · 18:00' },
      { key: 'venue', label: 'Venue', example: 'The Foundry, 21 Maker St' },
      { key: 'ticket_price', label: 'Ticket price', example: '$25' },
    ],
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#F5F3FF' },
        elements: [
          sh('rect', { x: 0, y: 0, width: 1240, height: 640, cornerRadius: 0, fill: '#6D28D9' }),
          gr('burst', { x: 880, y: 80, width: 280, height: 280, fill: '#F59E0B' }),
          tx({ x: 80, y: 200, width: 900, height: 90, text: 'you are invited to', fontFamily: 'Inter', fontSize: 30, letterSpacing: 6, fill: '#DDD6FE', align: 'center' }),
          tx({ x: 80, y: 270, width: 900, height: 200, text: '{{event_name}}', fontFamily: 'Archivo Black', fontSize: 110, fill: '#FFFFFF', align: 'center' }),
          tx({ x: 170, y: 740, width: 900, height: 60, text: '{{date}}', fontFamily: 'Space Grotesk', bold: true, fontSize: 44, fill: '#6D28D9', align: 'center' }),
          ln({ x: 470, y: 830, width: 300, height: 0, stroke: '#C4B5FD', strokeWidth: 4 }),
          tx({ x: 170, y: 870, width: 900, height: 50, text: '{{venue}}', fontFamily: 'Inter', fontSize: 32, fill: '#3B0764', align: 'center' }),
          sh('rect', { x: 420, y: 1180, width: 400, height: 110, cornerRadius: 55, fill: '#6D28D9' }),
          tx({ x: 420, y: 1212, width: 400, height: 50, text: 'TICKETS {{ticket_price}}', fontFamily: 'Space Grotesk', bold: true, fontSize: 30, letterSpacing: 2, fill: '#FFFFFF', align: 'center' }),
        ],
      },
    ],
  },

  // 11 ── Event story · festive
  {
    slug: 'event-story-festive',
    name: 'Festive Event Story',
    category: 'social',
    width: 1080,
    height: 1920,
    accent: '#DC2626',
    badge: 'new',
    fields: [
      { key: 'event_name', label: 'Event name', example: 'SUMMER BLOCK PARTY' },
      { key: 'date', label: 'Date', example: 'JULY 4 · 4 PM' },
      { key: 'location', label: 'Location', example: 'Riverside Park' },
    ],
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#450A0A' },
        elements: [
          st('🎉', { x: 100, y: 180, width: 120, height: 120, fontSize: 90 }),
          st('🎈', { x: 860, y: 320, width: 120, height: 120, fontSize: 90 }),
          st('🎊', { x: 140, y: 1500, width: 120, height: 120, fontSize: 90 }),
          tx({ x: 90, y: 600, width: 900, height: 260, text: '{{event_name}}', fontFamily: 'Titan One', fontSize: 104, fill: '#FCA5A5', align: 'center' }),
          ln({ x: 340, y: 920, width: 400, height: 0, stroke: '#F59E0B', strokeWidth: 6 }),
          tx({ x: 190, y: 980, width: 700, height: 80, text: '{{date}}', fontFamily: 'Poppins', bold: true, fontSize: 52, fill: '#FDE68A', align: 'center' }),
          tx({ x: 190, y: 1090, width: 700, height: 60, text: '{{location}}', fontFamily: 'Poppins', fontSize: 40, fill: '#FEE2E2', align: 'center' }),
          sh('rect', { x: 340, y: 1560, width: 400, height: 100, cornerRadius: 50, fill: '#DC2626' }),
          tx({ x: 340, y: 1588, width: 400, height: 50, text: 'JOIN US!', fontFamily: 'Poppins', bold: true, fontSize: 34, letterSpacing: 3, fill: '#FFFFFF', align: 'center' }),
        ],
      },
    ],
  },

  // 12 ── Invoice · clean business doc
  {
    slug: 'invoice-smart',
    name: 'Smart Invoice',
    category: 'print',
    width: 1240,
    height: 1754,
    accent: '#0F766E',
    badge: 'new',
    fields: [
      { key: 'invoice_no', label: 'Invoice number', example: 'INV-2026-042' },
      { key: 'client_name', label: 'Client name', example: 'Northwind Traders Inc.' },
      { key: 'due_date', label: 'Due date', example: '30 June 2026' },
      { key: 'amount', label: 'Amount due', example: '$ 2,400.00' },
    ],
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#FFFFFF' },
        elements: [
          sh('rect', { x: 0, y: 0, width: 1240, height: 24, cornerRadius: 0, fill: '#0F766E' }),
          tx({ x: 80, y: 100, width: 500, height: 80, text: 'INVOICE', fontFamily: 'Space Grotesk', bold: true, fontSize: 64, letterSpacing: 8, fill: '#0F172A' }),
          tx({ x: 80, y: 220, width: 500, height: 40, text: 'From: Your Studio Name', fontFamily: 'Inter', fontSize: 24, fill: '#64748B' }),
          sh('rect', { x: 780, y: 100, width: 380, height: 170, cornerRadius: 16, fill: '#F0FDFA' }),
          tx({ x: 810, y: 125, width: 320, height: 40, text: '{{invoice_no}}', fontFamily: 'Space Grotesk', bold: true, fontSize: 30, fill: '#134E4A' }),
          tx({ x: 810, y: 175, width: 320, height: 36, text: 'Due {{due_date}}', fontFamily: 'Inter', fontSize: 22, fill: '#0F766E' }),
          tx({ x: 810, y: 215, width: 320, height: 36, text: 'Billed to', fontFamily: 'Inter', fontSize: 18, letterSpacing: 2, fill: '#94A3B8' }),
          tx({ x: 80, y: 360, width: 700, height: 50, text: '{{client_name}}', fontFamily: 'Inter', bold: true, fontSize: 34, fill: '#0F172A' }),
          ln({ x: 80, y: 440, width: 1080, height: 0, stroke: '#E2E8F0', strokeWidth: 3 }),
          tx({ x: 80, y: 480, width: 700, height: 40, text: 'Description', fontFamily: 'Inter', bold: true, fontSize: 20, letterSpacing: 2, fill: '#94A3B8' }),
          tx({ x: 860, y: 480, width: 300, height: 40, text: 'Amount', fontFamily: 'Inter', bold: true, fontSize: 20, letterSpacing: 2, fill: '#94A3B8', align: 'right' }),
          ln({ x: 80, y: 530, width: 1080, height: 0, stroke: '#E2E8F0', strokeWidth: 1 }),
          tx({ x: 80, y: 560, width: 700, height: 40, text: 'Professional services — this billing period', fontFamily: 'Inter', fontSize: 24, fill: '#334155' }),
          sh('rect', { x: 700, y: 1350, width: 460, height: 130, cornerRadius: 20, fill: '#0F766E' }),
          tx({ x: 720, y: 1372, width: 200, height: 40, text: 'TOTAL DUE', fontFamily: 'Inter', bold: true, fontSize: 22, letterSpacing: 2, fill: '#99F6E4' }),
          tx({ x: 720, y: 1414, width: 420, height: 50, text: '{{amount}}', fontFamily: 'Space Grotesk', bold: true, fontSize: 40, fill: '#FFFFFF' }),
        ],
      },
    ],
  },
]
