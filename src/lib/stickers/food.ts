import type { StickerPack } from './index'

// Food & drink.
const INK = '#2D2A32'
const svg = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${inner}</svg>`

export const FOOD_PACK: StickerPack = {
  id: 'food',
  name: 'Food & Drink',
  icon: '🍕',
  stickers: [
    {
      id: 'food-coffee',
      name: 'Coffee cup',
      keywords: ['coffee', 'cup', 'morning', 'caffeine', 'espresso', 'cafe'],
      svg: svg(
        `<path d="M24 42 L88 42 L82 96 Q81 104 72 104 L40 104 Q31 104 30 96 Z" fill="#FFFFFF" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M84 50 Q106 52 102 68 Q98 84 78 82" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>` +
          `<path d="M36 54 L80 54 L76 90 Q75 96 68 96 L46 96 Q39 96 38 90 Z" fill="#8A5A3B"/>` +
          `<path d="M46 30 Q44 22 50 18 M62 30 Q60 22 66 18 M78 30 Q76 22 82 18" fill="none" stroke="#B983FF" stroke-width="3.5" stroke-linecap="round"/>`,
      ),
    },
    {
      id: 'food-pizza',
      name: 'Pizza slice',
      keywords: ['pizza', 'slice', 'italian', 'food', 'cheese'],
      svg: svg(
        `<path d="M60 12 L96 92 Q60 108 24 92 Z" fill="#FFD93D" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M60 12 L96 92 Q78 100 60 102 Z" fill="#FF9F45" opacity="0.5"/>` +
          `<path d="M30 88 L90 88" stroke="#FF6B6B" stroke-width="6" stroke-linecap="round"/>` +
          `<circle cx="52" cy="56" r="6" fill="#FF6B6B" stroke="${INK}" stroke-width="2"/>` +
          `<circle cx="68" cy="72" r="6" fill="#FF6B6B" stroke="${INK}" stroke-width="2"/>` +
          `<circle cx="48" cy="76" r="5" fill="#FF6B6B" stroke="${INK}" stroke-width="2"/>`,
      ),
    },
    {
      id: 'food-donut',
      name: 'Donut',
      keywords: ['donut', 'doughnut', 'sweet', 'dessert', 'sprinkles'],
      svg: svg(
        `<circle cx="60" cy="62" r="44" fill="#FFC24B" stroke="${INK}" stroke-width="3.5"/>` +
          `<path d="M60 18 Q88 18 100 44 Q106 62 96 80 Q84 100 60 102 Q32 100 22 76 Q14 56 26 38 Q38 18 60 18 Z" fill="#FF7BAC" opacity="0.85"/>` +
          `<circle cx="60" cy="62" r="15" fill="#FFFFFF" stroke="${INK}" stroke-width="3.5"/>` +
          `<g stroke-width="3" stroke-linecap="round">${[
            ['#FFFFFF', 36, 42], ['#4D96FF', 60, 30], ['#6BCB77', 84, 44],
            ['#FFD93D', 90, 70], ['#FFFFFF', 76, 92], ['#B983FF', 50, 96],
            ['#4D96FF', 30, 72], ['#FF6B6B', 32, 58],
          ].map(([c, x, y]) => `<path d="M${x} ${y} l8 -4" stroke="${c}"/>`).join('')}</g>`,
      ),
    },
    {
      id: 'food-burger',
      name: 'Burger',
      keywords: ['burger', 'hamburger', 'fast food', 'snack'],
      svg: svg(
        `<path d="M22 52 Q22 20 60 20 Q98 20 98 52 L22 52 Z" fill="#FFC24B" stroke="${INK}" stroke-width="3.5"/>` +
          `<path d="M22 52 L98 52 Q100 60 92 62 L28 62 Q20 60 22 52 Z" fill="#6BCB77" stroke="${INK}" stroke-width="3"/>` +
          `<path d="M26 62 L94 62 L90 74 L30 74 Z" fill="#FF6B6B" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
          `<path d="M28 74 L92 74 Q98 76 98 84 Q98 96 86 96 L34 96 Q22 96 22 84 Q22 76 28 74 Z" fill="#FFC24B" stroke="${INK}" stroke-width="3.5"/>` +
          `<circle cx="44" cy="34" r="2.5" fill="#FF9F45"/><circle cx="62" cy="30" r="2.5" fill="#FF9F45"/><circle cx="78" cy="36" r="2.5" fill="#FF9F45"/>`,
      ),
    },
    {
      id: 'food-avocado',
      name: 'Avocado',
      keywords: ['avocado', 'green', 'healthy', 'toast', 'guacamole'],
      svg: svg(
        `<path d="M60 14 C 80 14 94 34 94 58 C 94 84 78 106 60 106 C 42 106 26 84 26 58 C 26 34 40 14 60 14 Z" fill="#6BCB77" stroke="${INK}" stroke-width="3.5"/>` +
          `<path d="M60 28 C 74 28 82 42 82 58 C 82 76 71 92 60 92 C 49 92 38 76 38 58 C 38 42 46 28 60 28 Z" fill="#FFD93D"/>` +
          `<ellipse cx="60" cy="62" rx="14" ry="18" fill="#8A5A3B" stroke="${INK}" stroke-width="3"/>`,
      ),
    },
    {
      id: 'food-strawberry',
      name: 'Strawberry',
      keywords: ['strawberry', 'berry', 'fruit', 'red', 'summer'],
      svg: svg(
        `<path d="M60 34 C 78 34 94 46 94 66 C 94 88 74 104 60 104 C 46 104 26 88 26 66 C 26 46 42 34 60 34 Z" fill="#FF6B6B" stroke="${INK}" stroke-width="3.5"/>` +
          `<g stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" opacity="0.85">${[
            'M46 56 l0 7 M42 59 l8 0', 'M68 56 l0 7 M64 59 l8 0', 'M56 78 l0 7 M52 81 l8 0',
            'M78 72 l0 6 M75 75 l6 0', 'M38 74 l0 6 M35 77 l6 0',
          ].map((d) => `<path d="${d}"/>`).join('')}</g>` +
          `<path d="M38 34 Q60 18 82 34 Q70 44 60 42 Q50 44 38 34 Z" fill="#6BCB77" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
          `<path d="M60 34 L60 14 M60 20 Q52 12 46 16 M60 20 Q68 12 74 16" fill="none" stroke="#6BCB77" stroke-width="3.5" stroke-linecap="round"/>`,
      ),
    },
    {
      id: 'food-boba',
      name: 'Boba tea',
      keywords: ['boba', 'bubble tea', 'milk tea', 'drink', 'tapioca'],
      svg: svg(
        `<path d="M32 40 L88 40 L80 104 Q79 110 72 110 L48 110 Q41 110 40 104 Z" fill="#D9C7A7" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M34 56 L86 56 L80 104 Q79 110 72 110 L48 110 Q41 110 40 104 Z" fill="#B983FF" opacity="0.55"/>` +
          `<circle cx="50" cy="98" r="6" fill="#2D2A32"/><circle cx="66" cy="102" r="6" fill="#2D2A32"/><circle cx="58" cy="90" r="6" fill="#2D2A32"/>` +
          `<path d="M64 36 L86 8 M72 36 L94 12" stroke="#FF6B6B" stroke-width="7" stroke-linecap="round"/>` +
          `<path d="M30 40 L90 40 L89 48 L31 48 Z" fill="#FFFFFF" stroke="${INK}" stroke-width="3"/>`,
      ),
    },
    {
      id: 'food-icecream',
      name: 'Ice cream',
      keywords: ['ice cream', 'cone', 'summer', 'dessert', 'sweet'],
      svg: svg(
        `<circle cx="44" cy="42" r="20" fill="#FF7BAC" stroke="${INK}" stroke-width="3.5"/>` +
          `<circle cx="76" cy="42" r="20" fill="#FFFFFF" stroke="${INK}" stroke-width="3.5"/>` +
          `<circle cx="60" cy="28" r="20" fill="#FFC24B" stroke="${INK}" stroke-width="3.5"/>` +
          `<circle cx="60" cy="14" r="5" fill="#FF6B6B" stroke="${INK}" stroke-width="2.5"/>` +
          `<path d="M36 58 L60 112 L84 58 Z" fill="#FFC24B" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M44 66 L64 96 M52 62 L72 92 M60 60 L78 88" stroke="#FF9F45" stroke-width="2.5" opacity="0.7"/>`,
      ),
    },
    {
      id: 'food-cupcake',
      name: 'Cupcake',
      keywords: ['cupcake', 'dessert', 'sweet', 'bakery', 'birthday'],
      svg: svg(
        `<path d="M30 58 Q30 30 60 30 Q90 30 90 58 Z" fill="#FF7BAC" stroke="${INK}" stroke-width="3.5"/>` +
          `<path d="M40 58 Q36 42 48 40 Q54 30 62 38 Q72 30 74 44 Q84 46 80 58 Z" fill="#FFFFFF" opacity="0.5"/>` +
          `<circle cx="60" cy="24" r="6" fill="#FF6B6B" stroke="${INK}" stroke-width="2.5"/>` +
          `<path d="M30 58 L90 58 L84 106 Q83 112 76 112 L44 112 Q37 112 36 106 Z" fill="#FFD93D" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M42 58 L46 112 M60 58 L60 112 M78 58 L74 112" stroke="#FF9F45" stroke-width="3" opacity="0.7"/>`,
      ),
    },
    {
      id: 'food-sushi',
      name: 'Sushi roll',
      keywords: ['sushi', 'japanese', 'maki', 'food', 'rice'],
      svg: svg(
        `<circle cx="60" cy="62" r="44" fill="#2D2A32"/>` +
          `<circle cx="60" cy="62" r="36" fill="#FFFFFF"/>` +
          `<circle cx="60" cy="62" r="22" fill="#FF9F45"/>` +
          `<circle cx="60" cy="62" r="12" fill="#FF6B6B" stroke="#2D2A32" stroke-width="2"/>` +
          `<g stroke="#2D2A32" stroke-width="2.5"><path d="M52 34 l4 8 M68 36 l-2 8 M38 48 l8 4 M84 52 l-8 4 M36 70 l8 -2 M40 86 l6 -6 M80 84 l-5 -6 M86 68 l-8 1"/></g>`,
      ),
    },
    {
      id: 'food-taco',
      name: 'Taco',
      keywords: ['taco', 'mexican', 'food', 'snack'],
      svg: svg(
        `<path d="M16 76 Q16 34 60 34 Q104 34 104 76 Q104 86 94 84 Q60 74 26 84 Q16 86 16 76 Z" fill="#FFC24B" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M24 72 Q24 44 60 44 Q96 44 96 72 Q60 64 24 72 Z" fill="#6BCB77" stroke="${INK}" stroke-width="3"/>` +
          `<circle cx="44" cy="56" r="6" fill="#FF6B6B" stroke="${INK}" stroke-width="2"/>` +
          `<circle cx="64" cy="52" r="6" fill="#FF6B6B" stroke="${INK}" stroke-width="2"/>` +
          `<circle cx="80" cy="58" r="5" fill="#FF6B6B" stroke="${INK}" stroke-width="2"/>` +
          `<path d="M22 80 L26 92 M40 82 L42 94 M60 82 L60 96 M80 82 L78 94 M98 80 L94 92" stroke="#FF9F45" stroke-width="3" stroke-linecap="round" opacity="0.8"/>`,
      ),
    },
    {
      id: 'food-lemon',
      name: 'Lemon',
      keywords: ['lemon', 'citrus', 'fruit', 'yellow', 'fresh'],
      svg: svg(
        `<ellipse cx="60" cy="64" rx="42" ry="34" fill="#FFD93D" stroke="${INK}" stroke-width="3.5" transform="rotate(-18 60 64)"/>` +
          `<ellipse cx="60" cy="64" rx="30" ry="22" fill="none" stroke="#FF9F45" stroke-width="3" transform="rotate(-18 60 64)"/>` +
          `<path d="M96 40 L106 30 M100 46 L112 42" stroke="#6BCB77" stroke-width="4" stroke-linecap="round"/>` +
          `<ellipse cx="46" cy="52" rx="8" ry="5" fill="#FFFFFF" opacity="0.45" transform="rotate(-25 46 52)"/>`,
      ),
    },
  ],
}
