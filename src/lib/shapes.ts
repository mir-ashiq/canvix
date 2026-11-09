// ─────────────────────────────────────────────────────────────
// Canvix v0.18 (Wave 3) — parametric shape & mask geometry
//
// One pure module every renderer shares (the chart-geometry pattern):
// the Konva canvas, the SVG serializer and the video-export frame
// builder all map the SAME point arrays, so a polygon masked by a
// heart looks identical everywhere. No Konva/DOM imports — it also
// runs in unit tests and (future) server-side rendering.
//
// Authoring space: every generator emits points in a 100×100 box
// (the same convention ShapeElement.pathData uses), so callers
// scale once into the element box.
// ─────────────────────────────────────────────────────────────

export type Pt = [number, number]

/** Wrap an angle into [0, 2π). */
function normAngle(a: number): number {
  const TAU = Math.PI * 2
  return ((a % TAU) + TAU) % TAU
}

/** Regular polygon vertices in a 100×100 box, first vertex at the top.
 * `sides` is clamped to 3..12 (the picker range). */
export function polygonPoints(sides: number): Pt[] {
  const n = clampInt(sides, 3, 12)
  const cx = 50
  const cy = 50
  const r = 48 // slight inset so strokes stay inside the box
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return out
}

/** Star vertices in a 100×100 box, first outer point at the top.
 * `points` clamped 3..16, `innerRatio` clamped 0.15..0.85 (default 0.55 —
 * the classic five-pointer the pre-v0.18 editor hardcoded). */
export function starPointsEx(points: number, innerRatio?: number): Pt[] {
  const n = clampInt(points, 3, 16)
  const ratio = clampNum(innerRatio ?? 0.55, 0.15, 0.85)
  const cx = 50
  const cy = 50
  const outer = 48
  const inner = outer * ratio
  const out: Pt[] = []
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i / (n * 2)) * Math.PI * 2
    const r = i % 2 === 0 ? outer : inner
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return out
}

// ── Image masks ──────────────────────────────────────────────

/** The ten preset mask shapes + the two parametric "custom" modes.
 * Order here IS the picker order. */
export const MASK_SHAPES = [
  'none',
  'circle',
  'rounded',
  'arch',
  'triangle',
  'diamond',
  'pentagon',
  'hexagon',
  'star',
  'heart',
  'blob',
  'poly',
  'polyStar',
] as const

export type MaskShape = (typeof MASK_SHAPES)[number]

export const MASK_SHAPE_LABELS: Record<MaskShape, string> = {
  none: 'None',
  circle: 'Circle',
  rounded: 'Rounded',
  arch: 'Arch',
  triangle: 'Triangle',
  diamond: 'Diamond',
  pentagon: 'Pentagon',
  hexagon: 'Hexagon',
  star: 'Star',
  heart: 'Heart',
  blob: 'Blob',
  poly: 'Polygon',
  polyStar: 'Star burst',
}

export function isMaskShape(v: unknown): v is MaskShape {
  return typeof v === 'string' && (MASK_SHAPES as readonly string[]).includes(v)
}

/** True when the mask needs the `maskSides` (+ `maskInnerRatio`) params. */
export function isParametricMask(shape: MaskShape): boolean {
  return shape === 'poly' || shape === 'polyStar'
}

/** A circle sampled as a polygon — smooth at any render size. */
function circlePts(segments = 72): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    out.push([50 + 48 * Math.cos(a), 50 + 48 * Math.sin(a)])
  }
  return out
}

/** Squircle-ish rounded square: straight edges + quarter arcs. */
function roundedPts(radius = 22, segments = 14): Pt[] {
  const out: Pt[] = []
  const corners: Array<[number, number]> = [
    [50 + 50 - radius, 50 + 50 - radius],
    [50 - 50 + radius, 50 + 50 - radius],
    [50 - 50 + radius, 50 - 50 + radius],
    [50 + 50 - radius, 50 - 50 + radius],
  ]
  // corner arcs, counter-clockwise consistent with circlePts
  const startAngles = [0, Math.PI / 2, Math.PI, -Math.PI / 2]
  for (let c = 0; c < 4; c++) {
    const [cx, cy] = corners[c]
    const a0 = startAngles[c]
    for (let i = 0; i <= segments; i++) {
      const a = a0 + (i / segments) * (Math.PI / 2)
      out.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)])
    }
  }
  return out
}

/** Roman-arch window: full-width semicircle on straight legs. */
function archPts(segments = 36): Pt[] {
  const out: Pt[] = []
  const r = 48
  const cx = 50
  // right leg bottom → arc → left leg bottom
  out.push([cx + r, 98])
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI
    out.push([cx + r * Math.cos(a), 50 + r * Math.sin(a)])
  }
  out.push([cx - r, 98])
  return out
}

/** Heart via the classic parametric curve (t ∈ [0, 2π)). */
function heartPts(segments = 72): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2
    const x = 16 * Math.pow(Math.sin(t), 3)
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))
    // (x, y) spans ≈ [-16, 16] × [-11, 17] → map into the 100-box
    out.push([50 + x * 2.9, 50 + y * 2.7])
  }
  // tiny inset so the top dimples stay inside the box
  return out.map(([x, y]) => [50 + (x - 50) * 0.96, 50 + (y - 50) * 0.96] as Pt)
}

/** Organic blob: a fixed-seed polar wobble — deterministic so every
 * replica (and every export) renders the SAME blob. */
function blobPts(segments = 72): Pt[] {
  const harmonics: Array<[number, number]> = [
    [2, 0.10],
    [3, -0.07],
    [5, 0.045],
  ]
  const out: Pt[] = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    let r = 0.78
    for (const [k, amp] of harmonics) r += amp * Math.cos(k * a + k * 1.7)
    out.push([50 + 50 * r * Math.cos(a), 50 + 50 * r * Math.sin(a)])
  }
  return out
}

/**
 * The mask's clip polygon in 100×100 authoring space.
 * `shape === 'none'` returns null (caller skips clipping entirely).
 */
export function maskPolygon(shape: MaskShape, sides?: number, innerRatio?: number): Pt[] | null {
  switch (shape) {
    case 'none':
      return null
    case 'circle':
      return circlePts()
    case 'rounded':
      return roundedPts()
    case 'arch':
      return archPts()
    case 'triangle':
      // flat-bottom triangle, apex at the top
      return [
        [50, 3],
        [97, 95],
        [3, 95],
      ]
    case 'diamond':
      return [
        [50, 2],
        [98, 50],
        [50, 98],
        [2, 50],
      ]
    case 'pentagon':
      return polygonPoints(5)
    case 'hexagon':
      return polygonPoints(6)
    case 'star':
      return starPointsEx(5, 0.55)
    case 'heart':
      return heartPts()
    case 'blob':
      return blobPts()
    case 'poly':
      return polygonPoints(sides ?? 6)
    case 'polyStar':
      return starPointsEx(sides ?? 6, innerRatio ?? 0.55)
    default:
      return null
  }
}

/** Scale 100-box points into an element box (w × h) and offset by (x, y). */
export function scalePts(pts: Pt[], x: number, y: number, w: number, h: number): Pt[] {
  const sx = w / 100
  const sy = h / 100
  return pts.map(([px, py]) => [x + px * sx, y + py * sy] as Pt)
}

/** The SHAPE mapping — the generating 48-radius circle fills the whole
 * element box (centre-based stretch), so polygon/star elements match
 * rect/ellipse/triangle behaviour exactly: a vertex lands on the box
 * edge, and a non-square box stretches the shape. `scalePts` above is
 * the MASK/pathData convention (linear 100-box, 2 % inset). Both are
 * needed; never swap them. */
export function stretchPts(pts: Pt[], x: number, y: number, w: number, h: number): Pt[] {
  const sx = w / 96
  const sy = h / 96
  const cx = x + w / 2
  const cy = y + h / 2
  return pts.map(([px, py]) => [cx + (px - 50) * sx, cy + (py - 50) * sy] as Pt)
}

/** "x,y x,y …" for SVG <polygon points>. */
export function ptsToSvg(pts: Pt[]): string {
  return pts.map(([x, y]) => `${round2(x)},${round2(y)}`).join(' ')
}

/** Draw a 100-box polygon into a canvas-like 2D context (Konva
 * clipShapeFunc passes its wrapper — it forwards the standard API). */
export function tracePts(ctx: {
  beginPath: () => void
  moveTo: (x: number, y: number) => void
  lineTo: (x: number, y: number) => void
  closePath: () => void
}, pts: Pt[], w: number, h: number): void {
  const sx = w / 100
  const sy = h / 100
  ctx.beginPath()
  pts.forEach(([px, py], i) => {
    const X = px * sx
    const Y = py * sy
    if (i === 0) ctx.moveTo(X, Y)
    else ctx.lineTo(X, Y)
  })
  ctx.closePath()
}

// ── shared numeric clamps (mirrors the repo's sanitiser style) ──

export function clampNum(v: unknown, min: number, max: number, fallback = min): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export function clampInt(v: unknown, min: number, max: number, fallback = min): number {
  return Math.round(clampNum(v, min, max, fallback))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export { normAngle }
