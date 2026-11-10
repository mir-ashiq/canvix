import type { StickerPack } from './index'

// Arrows, pointers and attention marks.
const INK = '#2D2A32'
const SKIN = '#FFC24B'
const svg = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${inner}</svg>`

export const ARROWS_PACK: StickerPack = {
  id: 'arrows',
  name: 'Arrows & Marks',
  icon: '➡️',
  stickers: [
    {
      id: 'arrows-curve-right',
      name: 'Curved arrow',
      keywords: ['arrow', 'curve', 'right', 'point', 'direction'],
      svg: svg(
        `<path d="M16 92 Q16 40 72 40" fill="none" stroke="#FF6B6B" stroke-width="9" stroke-linecap="round"/>` +
          `<path d="M60 24 L88 40 L60 56 Z" fill="#FF6B6B" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`,
      ),
    },
    {
      id: 'arrows-curve-down',
      name: 'Curved arrow down',
      keywords: ['arrow', 'down', 'curve', 'below', 'direction'],
      svg: svg(
        `<path d="M24 20 Q88 20 88 70" fill="none" stroke="#4D96FF" stroke-width="9" stroke-linecap="round"/>` +
          `<path d="M72 60 L88 88 L104 60 Z" fill="#4D96FF" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`,
      ),
    },
    {
      id: 'arrows-hand-pointer',
      name: 'Hand pointer',
      keywords: ['hand', 'pointer', 'click', 'here', 'note'],
      svg: svg(
        // one closed silhouette: index finger up, three knuckles curled
        `<path d="M42 108 Q30 108 30 94 L30 62 Q30 52 40 52 Q46 52 47 58 L47 30 Q47 18 57 18 Q67 18 67 30 L67 52 Q68 46 75 46 Q82 46 83 53 L83 56 Q84 51 91 51 Q98 51 98 59 L98 64 Q99 60 105 61 Q112 62 112 71 L112 92 Q112 108 98 108 Z" fill="${SKIN}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M47 34 Q47 26 57 26" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" opacity="0.6"/>`,
      ),
    },
    {
      id: 'arrows-highlight',
      name: 'Highlight mark',
      keywords: ['highlight', 'marker', 'underline', 'important', 'note'],
      svg: svg(
        `<rect x="18" y="48" width="84" height="22" rx="6" fill="#FFD93D" stroke="${INK}" stroke-width="3"/>` +
          `<path d="M24 70 L20 84 L32 70 M52 70 L48 84 L60 70 M80 70 L76 84 L88 70" fill="#FFD93D" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`,
      ),
    },
    {
      id: 'arrows-circle-mark',
      name: 'Circle mark',
      keywords: ['circle', 'mark', 'focus', 'highlight', 'annotate'],
      svg: svg(
        // a bold ~330° ring with a clear overlap — the hand-drawn look
        `<path d="M78 18 Q104 28 102 58 Q100 88 70 98 Q38 108 22 82 Q8 58 22 34 Q34 12 62 14" fill="none" stroke="#FF6B6B" stroke-width="11" stroke-linecap="round"/>` +
          `<path d="M58 14 Q68 14 78 18" fill="none" stroke="#FF6B6B" stroke-width="11" stroke-linecap="round" opacity="0.55"/>`,
      ),
    },
    {
      id: 'arrows-check',
      name: 'Check burst',
      keywords: ['check', 'done', 'yes', 'correct', 'complete', 'ok'],
      svg: svg(
        `<path d="M60 8 L74 26 L96 22 L96 44 L114 60 L96 76 L96 98 L74 94 L60 112 L46 94 L24 98 L24 76 L6 60 L24 44 L24 22 L46 26 Z" fill="#6BCB77" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M40 60 L54 74 L82 44" fill="none" stroke="#FFFFFF" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`,
      ),
    },
    {
      id: 'arrows-cross',
      name: 'Cross mark',
      keywords: ['cross', 'no', 'wrong', 'error', 'cancel', 'fail'],
      svg: svg(
        `<circle cx="60" cy="60" r="46" fill="#FF6B6B" stroke="${INK}" stroke-width="3.5"/>` +
          `<path d="M42 42 L78 78 M78 42 L42 78" stroke="#FFFFFF" stroke-width="10" stroke-linecap="round"/>`,
      ),
    },
    {
      id: 'arrows-question',
      name: 'Question mark',
      keywords: ['question', 'help', 'faq', 'unknown', 'confused'],
      svg: svg(
        `<circle cx="60" cy="60" r="46" fill="#4D96FF" stroke="${INK}" stroke-width="3.5"/>` +
          `<text x="60" y="78" text-anchor="middle" font-family="Arial, sans-serif" font-size="52" font-weight="bold" fill="#FFFFFF">?</text>`,
      ),
    },
    {
      id: 'arrows-exclaim',
      name: 'Exclamation',
      keywords: ['exclamation', 'attention', 'alert', 'warning', 'important'],
      svg: svg(
        `<circle cx="60" cy="60" r="46" fill="#FF9F45" stroke="${INK}" stroke-width="3.5"/>` +
          `<rect x="52" y="28" width="16" height="42" rx="8" fill="#FFFFFF"/>` +
          `<circle cx="60" cy="86" r="9" fill="#FFFFFF"/>`,
      ),
    },
    {
      id: 'arrows-pin',
      name: 'Pin',
      keywords: ['pin', 'location', 'map', 'here', 'place', 'marker'],
      svg: svg(
        `<path d="M60 108 C 60 108 26 70 26 46 C 26 28 40 14 60 14 C 80 14 94 28 94 46 C 94 70 60 108 60 108 Z" fill="#FF6B6B" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<circle cx="60" cy="46" r="14" fill="#FFFFFF" stroke="${INK}" stroke-width="3"/>`,
      ),
    },
    {
      id: 'arrows-tag',
      name: 'Price tag',
      keywords: ['tag', 'price', 'label', 'sale', 'offer'],
      svg: svg(
        `<path d="M20 52 L52 20 L100 20 L100 68 L68 100 Q60 108 52 100 L20 68 Q12 60 20 52 Z" fill="#FFD93D" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<circle cx="84" cy="36" r="7" fill="#FFFFFF" stroke="${INK}" stroke-width="3"/>` +
          `<path d="M40 60 L56 44 M46 70 L62 54" stroke="${INK}" stroke-width="4" stroke-linecap="round" opacity="0.55"/>`,
      ),
    },
    {
      id: 'arrows-banner',
      name: 'Ribbon banner',
      keywords: ['banner', 'ribbon', 'label', 'title', 'header'],
      svg: svg(
        `<path d="M14 40 L34 52 L14 64 Z" fill="#B983FF" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
          `<path d="M106 40 L86 52 L106 64 Z" fill="#B983FF" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
          `<path d="M30 38 L90 38 L100 52 L90 66 L30 66 L20 52 Z" fill="#B983FF" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M42 46 L78 46 M42 58 L78 58" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" opacity="0.7"/>`,
      ),
    },
  ],
}
