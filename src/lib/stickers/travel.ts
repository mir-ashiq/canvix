import type { StickerPack } from './index'

// Travel & everyday objects.
const INK = '#2D2A32'
const svg = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${inner}</svg>`

export const TRAVEL_PACK: StickerPack = {
  id: 'travel',
  name: 'Travel',
  icon: '✈️',
  stickers: [
    {
      id: 'travel-plane',
      name: 'Airplane',
      keywords: ['plane', 'airplane', 'fly', 'travel', 'trip', 'flight'],
      svg: svg(
        `<path d="M14 62 Q12 54 22 52 L52 48 L74 18 Q78 12 84 14 Q90 16 86 26 L70 54 L96 58 Q104 60 102 68 Q100 74 92 74 L62 72 L44 98 Q40 104 34 102 Q28 100 32 92 L46 70 L24 68 Q16 68 14 62 Z" fill="#4D96FF" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M52 48 L72 22 Q74 18 78 17 L70 52 Z" fill="#FFFFFF" opacity="0.35"/>` +
          `<circle cx="64" cy="42" r="4" fill="#FFFFFF"/>`,
      ),
    },
    {
      id: 'travel-pin',
      name: 'Map pins',
      keywords: ['pin', 'location', 'map', 'gps', 'here', 'meet'],
      svg: svg(
        `<path d="M40 56 C 40 44 32 36 32 26 C 32 14 42 6 52 6 C 62 6 70 14 70 26 C 70 36 62 44 62 56 Z" fill="none"/>` +
          `<path d="M44 62 C 44 44 32 40 32 26 C 32 14 41 6 51 6 C 61 6 68 14 68 26 C 68 40 58 44 58 62 Q51 68 44 62 Z" fill="#FF6B6B" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<circle cx="51" cy="26" r="9" fill="#FFFFFF" stroke="${INK}" stroke-width="3"/>` +
          `<path d="M78 84 C 78 74 70 70 70 60 C 70 51 77 45 85 45 C 93 45 100 51 100 60 C 100 70 92 74 92 84 Q85 89 78 84 Z" fill="#4D96FF" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
          `<circle cx="85" cy="60" r="7" fill="#FFFFFF" stroke="${INK}" stroke-width="2.5"/>` +
          `<path d="M51 62 L51 84 Q68 92 78 84" fill="none" stroke="${INK}" stroke-width="2.5" stroke-dasharray="4 4"/>`,
      ),
    },
    {
      id: 'travel-camera',
      name: 'Camera',
      keywords: ['camera', 'photo', 'picture', 'shoot', 'photography'],
      svg: svg(
        `<rect x="14" y="34" width="92" height="64" rx="12" fill="#4D96FF" stroke="${INK}" stroke-width="3.5"/>` +
          `<rect x="44" y="22" width="32" height="14" rx="5" fill="#4D96FF" stroke="${INK}" stroke-width="3.5"/>` +
          `<circle cx="60" cy="66" r="22" fill="#FFFFFF" stroke="${INK}" stroke-width="3.5"/>` +
          `<circle cx="60" cy="66" r="13" fill="#2D2A32"/>` +
          `<circle cx="55" cy="61" r="4" fill="#FFFFFF" opacity="0.8"/>` +
          `<circle cx="92" cy="48" r="5" fill="#FFD93D" stroke="${INK}" stroke-width="2"/>`,
      ),
    },
    {
      id: 'travel-suitcase',
      name: 'Suitcase',
      keywords: ['suitcase', 'luggage', 'bag', 'travel', 'trip', 'pack'],
      svg: svg(
        `<rect x="20" y="36" width="80" height="66" rx="12" fill="#FF9F45" stroke="${INK}" stroke-width="3.5"/>` +
          `<path d="M44 36 L44 24 Q44 18 50 18 L70 18 Q76 18 76 24 L76 36" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>` +
          `<rect x="20" y="60" width="80" height="12" fill="#B983FF" stroke="${INK}" stroke-width="3"/>` +
          `<rect x="54" y="54" width="12" height="24" rx="4" fill="#B983FF" stroke="${INK}" stroke-width="3"/>`,
      ),
    },
    {
      id: 'travel-passport',
      name: 'Passport',
      keywords: ['passport', 'document', 'travel', 'id', 'international'],
      svg: svg(
        `<rect x="28" y="14" width="64" height="92" rx="8" fill="#2D3A5C" stroke="${INK}" stroke-width="3.5"/>` +
          `<circle cx="60" cy="44" r="16" fill="none" stroke="#FFD93D" stroke-width="3"/>` +
          `<path d="M60 28 L64 36 L60 44 L56 36 Z" fill="#FFD93D"/>` +
          `<path d="M50 68 L70 68 M46 78 L74 78 M50 88 L70 88" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" opacity="0.85"/>`,
      ),
    },
    {
      id: 'travel-compass',
      name: 'Compass',
      keywords: ['compass', 'navigate', 'direction', 'explore', 'north'],
      svg: svg(
        `<circle cx="60" cy="60" r="48" fill="#FFFFFF" stroke="${INK}" stroke-width="3.5"/>` +
          `<path d="M74 46 L66 66 L46 74 L54 54 Z" fill="#FF6B6B" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
          `<circle cx="60" cy="60" r="4" fill="${INK}"/>` +
          `<path d="M60 16 L63 24 M60 104 L57 96 M16 60 L24 57 M104 60 L96 63" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`,
      ),
    },
    {
      id: 'travel-beach',
      name: 'Beach umbrella',
      keywords: ['beach', 'umbrella', 'summer', 'vacation', 'sea'],
      svg: svg(
        `<path d="M60 12 Q20 18 14 52 Q38 40 60 46 Q82 40 106 52 Q100 18 60 12 Z" fill="#FF6B6B" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M36 26 L44 44 M60 14 L60 46 M84 26 L76 44" stroke="#FFFFFF" stroke-width="4" opacity="0.7"/>` +
          `<path d="M56 46 Q54 84 44 104" fill="none" stroke="#8A5A3B" stroke-width="7" stroke-linecap="round"/>` +
          `<path d="M16 106 Q60 96 104 106" fill="none" stroke="#4D96FF" stroke-width="5" stroke-linecap="round"/>`,
      ),
    },
    {
      id: 'travel-sunglasses',
      name: 'Sunglasses',
      keywords: ['sunglasses', 'glasses', 'summer', 'cool', 'style'],
      svg: svg(
        `<path d="M12 44 L108 44 L104 60 Q100 78 82 78 L66 78 Q58 78 57 68 L56 60 Q55 68 48 78 L38 78 Q20 78 16 60 Z" fill="#FF9F45" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M24 54 Q24 70 40 70 L60 70 Q64 54 56 52 L28 52 Q24 52 24 54 Z" fill="#2D2A32"/>` +
          `<path d="M96 54 Q96 70 80 70 L66 70 Q62 54 70 52 L92 52 Q96 52 96 54 Z" fill="#2D2A32"/>` +
          `<path d="M12 44 L4 36 M108 44 L116 36" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
      ),
    },
    {
      id: 'travel-map',
      name: 'Map',
      keywords: ['map', 'route', 'directions', 'travel', 'plan'],
      svg: svg(
        `<path d="M14 28 L44 16 L76 28 L106 16 L106 92 L76 104 L44 92 L14 104 Z" fill="#FFF6D9" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M44 16 L44 92 M76 28 L76 104" stroke="${INK}" stroke-width="2.5" opacity="0.4"/>` +
          `<path d="M22 78 Q40 60 54 66 Q72 74 84 56 Q96 42 100 40" fill="none" stroke="#FF6B6B" stroke-width="4" stroke-dasharray="7 5" stroke-linecap="round"/>` +
          `<circle cx="54" cy="66" r="6" fill="#4D96FF" stroke="#FFFFFF" stroke-width="2.5"/>` +
          `<circle cx="100" cy="40" r="7" fill="#FF6B6B" stroke="#FFFFFF" stroke-width="2.5"/>`,
      ),
    },
    {
      id: 'travel-van',
      name: 'Camper van',
      keywords: ['van', 'camper', 'road trip', 'travel', 'adventure', 'car'],
      svg: svg(
        `<path d="M12 74 L12 44 Q12 36 20 36 L64 36 L84 58 L100 60 Q108 62 108 74 L108 84 L12 84 Z" fill="#FFFFFF" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<rect x="20" y="44" width="30" height="18" rx="3" fill="#4D96FF" stroke="${INK}" stroke-width="2.5"/>` +
          `<path d="M58 44 L72 58 L58 58 Z" fill="#4D96FF" opacity="0.6"/>` +
          `<circle cx="34" cy="86" r="11" fill="#2D2A32" stroke="${INK}" stroke-width="3"/><circle cx="34" cy="86" r="4" fill="#FFFFFF"/>` +
          `<circle cx="88" cy="86" r="11" fill="#2D2A32" stroke="${INK}" stroke-width="3"/><circle cx="88" cy="86" r="4" fill="#FFFFFF"/>` +
          `<path d="M46 68 L64 68" stroke="#FF6B6B" stroke-width="3.5" stroke-linecap="round"/>`,
      ),
    },
  ],
}
