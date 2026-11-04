/**
 * v0.14 (D4): the image filter gallery — one pure pixel pipeline that
 * every renderer shares.
 *
 *   editor canvas  → Konva filter wrappers (node.cache() pipeline)
 *   video export   → renderFilteredCanvas() pre-bakes pixels
 *   SVG export     → svgImageFilterParts() approximates with filter
 *                    primitives (documented where approximate)
 *   toolbar chips  → renderFilteredCanvas() on a tiny preview canvas
 *
 * The element contract (ImageElement): `filter` is a preset id from
 * IMAGE_FILTER_PRESETS ('none' = untouched) and `filterIntensity` is
 * 0..100 (default 100). Both are optional for older documents; every
 * reader normalizes through isImageFilterId()/clampFilterIntensity()
 * so a hostile paste or MCP patch can never smuggle junk in.
 *
 * Adjustments (brightness/contrast/saturation, -100..100) live in the
 * same pipeline BEFORE the preset, in the exact order the editor has
 * always applied them: Brighten → Contrast → HSL → preset. The canvas
 * path reproduces Konva's own math bit-for-bit (the formulas below are
 * copied from konva/lib/filters) so the two renderers agree.
 */

// ── presets ───────────────────────────────────────────────────

export interface ImageFilterPreset {
  id: string
  label: string
  /** one-line UI hint (title attr) */
  hint: string
}

export const IMAGE_FILTER_PRESETS: readonly ImageFilterPreset[] = [
  { id: 'none', label: 'Original', hint: 'No filter' },
  { id: 'grayscale', label: 'Mono', hint: 'Classic black & white' },
  { id: 'warm', label: 'Warm', hint: 'Golden-hour warmth' },
  { id: 'cool', label: 'Cool', hint: 'Bluish shadows' },
  { id: 'vintage', label: 'Vintage', hint: 'Faded warm print' },
  { id: 'blur', label: 'Blur', hint: 'Soft gaussian blur' },
  { id: 'sharpen', label: 'Sharpen', hint: 'Crisper edges' },
  { id: 'vignette', label: 'Vignette', hint: 'Darkened corners' },
] as const

const PRESET_IDS = new Set(IMAGE_FILTER_PRESETS.map((p) => p.id))

/** unknown input → boolean (never throws; the sanitizer + MCP patcher
 *  both lean on this to keep junk out of the element) */
export function isImageFilterId(v: unknown): v is string {
  return typeof v === 'string' && PRESET_IDS.has(v)
}

/** 0..100, default 100; NaN/∞/junk fall back to the default */
export function clampFilterIntensity(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 100
  return Math.min(100, Math.max(0, Math.round(n)))
}

// ── the pixel kernels ─────────────────────────────────────────

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

/** intensity t (0..1) lerp helper: (1-t)·a + t·b */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Apply ONE preset to ImageData in place. t = 0 (and 'none') are
 * guaranteed no-ops — the callers rely on that to skip caching work.
 * Unknown ids are silently ignored (defense in depth: readers have
 * already validated, this never throws on hostile input).
 */
export function applyPresetToImageData(data: ImageData, id: string, tRaw: number): void {
  const t = Math.min(1, Math.max(0, Number.isFinite(tRaw) ? tRaw : 0))
  if (t <= 0 || id === 'none') return
  const px = data.data
  const w = data.width
  const h = data.height

  if (id === 'grayscale') {
    for (let i = 0; i < px.length; i += 4) {
      const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
      px[i] = clamp255(lerp(px[i], lum, t))
      px[i + 1] = clamp255(lerp(px[i + 1], lum, t))
      px[i + 2] = clamp255(lerp(px[i + 2], lum, t))
    }
    return
  }

  if (id === 'warm' || id === 'cool') {
    const wr = id === 'warm' ? 1.14 : 0.88
    const wb = id === 'warm' ? 0.86 : 1.12
    const wg = id === 'warm' ? 1.03 : 0.97
    for (let i = 0; i < px.length; i += 4) {
      px[i] = clamp255(lerp(px[i], px[i] * wr, t))
      px[i + 1] = clamp255(lerp(px[i + 1], px[i + 1] * wg, t))
      px[i + 2] = clamp255(lerp(px[i + 2], px[i + 2] * wb, t))
    }
    return
  }

  if (id === 'vintage') {
    // faded warm print: sepia-lerp (0.6 of full sepia), then lift the
    // blacks + slightly flatten contrast — all affine, so the SVG
    // approximation can reproduce it exactly
    const ts = 0.6 * t
    const slope = 1 - 0.12 * t
    const lift = 18 * t
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i]
      const g = px[i + 1]
      const b = px[i + 2]
      const sr = 0.393 * r + 0.769 * g + 0.194 * b
      const sg = 0.349 * r + 0.686 * g + 0.168 * b
      const sb = 0.272 * r + 0.534 * g + 0.131 * b
      px[i] = clamp255((lerp(r, sr, ts) - lift * 0) * slope + lift)
      px[i + 1] = clamp255(lerp(g, sg, ts) * slope + lift)
      px[i + 2] = clamp255(lerp(b, sb, ts) * slope + lift * 0.9)
    }
    return
  }

  if (id === 'blur') {
    // three box passes ≈ gaussian; radius scales with intensity.
    // sub-pixel radii are an honest no-op (no jump at low intensity)
    const radius = Math.round(6 * t)
    if (radius < 1) return
    boxBlurPass(px, w, h, radius, true) // horizontal
    boxBlurPass(px, w, h, radius, false) // vertical
    boxBlurPass(px, w, h, radius, true)
    boxBlurPass(px, w, h, radius, false)
    return
  }

  if (id === 'sharpen') {
    // 3×3 unsharp kernel; edges clamp like feConvolveMatrix duplicate
    const k = 0.9 * t
    if (k <= 0) return
    const src = new Uint8ClampedArray(px)
    for (let y = 0; y < h; y++) {
      const yUp = y > 0 ? y - 1 : 0
      const yDn = y < h - 1 ? y + 1 : h - 1
      for (let x = 0; x < w; x++) {
        const xL = x > 0 ? x - 1 : 0
        const xR = x < w - 1 ? x + 1 : w - 1
        const i = (y * w + x) * 4
        for (let c = 0; c < 3; c++) {
          const up = src[(yUp * w + x) * 4 + c]
          const dn = src[(yDn * w + x) * 4 + c]
          const lf = src[(y * w + xL) * 4 + c]
          const rt = src[(y * w + xR) * 4 + c]
          const me = src[i + c]
          px[i + c] = clamp255(me + k * (4 * me - up - dn - lf - rt))
        }
      }
    }
    return
  }

  if (id === 'vignette') {
    const cx = (w - 1) / 2
    const cy = (h - 1) / 2
    const maxD = Math.sqrt(cx * cx + cy * cy)
    if (maxD <= 0) return
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (x - cx) / maxD
        const dy = (y - cy) / maxD
        const d2 = dx * dx + dy * dy // normalized 0..1, 1 at corners
        const f = 1 - 0.8 * t * Math.pow(d2, 1.1)
        const i = (y * w + x) * 4
        px[i] = clamp255(px[i] * f)
        px[i + 1] = clamp255(px[i + 1] * f)
        px[i + 2] = clamp255(px[i + 2] * f)
      }
    }
    return
  }
  // unknown id: no-op (readers validate; this is the last line of defense)
}

/** one axis of an in-place box blur (edge clamp = duplicate) */
function boxBlurPass(px: Uint8ClampedArray, w: number, h: number, r: number, horizontal: boolean): void {
  const src = new Uint8ClampedArray(px)
  const len = horizontal ? w : h
  const outer = horizontal ? h : w
  const win = r * 2 + 1
  for (let o = 0; o < outer; o++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0
      // seed: clamped window around index 0
      for (let k = -r; k <= r; k++) {
        const idx = Math.min(len - 1, Math.max(0, k))
        sum += horizontal ? src[(o * w + idx) * 4 + c] : src[(idx * w + o) * 4 + c]
      }
      for (let i = 0; i < len; i++) {
        const dst = horizontal ? (o * w + i) * 4 + c : (i * w + o) * 4 + c
        px[dst] = sum / win
        const addI = Math.min(len - 1, i + r + 1)
        const subI = Math.max(0, i - r)
        sum += (horizontal ? src[(o * w + addI) * 4 + c] : src[(addI * w + o) * 4 + c])
        sum -= (horizontal ? src[(o * w + subI) * 4 + c] : src[(subI * w + o) * 4 + c])
      }
    }
  }
}

// ── adjustments (Konva-exact, for the canvas pre-render path) ──

/**
 * Apply brightness/contrast/saturation in the exact order and math the
 * editor's Konva pipeline uses (Brighten → Contrast → HSL; formulas
 * copied from konva/lib/filters). Values are the element's -100..100
 * scale; 0s are no-ops.
 */
export function applyAdjustmentsToImageData(
  data: ImageData,
  brightness: number,
  contrast: number,
  saturation: number
): void {
  const b = Number.isFinite(brightness) ? brightness : 0
  const c = Number.isFinite(contrast) ? contrast : 0
  const s = Number.isFinite(saturation) ? saturation / 100 : 0
  const px = data.data
  const add = (b / 100) * 255
  const adjust = Math.pow((c + 100) / 100, 2)
  // Konva HSL with hue=0, luminance=0 (vsu=s, vsw=0)
  const rr = 0.299 + 0.701 * s
  const rg = 0.587 - 0.587 * s
  const rb = 0.114 - 0.114 * s
  const gr = 0.299 - 0.299 * s
  const gg = 0.587 + 0.413 * s
  const gb = 0.114 - 0.114 * s
  const br = 0.299 - 0.3 * s
  const bg = 0.587 - 0.588 * s
  const bb = 0.114 + 0.886 * s
  const noAdjust = b === 0 && c === 0
  const noSat = s === 0 // s=0 matrix would still map colors to luma — Konva loads HSL only when needed
  if (noAdjust && noSat) return
  for (let i = 0; i < px.length; i += 4) {
    let v0 = px[i] + add // Brighten
    let v1 = px[i + 1] + add
    let v2 = px[i + 2] + add
    if (!noAdjust) {
      // Contrast (normalized around 0.5)
      v0 = ((v0 / 255 - 0.5) * adjust + 0.5) * 255
      v1 = ((v1 / 255 - 0.5) * adjust + 0.5) * 255
      v2 = ((v2 / 255 - 0.5) * adjust + 0.5) * 255
    }
    if (!noSat) {
      // HSL saturation matrix
      const r = v0
      const g = v1
      const bl = v2
      v0 = rr * r + rg * g + rb * bl
      v1 = gr * r + gg * g + gb * bl
      v2 = br * r + bg * g + bb * bl
    }
    px[i] = clamp255(v0)
    px[i + 1] = clamp255(v1)
    px[i + 2] = clamp255(v2)
  }
}

// ── canvas pre-render (video export + toolbar chips) ──────────

const filteredCache = new WeakMap<object, Map<string, HTMLCanvasElement>>()

export interface FilterElementLike {
  brightness?: number
  contrast?: number
  saturation?: number
  filter?: string
  filterIntensity?: number
}

/** true when ANY filter/adjustment would change pixels (skip work otherwise) */
export function imageHasFilters(el: FilterElementLike): boolean {
  const preset = isImageFilterId(el.filter) ? el.filter : 'none'
  const t = clampFilterIntensity(el.filterIntensity) / 100
  return (
    (el.brightness ?? 0) !== 0 ||
    (el.contrast ?? 0) !== 0 ||
    (el.saturation ?? 0) !== 0 ||
    (preset !== 'none' && t > 0)
  )
}

/**
 * Draw `source` to a canvas of `w`×`h` with the element's adjustments +
 * preset applied — the pixel-exact twin of the editor's Konva output.
 * Results are memoized per (source, params, size) so per-page rebuilds
 * in the video exporter don't re-bake pixels.
 */
export function renderFilteredCanvas(
  el: FilterElementLike,
  source: CanvasImageSource & object,
  w: number,
  h: number
): HTMLCanvasElement {
  const preset = isImageFilterId(el.filter) ? el.filter : 'none'
  const intensity = clampFilterIntensity(el.filterIntensity)
  const key = `${w}x${h}|${el.brightness ?? 0}|${el.contrast ?? 0}|${el.saturation ?? 0}|${preset}|${intensity}`
  let bySize = filteredCache.get(source)
  if (!bySize) {
    bySize = new Map()
    filteredCache.set(source, bySize)
  }
  const hit = bySize.get(key)
  if (hit) return hit

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w))
  canvas.height = Math.max(1, Math.round(h))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return canvas
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  if (imageHasFilters(el)) {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
    applyAdjustmentsToImageData(data, el.brightness ?? 0, el.contrast ?? 0, el.saturation ?? 0)
    applyPresetToImageData(data, preset, intensity / 100)
    ctx.putImageData(data, 0, 0)
  }
  bySize.set(key, canvas)
  return canvas
}

// ── SVG export approximation ──────────────────────────────────

export interface SvgFilterSink {
  /** push a `<filter>…</filter>` (or gradient) definition */
  defs: (markup: string) => void
  /** allocate a unique id */
  nextId: (prefix: string) => string
}

export interface SvgImageFilterResult {
  /** ` filter="url(#id)"` to append to the <image> tag ('' when none) */
  attr: string
  /**
   * Extra markup to emit AFTER the image (the vignette overlay, which
   * is a clipped gradient rect, not a filter primitive — an honest
   * approximation documented in the module header).
   */
  overlay: string
}

/**
 * SVG approximation of the element's full filter stack
 * (adjustments + preset). Runs inside svg-export's image case.
 *
 * Fidelity notes (documented approximations):
 *   - brightness/contrast → feComponentTransfer linear (exact)
 *   - saturation          → feColorMatrix with Konva's HSL matrix (exact)
 *   - grayscale/warm/cool/vintage → linear color matrices (exact);
 *     vintage's black-lift rides the same feComponentTransfer pass
 *   - sharpen → feConvolveMatrix with the same 3×3 kernel (exact)
 *   - blur    → feGaussianBlur with σ = the gaussian equivalent of
 *     the kernel's 3-pass box stack (exact variance match; the box
 *     stack itself is the approximation of a true gaussian)
 *   - vignette → clipped radial-gradient overlay rect (alpha-over
 *     compositing matches the kernel's multiply falloff shape, stops
 *     approximate the d^2.2 curve)
 */
export function svgImageFilterParts(
  el: FilterElementLike,
  sink: SvgFilterSink,
  bounds: { x: number; y: number; w: number; h: number },
  /** extra attributes for the vignette overlay rect (clip-path /
   *  transform — whatever the caller's image tag carries) */
  overlayAttrs = ''
): SvgImageFilterResult {
  const preset = isImageFilterId(el.filter) ? el.filter : 'none'
  const t = clampFilterIntensity(el.filterIntensity) / 100
  const b = el.brightness ?? 0
  const c = el.contrast ?? 0
  const s = el.saturation ?? 0
  const needBase = b !== 0 || c !== 0 || s !== 0
  const needPreset = preset !== 'none' && t > 0 && preset !== 'vignette'
  const needVignette = preset === 'vignette' && t > 0

  if (!needBase && !needPreset && !needVignette) return { attr: '', overlay: '' }

  const id = sink.nextId('imgf')
  const primitives: string[] = []

  if (needBase) {
    const adjust = Math.pow((c + 100) / 100, 2)
    // Brighten + Contrast fold into one linear transfer per channel
    // (normalized 0..1): v' = slope·v + intercept with
    //   slope = ((c+100)/100)², intercept = 0.5 - 0.5·slope + b/100
    const slope = adjust
    const intercept = 0.5 - 0.5 * adjust + b / 100
    primitives.push(
      `    <feComponentTransfer>\n` +
        ['R', 'G', 'B']
          .map((ch) => `      <feFunc${ch} type="linear" slope="${round(slope)}" intercept="${round(intercept)}" />`)
          .join('\n') +
        `\n    </feComponentTransfer>`
    )
    if (s !== 0) {
      // Konva HSL saturation matrix, hue=0/luminance=0
      const m = [
        round(0.299 + 0.701 * (s / 100)), round(0.587 - 0.587 * (s / 100)), round(0.114 - 0.114 * (s / 100)), 0, 0,
        round(0.299 - 0.299 * (s / 100)), round(0.587 + 0.413 * (s / 100)), round(0.114 - 0.114 * (s / 100)), 0, 0,
        round(0.299 - 0.3 * (s / 100)), round(0.587 - 0.588 * (s / 100)), round(0.114 + 0.886 * (s / 100)), 0, 0,
        0, 0, 0, 1, 0,
      ]
      primitives.push(`    <feColorMatrix type="matrix" values="${m.join(' ')}" />`)
    }
  }

  if (preset === 'grayscale') {
    // exact linear lerp-to-luma: (1-t)·I + t·Luma
    const k = 1 - t
    const m = [
      round(k + 0.299 * t), round(0.587 * t), round(0.114 * t), 0, 0,
      round(0.299 * t), round(k + 0.587 * t), round(0.114 * t), 0, 0,
      round(0.299 * t), round(0.587 * t), round(k + 0.114 * t), 0, 0,
      0, 0, 0, 1, 0,
    ]
    primitives.push(`    <feColorMatrix type="matrix" values="${m.join(' ')}" />`)
  } else if (preset === 'warm' || preset === 'cool') {
    const wr = preset === 'warm' ? 1.14 : 0.88
    const wg = preset === 'warm' ? 1.03 : 0.97
    const wb = preset === 'warm' ? 0.86 : 1.12
    const k = 1 - t
    const m = [
      round(k + wr * t), 0, 0, 0, 0,
      0, round(k + wg * t), 0, 0, 0,
      0, 0, round(k + wb * t), 0, 0,
      0, 0, 0, 1, 0,
    ]
    primitives.push(`    <feColorMatrix type="matrix" values="${m.join(' ')}" />`)
  } else if (preset === 'vintage') {
    // sepia lerp (0.6t) then fade slope/lift — affine, exact
    const ts = 0.6 * t
    const k = 1 - ts
    const m = [
      round(k + 0.393 * ts), round(0.769 * ts), round(0.194 * ts), 0, 0,
      round(0.349 * ts), round(k + 0.686 * ts), round(0.168 * ts), 0, 0,
      round(0.272 * ts), round(0.534 * ts), round(k + 0.131 * ts), 0, 0,
      0, 0, 0, 1, 0,
    ]
    primitives.push(`    <feColorMatrix type="matrix" values="${m.join(' ')}" />`)
    const slope = 1 - 0.12 * t
    const lift = (18 * t) / 255
    primitives.push(
      `    <feComponentTransfer>\n` +
        ['R', 'G', 'B']
          .map((ch, i) => `      <feFunc${ch} type="linear" slope="${round(slope)}" intercept="${round(i === 2 ? lift * 0.9 : lift)}" />`)
          .join('\n') +
        `\n    </feComponentTransfer>`
    )
  } else if (preset === 'blur') {
    // σ of the pixel kernel's 3-pass box stack: sqrt(3·((2r+1)²−1)/12)
    const r = Math.round(6 * t)
    const sigma = Math.sqrt((3 * ((2 * r + 1) * (2 * r + 1) - 1)) / 12)
    primitives.push(`    <feGaussianBlur stdDeviation="${round(sigma)}" edgeMode="duplicate" />`)
  } else if (preset === 'sharpen') {
    // same 3×3 kernel as the pixel path, rounded once, used everywhere
    const k = round(0.9 * t)
    const center = round(1 + 4 * 0.9 * t)
    primitives.push(
      `    <feConvolveMatrix order="3" preserveAlpha="true" edgeMode="duplicate" divisor="1" kernel="0 ${-k} 0 ${-k} ${center} ${-k} 0 ${-k} 0" />`
    )
  }

  let attr = ''
  if (primitives.length) {
    sink.defs(
      `  <filter id="${id}" color-interpolation-filters="sRGB" x="-20%" y="-20%" width="140%" height="140%">\n${primitives.join('\n')}\n  </filter>`
    )
    attr = ` filter="url(#${id})"`
  }

  let overlay = ''
  if (needVignette) {
    const gid = sink.nextId('vgn')
    const { x, y, w, h } = bounds
    const cx = x + w / 2
    const cy = y + h / 2
    const r = Math.sqrt(w * w + h * h) / 2
    // stops approximate the kernel's (1 - 0.8t·d^2.2) falloff
    const a = (d: number) => round(0.8 * t * Math.pow(d, 2.2))
    sink.defs(
      `  <radialGradient id="${gid}" gradientUnits="userSpaceOnUse" cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}">\n` +
        `    <stop offset="0" stop-color="#000000" stop-opacity="0" />\n` +
        `    <stop offset="0.5" stop-color="#000000" stop-opacity="${a(0.5)}" />\n` +
        `    <stop offset="0.75" stop-color="#000000" stop-opacity="${a(0.75)}" />\n` +
        `    <stop offset="1" stop-color="#000000" stop-opacity="${a(1)}" />\n` +
        `  </radialGradient>`
    )
    overlay = `  <rect x="${x}" y="${y}" width="${w}" height="${h}"${overlayAttrs} fill="url(#${gid})" />`
  }

  return { attr, overlay }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}
