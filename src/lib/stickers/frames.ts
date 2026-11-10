import type { StickerPack } from './index'

// Frames, badges and labels — the "sticker with a word on it" set.
const INK = '#2D2A32'
const svg = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${inner}</svg>`
const F = 'font-family="Arial, sans-serif" font-weight="bold"'

export const FRAMES_PACK: StickerPack = {
  id: 'frames',
  name: 'Frames & Badges',
  icon: '🏅',
  stickers: [
    {
      id: 'frames-new',
      name: 'NEW burst',
      keywords: ['new', 'burst', 'label', 'launch', 'fresh'],
      svg: svg(
        `<path d="M60 6 L74 22 L96 16 L98 38 L116 48 L102 62 L114 80 L92 84 L90 106 L70 98 L56 112 L46 94 L24 98 L28 76 L10 64 L26 50 L20 28 L42 30 Z" fill="#FF6B6B" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<text x="60" y="68" text-anchor="middle" ${F} font-size="26" fill="#FFFFFF">NEW</text>`,
      ),
    },
    {
      id: 'frames-sale',
      name: 'SALE tag',
      keywords: ['sale', 'discount', 'tag', 'offer', 'deal', 'promo'],
      svg: svg(
        `<path d="M58 12 L108 12 L108 62 Q108 70 100 70 L34 70 Q24 70 18 62 L12 54 L58 12 Z" fill="#FF6B6B" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round" transform="rotate(8 60 40)"/>` +
          `<circle cx="94" cy="28" r="6" fill="#FFFFFF" stroke="${INK}" stroke-width="2.5" transform="rotate(8 60 40)"/>` +
          `<text x="62" y="52" text-anchor="middle" ${F} font-size="26" fill="#FFFFFF" transform="rotate(8 60 40)">SALE</text>`,
      ),
    },
    {
      id: 'frames-hot',
      name: 'HOT badge',
      keywords: ['hot', 'flame', 'trending', 'popular', 'badge'],
      svg: svg(
        `<circle cx="60" cy="66" r="42" fill="#FF9F45" stroke="${INK}" stroke-width="3.5"/>` +
          `<path d="M60 22 C 66 34 78 38 76 52 C 84 46 86 40 84 34 C 94 44 96 60 88 72 C 80 84 68 90 60 90 C 48 90 38 82 36 70 C 34 60 40 54 46 48 C 44 56 48 60 52 60 C 46 44 54 32 60 22 Z" fill="#FF6B6B" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
          `<text x="60" y="102" text-anchor="middle" ${F} font-size="14" fill="#FFFFFF">HOT!</text>`,
      ),
    },
    {
      id: 'frames-star-badge',
      name: 'Star badge',
      keywords: ['badge', 'star', 'award', 'premium', 'quality'],
      svg: svg(
        `<path d="M60 8 L78 26 L104 24 L102 50 L118 66 L102 82 L104 108 L78 106 L60 116 L42 106 L16 108 L18 82 L2 66 L18 50 L16 24 L42 26 Z" fill="#FFD93D" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<text x="60" y="72" text-anchor="middle" ${F} font-size="20" fill="#2D2A32">TOP</text>`,
      ),
    },
    {
      id: 'frames-laurel',
      name: 'Laurel wreath',
      keywords: ['laurel', 'wreath', 'award', 'winner', 'classic'],
      svg: svg(
        `<g fill="#6BCB77" stroke="${INK}" stroke-width="2.5">${[
          'M34 100 Q16 84 18 56 Q20 34 34 22 Q28 44 32 62 Q34 80 44 92 Z',
          'M86 100 Q104 84 102 56 Q100 34 86 22 Q92 44 88 62 Q86 80 76 92 Z',
          'M28 58 q-8 -4 -8 -12 q8 2 10 10 z', 'M92 58 q8 -4 8 -12 q-8 2 -10 10 z',
          'M32 78 q-9 -2 -11 -10 q9 0 12 8 z', 'M88 78 q9 -2 11 -10 q-9 0 -12 8 z',
        ].map((d) => `<path d="${d}"/>`).join('')}</g>` +
          `<text x="60" y="66" text-anchor="middle" ${F} font-size="22" fill="#2D2A32">Nº1</text>`,
      ),
    },
    {
      id: 'frames-scalloped',
      name: 'Scalloped frame',
      keywords: ['frame', 'scallop', 'circle', 'decorative', 'border'],
      svg: svg(
        `<g fill="#FF7BAC" stroke="${INK}" stroke-width="3">${Array.from({ length: 12 }, (_, i) => {
          const a = (Math.PI / 6) * i - Math.PI / 2
          const cx = 60 + 38 * Math.cos(a)
          const cy = 60 + 38 * Math.sin(a)
          return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="13"/>`
        }).join('')}</g>` +
          `<circle cx="60" cy="60" r="36" fill="#FFFFFF" opacity="0.3"/>`,
      ),
    },
    {
      id: 'frames-dashed-circle',
      name: 'Dashed circle frame',
      keywords: ['circle', 'dashed', 'frame', 'outline', 'minimal'],
      svg: svg(
        `<circle cx="60" cy="60" r="48" fill="none" stroke="#4D96FF" stroke-width="9" stroke-dasharray="14 9"/>` +
          `<circle cx="60" cy="60" r="30" fill="none" stroke="#FFD93D" stroke-width="5" stroke-dasharray="6 8"/>`,
      ),
    },
    {
      id: 'frames-quote',
      name: 'Quote marks',
      keywords: ['quote', 'quotation', 'testimonial', 'review', 'cite'],
      svg: svg(
        `<path d="M28 72 Q22 44 44 28 L52 38 Q38 48 38 62 L50 62 L50 84 L28 84 Z" fill="#4D96FF" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
          `<path d="M70 72 Q64 44 86 28 L94 38 Q80 48 80 62 L92 62 L92 84 L70 84 Z" fill="#4D96FF" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`,
      ),
    },
    {
      id: 'frames-label-blank',
      name: 'Blank label',
      keywords: ['label', 'blank', 'name', 'tag', 'write'],
      svg: svg(
        `<path d="M14 44 L44 44 L60 26 L76 44 L106 44 L106 78 L76 78 L60 96 L44 78 L14 78 Z" fill="#FFFFFF" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M28 56 L64 56 M28 66 L56 66" stroke="#B983FF" stroke-width="4" stroke-linecap="round"/>`,
      ),
    },
    {
      id: 'frames-verified',
      name: 'Verified badge',
      keywords: ['verified', 'check', 'trust', 'official', 'badge'],
      svg: svg(
        `<path d="M60 8 L76 20 L96 16 L100 36 L116 46 L106 64 L112 84 L92 88 L80 104 L60 96 L40 104 L28 88 L8 84 L14 64 L4 46 L20 36 L24 16 L44 20 Z" fill="#4D96FF" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M40 60 L54 74 L82 46" fill="none" stroke="#FFFFFF" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`,
      ),
    },
  ],
}
