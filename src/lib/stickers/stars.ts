import type { StickerPack } from './index'

// Stars, sparkles and shine marks.
const INK = '#2D2A32'
const svg = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${inner}</svg>`

/** 5-point star polygon centered at (cx,cy), outer r, inner ~0.42r */
function star(cx: number, cy: number, r: number, fill: string, sw = 3.5, rot = -90): string {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.42
    const a = ((Math.PI / 5) * i + (rot * Math.PI) / 180) as number
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`)
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`
}

/** 4-point sparkle (the "shine" diamond) */
function sparkle(cx: number, cy: number, r: number, fill: string, sw = 3): string {
  const q = r * 0.22
  return (
    `<path d="M${cx} ${cy - r} Q ${cx + q} ${cy - q} ${cx + r} ${cy} Q ${cx + q} ${cy + q} ${cx} ${cy + r} ` +
    `Q ${cx - q} ${cy + q} ${cx - r} ${cy} Q ${cx - q} ${cy - q} ${cx} ${cy - r} Z" ` +
    `fill="${fill}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`
  )
}

export const STARS_PACK: StickerPack = {
  id: 'stars',
  name: 'Stars & Sparkles',
  icon: '⭐',
  stickers: [
    { id: 'stars-yellow', name: 'Yellow star', keywords: ['star', 'favorite', 'rate', 'yellow'], svg: svg(star(60, 62, 46, '#FFD93D') + `<path d="M44 44 L52 52" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" opacity="0.6"/>`) },
    { id: 'stars-gold-badge', name: 'Gold star badge', keywords: ['gold', 'badge', 'award', 'star'], svg: svg(star(60, 60, 50, '#FF9F45', 4) + star(60, 60, 34, '#FFD93D', 3)) },
    { id: 'stars-blue', name: 'Blue star', keywords: ['star', 'blue', 'review'], svg: svg(star(60, 62, 46, '#4D96FF')) },
    { id: 'stars-pink', name: 'Pink star', keywords: ['star', 'pink', 'cute'], svg: svg(star(60, 62, 46, '#FF7BAC')) },
    {
      id: 'stars-sparkle',
      name: 'Sparkle',
      keywords: ['sparkle', 'shine', 'glitter', 'clean', 'new'],
      svg: svg(sparkle(60, 62, 44, '#FFD93D', 3.5) + sparkle(98, 26, 14, '#FFD93D', 2.5) + sparkle(22, 96, 10, '#FFD93D', 2.5)),
    },
    {
      id: 'stars-sparkle-pink',
      name: 'Pink sparkles',
      keywords: ['sparkle', 'pink', 'magic', 'glitter'],
      svg: svg(sparkle(46, 48, 30, '#FF7BAC', 3) + sparkle(86, 76, 20, '#B983FF', 2.5) + sparkle(28, 92, 12, '#FF7BAC', 2)),
    },
    {
      id: 'stars-shooting',
      name: 'Shooting star',
      keywords: ['shooting', 'comet', 'wish', 'night'],
      svg: svg(
        `<path d="M14 106 L44 76 M24 100 L54 70 M34 94 L64 64" stroke="#4D96FF" stroke-width="5" stroke-linecap="round"/>` +
          star(74, 54, 26, '#FFD93D', 3.5) +
          sparkle(100, 28, 12, '#FFFFFF', 2),
      ),
    },
    {
      id: 'stars-burst',
      name: 'Star burst',
      keywords: ['burst', 'boom', 'sale', 'attention', 'wow'],
      svg: svg(
        `<g>${Array.from({ length: 12 }, (_, i) => {
          const a = (Math.PI / 6) * i
          const x1 = 60 + 40 * Math.cos(a)
          const y1 = 60 + 40 * Math.sin(a)
          const x2 = 60 + 54 * Math.cos(a)
          const y2 = 60 + 54 * Math.sin(a)
          return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="#FF9F45" stroke-width="6" stroke-linecap="round"/>`
        }).join('')}</g>` +
          `<circle cx="60" cy="60" r="38" fill="#FFD93D" stroke="${INK}" stroke-width="3.5"/>` +
          star(60, 60, 24, '#FF6B6B', 3),
      ),
    },
    {
      id: 'stars-night',
      name: 'Night star',
      keywords: ['night', 'moon', 'sleep', 'star', 'dark'],
      svg: svg(
        `<circle cx="60" cy="62" r="44" fill="#2D2A32"/>` +
          star(60, 62, 30, '#FFD93D', 3) +
          sparkle(94, 34, 9, '#FFFFFF', 1.8) +
          sparkle(30, 88, 7, '#FFFFFF', 1.5) +
          `<circle cx="90" cy="86" r="3" fill="#FFFFFF"/><circle cx="34" cy="34" r="2.5" fill="#FFFFFF"/>`,
      ),
    },
    {
      id: 'stars-wand',
      name: 'Magic wand',
      keywords: ['magic', 'wand', 'wizard', 'spell', 'ai'],
      svg: svg(
        `<path d="M20 100 L72 48" stroke="#B983FF" stroke-width="10" stroke-linecap="round"/>` +
          `<path d="M20 100 L72 48" stroke="${INK}" stroke-width="3" stroke-linecap="round" opacity="0.25"/>` +
          star(84, 36, 18, '#FFD93D', 3) +
          sparkle(60, 24, 9, '#FF7BAC', 2) +
          sparkle(104, 58, 8, '#4D96FF', 2) +
          sparkle(88, 68, 6, '#FFD93D', 1.8),
      ),
    },
    {
      id: 'stars-rating',
      name: 'Five stars',
      keywords: ['rating', 'review', 'five', 'stars', 'score'],
      svg: svg(
        [14, 36, 58, 80, 102].map((x, i) => star(x, i % 2 === 0 ? 62 : 54, 11, '#FFD93D', 2.2)).join(''),
      ),
    },
    {
      id: 'stars-autograph',
      name: 'Circled star',
      keywords: ['circle', 'star', 'quality', 'premium', 'verified'],
      svg: svg(
        `<circle cx="60" cy="60" r="50" fill="#4D96FF" stroke="${INK}" stroke-width="3.5"/>` +
          star(60, 60, 28, '#FFFFFF', 3) +
          `<ellipse cx="42" cy="34" rx="10" ry="6" fill="#FFFFFF" opacity="0.3" transform="rotate(-25 42 34)"/>`,
      ),
    },
  ],
}
