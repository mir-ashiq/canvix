// ─────────────────────────────────────────────────────────────
// Canvix local upscaler (Wave 4 — AI Power-Up).
//
// High-quality Lanczos-3 resampling in pure TypeScript — the local half
// of the "Real-ESRGAN / Lanczos" roadmap item. Zero downloads, zero
// provider calls, works offline on ANY image (uploads, stock photos,
// AI generations — the VibesAI-class providers only edit images they
// generated themselves, so local tools are the universal path).
//
// Pipeline: premultiply → separable Lanczos-3 (horizontal, then
// vertical) → unpremultiply. Premultiplication matters for cut-outs
// (the BG remover's alpha PNGs): filtering straight RGBA bleeds the
// color of fully-transparent pixels into the edges of the subject.
// ─────────────────────────────────────────────────────────────

/** A raw RGBA raster (the canvas ImageData shape — Uint8ClampedArray). */
export interface Raster {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** Hard output cap — protects the tab from accidental 16k monsters. */
export const MAX_OUTPUT_SIDE = 8192

/** Largest accepted upscale factor. */
export const MAX_FACTOR = 4

function lanczos3(x: number): number {
  if (x === 0) return 1
  const ax = Math.abs(x)
  if (ax >= 3) return 0
  const px = Math.PI * x
  return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px)
}

/** Clamp an integer factor to the supported range (min 1). */
export function clampFactor(factor: number): number {
  if (Number.isNaN(factor)) return 1
  if (factor === Infinity) return MAX_FACTOR
  const f = Math.floor(factor)
  if (f < 1) return 1
  return Math.min(f, MAX_FACTOR)
}

/**
 * Largest usable factor: never let a side exceed MAX_OUTPUT_SIDE.
 * Returns ≥1 so a tiny upscale of an already-huge image is a no-op
 * (factor 1) rather than an error the UI has to special-case.
 */
export function factorFor(srcW: number, srcH: number, wanted: number): number {
  const f = clampFactor(wanted)
  const maxBySide = Math.max(1, Math.floor(Math.min(MAX_OUTPUT_SIDE / srcW, MAX_OUTPUT_SIDE / srcH)))
  return Math.max(1, Math.min(f, maxBySide))
}

/** One separable pass. `toSrc` maps a destination index to source space. */
function resampleAxis(
  src: Raster,
  dstW: number,
  dstH: number,
  horizontal: boolean,
): Raster {
  const srcLen = horizontal ? src.width : src.height
  const dstLen = horizontal ? dstW : dstH
  const out = new Uint8ClampedArray(dstW * dstH * 4)
  // scale factor: source pixels per destination pixel
  const scale = srcLen / dstLen
  // kernel support in SOURCE pixels (at least 1 so pure upscales keep a
  // meaningful window; downscales widen it proportionally)
  const support = Math.max(1, 3 * scale)
  // weight lookup discretised to 1/256 source px — the kernel is smooth
  // and symmetric, a shared table keeps the loop allocation-light
  const TABLE_N = 1024
  const table = new Float32Array(TABLE_N + 1)
  for (let i = 0; i <= TABLE_N; i++) table[i] = lanczos3((i / TABLE_N) * support)

  const srcStride = src.width * 4
  const dstStride = dstW * 4

  for (let d = 0; d < dstLen; d++) {
    // centre of destination pixel d in source coordinates
    const centre = (d + 0.5) * scale - 0.5
    const lo = Math.max(0, Math.ceil(centre - support))
    const hi = Math.min(srcLen - 1, Math.floor(centre + support))
    const taps: { idx: number; w: number }[] = []
    let wsum = 0
    for (let s = lo; s <= hi; s++) {
      const dist = Math.abs(s - centre)
      const w = dist >= support ? 0 : table[Math.min(TABLE_N, Math.round((dist / support) * TABLE_N))]
      if (w !== 0) {
        taps.push({ idx: s, w })
        wsum += w
      }
    }
    if (wsum === 0) {
      // degenerate window (can't happen with support ≥1, but stay safe):
      // nearest neighbour
      taps.push({ idx: Math.min(srcLen - 1, Math.max(0, Math.round(centre))), w: 1 })
      wsum = 1
    }
    for (let other = 0; other < (horizontal ? src.height : src.width); other++) {
      const dstBase = horizontal
        ? other * dstStride + d * 4
        : d * dstStride + other * 4
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (const t of taps) {
        const srcBase = horizontal
          ? other * srcStride + t.idx * 4
          : t.idx * srcStride + other * 4
        const w = t.w / wsum
        const av = src.data[srcBase + 3]
        // premultiplied sampling: weight color by its own alpha so
        // transparent pixels contribute nothing
        r += src.data[srcBase] * (av / 255) * w
        g += src.data[srcBase + 1] * (av / 255) * w
        b += src.data[srcBase + 2] * (av / 255) * w
        a += av * w
      }
      if (a > 0.0001) {
        // unpremultiply
        out[dstBase] = r / (a / 255)
        out[dstBase + 1] = g / (a / 255)
        out[dstBase + 2] = b / (a / 255)
      }
      out[dstBase + 3] = a
    }
  }
  return { data: out, width: dstW, height: dstH }
}

/**
 * Lanczos-3 upscale (or downscale) of an RGBA raster. `factor` is
 * clamped to 1..4 and by the MAX_OUTPUT_SIDE cap; factor 1 returns a
 * copy. Deterministic and pure — the same input always yields the same
 * output, which is what the unit tests pin down.
 */
export function lanczosUpscale(src: Raster, factor: number): Raster {
  if (src.width < 1 || src.height < 1) throw new Error('upscale: empty raster')
  if (src.data.length < src.width * src.height * 4) throw new Error('upscale: data/size mismatch')
  const f = clampFactor(factor)
  if (f === 1) {
    return { data: new Uint8ClampedArray(src.data), width: src.width, height: src.height }
  }
  const dstW = Math.min(MAX_OUTPUT_SIDE, src.width * f)
  const dstH = Math.min(MAX_OUTPUT_SIDE, src.height * f)
  // horizontal pass: W×H → dstW×H
  const mid = resampleAxis(src, dstW, src.height, true)
  // vertical pass: dstW×H → dstW×dstH
  return resampleAxis(mid, dstW, dstH, false)
}
