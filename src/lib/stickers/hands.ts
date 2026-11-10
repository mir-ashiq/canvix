import type { StickerPack } from './index'

// Hand gestures — solid mitten style, one closed silhouette per
// gesture, cuff OVERLAPS the wrist (no detached chunks).
const INK = '#2D2A32'
const SKIN = '#FFC24B'
const svg = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${inner}</svg>`

/** the sleeve — drawn UNDER the hand, overlapping the wrist */
function cuff(x: number, y: number, w: number, h: number): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="#4D96FF" stroke="${INK}" stroke-width="3"/>`
}

export const HANDS_PACK: StickerPack = {
  id: 'hands',
  name: 'Hands',
  icon: '👋',
  stickers: [
    {
      id: 'hands-thumbs-up',
      name: 'Thumbs up',
      keywords: ['like', 'ok', 'approve', 'yes', 'good'],
      svg: svg(
        cuff(28, 62, 64, 22) +
          `<path d="M34 78 L34 50 Q34 30 46 26 L50 24 Q58 22 58 34 L58 44 L84 44 Q94 44 94 55 Q94 66 84 66 L58 66 L58 78 Q58 86 50 86 L42 86 Q34 86 34 78 Z" fill="${SKIN}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M44 34 Q44 28 49 27" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" opacity="0.6"/>`,
      ),
    },
    {
      id: 'hands-thumbs-down',
      name: 'Thumbs down',
      keywords: ['dislike', 'no', 'bad', 'reject', 'down'],
      svg: svg(
        cuff(28, 36, 64, 22) +
          `<path d="M34 42 L34 70 Q34 90 46 94 L50 96 Q58 98 58 86 L58 76 L84 76 Q94 76 94 65 Q94 54 84 54 L58 54 L58 42 Q58 34 50 34 L42 34 Q34 34 34 42 Z" fill="${SKIN}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M44 62 Q44 68 49 69" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" opacity="0.6"/>`,
      ),
    },
    {
      id: 'hands-peace',
      name: 'Peace sign',
      keywords: ['peace', 'victory', 'two', 'fingers'],
      svg: svg(
        cuff(38, 76, 44, 20) +
          `<path d="M46 82 L38 44 Q36 24 48 22 Q58 20 60 38 L62 48 L66 32 Q69 16 79 20 Q88 24 84 44 L76 72 Q72 84 62 88 Q52 90 46 82 Z" fill="${SKIN}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M52 34 Q52 26 57 25" fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" opacity="0.6"/>`,
      ),
    },
    {
      id: 'hands-ok',
      name: 'OK sign',
      keywords: ['ok', 'perfect', 'circle', 'fine'],
      svg: svg(
        cuff(36, 76, 48, 20) +
          `<path d="M60 22 Q80 22 80 40 Q80 50 70 56 L66 58 Q76 66 74 76 Q72 88 60 88 Q48 88 46 76 Q44 66 54 58 L50 56 Q40 50 40 40 Q40 22 60 22 Z" fill="${SKIN}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<circle cx="60" cy="38" r="9" fill="#FFFFFF" opacity="0.4"/>`,
      ),
    },
    {
      id: 'hands-wave',
      name: 'Waving hand',
      keywords: ['hello', 'hi', 'wave', 'welcome', 'bye'],
      svg: svg(
        cuff(32, 78, 56, 20) +
          `<path d="M38 80 Q32 60 36 44 Q38 34 45 37 Q50 40 49 48 L51 48 Q50 32 58 30 Q66 28 66 42 L68 42 Q68 28 76 28 Q83 28 82 44 L83 46 Q86 36 93 39 Q99 42 96 56 Q92 72 82 82 Q72 92 54 90 Q43 88 38 80 Z" fill="${SKIN}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M44 20 L48 10 M62 16 L62 6 M80 20 L84 10" stroke="#4D96FF" stroke-width="4" stroke-linecap="round"/>`,
      ),
    },
    {
      id: 'hands-clap',
      name: 'Clapping hands',
      keywords: ['clap', 'applause', 'bravo', 'praise'],
      svg: svg(
        cuff(26, 70, 56, 20) +
          `<path d="M34 74 Q28 56 32 42 Q34 33 41 36 Q46 39 45 46 L52 42 Q50 30 58 28 Q66 26 66 38 L74 36 Q74 26 82 27 Q89 28 87 42 Q84 58 76 70 Q68 80 54 80 Q42 80 34 74 Z" fill="${SKIN}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M44 18 L50 8 M64 14 L66 4 M84 20 L90 12" stroke="#FFD93D" stroke-width="4.5" stroke-linecap="round"/>`,
      ),
    },
    {
      id: 'hands-point-right',
      name: 'Pointing right',
      keywords: ['point', 'right', 'look', 'direction', 'here'],
      svg: svg(
        cuff(22, 60, 52, 22) +
          `<path d="M32 76 L32 48 Q32 40 40 40 L88 40 Q100 40 100 53 Q100 66 88 66 L56 66 L56 76 Q56 84 48 84 L40 84 Q32 84 32 76 Z" fill="${SKIN}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<circle cx="46" cy="53" r="3" fill="${INK}"/>`,
      ),
    },
    {
      id: 'hands-point-up',
      name: 'Pointing up',
      keywords: ['point', 'up', 'tip', 'idea', 'note'],
      svg: svg(
        cuff(36, 78, 48, 20) +
          `<path d="M48 84 L48 36 Q48 14 60 14 Q72 14 72 36 L72 52 L80 52 Q88 52 88 62 Q88 72 80 72 L72 72 L72 84 Q72 92 64 92 L56 92 Q48 92 48 84 Z" fill="${SKIN}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<circle cx="60" cy="28" r="3" fill="${INK}"/>`,
      ),
    },
    {
      id: 'hands-muscle',
      name: 'Flexed muscle',
      keywords: ['strong', 'muscle', 'flex', 'power', 'gym'],
      svg: svg(
        cuff(30, 70, 44, 22) +
          `<path d="M42 84 Q30 80 30 66 Q30 48 48 42 Q57 39 61 46 L68 38 Q77 27 87 36 Q97 46 89 60 L83 70 Q77 88 60 92 Q49 94 42 84 Z" fill="${SKIN}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<path d="M62 56 Q70 52 75 58" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" opacity="0.6"/>`,
      ),
    },
    {
      id: 'hands-raise',
      name: 'Raised hand',
      keywords: ['raise', 'stop', 'high', 'five', 'hand'],
      svg: svg(
        cuff(34, 78, 52, 20) +
          `<path d="M40 82 Q36 62 38 46 Q39 37 45 37 Q51 37 51 46 L51 42 Q51 30 58 30 Q65 30 65 42 L65 46 Q65 35 72 35 Q79 35 79 47 L79 58 Q88 60 88 71 Q88 86 75 92 Q60 96 48 92 Q42 90 40 82 Z" fill="${SKIN}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>`,
      ),
    },
  ],
}
