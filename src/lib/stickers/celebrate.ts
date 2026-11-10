import type { StickerPack } from './index'

// Celebrations — party, birthday, congrats.
const INK = '#2D2A32'
const svg = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${inner}</svg>`
const confetti = (seed: number): string => {
  const colors = ['#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF', '#B983FF', '#FF9F45', '#FF7BAC']
  let out = ''
  for (let i = 0; i < 9; i++) {
    const x = 14 + ((seed * 37 + i * 89) % 88)
    const y = 12 + ((seed * 53 + i * 61) % 92)
    const c = colors[(seed + i) % colors.length]
    const big = i % 3 === 0
    out +=
      i % 2 === 0
        ? `<rect x="${x}" y="${y}" width="${big ? 15 : 11}" height="${big ? 9 : 7}" rx="2.5" fill="${c}" stroke="${INK}" stroke-width="2" transform="rotate(${(seed * 23 + i * 41) % 70 - 35} ${x} ${y})"/>`
        : `<circle cx="${x}" cy="${y}" r="${big ? 6 : 4}" fill="${c}" stroke="${INK}" stroke-width="2"/>`
  }
  return out
}

export const CELEBRATE_PACK: StickerPack = {
  id: 'celebrate',
  name: 'Celebrate',
  icon: '🎉',
  stickers: [
    {
      id: 'celebrate-popper',
      name: 'Party popper',
      keywords: ['party', 'popper', 'confetti', 'celebrate', 'new year'],
      svg: svg(
        `<path d="M18 102 L44 52 L52 106 Z" fill="#FF9F45" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M30 84 L46 60" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>` +
          star(66, 44, 16, '#FFD93D', 3) +
          `<path d="M56 24 L62 14 M76 66 L88 70 M64 64 L70 76" stroke="#FF6B6B" stroke-width="4" stroke-linecap="round"/>` +
          `<circle cx="88" cy="34" r="5" fill="#4D96FF" stroke="${INK}" stroke-width="2"/>` +
          `<circle cx="52" cy="36" r="4" fill="#6BCB77" stroke="${INK}" stroke-width="2"/>` +
          `<circle cx="96" cy="56" r="4" fill="#B983FF" stroke="${INK}" stroke-width="2"/>` +
          sparkle(84, 16, 7, '#FF7BAC', 1.8),
      ),
    },
    {
      id: 'celebrate-balloon',
      name: 'Red balloon',
      keywords: ['balloon', 'party', 'birthday', 'red'],
      svg: svg(
        `<path d="M60 14 C 78 14 88 28 88 44 C 88 62 72 78 60 78 C 48 78 32 62 32 44 C 32 28 42 14 60 14 Z" fill="#FF6B6B" stroke="${INK}" stroke-width="3.5"/>` +
          `<ellipse cx="48" cy="34" rx="8" ry="12" fill="#FFFFFF" opacity="0.4" transform="rotate(-18 48 34)"/>` +
          `<path d="M56 78 L54 86 L66 86 L64 78" fill="#FF6B6B" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>` +
          `<path d="M60 86 Q52 96 60 106 Q68 96 60 86" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`,
      ),
    },
    {
      id: 'celebrate-balloons',
      name: 'Balloon bunch',
      keywords: ['balloons', 'party', 'bunch', 'birthday', 'colorful'],
      svg: svg(
        `<path d="M38 26 C 50 26 56 36 56 47 C 56 60 45 71 38 71 C 31 71 20 60 20 47 C 20 36 26 26 38 26 Z" fill="#4D96FF" stroke="${INK}" stroke-width="3"/>` +
          `<path d="M84 20 C 96 20 102 30 102 41 C 102 54 91 65 84 65 C 77 65 66 54 66 41 C 66 30 72 20 84 20 Z" fill="#FFD93D" stroke="${INK}" stroke-width="3"/>` +
          `<path d="M60 42 C 72 42 78 52 78 63 C 78 76 67 87 60 87 C 53 87 42 76 42 63 C 42 52 48 42 60 42 Z" fill="#FF6B6B" stroke="${INK}" stroke-width="3"/>` +
          `<path d="M38 71 L52 100 M84 65 L66 100 M60 87 L60 100" stroke="${INK}" stroke-width="2.5" fill="none" stroke-linecap="round"/>` +
          `<path d="M52 100 Q60 108 68 100" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`,
      ),
    },
    {
      id: 'celebrate-confetti',
      name: 'Confetti burst',
      keywords: ['confetti', 'burst', 'party', 'scattered'],
      svg: svg(
        // a cannon fan: pieces radiate from the bottom-left corner
        `<path d="M8 112 Q28 92 58 78" fill="none" stroke="#FF9F45" stroke-width="7" stroke-linecap="round"/>` +
          `<path d="M8 112 Q40 104 74 100" fill="none" stroke="#6BCB77" stroke-width="7" stroke-linecap="round"/>` +
          `<g>${(
            [
              ['rect', 52, 40, -35, '#FF6B6B'], ['circle', 78, 34, 7, '#FFD93D'],
              ['rect', 96, 58, 25, '#4D96FF'], ['circle', 70, 66, 6, '#B983FF'],
              ['rect', 46, 70, 15, '#6BCB77'], ['circle', 100, 20, 5, '#FF7BAC'],
              ['rect', 82, 84, -20, '#FF9F45'], ['circle', 58, 54, 5, '#4D96FF'],
              ['rect', 66, 90, 40, '#FFD93D'], ['circle', 92, 76, 4, '#FF6B6B'],
              ['rect', 34, 56, -55, '#B983FF'], ['circle', 108, 40, 4, '#6BCB77'],
            ] as [string, number, number, number, string][]
          )
            .map(([k, x, y, r, c]) =>
              k === 'rect'
                ? `<rect x="${x}" y="${y}" width="15" height="10" rx="3" fill="${c}" stroke="${INK}" stroke-width="2" transform="rotate(${r} ${x} ${y})"/>`
                : `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" stroke="${INK}" stroke-width="2"/>`,
            )
            .join('')}</g>`,
      ),
    },
    {
      id: 'celebrate-cake',
      name: 'Birthday cake',
      keywords: ['cake', 'birthday', 'party', 'candle'],
      svg: svg(
        `<rect x="22" y="58" width="76" height="40" rx="8" fill="#FF7BAC" stroke="${INK}" stroke-width="3.5"/>` +
          `<path d="M22 70 Q30 62 38 70 Q46 78 54 70 Q62 62 70 70 Q78 78 86 70 Q90 66 98 70 L98 62 L22 62 Z" fill="#FFFFFF" stroke="${INK}" stroke-width="2.5"/>` +
          `<rect x="56" y="36" width="8" height="22" fill="#4D96FF" stroke="${INK}" stroke-width="2.5"/>` +
          `<path d="M60 14 C 66 18 66 26 60 30 C 54 26 54 18 60 14 Z" fill="#FFD93D" stroke="#FF9F45" stroke-width="2"/>` +
          `<path d="M36 84 L44 84 M56 84 L64 84 M76 84 L84 84" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" opacity="0.7"/>`,
      ),
    },
    {
      id: 'celebrate-champagne',
      name: 'Champagne toast',
      keywords: ['champagne', 'toast', 'cheers', 'drink', 'new year'],
      svg: svg(
        // two solid coupe glasses clinking — filled bodies, chunky stems
        `<path d="M26 16 L54 16 L50 34 Q42 44 30 34 Z" fill="#FFFFFF" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M32 42 L34 44 Q40 48 46 44 L48 42" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
          `<path d="M40 46 L40 62 Q40 70 32 74 L48 74 Q40 70 40 62 Z" fill="#FFFFFF" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
          `<path d="M66 16 L94 16 L90 34 Q82 44 70 34 Z" fill="#FFFFFF" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M72 42 L74 44 Q80 48 86 44 L88 42" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
          `<path d="M80 46 L80 62 Q80 70 72 74 L88 74 Q80 70 80 62 Z" fill="#FFFFFF" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
          `<path d="M28 24 Q32 20 38 22 M70 22 Q76 20 80 24" fill="none" stroke="#FFD93D" stroke-width="4" stroke-linecap="round"/>` +
          `<path d="M54 30 L66 30" stroke="#FF6B6B" stroke-width="5" stroke-linecap="round"/>` +
          `<circle cx="60" cy="8" r="4" fill="#FFD93D" stroke="${INK}" stroke-width="2"/>` +
          `<circle cx="44" cy="6" r="3" fill="#4D96FF" stroke="${INK}" stroke-width="2"/>` +
          `<circle cx="76" cy="6" r="3" fill="#6BCB77" stroke="${INK}" stroke-width="2"/>`,
      ),
    },
    {
      id: 'celebrate-gift',
      name: 'Gift box',
      keywords: ['gift', 'present', 'box', 'birthday', 'surprise'],
      svg: svg(
        `<rect x="22" y="46" width="76" height="52" rx="6" fill="#4D96FF" stroke="${INK}" stroke-width="3.5"/>` +
          `<rect x="22" y="46" width="76" height="16" rx="6" fill="#4D96FF" stroke="${INK}" stroke-width="3.5"/>` +
          `<rect x="52" y="46" width="16" height="52" fill="#FFD93D" stroke="${INK}" stroke-width="3"/>` +
          `<path d="M60 46 C 44 40 40 26 50 24 C 58 22 60 34 60 46 Z" fill="#FF6B6B" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
          `<path d="M60 46 C 76 40 80 26 70 24 C 62 22 60 34 60 46 Z" fill="#FF6B6B" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`,
      ),
    },
    {
      id: 'celebrate-ribbon',
      name: 'Ribbon bow',
      keywords: ['ribbon', 'bow', 'gift', 'decoration'],
      svg: svg(
        `<path d="M60 58 C 44 40 20 40 20 56 C 20 72 44 72 60 58 Z" fill="#FF6B6B" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M60 58 C 76 40 100 40 100 56 C 100 72 76 72 60 58 Z" fill="#FF6B6B" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M60 58 C 50 74 46 92 54 102 Q60 108 66 102 C 74 92 70 74 60 58 Z" fill="#FF7BAC" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<circle cx="60" cy="58" r="8" fill="#FFD93D" stroke="${INK}" stroke-width="3"/>`,
      ),
    },
    {
      id: 'celebrate-streamers',
      name: 'Streamers',
      keywords: ['streamers', 'party', 'decoration', 'ribbon'],
      svg: svg(
        // two clean hanging ribbons with a wavy tail — readable at any size
        `<path d="M24 8 L44 8 Q40 34 48 58 Q52 72 42 92 L30 92 Q38 72 34 58 Q28 34 24 8 Z" fill="#FF6B6B" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
          `<path d="M76 8 L96 8 Q92 34 100 58 Q104 72 94 92 L82 92 Q90 72 86 58 Q80 34 76 8 Z" fill="#4D96FF" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
          `<path d="M24 8 L44 8 M76 8 L96 8" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>` +
          confetti(11) +
          confetti(5),
      ),
    },
    {
      id: 'celebrate-fireworks',
      name: 'Fireworks',
      keywords: ['fireworks', 'new year', 'night', 'celebration'],
      svg: svg(
        `<g>${Array.from({ length: 3 }, (_, k) => {
          const cx = [44, 84, 62][k]
          const cy = [44, 56, 92][k]
          const col = ['#FFD93D', '#FF6B6B', '#4D96FF'][k]
          return Array.from({ length: 8 }, (_, i) => {
            const a = (Math.PI / 4) * i
            const x1 = cx + 12 * Math.cos(a)
            const y1 = cy + 12 * Math.sin(a)
            const x2 = cx + (k === 2 ? 18 : 24) * Math.cos(a)
            const y2 = cy + (k === 2 ? 18 : 24) * Math.sin(a)
            return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${col}" stroke-width="${k === 2 ? 3 : 4.5}" stroke-linecap="round"/>`
          }).join('')
        }).join('')}</g>`,
      ),
    },
    {
      id: 'celebrate-horn',
      name: 'Party horn',
      keywords: ['horn', 'blower', 'party', 'noise'],
      svg: svg(
        `<path d="M16 96 Q14 84 26 82 L58 74 L64 98 L32 104 Q18 106 16 96 Z" fill="#FF9F45" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M60 78 Q84 62 96 40 Q102 30 96 24 Q90 18 82 24 Q64 38 58 68 Z" fill="#FFD93D" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M74 62 Q86 50 92 38 M68 70 Q80 58 88 46" fill="none" stroke="${INK}" stroke-width="2" opacity="0.4"/>` +
          star(102, 18, 8, '#FF6B6B', 2) + sparkle(50, 34, 8, '#B983FF', 2),
      ),
    },
    {
      id: 'celebrate-congrats',
      name: 'Congrats badge',
      keywords: ['congrats', 'congratulations', 'badge', 'winner', 'well done'],
      svg: svg(
        `<circle cx="60" cy="60" r="46" fill="#6BCB77" stroke="${INK}" stroke-width="3.5"/>` +
          `<circle cx="60" cy="60" r="36" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-dasharray="6 5"/>` +
          `<text x="60" y="54" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="bold" fill="#FFFFFF">WELL</text>` +
          `<text x="60" y="72" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="bold" fill="#FFFFFF">DONE</text>` +
          `<path d="M42 78 L36 98 L48 90 L60 98 L56 78" fill="#FFD93D" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`,
      ),
    },
  ],
}

function star(cx: number, cy: number, r: number, fill: string, sw: number): string {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.42
    const a = (Math.PI / 5) * i - Math.PI / 2
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`)
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`
}

function sparkle(cx: number, cy: number, r: number, fill: string, sw: number): string {
  const q = r * 0.22
  return (
    `<path d="M${cx} ${cy - r} Q ${cx + q} ${cy - q} ${cx + r} ${cy} Q ${cx + q} ${cy + q} ${cx} ${cy + r} ` +
    `Q ${cx - q} ${cy + q} ${cx - r} ${cy} Q ${cx - q} ${cy - q} ${cx} ${cy - r} Z" ` +
    `fill="${fill}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`
  )
}
