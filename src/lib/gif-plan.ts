// ─────────────────────────────────────────────────────────────
// GIF export pre-flight (v0.15 R5) — the pure planning helpers the
// export dialog needs at RENDER time, split from the heavy encoder
// (gif-export.ts) so the editor page's module graph stays light:
// the LZW writer + quantizer load on demand when a GIF is actually
// requested (the pdf-export precedent).
// ─────────────────────────────────────────────────────────────

import type { PageData } from '@/lib/types'

/** hard frame cap — bounds memory and time on hostile inputs */
export const GIF_MAX_FRAMES = 1800

/** GIF delays are centiseconds — the honest mapping (15 fps encodes
 *  as 7 cs = 14.29 effective; durations are reported from the actual
 *  delays, never from the requested fps). */
export function gifDelayCs(fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error(`gifDelayCs: fps must be positive, got ${fps}`)
  return Math.max(2, Math.round(100 / fps))
}

export interface GifFramePlan {
  frames: number
  delayCs: number
  /** what the encoded delays actually add up to */
  durationSec: number
}

/** The frame plan — computed BEFORE any rendering so the dialog can
 *  refuse an impossible export up front. Fail-closed: the error is
 *  actionable and names every lever. */
export function planGifFrames(totalSec: number, fps: number, maxFrames = GIF_MAX_FRAMES): GifFramePlan {
  if (!Number.isFinite(totalSec) || totalSec <= 0) {
    throw new Error('planGifFrames: the timeline has no positive duration')
  }
  const delayCs = gifDelayCs(fps)
  const frames = Math.max(1, Math.round(totalSec * fps))
  if (frames > maxFrames) {
    throw new Error(
      `That selection would need ${frames} GIF frames — the cap is ${maxFrames}. Narrow the page range, lower the frame rate, or export the pages as video instead.`,
    )
  }
  return { frames, delayCs, durationSec: (frames * delayCs) / 100 }
}

export type GifPageRange =
  | { mode: 'current'; currentPage: number }
  | { mode: 'all' }
  | { mode: 'range'; from: number; to: number }

/** Page selection for the GIF — 1-based inclusive `from`/`to`.
 *  Out-of-bounds values clamp into the design (a typed 99 in a
 *  3-page deck means page 3); reversed or non-numeric input throws
 *  (an empty selection is an error, never a silent no-op). */
export function selectGifPages(pages: PageData[], range: GifPageRange): PageData[] {
  if (pages.length === 0) throw new Error('selectGifPages: the design has no pages')
  if (range.mode === 'all') return pages
  if (range.mode === 'current') {
    const i = range.currentPage
    if (!Number.isInteger(i) || i < 0 || i >= pages.length) {
      throw new Error(`selectGifPages: currentPage ${i} is out of range (0..${pages.length - 1})`)
    }
    return [pages[i]]
  }
  const from = Math.round(Number(range.from))
  const to = Math.round(Number(range.to))
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new Error(`selectGifPages: page range ${range.from}–${range.to} is not numeric`)
  }
  if (from > to) throw new Error(`selectGifPages: page range ${from}–${to} is reversed`)
  const lo = Math.min(Math.max(1, from), pages.length)
  const hi = Math.min(Math.max(1, to), pages.length)
  return pages.slice(lo - 1, hi)
}
