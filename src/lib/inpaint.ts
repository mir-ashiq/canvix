// ─────────────────────────────────────────────────────────────
// Canvix local magic-eraser engine (Wave 4 — AI Power-Up).
//
// Brush-paint a region → the region is reconstructed from its
// surroundings. Clean-room "LaMa-style" pyramid diffusion: a pull-push
// fill seeds the hole from progressively coarser scales, then
// boundary-constrained Jacobi diffusion polishes the full-resolution
// result. Pure TypeScript, deterministic, zero model downloads, works
// offline on ANY image — the property VibesAI-class edit providers
// lack (they refuse images they did not generate themselves).
//
// Pipeline:
//   1. pull-push pyramid: downsample KNOWN pixels only, level by
//      level, until every 2×2 block would be unknown (or a floor
//      size) — then fill back up, seeding each level's holes from the
//      coarser reconstruction.
//   2. diffusion refine: N Jacobi sweeps where each hole pixel
//      becomes the mean of its 8 neighbours (known pixels are fixed
//      boundary conditions — the reconstruction matches the image at
//      the brush edge by construction).
//   3. one feather pass over the hole boundary so the seam is not a
//      hard line.
// ─────────────────────────────────────────────────────────────

import type { Raster } from './upscale'

/** Brush mask: same geometry as the raster, alpha 0 = keep, ≥128 = erase. */
export interface Mask {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** Jacobi sweeps at full resolution after the pyramid seed. */
export const REFINE_SWEEPS = 28

/** Pyramid floor — stop descending when a level gets this small. */
const PYRAMID_FLOOR = 4

/** true when the mask paints this pixel */
function isHole(mask: Mask, x: number, y: number): boolean {
  return mask.data[(y * mask.width + x) * 4 + 3] >= 128
}

/** Downsample one level counting only known pixels; blocks with none
 *  stay unknown. Returns the coarse raster plus a coarse hole flag map. */
function downsampleKnown(
  img: Float32Array,
  known: Uint8Array,
  w: number,
  h: number,
): { img: Float32Array; known: Uint8Array; w: number; h: number } {
  const cw = Math.max(1, w >> 1)
  const ch = Math.max(1, h >> 1)
  const cimg = new Float32Array(cw * ch * 4)
  const cknown = new Uint8Array(cw * ch)
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const x = cx * 2 + dx
          const y = cy * 2 + dy
          if (x >= w || y >= h) continue
          const i = y * w + x
          if (!known[i]) continue
          n++
          r += img[i * 4]
          g += img[i * 4 + 1]
          b += img[i * 4 + 2]
          a += img[i * 4 + 3]
        }
      }
      const ci = cy * cw + cx
      if (n > 0) {
        cimg[ci * 4] = r / n
        cimg[ci * 4 + 1] = g / n
        cimg[ci * 4 + 2] = b / n
        cimg[ci * 4 + 3] = a / n
        cknown[ci] = 1
      }
    }
  }
  return { img: cimg, known: cknown, w: cw, h: ch }
}

/** Bilinear sample of a coarse level at fine coordinates (pixel centres). */
function bilinear(
  img: Float32Array,
  w: number,
  h: number,
  fx: number,
  fy: number,
  out: Float32Array,
): void {
  const x = Math.min(w - 1, Math.max(0, fx))
  const y = Math.min(h - 1, Math.max(0, fy))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(w - 1, x0 + 1)
  const y1 = Math.min(h - 1, y0 + 1)
  const tx = x - x0
  const ty = y - y0
  for (let c = 0; c < 4; c++) {
    const top = img[(y0 * w + x0) * 4 + c] * (1 - tx) + img[(y0 * w + x1) * 4 + c] * tx
    const bot = img[(y1 * w + x0) * 4 + c] * (1 - tx) + img[(y1 * w + x1) * 4 + c] * tx
    out[c] = top * (1 - ty) + bot * ty
  }
}

/** One pyramid build (down) + fill (up), mutating `img` in place. */
function pullPush(img: Float32Array, known: Uint8Array, w: number, h: number): void {
  // ── build the pyramid of known-only averages ──
  const levels: { img: Float32Array; known: Uint8Array; w: number; h: number }[] = [
    { img, known, w, h },
  ]
  while (
    levels[levels.length - 1].w > PYRAMID_FLOOR &&
    levels[levels.length - 1].h > PYRAMID_FLOOR
  ) {
    const top = levels[levels.length - 1]
    levels.push(downsampleKnown(top.img, top.known, top.w, top.h))
  }
  // coarsest level still has unknown pixels (the hole covered entire
  // blocks): seed them with the mean of everything known at that level
  const coarse = levels[levels.length - 1]
  let mr = 0
  let mg = 0
  let mb = 0
  let ma = 0
  let mn = 0
  for (let i = 0; i < coarse.w * coarse.h; i++) {
    if (!coarse.known[i]) continue
    mn++
    mr += coarse.img[i * 4]
    mg += coarse.img[i * 4 + 1]
    mb += coarse.img[i * 4 + 2]
    ma += coarse.img[i * 4 + 3]
  }
  const mean = mn > 0 ? [mr / mn, mg / mn, mb / mn, ma / mn] : [0, 0, 0, 0]
  for (let i = 0; i < coarse.w * coarse.h; i++) {
    if (coarse.known[i]) continue
    coarse.img[i * 4] = mean[0]
    coarse.img[i * 4 + 1] = mean[1]
    coarse.img[i * 4 + 2] = mean[2]
    coarse.img[i * 4 + 3] = mean[3]
  }
  // ── fill back up: each level's holes take bilinear samples of the
  //    coarser reconstruction ──
  for (let l = levels.length - 2; l >= 0; l--) {
    const fine = levels[l]
    const c = levels[l + 1]
    const sample = new Float32Array(4)
    for (let y = 0; y < fine.h; y++) {
      for (let x = 0; x < fine.w; x++) {
        const i = y * fine.w + x
        if (fine.known[i]) continue
        bilinear(c.img, c.w, c.h, (x - 0.5) / 2, (y - 0.5) / 2, sample)
        fine.img[i * 4] = sample[0]
        fine.img[i * 4 + 1] = sample[1]
        fine.img[i * 4 + 2] = sample[2]
        fine.img[i * 4 + 3] = sample[3]
      }
    }
  }
}

/** Boundary-constrained Jacobi diffusion over the hole pixels only. */
function diffuse(img: Float32Array, known: Uint8Array, w: number, h: number, sweeps: number): void {
  // hole pixel index list + a full index map (pixel → hole slot) so the
  // hot loop below can find a hole neighbour's PREVIOUS-sweep value
  const holes: number[] = []
  for (let i = 0; i < w * h; i++) if (!known[i]) holes.push(i)
  if (!holes.length) return
  const holeMap = new Int32Array(w * h).fill(-1)
  for (let k = 0; k < holes.length; k++) holeMap[holes[k]] = k
  const next = new Float32Array(4)
  for (let s = 0; s < sweeps; s++) {
    // Jacobi: read from the current state, write via a per-sweep copy of
    // the hole values (cheap: only holes are copied)
    const prev = new Float32Array(holes.length * 4)
    for (let k = 0; k < holes.length; k++) {
      const i = holes[k]
      prev[k * 4] = img[i * 4]
      prev[k * 4 + 1] = img[i * 4 + 1]
      prev[k * 4 + 2] = img[i * 4 + 2]
      prev[k * 4 + 3] = img[i * 4 + 3]
    }
    for (let k = 0; k < holes.length; k++) {
      const i = holes[k]
      const x = i % w
      const y = (i / w) | 0
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const ni = ny * w + nx
          const nk = holeMap[ni]
          if (nk >= 0) {
            // neighbour is also a hole → its PREVIOUS sweep value
            r += prev[nk * 4]
            g += prev[nk * 4 + 1]
            b += prev[nk * 4 + 2]
            a += prev[nk * 4 + 3]
          } else {
            r += img[ni * 4]
            g += img[ni * 4 + 1]
            b += img[ni * 4 + 2]
            a += img[ni * 4 + 3]
          }
          n++
        }
      }
      if (n > 0) {
        next[0] = r / n
        next[1] = g / n
        next[2] = b / n
        next[3] = a / n
        img[i * 4] = next[0]
        img[i * 4 + 1] = next[1]
        img[i * 4 + 2] = next[2]
        img[i * 4 + 3] = next[3]
      }
    }
  }
}

/** Feather the hole boundary: blend each boundary hole pixel 50/50 with
 *  the average of its known neighbours — softens the seam. */
function feather(img: Float32Array, known: Uint8Array, w: number, h: number): void {
  const edges: number[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (known[i]) continue
      let hasKnown = false
      for (let dy = -1; dy <= 1 && !hasKnown; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          if (known[ny * w + nx]) {
            hasKnown = true
            break
          }
        }
      }
      if (hasKnown) edges.push(i)
    }
  }
  for (const i of edges) {
    const x = i % w
    const y = (i / w) | 0
    let r = 0
    let g = 0
    let b = 0
    let a = 0
    let n = 0
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const ni = ny * w + nx
        if (!known[ni]) continue
        r += img[ni * 4]
        g += img[ni * 4 + 1]
        b += img[ni * 4 + 2]
        a += img[ni * 4 + 3]
        n++
      }
    }
    if (n > 0) {
      img[i * 4] = img[i * 4] * 0.5 + (r / n) * 0.5
      img[i * 4 + 1] = img[i * 4 + 1] * 0.5 + (g / n) * 0.5
      img[i * 4 + 2] = img[i * 4 + 2] * 0.5 + (b / n) * 0.5
      img[i * 4 + 3] = img[i * 4 + 3] * 0.5 + (a / n) * 0.5
    }
  }
}

/**
 * Reconstruct the masked region of `src` from its surroundings.
 * Returns a NEW raster — the input is never mutated. Pixels outside
 * the mask are byte-identical to the input.
 */
export function inpaint(src: Raster, mask: Mask, sweeps = REFINE_SWEEPS): Raster {
  if (src.width !== mask.width || src.height !== mask.height) {
    throw new Error('inpaint: mask geometry must match the raster')
  }
  if (src.width < 1 || src.height < 1) throw new Error('inpaint: empty raster')
  const out = new Uint8ClampedArray(src.data) // untouched pixels stay identical
  // working buffers in float
  const img = new Float32Array(src.width * src.height * 4)
  const known = new Uint8Array(src.width * src.height)
  let holes = 0
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = y * src.width + x
      img[i * 4] = src.data[i * 4]
      img[i * 4 + 1] = src.data[i * 4 + 1]
      img[i * 4 + 2] = src.data[i * 4 + 2]
      img[i * 4 + 3] = src.data[i * 4 + 3]
      if (isHole(mask, x, y)) {
        holes++
      } else {
        known[i] = 1
      }
    }
  }
  if (holes === 0) return { data: out, width: src.width, height: src.height }
  pullPush(img, known, src.width, src.height)
  diffuse(img, known, src.width, src.height, sweeps)
  feather(img, known, src.width, src.height)
  for (let i = 0; i < src.width * src.height; i++) {
    if (known[i]) continue
    out[i * 4] = img[i * 4]
    out[i * 4 + 1] = img[i * 4 + 1]
    out[i * 4 + 2] = img[i * 4 + 2]
    out[i * 4 + 3] = img[i * 4 + 3]
  }
  return { data: out, width: src.width, height: src.height }
}
