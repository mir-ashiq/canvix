import type { StickerPack } from './index'

// Business & productivity accents.
const INK = '#2D2A32'
const svg = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${inner}</svg>`

export const BUSINESS_PACK: StickerPack = {
  id: 'business',
  name: 'Business',
  icon: '💼',
  stickers: [
    {
      id: 'business-chart-up',
      name: 'Growth chart',
      keywords: ['growth', 'chart', 'up', 'sales', 'analytics', 'progress'],
      svg: svg(
        `<rect x="16" y="16" width="88" height="88" rx="10" fill="#FFFFFF" stroke="${INK}" stroke-width="3.5"/>` +
          `<path d="M28 88 L48 66 L62 76 L92 40" fill="none" stroke="#6BCB77" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` +
          `<path d="M78 40 L92 40 L92 54" fill="none" stroke="#6BCB77" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` +
          `<circle cx="48" cy="66" r="4" fill="#6BCB77" stroke="${INK}" stroke-width="2"/>` +
          `<circle cx="62" cy="76" r="4" fill="#6BCB77" stroke="${INK}" stroke-width="2"/>` +
          `<circle cx="92" cy="40" r="4" fill="#6BCB77" stroke="${INK}" stroke-width="2"/>`,
      ),
    },
    {
      id: 'business-bars',
      name: 'Bar chart',
      keywords: ['bars', 'chart', 'data', 'stats', 'report'],
      svg: svg(
        `<rect x="16" y="16" width="88" height="88" rx="10" fill="#FFFFFF" stroke="${INK}" stroke-width="3.5"/>` +
          `<rect x="30" y="66" width="14" height="26" rx="3" fill="#4D96FF" stroke="${INK}" stroke-width="2.5"/>` +
          `<rect x="52" y="50" width="14" height="42" rx="3" fill="#4D96FF" stroke="${INK}" stroke-width="2.5"/>` +
          `<rect x="74" y="34" width="14" height="58" rx="3" fill="#6BCB77" stroke="${INK}" stroke-width="2.5"/>`,
      ),
    },
    {
      id: 'business-target',
      name: 'Target hit',
      keywords: ['target', 'goal', 'aim', 'success', 'dart'],
      svg: svg(
        `<circle cx="56" cy="64" r="42" fill="#FF6B6B" stroke="${INK}" stroke-width="3.5"/>` +
          `<circle cx="56" cy="64" r="28" fill="#FFFFFF" stroke="${INK}" stroke-width="3"/>` +
          `<circle cx="56" cy="64" r="14" fill="#FF6B6B" stroke="${INK}" stroke-width="3"/>` +
          `<path d="M56 64 L100 20" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>` +
          `<path d="M92 20 L102 18 L100 28" fill="none" stroke="#FFD93D" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
      ),
    },
    {
      id: 'business-rocket',
      name: 'Rocket launch',
      keywords: ['rocket', 'launch', 'startup', 'growth', 'ship'],
      svg: svg(
        `<path d="M60 10 C 74 24 80 44 80 64 L40 64 C 40 44 46 24 60 10 Z" fill="#FFFFFF" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<circle cx="60" cy="42" r="10" fill="#4D96FF" stroke="${INK}" stroke-width="3"/>` +
          `<path d="M40 58 L26 82 L42 76 Z" fill="#FF6B6B" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
          `<path d="M80 58 L94 82 L78 76 Z" fill="#FF6B6B" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
          `<path d="M52 64 L52 78 L60 92 L68 78 L68 64 Z" fill="#FFD93D" stroke="#FF9F45" stroke-width="3" stroke-linejoin="round"/>` +
          `<path d="M56 92 L60 106 L64 92" fill="#FF9F45" stroke="#FF9F45" stroke-width="2" stroke-linejoin="round"/>`,
      ),
    },
    {
      id: 'business-bulb',
      name: 'Idea lightbulb',
      keywords: ['idea', 'bulb', 'light', 'inspiration', 'think'],
      svg: svg(
        `<circle cx="60" cy="50" r="32" fill="#FFD93D" stroke="${INK}" stroke-width="3.5"/>` +
          `<path d="M46 74 L46 86 Q46 92 52 92 L68 92 Q74 92 74 86 L74 74" fill="#FFD93D" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<rect x="48" y="92" width="24" height="8" rx="3" fill="#B983FF" stroke="${INK}" stroke-width="3"/>` +
          `<rect x="51" y="102" width="18" height="6" rx="3" fill="#B983FF" stroke="${INK}" stroke-width="2.5"/>` +
          `<path d="M60 34 L60 54 M52 44 L68 44" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>` +
          `<path d="M28 28 L34 32 M92 28 L86 32 M22 54 L30 54 M98 54 L90 54" stroke="#FF9F45" stroke-width="3.5" stroke-linecap="round"/>`,
      ),
    },
    {
      id: 'business-briefcase',
      name: 'Briefcase',
      keywords: ['briefcase', 'work', 'job', 'office', 'business'],
      svg: svg(
        `<rect x="14" y="38" width="92" height="56" rx="10" fill="#B983FF" stroke="${INK}" stroke-width="3.5"/>` +
          `<path d="M44 38 L44 28 Q44 22 50 22 L70 22 Q76 22 76 28 L76 38" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>` +
          `<rect x="14" y="56" width="92" height="12" fill="#FFFFFF" opacity="0.25"/>` +
          `<rect x="52" y="54" width="16" height="14" rx="3" fill="#FFD93D" stroke="${INK}" stroke-width="3"/>`,
      ),
    },
    {
      id: 'business-handshake',
      name: 'Handshake',
      keywords: ['handshake', 'deal', 'partnership', 'agree', 'contract'],
      svg: svg(
        `<rect x="10" y="52" width="24" height="18" rx="6" fill="#4D96FF" stroke="${INK}" stroke-width="3"/>` +
          `<rect x="86" y="52" width="24" height="18" rx="6" fill="#4D96FF" stroke="${INK}" stroke-width="3"/>` +
          `<path d="M30 56 L48 44 L64 52 L80 44 L90 56 L76 72 L64 62 L52 72 Z" fill="#FFC24B" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M48 44 L56 54 M64 52 L58 60" stroke="${INK}" stroke-width="2.5" stroke-linecap="round" opacity="0.5"/>`,
      ),
    },
    {
      id: 'business-search',
      name: 'Search',
      keywords: ['search', 'find', 'magnifier', 'research', 'seo'],
      svg: svg(
        `<circle cx="52" cy="50" r="30" fill="#FFFFFF" stroke="#4D96FF" stroke-width="8"/>` +
          `<circle cx="52" cy="50" r="30" fill="none" stroke="${INK}" stroke-width="3.5"/>` +
          `<path d="M74 72 L100 98" stroke="#4D96FF" stroke-width="14" stroke-linecap="round"/>` +
          `<path d="M74 72 L100 98" stroke="${INK}" stroke-width="4" opacity="0.35" stroke-linecap="round"/>` +
          `<path d="M40 38 Q46 32 54 34" stroke="#4D96FF" stroke-width="4" stroke-linecap="round" fill="none"/>`,
      ),
    },
    {
      id: 'business-calendar',
      name: 'Calendar check',
      keywords: ['calendar', 'date', 'schedule', 'event', 'plan'],
      svg: svg(
        `<rect x="18" y="24" width="84" height="78" rx="10" fill="#FFFFFF" stroke="${INK}" stroke-width="3.5"/>` +
          `<rect x="18" y="24" width="84" height="20" rx="10" fill="#4D96FF" stroke="${INK}" stroke-width="3.5"/>` +
          `<rect x="34" y="14" width="8" height="18" rx="4" fill="${INK}"/>` +
          `<rect x="78" y="14" width="8" height="18" rx="4" fill="${INK}"/>` +
          `<path d="M38 62 L54 78 L84 48" fill="none" stroke="#6BCB77" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
      ),
    },
    {
      id: 'business-money',
      name: 'Money bag',
      keywords: ['money', 'cash', 'bag', 'profit', 'revenue', 'funding'],
      svg: svg(
        `<path d="M44 30 L76 30 L84 44 Q104 74 88 92 Q74 106 60 106 Q46 106 32 92 Q16 74 36 44 Z" fill="#6BCB77" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M46 30 Q60 22 74 30" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>` +
          `<text x="60" y="80" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" font-weight="bold" fill="#FFFFFF">$</text>`,
      ),
    },
    {
      id: 'business-coins',
      name: 'Coin stack',
      keywords: ['coins', 'money', 'savings', 'stack', 'funding'],
      svg: svg(
        `<ellipse cx="60" cy="88" rx="34" ry="12" fill="#FFD93D" stroke="${INK}" stroke-width="3"/>` +
          `<ellipse cx="60" cy="72" rx="34" ry="12" fill="#FFD93D" stroke="${INK}" stroke-width="3"/>` +
          `<ellipse cx="60" cy="56" rx="34" ry="12" fill="#FFD93D" stroke="${INK}" stroke-width="3"/>` +
          `<ellipse cx="60" cy="40" rx="34" ry="12" fill="#FFD93D" stroke="${INK}" stroke-width="3"/>` +
          `<text x="60" y="45" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="bold" fill="#B8860B">$</text>`,
      ),
    },
    {
      id: 'business-medal',
      name: 'Award medal',
      keywords: ['medal', 'award', 'winner', 'first', 'prize', 'quality'],
      svg: svg(
        `<path d="M40 12 L56 48 L44 54 L28 18 Z" fill="#4D96FF" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
          `<path d="M80 12 L64 48 L76 54 L92 18 Z" fill="#4D96FF" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
          `<circle cx="60" cy="76" r="28" fill="#FFD93D" stroke="${INK}" stroke-width="3.5"/>` +
          `<circle cx="60" cy="76" r="19" fill="none" stroke="#FF9F45" stroke-width="3"/>` +
          `<text x="60" y="83" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="bold" fill="#B8860B">1</text>`,
      ),
    },
  ],
}
