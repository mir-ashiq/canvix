import type { StickerPack } from './index'

// Nature — sun, sky, plants, weather.
const INK = '#2D2A32'
const svg = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${inner}</svg>`

export const NATURE_PACK: StickerPack = {
  id: 'nature',
  name: 'Nature',
  icon: '🌿',
  stickers: [
    {
      id: 'nature-sun',
      name: 'Sun',
      keywords: ['sun', 'sunny', 'summer', 'weather', 'bright'],
      svg: svg(
        `<g>${Array.from({ length: 8 }, (_, i) => {
          const a = (Math.PI / 4) * i
          const x1 = 60 + 52 * Math.cos(a)
          const y1 = 60 + 52 * Math.sin(a)
          const x2 = 60 + 64 * Math.cos(a)
          const y2 = 60 + 64 * Math.sin(a)
          return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="#FF9F45" stroke-width="6" stroke-linecap="round"/>`
        }).join('')}</g>` +
          `<circle cx="60" cy="60" r="40" fill="#FFD93D" stroke="${INK}" stroke-width="3.5"/>` +
          `<circle cx="48" cy="48" r="10" fill="#FFFFFF" opacity="0.35"/>`,
      ),
    },
    {
      id: 'nature-rainbow',
      name: 'Rainbow',
      keywords: ['rainbow', 'colorful', 'sky', 'pride', 'happy'],
      svg: svg(
        `<path d="M12 92 A48 48 0 0 1 108 92" fill="none" stroke="#FF6B6B" stroke-width="10" stroke-linecap="round"/>` +
          `<path d="M24 92 A36 36 0 0 1 96 92" fill="none" stroke="#FF9F45" stroke-width="10" stroke-linecap="round"/>` +
          `<path d="M36 92 A24 24 0 0 1 84 92" fill="none" stroke="#FFD93D" stroke-width="10" stroke-linecap="round"/>` +
          `<path d="M48 92 A12 12 0 0 1 72 92" fill="none" stroke="#6BCB77" stroke-width="10" stroke-linecap="round"/>` +
          `<path d="M10 92 L110 92" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>`,
      ),
    },
    {
      id: 'nature-cloud',
      name: 'Cloud',
      keywords: ['cloud', 'sky', 'weather', 'soft', 'day'],
      svg: svg(
        `<path d="M30 82 Q14 82 14 68 Q14 56 26 54 Q26 36 44 36 Q52 24 68 28 Q84 30 86 46 Q102 46 104 62 Q105 78 88 80 Z" fill="#FFFFFF" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M36 90 Q40 100 34 106 M54 90 Q58 100 52 106 M72 90 Q76 100 70 106" fill="none" stroke="#4D96FF" stroke-width="4" stroke-linecap="round"/>`,
      ),
    },
    {
      id: 'nature-flower',
      name: 'Flower',
      keywords: ['flower', 'bloom', 'spring', 'daisy', 'plant'],
      svg: svg(
        `<g>${Array.from({ length: 6 }, (_, i) => {
          const a = (Math.PI / 3) * i
          const cx = 60 + 26 * Math.cos(a)
          const cy = 56 + 26 * Math.sin(a)
          return `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="15" ry="20" transform="rotate(${((a * 180) / Math.PI + 90).toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})" fill="#FF7BAC" stroke="${INK}" stroke-width="3"/>`
        }).join('')}</g>` +
          `<circle cx="60" cy="56" r="13" fill="#FFD93D" stroke="${INK}" stroke-width="3"/>` +
          `<path d="M60 78 L60 108 M60 90 Q76 86 78 74 M60 98 Q46 94 44 82" fill="none" stroke="#6BCB77" stroke-width="4.5" stroke-linecap="round"/>`,
      ),
    },
    {
      id: 'nature-tulip',
      name: 'Tulip',
      keywords: ['tulip', 'flower', 'spring', 'love', 'bloom'],
      svg: svg(
        `<path d="M38 44 Q38 20 52 20 Q58 20 60 28 Q62 20 68 20 Q82 20 82 44 Q82 60 60 62 Q38 60 38 44 Z" fill="#FF6B6B" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M60 62 L60 104" stroke="#6BCB77" stroke-width="5" stroke-linecap="round"/>` +
          `<path d="M60 80 Q42 78 38 62 Q54 62 60 74 Z" fill="#6BCB77" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
          `<path d="M60 88 Q78 86 82 70 Q66 70 60 82 Z" fill="#6BCB77" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`,
      ),
    },
    {
      id: 'nature-leaf',
      name: 'Leaf',
      keywords: ['leaf', 'green', 'eco', 'nature', 'plant'],
      svg: svg(
        `<path d="M22 98 Q18 48 60 22 Q102 48 98 98 Q60 112 22 98 Z" fill="#6BCB77" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M60 30 L60 102 M60 52 Q46 48 40 38 M60 52 Q74 48 80 38 M60 72 Q46 68 40 58 M60 72 Q74 68 80 58 M60 90 Q48 86 42 78 M60 90 Q72 86 78 78" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round" opacity="0.5"/>`,
      ),
    },
    {
      id: 'nature-tree',
      name: 'Tree',
      keywords: ['tree', 'forest', 'wood', 'park', 'plant'],
      svg: svg(
        `<rect x="52" y="66" width="16" height="38" rx="4" fill="#B983FF" stroke="${INK}" stroke-width="3"/>` +
          `<circle cx="60" cy="44" r="30" fill="#6BCB77" stroke="${INK}" stroke-width="3.5"/>` +
          `<circle cx="36" cy="58" r="18" fill="#6BCB77" stroke="${INK}" stroke-width="3.5"/>` +
          `<circle cx="84" cy="58" r="18" fill="#6BCB77" stroke="${INK}" stroke-width="3.5"/>` +
          `<ellipse cx="48" cy="34" rx="9" ry="6" fill="#FFFFFF" opacity="0.35" transform="rotate(-25 48 34)"/>`,
      ),
    },
    {
      id: 'nature-cactus',
      name: 'Cactus',
      keywords: ['cactus', 'desert', 'plant', 'succulent', 'mexico'],
      svg: svg(
        `<rect x="48" y="30" width="24" height="72" rx="12" fill="#6BCB77" stroke="${INK}" stroke-width="3.5"/>` +
          `<path d="M48 60 Q30 60 30 44 Q30 34 40 34 Q48 34 48 46 Z" fill="#6BCB77" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M72 70 Q90 70 90 54 Q90 44 80 44 Q72 44 72 56 Z" fill="#6BCB77" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M56 44 L56 50 M64 56 L64 62 M56 72 L56 78" stroke="${INK}" stroke-width="2.5" stroke-linecap="round" opacity="0.5"/>` +
          `<path d="M28 104 L92 104" stroke="#FF9F45" stroke-width="5" stroke-linecap="round"/>`,
      ),
    },
    {
      id: 'nature-moon',
      name: 'Crescent moon',
      keywords: ['moon', 'night', 'sleep', 'crescent', 'dark'],
      svg: svg(
        `<path d="M74 12 C 46 18 30 42 30 66 C 30 90 46 108 74 112 C 56 100 46 84 46 64 C 46 44 56 26 74 12 Z" fill="#FFD93D" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<circle cx="88" cy="34" r="3.5" fill="#FFFFFF"/>` +
          `<circle cx="98" cy="66" r="2.5" fill="#FFFFFF"/>` +
          `<circle cx="84" cy="94" r="3" fill="#FFFFFF"/>`,
      ),
    },
    {
      id: 'nature-snowflake',
      name: 'Snowflake',
      keywords: ['snow', 'snowflake', 'winter', 'cold', 'ice'],
      svg: svg(
        `<g stroke="#4D96FF" stroke-width="7" stroke-linecap="round">${Array.from({ length: 3 }, (_, i) => {
          const a = (Math.PI / 3) * i
          const x1 = 60 - 44 * Math.cos(a)
          const y1 = 60 - 44 * Math.sin(a)
          const x2 = 60 + 44 * Math.cos(a)
          const y2 = 60 + 44 * Math.sin(a)
          return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}"/>`
        }).join('')}</g>` +
          `<g stroke="#4D96FF" stroke-width="5" stroke-linecap="round" fill="none">${[
            'M38 38 L28 28 M38 38 L26 42 M82 82 L92 92 M82 82 L94 78',
            'M82 38 L92 28 M82 38 L94 42 M38 82 L28 92 M38 82 L26 78',
            'M60 16 L52 8 M60 16 L68 8 M60 104 L52 112 M60 104 L68 112',
          ].map((d) => `<path d="${d}"/>`).join('')}</g>` +
          `<circle cx="60" cy="60" r="8" fill="#4D96FF"/>`,
      ),
    },
    {
      id: 'nature-drop',
      name: 'Water drop',
      keywords: ['drop', 'water', 'rain', 'blue', 'hydrate'],
      svg: svg(
        `<path d="M60 12 C 60 12 26 56 26 78 C 26 96 40 108 60 108 C 80 108 94 96 94 78 C 94 56 60 12 60 12 Z" fill="#4D96FF" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M44 76 Q44 90 56 94" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" opacity="0.6"/>`,
      ),
    },
    {
      id: 'nature-mountains',
      name: 'Mountains',
      keywords: ['mountain', 'hiking', 'travel', 'outdoor', 'adventure'],
      svg: svg(
        `<path d="M10 96 L40 40 L58 68 L70 48 L110 96 Z" fill="#6BCB77" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M40 40 L52 60 L34 60 Z" fill="#FFFFFF" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>` +
          `<path d="M70 48 L78 61 L62 61 Z" fill="#FFFFFF" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>` +
          `<circle cx="92" cy="26" r="10" fill="#FFD93D" stroke="${INK}" stroke-width="3"/>`,
      ),
    },
  ],
}
