import type { StickerPack } from './index'

// Hearts — the universal accent set. Each heart is the same hero
// path, recoloured; special hearts (arrow, broken, sparkles) add
// their own geometry on top.
const INK = '#2D2A32'
const svg = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${inner}</svg>`

/** classic heart centered at (60,62), width ~72 + glossy highlight */
function heart(fill: string): string {
  return (
    heartAt(60, 62, 46, fill) +
    `<ellipse cx="38" cy="36" rx="10" ry="7" fill="#FFFFFF" opacity="0.4" transform="rotate(-30 38 36)"/>`
  )
}

/** a heart centered at (cx,cy) with half-width s — the shared hero shape */
function heartAt(cx: number, cy: number, s: number, fill: string, sw = 3.5): string {
  const b = (n: number) => n.toFixed(1)
  return (
    `<path d="M${b(cx)} ${b(cy + s)} C ${b(cx - s * 0.65)} ${b(cy + s * 0.39)} ${b(cx - s)} ${b(cy + 0.04 * s)} ${b(cx - s)} ${b(cy - 0.35 * s)} ` +
    `C ${b(cx - s)} ${b(cy - 0.7 * s)} ${b(cx - s * 0.74)} ${b(cy - 0.92 * s)} ${b(cx - s * 0.43)} ${b(cy - 0.92 * s)} ` +
    `C ${b(cx - s * 0.22)} ${b(cy - 0.92 * s)} ${b(cx - s * 0.07)} ${b(cy - 0.8 * s)} ${b(cx)} ${b(cy - 0.57 * s)} ` +
    `C ${b(cx + s * 0.07)} ${b(cy - 0.8 * s)} ${b(cx + s * 0.22)} ${b(cy - 0.92 * s)} ${b(cx + s * 0.43)} ${b(cy - 0.92 * s)} ` +
    `C ${b(cx + s * 0.74)} ${b(cy - 0.92 * s)} ${b(cx + s)} ${b(cy - 0.7 * s)} ${b(cx + s)} ${b(cy - 0.35 * s)} ` +
    `C ${b(cx + s)} ${b(cy + 0.04 * s)} ${b(cx + s * 0.65)} ${b(cy + s * 0.39)} ${b(cx)} ${b(cy + s)} Z" ` +
    `fill="${fill}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`
  )
}

export const HEARTS_PACK: StickerPack = {
  id: 'hearts',
  name: 'Hearts',
  icon: '❤️',
  stickers: [
    { id: 'hearts-red', name: 'Red heart', keywords: ['love', 'red', 'valentine', 'like'], svg: svg(heart('#FF6B6B')) },
    { id: 'hearts-pink', name: 'Pink heart', keywords: ['love', 'pink', 'cute', 'sweet'], svg: svg(heart('#FF7BAC')) },
    { id: 'hearts-purple', name: 'Purple heart', keywords: ['love', 'purple', 'violet'], svg: svg(heart('#B983FF')) },
    { id: 'hearts-blue', name: 'Blue heart', keywords: ['love', 'blue', 'calm', 'friendship'], svg: svg(heart('#4D96FF')) },
    { id: 'hearts-green', name: 'Green heart', keywords: ['love', 'green', 'eco', 'nature'], svg: svg(heart('#6BCB77')) },
    { id: 'hearts-gold', name: 'Gold heart', keywords: ['love', 'gold', 'premium', 'best'], svg: svg(heart('#FFD93D')) },
    {
      id: 'hearts-rainbow',
      name: 'Rainbow heart',
      keywords: ['rainbow', 'pride', 'colorful', 'love'],
      svg: svg(
        `<defs><linearGradient id="hr" x1="0" y1="0" x2="1" y2="1">` +
          `<stop offset="0" stop-color="#FF6B6B"/><stop offset="0.35" stop-color="#FFD93D"/>` +
          `<stop offset="0.65" stop-color="#6BCB77"/><stop offset="1" stop-color="#4D96FF"/>` +
          `</linearGradient></defs>` +
          heart('url(#hr)'),
      ),
    },
    {
      id: 'hearts-arrow',
      name: 'Heart with arrow',
      keywords: ['cupid', 'arrow', 'valentine', 'shot'],
      svg: svg(
        heart('#FF6B6B') +
          `<path d="M20 96 L96 22" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>` +
          `<path d="M84 20 L98 20 L98 34" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` +
          `<path d="M26 88 L14 88 L14 100" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` +
          `<path d="M96 22 L88 18 M96 22 L92 30" stroke="#FF6B6B" stroke-width="3" stroke-linecap="round"/>`,
      ),
    },
    {
      id: 'hearts-broken',
      name: 'Broken heart',
      keywords: ['sad', 'broken', 'breakup', 'heartbreak'],
      svg: svg(
        `<path d="M60 30 L48 18 C 34 18 22 28 22 44 C 22 62 38 82 60 100 L60 30 Z" fill="#FF6B6B" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M60 30 L72 18 C 86 18 98 28 98 44 C 98 62 82 82 60 100 L60 30 Z" fill="#FF6B6B" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M60 30 L52 44 L62 54 L54 68 L60 82" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`,
      ),
    },
    {
      id: 'hearts-sparkle',
      name: 'Sparkling heart',
      keywords: ['sparkle', 'shine', 'love', 'glitter'],
      svg: svg(
        heart('#FF6B6B') +
          `<path d="M92 30 L96 22 L100 30 L108 34 L100 38 L96 46 L92 38 L84 34 Z" fill="#FFD93D" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>` +
          `<path d="M18 66 L21 60 L24 66 L30 69 L24 72 L21 78 L18 72 L12 69 Z" fill="#FFD93D" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`,
      ),
    },
    {
      id: 'hearts-cluster',
      name: 'Hearts cluster',
      keywords: ['many', 'cluster', 'love', 'float'],
      svg: svg(
        heartAt(52, 34, 30, '#FF6B6B', 3) +
          heartAt(80, 72, 24, '#FF7BAC', 3) +
          heartAt(36, 88, 17, '#B983FF', 2.5),
      ),
    },
    {
      id: 'hearts-banner',
      name: 'Heart banner',
      keywords: ['banner', 'ribbon', 'love', 'label'],
      svg: svg(
        heart('#FF6B6B') +
          `<path d="M6 56 L24 56 M96 56 L114 56" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`,
      ),
    },
  ],
}
