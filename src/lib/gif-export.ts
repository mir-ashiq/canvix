// ─────────────────────────────────────────────────────────────
// GIF export (v0.15 R5) — social-loop animated GIFs from any page
// range, entirely in the browser, ZERO new dependencies.
//
//   selected pages → the SAME render session the video engines
//   use (R2's deterministic fixed-timestep pacing, R3's moving
//   videos) → median-cut palette from deterministic timeline
//   samples → per-frame nearest-colour indexing (optional
//   Floyd–Steinberg dithering) → hand-rolled LZW + GIF89a writer.
//
// Honest limits, on the record in docs/GIF-EXPORT.md: GIFs are
// silent (the format has no audio), delays are centiseconds, and
// there is no frame-diff rect optimization yet (every frame is a
// full image — LZW still crushes the static regions).
// ─────────────────────────────────────────────────────────────

import type { PageData } from '@/lib/types'
import { buildTimeline, computeExportSize, createRenderSession, type VideoExportOptions } from './video-export'
import { buildNearestLUT, medianCutPalette } from './gif/palette'
import { GifWriter } from './gif/gif-encoder'

import { planGifFrames, selectGifPages, type GifPageRange } from './gif-plan'

// the pre-flight helpers live in the light gif-plan module (the
// dialog imports THAT statically); re-exported here for one-stop
// consumption and for the tests
export { gifDelayCs, planGifFrames, selectGifPages, GIF_MAX_FRAMES } from './gif-plan'
export type { GifFramePlan, GifPageRange } from './gif-plan'

/** hard output cap — the strictest common social-platform limit
 *  (Discord free tier); enforced DURING the encode so an oversized
 *  export aborts early with advice instead of wasting the render */
export const GIF_MAX_BYTES = 25 * 1024 * 1024
/** longest-edge pixel caps offered in the dialog */
export const GIF_SIZE_CHOICES = [480, 720, 1080] as const
/** frame rates offered in the dialog (centisecond-friendly) */
export const GIF_FPS_CHOICES = [10, 15, 20] as const

/** how many timeline times feed the palette pass */
const PALETTE_SAMPLE_FRAMES = 8
/** ceiling on pixels sampled for the palette (across all samples) */
const PALETTE_SAMPLE_BUDGET = 400_000

/** GIF delays are centiseconds — the honest mapping (15 fps encodes
 *  as 7 cs = 14.29 effective; durations are reported from the actual
 *  delays, never from the requested fps). */
export interface GifExportOptions {
  designWidth: number
  designHeight: number
  pages: PageData[]
  /** longest-edge pixel cap (480 / 720 / 1080) */
  maxWidth?: number
  fps?: number
  /** Floyd–Steinberg error diffusion (default: on — gradients
   *  without it band badly at 256 colours) */
  dither?: boolean
  onProgress?: (ratio: number, stage: string) => void
}

export interface GifExportResult {
  blob: Blob
  mimeType: 'image/gif'
  extension: 'gif'
  frames: number
  durationSec: number
  width: number
  height: number
  bytes: number
}

/** blend a canvas pixel over white — defensive: the compositor fills
 *  white before every frame, but a transparent pixel must never
 *  leak the previous frame's (or the buffer's) RGB into the GIF */
function overWhite(r: number, g: number, b: number, a: number): [number, number, number] {
  if (a >= 255) return [r, g, b]
  if (a <= 0) return [255, 255, 255]
  const al = a / 255
  return [r * al + 255 * (1 - al), g * al + 255 * (1 - al), b * al + 255 * (1 - al)]
}

export async function exportGif(opts: GifExportOptions): Promise<GifExportResult> {
  const fps = opts.fps ?? 15
  const dither = opts.dither ?? true
  if (opts.pages.length === 0) throw new Error('The GIF needs at least one page — adjust the page range.')

  const { width, height } = computeExportSize(opts.designWidth, opts.designHeight, opts.maxWidth ?? 720)
  const { segments, total } = buildTimeline(opts.pages)
  const plan = planGifFrames(total, fps) // throws BEFORE any work on overrun

  const sessionOpts: VideoExportOptions = {
    designWidth: opts.designWidth,
    designHeight: opts.designHeight,
    pages: opts.pages,
    maxWidth: opts.maxWidth,
    fps,
    onProgress: opts.onProgress,
  }
  const session = await createRenderSession(sessionOpts, width, height, segments, plan.frames)
  try {
    const { canvas, ctx, renderFrameAt, prepareFrameAt } = session

    // ── palette pass: deterministic samples across the timeline ──
    const sampleCount = Math.min(PALETTE_SAMPLE_FRAMES, plan.frames)
    const stride = Math.max(1, Math.floor((width * height) / (PALETTE_SAMPLE_BUDGET / PALETTE_SAMPLE_FRAMES)))
    const perFrame = Math.ceil((width * height) / stride)
    const samples = new Uint8Array(sampleCount * perFrame * 3)
    let filled = 0
    for (let s = 0; s < sampleCount; s++) {
      const frameNo = sampleCount === 1 ? 0 : Math.round((s * (plan.frames - 1)) / (sampleCount - 1))
      const t = frameNo / fps
      opts.onProgress?.(0.02 + 0.08 * (s / sampleCount), `Sampling colours ${s + 1} / ${sampleCount}…`)
      await prepareFrameAt(t)
      renderFrameAt(frameNo, t)
      const data = ctx.getImageData(0, 0, width, height).data
      for (let p = 0; p < width * height; p += stride) {
        const q = p * 4
        const [r, g, b] = overWhite(data[q], data[q + 1], data[q + 2], data[q + 3])
        samples[filled++] = r
        samples[filled++] = g
        samples[filled++] = b
      }
    }
    const palette = medianCutPalette(samples.subarray(0, filled))
    const lut = buildNearestLUT(palette)
    const pal = palette.colors

    // ── frame loop: the R2 deterministic contract (t = frame / fps,
    //    no wall clock anywhere — slow rendering can only make the
    //    export take longer, never drop or duplicate a frame) ──
    const writer = new GifWriter({ width, height, palette, loopCount: 0 })
    const indices = new Uint8Array(width * height)
    // Floyd–Steinberg error rows, one column of guard at each end so
    // x-1 / x+1 never leave the array (col = x + 1)
    let curErr = new Float32Array((width + 2) * 3)
    let nextErr = new Float32Array((width + 2) * 3)
    const breathe = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0))

    for (let frame = 0; frame < plan.frames; frame++) {
      const t = frame / fps
      await prepareFrameAt(t) // R3: every autoplay video at its exact frame
      renderFrameAt(frame, t)
      const data = ctx.getImageData(0, 0, width, height).data

      if (dither) {
        nextErr.fill(0)
        let p = 0
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++, p++) {
            const q = p * 4
            const [r0, g0, b0] = overWhite(data[q], data[q + 1], data[q + 2], data[q + 3])
            const col = (x + 1) * 3
            // clamp the diffused colour into gamut before indexing
            const r = Math.min(255, Math.max(0, r0 + curErr[col]))
            const g = Math.min(255, Math.max(0, g0 + curErr[col + 1]))
            const b = Math.min(255, Math.max(0, b0 + curErr[col + 2]))
            const idx = lut[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)]
            indices[p] = idx
            const c3 = idx * 3
            const er = r - pal[c3]
            const eg = g - pal[c3 + 1]
            const eb = b - pal[c3 + 2]
            // standard raster-order Floyd–Steinberg (7/16 →, 3/16 ↙,
            // 5/16 ↓, 1/16 ↘)
            curErr[col + 3] += er * 0.4375
            curErr[col + 4] += eg * 0.4375
            curErr[col + 5] += eb * 0.4375
            nextErr[col - 3] += er * 0.1875
            nextErr[col - 2] += eg * 0.1875
            nextErr[col - 1] += eb * 0.1875
            nextErr[col] += er * 0.3125
            nextErr[col + 1] += eg * 0.3125
            nextErr[col + 2] += eb * 0.3125
            nextErr[col + 3] += er * 0.0625
            nextErr[col + 4] += eg * 0.0625
            nextErr[col + 5] += eb * 0.0625
          }
          // swap rows: the filled next-row becomes current
          const swap = curErr
          curErr = nextErr
          nextErr = swap
          nextErr.fill(0)
        }
      } else {
        for (let p = 0; p < width * height; p++) {
          const q = p * 4
          const [r, g, b] = overWhite(data[q], data[q + 1], data[q + 2], data[q + 3])
          indices[p] = lut[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)]
        }
      }

      writer.addFrame(indices, plan.delayCs)
      if (writer.byteLength > GIF_MAX_BYTES) {
        throw new Error(
          `The GIF passed ${Math.round(GIF_MAX_BYTES / 1048576)} MB while encoding — lower the size, the frame rate, or narrow the page range.`,
        )
      }
      opts.onProgress?.(0.1 + 0.9 * ((frame + 1) / plan.frames), `Encoding frame ${frame + 1} / ${plan.frames}`)
      await breathe() // let the dialog's progress bar breathe
    }

    const bytes = writer.finish()
    if (writer.frames === 0 || bytes.length === 0) {
      throw new Error('The GIF encoder produced an empty file — try fewer pages or a smaller size.')
    }
    // explicit copy so the Blob gets a plain ArrayBuffer (TS's BlobPart
    // wants Uint8Array<ArrayBuffer>, and the writer's buffer is generic)
    const blobBytes = new Uint8Array(bytes.length)
    blobBytes.set(bytes)
    return {
      blob: new Blob([blobBytes], { type: 'image/gif' }),
      mimeType: 'image/gif',
      extension: 'gif',
      frames: writer.frames,
      durationSec: plan.durationSec,
      width: canvas.width,
      height: canvas.height,
      bytes: bytes.length,
    }
  } finally {
    session.destroy()
  }
}

/** the same object-URL download dance downloadVideo uses */
export function downloadGif(result: GifExportResult, filename: string): void {
  const url = URL.createObjectURL(result.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.gif`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
