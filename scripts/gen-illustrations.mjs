// gen-illustrations.mjs — clean-room authoring of the Canvix illustration
// packs (v0.17 Wave 2). Composes 48 original flat illustrations from SVG
// primitives and emits src/lib/assets/illustrations.ts.
// Run: node scripts/gen-illustrations.mjs
import { writeFileSync } from 'node:fs'

// ── tiny SVG DSL ──────────────────────────────────────────────
const f = (n) => Math.round(n * 100) / 100
const circ = (cx, cy, r, fill, extra = '') =>
  `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${fill}"${extra ? ' ' + extra : ''}/>`
const ell = (cx, cy, rx, ry, fill, rot = null) =>
  `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="${fill}"${rot != null ? ` transform="rotate(${rot} ${f(cx)} ${f(cy)})"` : ''}/>`
const rect = (x, y, w, h, rx, fill, rot = null) =>
  `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"${rx ? ` rx="${f(rx)}"` : ''} fill="${fill}"${rot != null ? ` transform="rotate(${rot} ${f(x + w / 2)} ${f(y + h / 2)})"` : ''}/>`
const poly = (pts, fill) =>
  `<polygon points="${pts.map((p) => `${f(p[0])},${f(p[1])}`).join(' ')}" fill="${fill}"/>`
const path = (d, fill) =>
  `<path d="${d}" fill="${fill}"/>`
const stroke = (d, sw, color) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f(sw)}" stroke-linecap="round" stroke-linejoin="round"/>`
const grad = (id, from, to, type = 'linear') =>
  type === 'linear'
    ? `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>`
    : `<defs><radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></radialGradient></defs>`
const star = (cx, cy, r, fill, points = 5, inner = 0.42) => {
  const pts = []
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? r : r * inner
    const a = (Math.PI / points) * i - Math.PI / 2
    pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)])
  }
  return poly(pts, fill)
}
const svg = (...children) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">${children.join('')}</svg>`

// ── pack palettes ─────────────────────────────────────────────
const P = {
  business: { a: '#1B2A4A', b: '#FF6B5B', c: '#F4E3C1', d: '#7A8CA5', e: '#2E9E8F' },
  people: { a: '#E76F51', b: '#FAF3E0', c: '#2A9D8F', d: '#6D4C6F', e: '#F4A261' },
  nature: { a: '#2D6A4F', b: '#74C69D', c: '#FFD166', d: '#A8DADC', e: '#1B4332' },
  tech: { a: '#3A0CA3', b: '#4CC9F0', c: '#7209B7', d: '#F8F9FA', e: '#5E60CE' },
  abstract: { a: '#7630D7', b: '#02C0CC', c: '#FF5C8A', d: '#FFE066', e: '#8B5CF6' },
  festive: { a: '#D62828', b: '#F77F00', c: '#FCBF49', d: '#003049', e: '#EAE2B7' },
}

// ── 48 illustrations ─────────────────────────────────────────
const I = []

// · business ·
I.push({ id: 'rocket-launch', name: 'Rocket launch', pack: 'business', tags: ['startup', 'growth', 'space'],
  svg: svg(
    star(38, 46, 6, P.business.d), star(164, 34, 4, P.business.d), circ(150, 130, 3, P.business.d),
    poly([[78, 108], [60, 150], [86, 132]], P.business.b),
    poly([[122, 108], [140, 150], [114, 132]], P.business.b),
    path('M100 26 C116 44 118 78 100 112 C82 78 84 44 100 26 Z', P.business.a),
    circ(100, 60, 11, P.business.c), circ(100, 60, 6, P.business.b),
    path('M100 112 C110 120 108 136 100 148 C92 136 90 120 100 112 Z', P.business.c),
    path('M100 132 C106 144 104 156 100 164 C96 156 94 144 100 132 Z', P.business.b),
    ell(88, 150, 4, 7, P.business.e, -20), ell(112, 150, 4, 7, P.business.e, 20)
  ) })
I.push({ id: 'growth-chart', name: 'Growth chart', pack: 'business', tags: ['growth', 'chart', 'success'],
  svg: svg(
    rect(34, 30, 10, 140, 5, P.business.d), rect(34, 160, 140, 10, 5, P.business.d),
    rect(58, 118, 22, 36, 4, P.business.c), rect(92, 96, 22, 58, 4, P.business.b), rect(126, 70, 22, 84, 4, P.business.a),
    stroke('M52 92 L86 62 L118 74 L158 34', 9, P.business.e),
    poly([[166, 12], [146, 34], [166, 34]], P.business.e),
    circ(158, 34, 6, P.business.b)
  ) })
I.push({ id: 'briefcase', name: 'Briefcase', pack: 'business', tags: ['work', 'office', 'business'],
  svg: svg(
    stroke('M78 52 L78 44 C78 38 82 34 88 34 L112 34 C118 34 122 38 122 44 L122 52', 8, P.business.a),
    rect(30, 52, 140, 92, 14, P.business.a),
    rect(30, 84, 140, 14, 0, P.business.b),
    rect(88, 78, 24, 26, 5, P.business.c),
    rect(94, 84, 12, 14, 3, P.business.d),
    circ(52, 68, 5, P.business.d), circ(148, 68, 5, P.business.d)
  ) })
I.push({ id: 'target-goal', name: 'Target goal', pack: 'business', tags: ['goal', 'aim', 'focus'],
  svg: svg(
    circ(96, 104, 64, P.business.c), circ(96, 104, 45, P.business.d), circ(96, 104, 26, P.business.b), circ(96, 104, 11, P.business.a),
    stroke('M96 104 L160 40', 10, P.business.a),
    poly([[172, 28], [140, 34], [160, 54]], P.business.a),
    circ(96, 104, 5, P.business.c)
  ) })
I.push({ id: 'handshake', name: 'Handshake', pack: 'business', tags: ['deal', 'partnership', 'agree'],
  svg: svg(
    rect(18, 86, 52, 22, 11, P.business.a), rect(130, 86, 52, 22, 11, P.business.a),
    rect(24, 80, 16, 34, 6, P.business.d), rect(160, 80, 16, 34, 6, P.business.d),
    path('M62 78 C74 66 88 66 100 78 L108 86 C114 92 114 100 108 106 L96 118 C90 124 82 124 76 118 Z', P.business.b),
    path('M138 78 C126 66 112 66 100 78 L92 86 C86 92 86 100 92 106 L104 118 C110 124 118 124 124 118 Z', P.business.e),
    circ(84, 100, 8, P.business.c), circ(116, 100, 8, P.business.a)
  ) })
I.push({ id: 'meeting-table', name: 'Meeting table', pack: 'business', tags: ['team', 'meeting', 'discussion'],
  svg: svg(
    ell(100, 120, 62, 24, P.business.a),
    rect(58, 130, 10, 40, 5, P.business.d), rect(132, 130, 10, 40, 5, P.business.d),
    circ(56, 58, 14, P.business.b), path('M32 96 C32 78 44 70 56 70 C68 70 80 78 80 96 Z', P.business.b),
    circ(144, 58, 14, P.business.e), path('M120 96 C120 78 132 70 144 70 C156 70 168 78 168 96 Z', P.business.e),
    circ(100, 44, 16, P.business.c), path('M72 86 C72 64 84 54 100 54 C116 54 128 64 128 86 Z', P.business.c),
    rect(88, 104, 24, 10, 5, P.business.c)
  ) })
I.push({ id: 'piggy-bank', name: 'Piggy bank', pack: 'business', tags: ['savings', 'money', 'finance'],
  svg: svg(
    ell(102, 116, 58, 40, P.business.c),
    circ(160, 100, 14, P.business.c), rect(168, 96, 14, 8, 4, P.business.a),
    rect(64, 148, 14, 22, 6, P.business.a), rect(124, 148, 14, 22, 6, P.business.a),
    circ(72, 104, 5, P.business.a), circ(70, 88, 7, P.business.d),
    ell(58, 122, 10, 14, P.business.d, -30),
    star(112, 62, 14, P.business.b),
    ell(112, 62, 8, 8, P.business.c)
  ) })
I.push({ id: 'trophy-win', name: 'Trophy win', pack: 'business', tags: ['award', 'win', 'champion'],
  svg: svg(
    path('M62 36 L138 36 L132 92 C130 112 116 124 100 124 C84 124 70 112 68 92 Z', P.business.c),
    stroke('M62 46 C46 46 42 68 58 76 L66 80', 9, P.business.c),
    stroke('M138 46 C154 46 158 68 142 76 L134 80', 9, P.business.c),
    rect(92, 124, 16, 22, 4, P.business.d),
    rect(66, 146, 68, 14, 6, P.business.a),
    star(100, 74, 22, P.business.b),
    rect(94, 30, 12, 8, 3, P.business.a)
  ) })

// · people ·
I.push({ id: 'collaboration', name: 'Collaboration', pack: 'people', tags: ['teamwork', 'together', 'share'],
  svg: svg(
    circ(58, 74, 20, P.people.a), path('M26 132 C26 104 40 92 58 92 C76 92 90 104 90 132 Z', P.people.a),
    circ(142, 74, 20, P.people.c), path('M110 132 C110 104 124 92 142 92 C160 92 174 104 174 132 Z', P.people.c),
    rect(76, 104, 48, 56, 8, P.people.b),
    rect(84, 116, 32, 5, 3, P.people.d), rect(84, 128, 32, 5, 3, P.people.d), rect(84, 140, 20, 5, 3, P.people.d),
    star(100, 62, 12, P.people.e), star(38, 44, 7, P.people.e), star(164, 44, 7, P.people.e)
  ) })
I.push({ id: 'presentation', name: 'Presentation', pack: 'people', tags: ['pitch', 'speech', 'report'],
  svg: svg(
    rect(40, 30, 120, 80, 8, P.people.b),
    rect(52, 76, 16, 22, 3, P.people.c), rect(74, 62, 16, 36, 3, P.people.a), rect(96, 48, 16, 50, 3, P.people.d),
    stroke('M100 110 L100 140', 8, P.people.d), stroke('M74 140 L126 140', 8, P.people.d),
    circ(148, 108, 13, P.people.a), path('M126 148 C126 132 136 124 148 124 C160 124 170 132 170 148 Z', P.people.a),
    stroke('M136 116 L120 100', 7, P.people.a)
  ) })
I.push({ id: 'freelancer', name: 'Freelancer', pack: 'people', tags: ['remote', 'work', 'laptop'],
  svg: svg(
    stroke('M30 160 C40 120 70 104 100 104 C130 104 160 120 170 160', 10, P.people.d),
    circ(100, 60, 18, P.people.a), path('M70 110 C70 84 82 74 100 74 C118 74 130 84 130 110 Z', P.people.c),
    path('M64 138 L136 138 L128 112 L72 112 Z', P.people.b),
    rect(66, 140, 68, 8, 4, P.people.e),
    ell(158, 96, 12, 9, P.people.a, -15), rect(150, 100, 18, 12, 4, P.people.d),
    stroke('M150 84 C146 76 152 70 148 62', 4, P.people.e)
  ) })
I.push({ id: 'team-highfive', name: 'Team high five', pack: 'people', tags: ['celebrate', 'team', 'success'],
  svg: svg(
    circ(64, 78, 19, P.people.a), path('M34 140 C34 112 46 100 64 100 C82 100 94 112 94 140 Z', P.people.a),
    circ(136, 78, 19, P.people.c), path('M106 140 C106 112 118 100 136 100 C154 100 166 112 166 140 Z', P.people.c),
    stroke('M70 106 L84 62', 10, P.people.a), stroke('M130 106 L116 62', 10, P.people.c),
    star(100, 48, 20, P.people.e), star(100, 48, 9, P.people.b),
    star(58, 38, 8, P.people.e), star(142, 38, 8, P.people.e)
  ) })
I.push({ id: 'thinking-woman', name: 'Thinking woman', pack: 'people', tags: ['idea', 'think', 'plan'],
  svg: svg(
    circ(78, 92, 26, P.people.a), path('M38 168 C38 134 56 120 78 120 C100 120 118 134 118 168 Z', P.people.c),
    circ(130, 70, 18, P.people.b), circ(152, 50, 12, P.people.b), circ(168, 32, 7, P.people.b),
    star(140, 66, 7, P.people.e),
    ell(66, 132, 10, 14, P.people.d, -20)
  ) })
I.push({ id: 'reading-book', name: 'Reading book', pack: 'people', tags: ['book', 'study', 'learn'],
  svg: svg(
    path('M100 92 C86 78 62 74 40 80 L40 152 C62 146 86 150 100 162 Z', P.people.b),
    path('M100 92 C114 78 138 74 160 80 L160 152 C138 146 114 150 100 162 Z', P.people.b),
    stroke('M100 92 L100 162', 5, P.people.d),
    rect(52, 92, 36, 5, 2, P.people.d), rect(52, 104, 36, 5, 2, P.people.d), rect(52, 116, 28, 5, 2, P.people.d),
    rect(112, 92, 36, 5, 2, P.people.d), rect(112, 104, 36, 5, 2, P.people.d), rect(112, 116, 28, 5, 2, P.people.d),
    circ(100, 46, 18, P.people.a), path('M74 82 C74 60 84 52 100 52 C116 52 126 60 126 82 Z', P.people.a)
  ) })
I.push({ id: 'coffee-chat', name: 'Coffee chat', pack: 'people', tags: ['coffee', 'talk', 'cafe'],
  svg: svg(
    path('M44 84 L96 84 L90 132 C89 142 80 148 70 148 C60 148 51 142 50 132 Z', P.people.a),
    stroke('M96 92 C112 92 112 116 96 116', 6, P.people.a),
    path('M104 84 L156 84 L150 132 C149 142 140 148 130 148 C120 148 111 142 110 132 Z', P.people.c),
    stroke('M156 92 C172 92 172 116 156 116', 6, P.people.c),
    stroke('M62 70 C58 62 66 56 62 48', 4, P.people.e), stroke('M78 70 C74 62 82 56 78 48', 4, P.people.e),
    stroke('M122 70 C118 62 126 56 122 48', 4, P.people.e), stroke('M138 70 C134 62 142 56 138 48', 4, P.people.e),
    rect(40, 156, 120, 8, 4, P.people.d)
  ) })
I.push({ id: 'work-desk', name: 'Work desk', pack: 'people', tags: ['desk', 'workspace', 'setup'],
  svg: svg(
    rect(28, 120, 144, 10, 5, P.people.d),
    rect(38, 130, 10, 44, 4, P.people.d), rect(152, 130, 10, 44, 4, P.people.d),
    rect(56, 58, 72, 52, 6, P.people.c), rect(62, 64, 60, 40, 3, P.people.b),
    rect(50, 110, 84, 8, 4, P.people.c),
    rect(74, 46, 36, 10, 4, P.people.d),
    rect(140, 88, 26, 32, 5, P.people.a), path('M146 118 L166 118 L170 128 L142 128 Z', P.people.e),
    circ(149, 82, 5, P.people.e)
  ) })

// · nature ·
I.push({ id: 'mountain-sunrise', name: 'Mountain sunrise', pack: 'nature', tags: ['mountain', 'sun', 'travel'],
  svg: svg(
    circ(140, 60, 26, P.nature.c),
    poly([[16, 150], [76, 62], [136, 150]], P.nature.a),
    poly([[68, 84], [76, 62], [84, 84], [76, 96]], P.nature.d),
    poly([[96, 150], [146, 78], [192, 150]], P.nature.e),
    poly([[138, 96], [146, 78], [154, 96], [146, 108]], P.nature.d),
    ell(52, 56, 22, 12, P.nature.d), ell(66, 62, 16, 9, P.nature.d),
    rect(8, 150, 184, 22, 11, P.nature.b)
  ) })
I.push({ id: 'forest-pines', name: 'Forest pines', pack: 'nature', tags: ['forest', 'trees', 'woods'],
  svg: svg(
    poly([[40, 140], [58, 60], [76, 140]], P.nature.a), rect(54, 140, 8, 18, 3, P.nature.e),
    poly([[86, 140], [108, 44], [130, 140]], P.nature.e), rect(102, 140, 10, 20, 4, P.nature.a),
    poly([[140, 140], [156, 76], [172, 140]], P.nature.a), rect(152, 140, 8, 16, 3, P.nature.e),
    ell(100, 164, 88, 16, P.nature.b)
  ) })
I.push({ id: 'cactus-desert', name: 'Cactus desert', pack: 'nature', tags: ['desert', 'cactus', 'southwest'],
  svg: svg(
    circ(150, 56, 22, P.nature.c),
    rect(86, 66, 28, 100, 14, P.nature.a),
    path('M86 108 C70 108 64 100 64 88 L64 80 C64 74 74 74 74 80 L74 88 C74 94 78 98 86 98 Z', P.nature.a),
    path('M114 122 C130 122 136 114 136 102 L136 82 C136 76 126 76 126 82 L126 102 C126 108 122 112 114 112 Z', P.nature.a),
    ell(50, 156, 12, 8, P.nature.b, -12), ell(70, 162, 14, 8, P.nature.b, 8),
    ell(140, 160, 16, 9, P.nature.b, -6), ell(164, 156, 12, 7, P.nature.b, 10),
    circ(60, 96, 4, P.nature.c), circ(140, 110, 4, P.nature.c), circ(100, 84, 4, P.nature.c)
  ) })
I.push({ id: 'ocean-waves', name: 'Ocean waves', pack: 'nature', tags: ['ocean', 'sea', 'water'],
  svg: svg(
    path('M10 70 C40 54 70 54 100 70 C130 86 160 86 190 70 L190 92 C160 108 130 108 100 92 C70 76 40 76 10 92 Z', P.nature.d),
    path('M10 104 C40 88 70 88 100 104 C130 120 160 120 190 104 L190 126 C160 142 130 142 100 126 C70 110 40 110 10 126 Z', P.nature.b),
    path('M10 138 C40 122 70 122 100 138 C130 154 160 154 190 138 L190 160 C160 176 130 176 100 160 C70 144 40 144 10 160 Z', P.nature.a),
    circ(52, 44, 14, P.nature.c)
  ) })
I.push({ id: 'leaf-rain', name: 'Leaf rain', pack: 'nature', tags: ['leaf', 'rain', 'eco'],
  svg: svg(
    ell(62, 44, 30, 16, P.nature.d), ell(84, 52, 22, 12, P.nature.d),
    path('M100 74 C100 128 76 158 40 170 C34 132 56 98 100 74 Z', P.nature.a),
    stroke('M100 74 C84 108 68 136 44 158', 5, P.nature.b),
    stroke('M126 92 L118 112', 5, P.nature.b), stroke('M146 106 L138 126', 5, P.nature.b),
    stroke('M120 132 L114 148', 5, P.nature.b), stroke('M152 138 L146 154', 5, P.nature.b),
    circ(168, 72, 5, P.nature.b), circ(140, 78, 4, P.nature.b)
  ) })
I.push({ id: 'butterfly-garden', name: 'Butterfly garden', pack: 'nature', tags: ['butterfly', 'garden', 'spring'],
  svg: svg(
    path('M96 84 C72 56 34 58 34 88 C34 114 66 120 92 104 Z', P.nature.b),
    path('M104 84 C128 56 166 58 166 88 C166 114 134 120 108 104 Z', P.nature.b),
    path('M96 102 C78 116 58 122 56 138 C78 142 96 128 100 112 Z', P.nature.a),
    path('M104 102 C122 116 142 122 144 138 C122 142 104 128 100 112 Z', P.nature.a),
    ell(100, 96, 6, 24, P.nature.e),
    stroke('M94 72 C88 62 82 60 78 62', 3, P.nature.e), stroke('M106 72 C112 62 118 60 122 62', 3, P.nature.e),
    circ(70, 40, 7, P.nature.c), star(138, 42, 9, P.nature.c),
    circ(42, 156, 6, P.nature.c), circ(158, 156, 6, P.nature.c)
  ) })
I.push({ id: 'moon-stars', name: 'Moon and stars', pack: 'nature', tags: ['night', 'moon', 'sleep'],
  svg: svg(
    path('M128 32 C96 40 76 66 76 96 C76 126 96 152 128 160 C104 172 72 166 52 142 C30 116 32 76 56 50 C76 28 106 22 128 32 Z', P.nature.d),
    star(146, 62, 12, P.nature.c), star(160, 106, 8, P.nature.c), star(138, 136, 7, P.nature.c),
    star(48, 40, 9, P.nature.c), circ(168, 42, 4, P.nature.b), circ(126, 52, 3, P.nature.b)
  ) })
I.push({ id: 'flower-bloom', name: 'Flower bloom', pack: 'nature', tags: ['flower', 'bloom', 'spring'],
  svg: svg(
    ell(100, 70, 16, 30, P.nature.b, 0), ell(100, 70, 16, 30, P.nature.b, 60), ell(100, 70, 16, 30, P.nature.b, 120),
    ell(100, 70, 16, 30, P.nature.b, 180), ell(100, 70, 16, 30, P.nature.b, 240), ell(100, 70, 16, 30, P.nature.b, 300),
    circ(100, 70, 14, P.nature.c),
    stroke('M100 88 C100 122 96 148 88 172', 6, P.nature.a),
    path('M92 140 C74 132 62 136 56 148 C70 156 84 152 92 140 Z', P.nature.a)
  ) })

// · tech ·
I.push({ id: 'laptop-code', name: 'Laptop code', pack: 'tech', tags: ['code', 'dev', 'programming'],
  svg: svg(
    rect(48, 44, 104, 68, 8, P.tech.a),
    rect(56, 52, 88, 52, 4, P.tech.d),
    rect(64, 62, 34, 6, 3, P.tech.b), rect(64, 74, 52, 6, 3, P.tech.c), rect(64, 86, 26, 6, 3, P.tech.e),
    stroke('M142 62 L152 70 L142 78', 4, P.tech.b),
    stroke('M130 62 L120 70 L130 78', 4, P.tech.b),
    path('M32 118 L168 118 L158 138 L42 138 Z', P.tech.e),
    rect(88, 124, 24, 4, 2, P.tech.d)
  ) })
I.push({ id: 'smartphone-app', name: 'Smartphone app', pack: 'tech', tags: ['phone', 'mobile', 'app'],
  svg: svg(
    rect(66, 26, 68, 128, 14, P.tech.a),
    rect(74, 40, 52, 100, 6, P.tech.d),
    rect(88, 32, 24, 6, 3, P.tech.e),
    circ(90, 58, 12, P.tech.b), circ(122, 58, 12, P.tech.c),
    rect(78, 80, 24, 16, 5, P.tech.c), rect(110, 80, 24, 16, 5, P.tech.b),
    rect(78, 104, 24, 16, 5, P.tech.e), rect(110, 104, 24, 16, 5, P.tech.c),
    circ(100, 132, 7, P.tech.b)
  ) })
I.push({ id: 'cloud-sync', name: 'Cloud sync', pack: 'tech', tags: ['cloud', 'sync', 'backup'],
  svg: svg(
    circ(70, 92, 26, P.tech.b), circ(100, 76, 32, P.tech.b), circ(130, 94, 24, P.tech.b),
    rect(66, 92, 70, 26, 13, P.tech.b),
    stroke('M76 122 C80 142 120 142 124 122', 8, P.tech.a),
    poly([[124, 112], [136, 126], [118, 130]], P.tech.a),
    poly([[76, 132], [64, 118], [82, 114]], P.tech.a),
    circ(62, 46, 5, P.tech.c), circ(146, 52, 4, P.tech.e)
  ) })
I.push({ id: 'database-server', name: 'Database server', pack: 'tech', tags: ['database', 'server', 'data'],
  svg: svg(
    ell(100, 52, 44, 16, P.tech.b), rect(56, 52, 88, 26, 0, P.tech.b), ell(100, 78, 44, 16, P.tech.c),
    ell(100, 90, 44, 16, P.tech.b), rect(56, 90, 88, 26, 0, P.tech.b), ell(100, 116, 44, 16, P.tech.c),
    ell(100, 128, 44, 16, P.tech.b), rect(56, 128, 88, 26, 0, P.tech.b), ell(100, 154, 44, 16, P.tech.c),
    circ(148, 65, 4, P.tech.d), circ(148, 103, 4, P.tech.d), circ(148, 141, 4, P.tech.d)
  ) })
I.push({ id: 'ai-chip', name: 'AI chip', pack: 'tech', tags: ['ai', 'chip', 'processor'],
  svg: svg(
    rect(58, 58, 84, 84, 12, P.tech.c),
    rect(72, 72, 56, 56, 8, P.tech.a),
    circ(88, 88, 8, P.tech.b), circ(112, 88, 8, P.tech.d), circ(88, 112, 8, P.tech.d), circ(112, 112, 8, P.tech.b),
    rect(46, 76, 12, 6, 3, P.tech.e), rect(46, 94, 12, 6, 3, P.tech.e), rect(46, 118, 12, 6, 3, P.tech.e),
    rect(142, 76, 12, 6, 3, P.tech.e), rect(142, 94, 12, 6, 3, P.tech.e), rect(142, 118, 12, 6, 3, P.tech.e),
    rect(76, 46, 6, 12, 3, P.tech.e), rect(97, 46, 6, 12, 3, P.tech.e), rect(118, 46, 6, 12, 3, P.tech.e),
    rect(76, 142, 6, 12, 3, P.tech.e), rect(97, 142, 6, 12, 3, P.tech.e), rect(118, 142, 6, 12, 3, P.tech.e)
  ) })
I.push({ id: 'wifi-signal', name: 'Wifi signal', pack: 'tech', tags: ['wifi', 'internet', 'connection'],
  svg: svg(
    stroke('M40 92 C70 62 130 62 160 92', 12, P.tech.a),
    stroke('M62 116 C82 96 118 96 138 116', 12, P.tech.e),
    stroke('M84 138 C92 130 108 130 116 138', 12, P.tech.b),
    circ(100, 160, 11, P.tech.c),
    star(48, 52, 7, P.tech.b), star(158, 52, 7, P.tech.b)
  ) })
I.push({ id: 'robot-helper', name: 'Robot helper', pack: 'tech', tags: ['robot', 'assistant', 'automation'],
  svg: svg(
    stroke('M100 42 L100 30', 5, P.tech.e), circ(100, 26, 7, P.tech.c),
    rect(64, 42, 72, 56, 16, P.tech.a),
    circ(84, 68, 9, P.tech.b), circ(116, 68, 9, P.tech.b),
    rect(86, 84, 28, 8, 4, P.tech.c),
    rect(72, 106, 56, 48, 14, P.tech.e),
    rect(84, 118, 32, 8, 4, P.tech.b),
    rect(50, 110, 16, 34, 8, P.tech.c), rect(134, 110, 16, 34, 8, P.tech.c),
    rect(78, 158, 12, 16, 5, P.tech.a), rect(110, 158, 12, 16, 5, P.tech.a)
  ) })
I.push({ id: 'circuit-board', name: 'Circuit board', pack: 'tech', tags: ['circuit', 'hardware', 'electronics'],
  svg: svg(
    rect(36, 48, 128, 104, 10, P.tech.a),
    rect(80, 78, 40, 40, 6, P.tech.c),
    circ(84, 98, 4, P.tech.b), circ(100, 98, 4, P.tech.b), circ(116, 98, 4, P.tech.b),
    stroke('M80 88 L60 88 L60 66', 4, P.tech.b), stroke('M120 108 L140 108 L140 136', 4, P.tech.b),
    stroke('M80 108 L60 108 L60 132', 4, P.tech.e), stroke('M120 88 L142 88 L142 64', 4, P.tech.e),
    circ(60, 66, 5, P.tech.b), circ(140, 136, 5, P.tech.b), circ(60, 132, 5, P.tech.e), circ(142, 64, 5, P.tech.e),
    circ(52, 60, 5, P.tech.d), circ(148, 140, 5, P.tech.d)
  ) })

// · abstract ·
I.push({ id: 'blob-duo', name: 'Blob duo', pack: 'abstract', tags: ['blob', 'organic', 'shapes'],
  svg: svg(
    path('M64 44 C92 28 128 40 134 68 C140 96 118 120 90 120 C60 120 36 100 38 72 C39 58 50 50 64 44 Z', P.abstract.a),
    path('M120 92 C146 80 168 94 166 118 C164 142 140 156 118 148 C96 140 92 112 104 100 C108 96 114 94 120 92 Z', P.abstract.b),
    path('M96 108 C112 102 128 112 126 126 C124 140 108 148 96 142 C84 136 82 114 96 108 Z', P.abstract.c)
  ) })
I.push({ id: 'gradient-spheres', name: 'Gradient spheres', pack: 'abstract', tags: ['gradient', 'sphere', 'balls'],
  svg: svg(
    grad('gs1', P.abstract.a, P.abstract.e),
    grad('gs2', P.abstract.b, P.abstract.e),
    grad('gs3', P.abstract.c, P.abstract.d),
    circ(72, 76, 38, 'url(#gs1)'),
    circ(134, 96, 30, 'url(#gs2)'),
    circ(96, 146, 24, 'url(#gs3)')
  ) })
I.push({ id: 'wave-lines', name: 'Wave lines', pack: 'abstract', tags: ['wave', 'lines', 'flow'],
  svg: svg(
    stroke('M16 56 C56 36 96 76 136 56 C160 44 178 50 188 60', 10, P.abstract.a),
    stroke('M16 92 C56 72 96 112 136 92 C160 80 178 86 188 96', 10, P.abstract.b),
    stroke('M16 128 C56 108 96 148 136 128 C160 116 178 122 188 132', 10, P.abstract.c),
    stroke('M16 164 C56 144 96 184 136 164 C160 152 178 158 188 168', 10, P.abstract.d)
  ) })
I.push({ id: 'geometric-stack', name: 'Geometric stack', pack: 'abstract', tags: ['geometric', 'stack', 'layers'],
  svg: svg(
    poly([[100, 24], [152, 60], [100, 96], [48, 60]], P.abstract.a),
    poly([[100, 66], [152, 102], [100, 138], [48, 102]], P.abstract.b),
    poly([[100, 108], [152, 144], [100, 180], [48, 144]], P.abstract.c),
    circ(100, 60, 8, P.abstract.d), circ(100, 102, 8, P.abstract.d), circ(100, 144, 8, P.abstract.d)
  ) })
I.push({ id: 'spiral-motion', name: 'Spiral motion', pack: 'abstract', tags: ['spiral', 'motion', 'swirl'],
  svg: svg(
    stroke('M100 100 C100 84 116 76 130 82 C150 90 154 116 142 134 C126 158 92 158 74 138 C52 114 56 78 80 60 C108 40 150 46 166 76', 12, P.abstract.a),
    circ(100, 100, 10, P.abstract.b),
    star(170, 66, 9, P.abstract.c), star(46, 140, 7, P.abstract.d)
  ) })
I.push({ id: 'confetti-burst', name: 'Confetti burst', pack: 'abstract', tags: ['confetti', 'party', 'celebrate'],
  svg: svg(
    star(100, 100, 30, P.abstract.c),
    circ(100, 100, 10, P.abstract.d),
    rect(40, 40, 14, 6, 3, P.abstract.a, 30), rect(150, 44, 14, 6, 3, P.abstract.b, -20),
    rect(36, 140, 14, 6, 3, P.abstract.d, -35), rect(156, 138, 14, 6, 3, P.abstract.e, 25),
    circ(52, 88, 7, P.abstract.b), circ(148, 92, 7, P.abstract.d), circ(88, 34, 6, P.abstract.c), circ(112, 166, 6, P.abstract.a),
    rect(92, 24, 16, 5, 2, P.abstract.c, 12), rect(96, 172, 16, 5, 2, P.abstract.a, -10)
  ) })
I.push({ id: 'fluid-ribbon', name: 'Fluid ribbon', pack: 'abstract', tags: ['ribbon', 'fluid', 'dance'],
  svg: svg(
    path('M20 100 C40 40 90 40 110 90 C130 140 160 150 184 110 L184 140 C150 180 104 164 84 118 C68 82 44 82 20 130 Z', P.abstract.a),
    path('M20 60 C44 20 96 18 120 58 C142 96 160 100 184 78 L184 106 C152 132 122 122 102 86 C84 52 46 52 20 92 Z', P.abstract.b),
    path('M20 158 C40 132 66 132 82 150 C98 168 126 172 148 156 C164 144 176 146 184 152 L184 168 C154 184 116 180 96 164 C80 150 60 150 20 176 Z', P.abstract.c),
    star(166, 36, 10, P.abstract.d)
  ) })
I.push({ id: 'crystal-shards', name: 'Crystal shards', pack: 'abstract', tags: ['crystal', 'shards', 'gems'],
  svg: svg(
    poly([[72, 32], [92, 76], [60, 88], [48, 56]], P.abstract.b),
    poly([[92, 76], [128, 62], [136, 100], [60, 88]], P.abstract.e),
    poly([[60, 88], [136, 100], [104, 168], [52, 128]], P.abstract.a),
    poly([[104, 168], [136, 100], [156, 132], [128, 172]], P.abstract.c),
    poly([[60, 88], [52, 128], [30, 112], [36, 80]], P.abstract.d)
  ) })

// · festive ·
I.push({ id: 'birthday-cake', name: 'Birthday cake', pack: 'festive', tags: ['birthday', 'cake', 'party'],
  svg: svg(
    rect(48, 108, 104, 30, 6, P.festive.d),
    rect(38, 134, 124, 34, 8, P.festive.a),
    path('M48 108 C58 122 68 122 78 110 C88 124 100 124 110 110 C120 124 132 124 142 110 C148 118 150 118 152 112 L152 108 Z', P.festive.c),
    rect(70, 92, 8, 20, 3, P.festive.e), rect(96, 84, 8, 28, 3, P.festive.e), rect(122, 92, 8, 20, 3, P.festive.e),
    ell(74, 84, 5, 8, P.festive.b), ell(100, 76, 5, 8, P.festive.b), ell(126, 84, 5, 8, P.festive.b),
    circ(64, 148, 5, P.festive.c), circ(90, 150, 5, P.festive.c), circ(116, 148, 5, P.festive.c), circ(140, 150, 5, P.festive.c)
  ) })
I.push({ id: 'party-popper', name: 'Party popper', pack: 'festive', tags: ['party', 'popper', 'celebration'],
  svg: svg(
    poly([[30, 190], [14, 108], [86, 140]], P.festive.a),
    poly([[30, 190], [14, 108], [50, 124]], P.festive.d),
    stroke('M60 128 L86 76', 6, P.festive.b), stroke('M84 138 L128 108', 6, P.festive.c),
    stroke('M70 116 L64 68', 6, P.festive.c), stroke('M100 128 L144 128', 6, P.festive.b),
    star(120, 60, 16, P.festive.b), star(160, 92, 12, P.festive.c), star(92, 42, 10, P.festive.a),
    circ(150, 52, 6, P.festive.c), circ(170, 130, 5, P.festive.a), circ(136, 80, 5, P.festive.d)
  ) })
I.push({ id: 'gift-box', name: 'Gift box', pack: 'festive', tags: ['gift', 'present', 'box'],
  svg: svg(
    rect(44, 84, 112, 84, 8, P.festive.d),
    rect(36, 64, 128, 26, 8, P.festive.a),
    rect(90, 64, 20, 104, 0, P.festive.c),
    path('M100 64 C80 40 52 44 56 58 C60 72 84 68 100 64 Z', P.festive.c),
    path('M100 64 C120 40 148 44 144 58 C140 72 116 68 100 64 Z', P.festive.c),
    circ(100, 62, 7, P.festive.b)
  ) })
I.push({ id: 'balloons', name: 'Balloons', pack: 'festive', tags: ['balloons', 'party', 'float'],
  svg: svg(
    ell(64, 74, 30, 36, P.festive.a), poly([[56, 106], [72, 106], [64, 116]], P.festive.d),
    ell(132, 92, 26, 32, P.festive.b), poly([[125, 120], [139, 120], [132, 129]], P.festive.d),
    ell(96, 50, 22, 27, P.festive.c), poly([[90, 74], [102, 74], [96, 82]], P.festive.d),
    stroke('M64 116 C56 142 68 158 58 184', 4, P.festive.d),
    stroke('M132 129 C126 152 140 168 130 190', 4, P.festive.d),
    stroke('M96 82 C90 106 102 122 92 146', 4, P.festive.d),
    ell(56, 62, 7, 10, P.festive.e, -20), ell(124, 80, 6, 9, P.festive.e, -20), ell(90, 42, 5, 8, P.festive.e, -20)
  ) })
I.push({ id: 'fireworks', name: 'Fireworks', pack: 'festive', tags: ['fireworks', 'new-year', 'celebrate'],
  svg: svg(
    star(64, 76, 10, P.festive.c),
    stroke('M64 62 L64 34', 5, P.festive.b), stroke('M64 90 L64 118', 5, P.festive.b),
    stroke('M50 76 L24 66', 5, P.festive.b), stroke('M78 76 L104 66', 5, P.festive.b),
    stroke('M54 66 L38 46', 5, P.festive.c), stroke('M74 66 L90 46', 5, P.festive.c),
    star(140, 118, 10, P.festive.c),
    stroke('M140 104 L140 76', 5, P.festive.a), stroke('M140 132 L140 160', 5, P.festive.a),
    stroke('M126 118 L100 108', 5, P.festive.a), stroke('M154 118 L180 108', 5, P.festive.a),
    star(104, 158, 7, P.festive.b), star(42, 150, 6, P.festive.c), star(172, 60, 6, P.festive.a), star(30, 44, 5, P.festive.b)
  ) })
I.push({ id: 'holly-wreath', name: 'Holly wreath', pack: 'festive', tags: ['christmas', 'holly', 'wreath'],
  svg: svg(
    circ(100, 100, 62, 'none', 'stroke="#1E5B34" stroke-width="22"'),
    path('M100 40 C88 50 88 60 100 66 C112 60 112 50 100 40 Z', '#2D7A45'),
    path('M100 134 C88 144 88 154 100 160 C112 154 112 144 100 134 Z', '#2D7A45'),
    path('M44 96 C34 106 36 118 48 120 C56 110 54 100 44 96 Z', '#2D7A45'),
    path('M156 96 C166 106 164 118 152 120 C144 110 146 100 156 96 Z', '#2D7A45'),
    star(76, 88, 13, P.festive.a), star(126, 96, 11, P.festive.a), star(96, 128, 10, P.festive.a),
    star(120, 60, 8, P.festive.a), star(66, 122, 8, P.festive.a),
    star(100, 100, 18, P.festive.c)
  ) })
I.push({ id: 'lantern-glow', name: 'Lantern glow', pack: 'festive', tags: ['lantern', 'light', 'festival'],
  svg: svg(
    grad('lg1', P.festive.c, P.festive.b, 'radial'),
    circ(100, 104, 62, 'url(#lg1)'),
    rect(84, 44, 32, 12, 6, P.festive.d),
    rect(72, 56, 56, 96, 16, P.festive.c),
    rect(78, 68, 44, 72, 10, P.festive.e),
    rect(80, 60, 40, 8, 4, P.festive.b), rect(80, 140, 40, 8, 4, P.festive.b),
    rect(94, 152, 12, 10, 4, P.festive.d),
    stroke('M100 162 L100 184', 4, P.festive.d), circ(100, 188, 5, P.festive.a)
  ) })
I.push({ id: 'champagne-toast', name: 'Champagne toast', pack: 'festive', tags: ['champagne', 'toast', 'celebration'],
  svg: svg(
    path('M58 30 L86 30 L82 66 C80 76 64 76 62 66 Z', P.festive.e),
    stroke('M72 76 L70 122', 5, P.festive.e), ell(70, 128, 12, 6, P.festive.d),
    path('M114 30 L142 30 L138 66 C136 76 120 76 118 66 Z', P.festive.e),
    stroke('M128 76 L126 122', 5, P.festive.e), ell(126, 128, 12, 6, P.festive.d),
    circ(70, 46, 4, P.festive.c), circ(76, 58, 3, P.festive.c), circ(66, 60, 3, P.festive.b),
    circ(126, 46, 4, P.festive.c), circ(132, 58, 3, P.festive.c), circ(122, 60, 3, P.festive.b),
    star(100, 40, 14, P.festive.c), star(46, 52, 8, P.festive.b), star(156, 52, 8, P.festive.b),
    star(100, 88, 7, P.festive.b)
  ) })

// ── emit TypeScript ───────────────────────────────────────────
const header = `// ─────────────────────────────────────────────────────────────
// Canvix illustration packs (v0.17 Wave 2) — original flat art
// authored in-house (clean-room: composed from primitives by
// scripts/gen-illustrations.mjs — nothing copied from elsewhere).
// 6 packs × 8 illustrations = 48 pieces. Each SVG is standalone,
// viewBox 0 0 200 200, transparent background, 2–4 colours that
// read on both white and the #0F1015 dark asset cards.
// ─────────────────────────────────────────────────────────────

export type IllustrationPack = 'business' | 'people' | 'nature' | 'tech' | 'abstract' | 'festive'

export interface IllustrationDef {
  id: string
  name: string
  pack: IllustrationPack
  tags: string[]
  svg: string
}

export const ILLUSTRATION_PACKS: { id: IllustrationPack; label: string }[] = [
  { id: 'business', label: 'Business' },
  { id: 'people', label: 'People' },
  { id: 'nature', label: 'Nature' },
  { id: 'tech', label: 'Tech' },
  { id: 'abstract', label: 'Abstract' },
  { id: 'festive', label: 'Festive' },
]

`

const body = I.map((d) => `  {\n    id: '${d.id}',\n    name: '${d.name}',\n    pack: '${d.pack}',\n    tags: [${d.tags.map((t) => `'${t}'`).join(', ')}],\n    svg: ${JSON.stringify(d.svg)},\n  },`).join('\n')

const out = header + 'export const ILLUSTRATIONS: IllustrationDef[] = [\n' + body + '\n]\n'
writeFileSync(new URL('../src/lib/assets/illustrations.ts', import.meta.url), out)
console.log(`wrote ${I.length} illustrations`)
const counts = {}
for (const d of I) counts[d.pack] = (counts[d.pack] ?? 0) + 1
console.log(JSON.stringify(counts))
