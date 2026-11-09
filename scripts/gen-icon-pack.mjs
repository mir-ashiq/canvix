// gen-icon-pack.mjs — build the Canvix offline icon pack (v0.17 Wave 2)
// from the ISC-licensed lucide-react icon set already in node_modules.
// Extracts a curated ~500 icons, converts every node (path/circle/rect/
// line/polyline/polygon) to a single path `d`, scales 24×24 → 100×100
// (the Canvix path-element coordinate box), and emits
// src/lib/assets/icon-pack.ts.
// Run: node scripts/gen-icon-pack.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'

const K = 100 / 24

// ── path d scaler (handles every SVG command lucide emits) ────
const NUM = /-?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g
function scaleD(d) {
  let out = ''
  let i = 0
  const cmds = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) ?? []
  let cmd = null
  let paramIdx = 0
  for (const tok of cmds) {
    if (/[A-Za-z]/.test(tok)) {
      cmd = tok
      paramIdx = 0
      out += tok
      continue
    }
    const n = parseFloat(tok)
    let scaled = n
    switch (cmd) {
      case 'H': case 'h': scaled = n * K; break
      case 'V': case 'v': scaled = n * K; break
      case 'A': case 'a': {
        // params: rx ry rot largeArc sweep x y — scale all but rot/flags
        const j = paramIdx % 7
        if (j === 2 || j === 3 || j === 4) scaled = n
        else scaled = n * K
        break
      }
      default: scaled = n * K
    }
    out += (out.endsWith('.') || /[MmLlHhVvCcSsQqTtAaZz.]/.test(out.slice(-1)) ? '' : '') + String(Math.round(scaled * 100) / 100)
    paramIdx++
  }
  return out
}
// The number concatenation above can glue "M10" + "20" → "M1020". Use a
// cleaner approach instead: rebuild with explicit separators.
function scalePath(d) {
  const segs = d.match(/[MmLlHhVvCcSsQqTtAaZz][^MmLlHhVvCcSsQqTtAaZz]*/g) ?? []
  return segs
    .map((seg) => {
      const cmd = seg[0]
      const rest = seg.slice(1).trim()
      if (!rest) return cmd
      const nums = rest.match(NUM) ?? []
      const scaled = nums.map((tok, idx) => {
        const n = parseFloat(tok)
        if (cmd === 'A' || cmd === 'a') {
          const j = idx % 7
          if (j === 2 || j === 3 || j === 4) return String(n)
        }
        return String(Math.round(n * K * 100) / 100)
      })
      return cmd + scaled.join(' ')
    })
    .join(' ')
}

// ── node → path d converters (24-space; scaled afterwards) ────
const fx = (n) => Math.round(n * 100) / 100
const N = (v) => Number(v)
const KEEP_STRING = new Set(['d', 'points', 'key'])
function nodeToD([tag, rawAttrs]) {
  // lucide emits attributes as STRINGS — coerce numerics before any
  // arithmetic, or `cx + r` silently concatenates ("12"+"10"="1210").
  // `d`/`points` stay strings (they carry their own grammar).
  const attrs = Object.fromEntries(
    Object.entries(rawAttrs).map(([k, v]) => [k, KEEP_STRING.has(k) ? v : N(v)])
  )
  switch (tag) {
    case 'path':
      return String(attrs.d)
    case 'circle': {
      const { cx, cy, r } = attrs
      return `M ${fx(cx - r)} ${fx(cy)} A ${fx(r)} ${fx(r)} 0 1 0 ${fx(cx + r)} ${fx(cy)} A ${fx(r)} ${fx(r)} 0 1 0 ${fx(cx - r)} ${fx(cy)} Z`
    }
    case 'ellipse': {
      const { cx, cy, rx, ry } = attrs
      return `M ${fx(cx - rx)} ${fx(cy)} A ${fx(rx)} ${fx(ry)} 0 1 0 ${fx(cx + rx)} ${fx(cy)} A ${fx(rx)} ${fx(ry)} 0 1 0 ${fx(cx - rx)} ${fx(cy)} Z`
    }
    case 'rect': {
      const { x, y, width: w, height: h, rx = 0, ry = rx } = attrs
      const rr = Math.min(rx, ry, w / 2, h / 2)
      if (!rr) return `M ${fx(x)} ${fx(y)} H ${fx(x + w)} V ${fx(y + h)} H ${fx(x)} Z`
      return (
        `M ${fx(x + rr)} ${fx(y)} H ${fx(x + w - rr)} A ${fx(rr)} ${fx(rr)} 0 0 1 ${fx(x + w)} ${fx(y + rr)} ` +
        `V ${fx(y + h - rr)} A ${fx(rr)} ${fx(rr)} 0 0 1 ${fx(x + w - rr)} ${fx(y + h)} ` +
        `H ${fx(x + rr)} A ${fx(rr)} ${fx(rr)} 0 0 1 ${fx(x)} ${fx(y + h - rr)} ` +
        `V ${fx(y + rr)} A ${fx(rr)} ${fx(rr)} 0 0 1 ${fx(x + rr)} ${fx(y)} Z`
      )
    }
    case 'line': {
      const { x1, y1, x2, y2 } = attrs
      return `M ${fx(x1)} ${fx(y1)} L ${fx(x2)} ${fx(y2)}`
    }
    case 'polyline':
      return `M ${String(rawAttrs.points ?? '').trim().replace(/\s+/g, ' ').split(' ').map((p) => p.replace(',', ' ')).join(' L ')}`
    case 'polygon':
      return `M ${String(rawAttrs.points ?? '').trim().replace(/\s+/g, ' ').split(' ').map((p) => p.replace(',', ' ')).join(' L ')} Z`
    default:
      return null
  }
}

// ── curated icon list (names as in lucide-react) ──────────────
const CURATED = `
home house building-2 building store store-plus factory landmark tent
rocket launch sparkles sparkle wand-2 wand-sparkles star stars star-half
sun moon moon-star cloud cloud-lightning cloud-rain cloud-snow cloud-sun
cloud-moon rainbow umbrella zap snowflake thermometer droplet droplets
waves wind map-map-pin map-pin navigation compass globe globe-2 earth
mountain mountain-snow trees tree-pine tree-deciduous leaf flower flower-2
sprout cactus bird bug dog cat fish rabbit turtle bug-play
heart hearts handshake thumbs-up thumbs-down smile laugh frown meh
angry surprised wink cry kiss laugh cry-smile party-popper crown
trophy medal award gift gift-heart cake candle cake-slice
user users user-plus user-check user-x user-cog contacts id-card
baby child student graduation-cap briefcase business
mail send inbox message-circle message-square messages-square
phone telephone phone-call smartphone mobile smartphone-charging
bell bell-ring bell-plus megaphone broadcast rss
search search-code search-check filter funnel sliders-horizontal
eye eye-off glasses scan scan-face scan-line view
lock lock-open lock-keyhole key key-round shield shield-check shield-alert
swords sword hammer wrench settings settings-2 tools cog
file file-text file-plus file-check file-x file-search file-code
file-image file-audio file-video file-archive file-spreadsheet file-json
files folder folder-plus folder-open folder-search folder-tree
clipboard clipboard-list clipboard-check clipboard-x notebook-pen
book book-open book-marked library bookmark books
pen-tool pencil pencil-line edit-2 edit-3 eraser highlighter
paintbrush paint-roller palette brush spray-can
scissors slice printer printing type case-upper case-lower
bold italic underline strikethrough list list-checks list-todo
align-left align-center align-right align-justify indent indent-decrease
layout layout-grid layout-dashboard layout-template layers layers-2
grid-2x2 grid-3x3 grid-4x4 table table-2 cells
square circle triangle diamond hexagon octagon pentagon
shapes box boxes package package-plus package-check
shopping-cart shopping-bag shopping-basket store-2
credit-card wallet banknote coins receipt percent badge-percent tag
tags ticket tickets scale-3d axis-3d cube cuboid
bar-chart-3 bar-chart-4 bar-chart-big line-chart line-chart-line
pie-chart pie-chart-2 pie-chart-big chart-spline chart-scatter
trending-up trending-down activity radar gauge
target crosshair focus crosshair-2 locate-fixed
lightbulb lightbulb-off lamp desk-lamp flashlight
brain brain-circuit circuit-board cpu microchip bot bot-medical
rocket-2 laptop laptop-2 monitor monitor-smartphone monitor-x
keyboard mouse mouse-pointer mouse-pointer-2 mouse-pointer-click
hard-drive database server cloud-server cloud-cog cloud-upload
wifi wifi-off wifi-hotspot bluetooth signal signal-high
plug plug-2 plug-zap battery battery-charging battery-full power
camera camera-off video video-off videocam videocam-off aperture focus-2
image image-off images film clapperboard video-camera
music music-2 music-3 music-4 guitar piano drum mic mic-2 mic-off
headphones headphones-2 ear volume-2 volume-x radio podcast
play play-circle pause pause-circle skip-forward skip-back
rewind fast-forward repeat shuffle list-music list-video audio-lines
disc-3 disc-album amplifier
calendar calendar-check calendar-plus calendar-x calendar-days calendar-clock
clock clock-1 clock-4 alarm-clock timer timer-off hourglass stopwatch watch
history schedule refresh-cw refresh-ccw rotate-cw rotate-ccw
undo-2 redo-2 arrow-left arrow-right arrow-up arrow-down
arrow-up-left arrow-up-right arrow-down-left arrow-down-right
move move-up move-down move-left move-right expand shrink
maximize minimize maximize-2 minimize-2 fullscreen
chevron-left chevron-right chevron-up chevron-down
chevrons-left chevrons-right chevrons-up chevrons-down
corner-up-left corner-up-right corner-down-left corner-down-right
arrow-up-from-line arrow-down-from-line arrow-left-from-line arrow-right-from-line
log-in log-out enter exit sign-in sign-out
external-link link link-2 link-2-off unlink share share-2 share-3
download upload cloud-download import import-end export
copy cut clipboard-copy paste duplicate file-plus-2 plus minus plus-circle minus-circle
plus-square minus-square x check check-check check-circle-2 x-circle
info alert-triangle alert-circle help-circle question-mark
ban slash delete backspace trash-2 trash
menu menu-x more-horizontal more-vertical ellipsis ellipsis-vertical
dot grid grip grid-grip grip-horizontal grip-vertical dots-3x3
sidebar sidebar-open sidebar-close panel-left panel-right panel-top panel-bottom
app-window app-window-2 window-maximize window-minimize
airplay casting cast picture-in-picture-2
coffee coffee-off cup-soda beer wine wine-off martini cocktail
utensils utensils-crossed chef-hat cooking-pot soup salad sandwich
pizza cookie cake-2 croissant egg-fried donut ice-cream ice-cream-2
apple banana cherry citrus carrot corn
fish-2 beef ham milk milk-off popcorn
plane plane-takeoff plane-landing car car-front bus bus-front train-front
truck ship sailboat anchor bike scooter rocket-3
map map-2 map-pin-off route navigation-2 mile-stone
luggage baggage-claims passport ticket-plane
beach umbrella-2 sun-snow palm-tree island
swim-run dumbbell bicycle bike-2 activity-2 heart-pulse
volleyball trophy-2 medal-2 jersey whistle
flag flag-triangle-right flag-off
pin pin-off map-pin-2 map-pin-check
at-sign at-sign-2 hash hashtag hashtag-2
message-circle-2 message-square-2 message-square-dots
bot-message-square messages-square-2
air-vent air-vent-2 wind-2
feather feather-2 quill
scroll scroll-text book-copy book-x book-lock
bookmark-check bookmark-plus bookmark-x bookmark-minus
graduation-cap-2 school university
calculator calculator-2 abacus sigma infinity divide pi
flask-conical flask-round beaker test-tube test-tube-2 microscope dna atom
orbit orbit-2 telescope satellite satellite-dish
orbit-3 eclipse
sparkle sparkles-2 star-off star-star
verified badge-check badge-x badge-alert badge-info
sticker sticker-2 sticky-note post-it
signature signature-2 fingerprint footprint
magnet magnet-2 zap-2 zap-off
siren siren-2 megaphone-2
wallpaper image-plus image-down image-up image-x image-play
gallery-horizontal gallery-vertical gallery-thumbnails
gallery-horizontal-end gallery-vertical-end
aspect-ratio ratio crop crop-2
contrast brightness-2 sun-medium sun-dim
sunglasses-2 lens focus-3
palette-2 color-filter color-filter-2
blend droplet-2 paint-drip
shapes-2 scissors-2 scissors-line-dashed
magic-wand sparkle-3 wand wand-3
layers-3 group group-2 combine split
flip-horizontal-2 flip-vertical-2 flip-horizontal flip-vertical
bring-to-front send-to-back move-3d move-diagonal move-diagonal-2
square-dashed square-dashed-bottom square-stack-2
frame frames-2
opacity-2 opacity-2
`.trim().split(/\s+/)

// ── extraction ────────────────────────────────────────────────
const iconDir = new URL('../node_modules/lucide-react/dist/esm/icons/', import.meta.url)
const available = new Set(readdirSync(iconDir).map((f) => f.replace(/\.js$/, '')))

const seen = new Set()
const picked = []
for (const name of CURATED) {
  if (seen.has(name) || !available.has(name)) continue
  seen.add(name)
  picked.push(name)
}

const pretty = (id) =>
  id.split('-').map((w) => (w.length <= 1 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ')

const icons = []
let skipped = []
for (const name of picked) {
  let file = name
  let src = readFileSync(new URL(`../node_modules/lucide-react/dist/esm/icons/${file}.js`, import.meta.url), 'utf8')
  // alias modules re-export another icon — follow one hop
  const alias = src.match(/export \{ default \} from '\.\/([^']+?)\.js';/)
  if (alias && available.has(alias[1])) {
    file = alias[1]
    src = readFileSync(new URL(`../node_modules/lucide-react/dist/esm/icons/${file}.js`, import.meta.url), 'utf8')
  }
  const m = src.match(/const __iconNode = (\[[\s\S]*?\]);/)
  if (!m) {
    skipped.push(name)
    continue
  }
  // safe-ish eval of the literal (module-controlled input)
  let node
  try {
    node = Function(`"use strict"; return (${m[1]})`)()
  } catch {
    skipped.push(name)
    continue
  }
  const ds = []
  let ok = true
  for (const entry of node) {
    const d = nodeToD(entry)
    if (!d) {
      ok = false
      break
    }
    ds.push(d)
  }
  if (!ok || !ds.length) {
    skipped.push(name)
    continue
  }
  icons.push({ id: name, name: pretty(name), tags: name.split('-'), d: scalePath(ds.join(' ')) })
}
// alias names that resolved to a base icon already present under its own
// name would duplicate the same art — dedupe by path data, keep the first.
const seenD = new Set()
const deduped = []
for (const i of icons) {
  if (seenD.has(i.d)) continue
  seenD.add(i.d)
  deduped.push(i)
}
icons.length = 0
icons.push(...deduped)

if (icons.length < 400) {
  console.error(`only ${icons.length} icons — curated list needs attention`)
  process.exit(1)
}

const header = `// ─────────────────────────────────────────────────────────────
// Canvix offline icon pack (v0.17 Wave 2) — ${icons.length} stroke icons
// extracted from the ISC-licensed lucide-react ${'${LUCIDE_VERSION}'}set at build
// time by scripts/gen-icon-pack.mjs, flattened to single path data in
// the Canvix 100×100 path box. Icons are STROKE art: insert with
// fill="transparent", stroke=<colour>, strokeWidth≈8.3.
// ─────────────────────────────────────────────────────────────

export interface IconDef {
  id: string
  name: string
  tags: string[]
  /** single path d, authored in a 100×100 box (stroke-oriented) */
  d: string
}

`

const body = icons
  .map((i) => `  { id: ${JSON.stringify(i.id)}, name: ${JSON.stringify(i.name)}, tags: ${JSON.stringify(i.tags)}, d: ${JSON.stringify(i.d)} },`)
  .join('\n')

const out =
  header +
  'export const ICONS: IconDef[] = [\n' +
  body +
  '\n]\n\n/** offline search — name/tag substring match, ranked: name prefix > name > tag */\nexport function searchIcons(query: string, limit = 120): IconDef[] {\n  const q = query.trim().toLowerCase()\n  if (!q) return ICONS.slice(0, limit)\n  const scored: { icon: IconDef; score: number }[] = []\n  for (const icon of ICONS) {\n    const name = icon.name.toLowerCase()\n    let score = -1\n    if (name.startsWith(q)) score = 0\n    else if (name.includes(q)) score = 1\n    else if (icon.tags.some((t) => t.startsWith(q))) score = 2\n    else if (icon.tags.some((t) => t.includes(q))) score = 3\n    if (score >= 0) scored.push({ icon, score })\n  }\n  return scored.sort((a, b) => a.score - b.score || a.icon.name.localeCompare(b.icon.name)).slice(0, limit).map((s) => s.icon)\n}\n'

writeFileSync(new URL('../src/lib/assets/icon-pack.ts', import.meta.url), out)
console.log(`wrote ${icons.length} icons (skipped: ${skipped.length ? skipped.join(', ') : 'none'})`)
