import type { StickerPack } from './index'

// Glossy vector faces — the house style: base circle at (60,64) r46,
// ink #2D2A32, glossy highlight top-left, mouth/eyes per expression.
const INK = '#2D2A32'
const base = (fill: string, extra = '') =>
  `<circle cx="60" cy="64" r="46" fill="${fill}" stroke="${INK}" stroke-width="3.5"/>` +
  `<ellipse cx="42" cy="38" rx="12" ry="8" fill="#FFFFFF" opacity="0.35" transform="rotate(-25 42 38)"/>${extra}`
const svg = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${inner}</svg>`
const eye = (x: number, y: number, r = 4.5) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${INK}"/>`

export const FACES_PACK: StickerPack = {
  id: 'faces',
  name: 'Faces',
  icon: '😄',
  stickers: [
    {
      id: 'faces-grin',
      name: 'Big grin',
      keywords: ['happy', 'smile', 'grin', 'joy'],
      svg: svg(
        base('#FFD93D') +
          eye(44, 58) + eye(76, 58) +
          `<path d="M40 76 Q60 96 80 76" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>` +
          `<path d="M46 80 Q60 90 74 80" fill="#FFFFFF" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`,
      ),
    },
    {
      id: 'faces-wink',
      name: 'Wink',
      keywords: ['wink', 'cheeky', 'playful'],
      svg: svg(
        base('#FFD93D') +
          eye(44, 58) +
          `<path d="M68 58 Q76 52 84 58" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>` +
          `<path d="M46 78 Q60 88 74 78" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
      ),
    },
    {
      id: 'faces-cool',
      name: 'Cool shades',
      keywords: ['cool', 'sunglasses', 'smug', 'swagger'],
      svg: svg(
        base('#FFD93D') +
          `<path d="M32 52 L88 52 L84 68 Q76 76 66 72 L62 62 L58 62 L54 72 Q44 76 36 68 Z" fill="${INK}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
          `<path d="M46 80 Q60 90 74 80" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
      ),
    },
    {
      id: 'faces-love',
      name: 'In love',
      keywords: ['love', 'hearts', 'eyes', 'crush'],
      svg: svg(
        base('#FFD93D') +
          heartEye(44, 58) + heartEye(76, 58) +
          `<path d="M48 80 Q60 90 72 80" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
      ),
    },
    {
      id: 'faces-laugh',
      name: 'Laughing hard',
      keywords: ['laugh', 'lol', 'tears', 'hilarious'],
      svg: svg(
        base('#FFD93D') +
          `<path d="M38 70 Q38 52 52 52 Q66 52 66 70 Z" fill="#2D2A32"/>` +
          `<path d="M54 70 Q60 78 66 70" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
          `<path d="M34 46 Q28 54 30 62" fill="none" stroke="#4D96FF" stroke-width="4" stroke-linecap="round"/>` +
          `<path d="M86 46 Q92 54 90 62" fill="none" stroke="#4D96FF" stroke-width="4" stroke-linecap="round"/>`,
      ),
    },
    {
      id: 'faces-sleepy',
      name: 'Sleepy',
      keywords: ['sleep', 'tired', 'zzz', 'bored', 'nap'],
      svg: svg(
        base('#FFD93D') +
          `<path d="M36 58 Q44 52 52 58" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>` +
          `<path d="M68 58 Q76 52 84 58" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>` +
          `<ellipse cx="60" cy="82" rx="8" ry="6" fill="${INK}"/>` +
          `<text x="72" y="34" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="${INK}">z</text>` +
          `<text x="86" y="20" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="${INK}">z</text>`,
      ),
    },
    {
      id: 'faces-angry',
      name: 'Angry',
      keywords: ['angry', 'mad', 'rage', 'furious'],
      svg: svg(
        base('#FF6B6B') +
          `<path d="M34 48 L52 56" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>` +
          `<path d="M86 48 L68 56" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>` +
          eye(46, 62) + eye(74, 62) +
          `<path d="M44 84 Q60 74 76 84" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>` +
          `<path d="M52 88 L54 96 M60 86 L60 96 M68 88 L66 96" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`,
      ),
    },
    {
      id: 'faces-surprised',
      name: 'Surprised',
      keywords: ['wow', 'surprise', 'shocked', 'amazed'],
      svg: svg(
        base('#FFD93D') +
          eye(44, 56, 6) + eye(76, 56, 6) +
          `<ellipse cx="60" cy="82" rx="11" ry="13" fill="${INK}"/>`,
      ),
    },
    {
      id: 'faces-thinking',
      name: 'Thinking',
      keywords: ['think', 'hmm', 'idea', 'ponder'],
      svg: svg(
        base('#FFD93D') +
          eye(44, 58) + eye(76, 58) +
          `<path d="M48 82 Q58 78 66 82" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>` +
          `<path d="M88 42 Q100 40 96 52 Q92 62 82 58" fill="#FFD93D" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
          `<circle cx="93" cy="66" r="4" fill="${INK}"/>`,
      ),
    },
    {
      id: 'faces-starstruck',
      name: 'Starstruck',
      keywords: ['star', 'eyes', 'amazed', 'fan', 'awesome'],
      svg: svg(
        base('#FFD93D') +
          starEye(44, 58) + starEye(76, 58) +
          `<path d="M44 80 Q60 94 76 80" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
      ),
    },
    {
      id: 'faces-sad',
      name: 'Sad',
      keywords: ['sad', 'cry', 'down', 'unhappy', 'sob'],
      svg: svg(
        base('#4D96FF') +
          `<path d="M36 54 Q44 48 52 54" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>` +
          `<path d="M68 54 Q76 48 84 54" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>` +
          eye(44, 64) + eye(76, 64) +
          `<path d="M46 88 Q60 76 74 88" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>` +
          `<path d="M42 70 Q38 82 40 92" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" opacity="0.9"/>` +
          `<path d="M78 70 Q82 82 80 92" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" opacity="0.9"/>`,
      ),
    },
    {
      id: 'faces-goofy',
      name: 'Goofy tongue',
      keywords: ['silly', 'goofy', 'tongue', 'cheeky', 'meme'],
      svg: svg(
        base('#FFD93D') +
          eye(44, 56) + eye(76, 56) +
          `<path d="M42 74 Q60 92 78 74 Z" fill="#2D2A32" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
          `<path d="M52 82 Q60 102 70 84 Q62 88 52 82 Z" fill="#FF7BAC" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`,
      ),
    },
  ],
}

function heartEye(x: number, y: number): string {
  return (
    `<path d="M${x} ${y + 8} C ${x - 10} ${y - 2} ${x - 4} ${y - 10} ${x} ${y - 4} C ${x + 4} ${y - 10} ${x + 10} ${y - 2} ${x} ${y + 8} Z" ` +
    `fill="#FF6B6B" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`
  )
}

function starEye(x: number, y: number): string {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 10 : 4
    const a = (Math.PI / 5) * i - Math.PI / 2
    pts.push(`${(x + r * Math.cos(a)).toFixed(1)},${(y + r * Math.sin(a)).toFixed(1)}`)
  }
  return `<polygon points="${pts.join(' ')}" fill="#FFD93D" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`
}
