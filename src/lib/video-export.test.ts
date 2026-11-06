// ─────────────────────────────────────────────────────────────
// video-export engine tests (v0.15 R2)
//
// The engine matrix is a PURE function of three facts, so the
// whole decision surface is unit-testable without a browser:
//
//   page audio + recorder-can-mux-audio  → MediaRecorder
//   WebCodecs available (silent design)  → WebCodecs
//   WebCodecs + audio but no audio-muxing
//          recorder                        → WebCodecs (silent, honest)
//   WebCodecs + audio + working recorder  → MediaRecorder
//   no WebCodecs + recorder               → MediaRecorder
//   neither                               → null (exportVideo throws)
//
// Plus computeExportSize (even-pixel rounding, upscale clamp)
// and pagesHaveAutoplayAudio (visibility + autoplay rules).
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import {
  chooseVideoExportEngine,
  computeExportSize,
  isPlayableExportVideo,
  MAX_EXPORT_VIDEOS,
  pagesHaveAutoplayAudio,
  pagesHaveAutoplayVideo,
  windowedSourceTime,
} from './video-export'
import type { PageData } from './types'

function page(elements: unknown[]): PageData {
  return {
    id: 'p1',
    background: { type: 'solid', color: '#FFFFFF' },
    elements: elements as PageData['elements'],
  }
}

describe('chooseVideoExportEngine — the fallback matrix', () => {
  it('page audio + an audio-muxing recorder rides MediaRecorder (audio wins)', () => {
    expect(
      chooseVideoExportEngine({ webcodecs: true, mediaRecorder: true, mediaRecorderAudio: true, hasPageAudio: true }),
    ).toEqual({ engine: 'mediarecorder', reason: expect.stringContaining('page audio') })
  })

  it('a silent design with WebCodecs takes the frame-exact path', () => {
    const d = chooseVideoExportEngine({ webcodecs: true, mediaRecorder: true, mediaRecorderAudio: true, hasPageAudio: false })
    expect(d.engine).toBe('webcodecs')
    expect(d.reason).toContain('frame-exact')
  })

  it('WebCodecs + page audio but NO audio-capable recorder → WebCodecs, honestly silent', () => {
    const d = chooseVideoExportEngine({ webcodecs: true, mediaRecorder: true, mediaRecorderAudio: false, hasPageAudio: true })
    expect(d.engine).toBe('webcodecs')
    expect(d.reason).toContain('silent')
  })

  it('WebCodecs + page audio + no recorder at all → WebCodecs (better than the old hard error)', () => {
    const d = chooseVideoExportEngine({ webcodecs: true, mediaRecorder: false, mediaRecorderAudio: false, hasPageAudio: true })
    expect(d.engine).toBe('webcodecs')
    expect(d.reason).toContain('only engine')
  })

  it('no WebCodecs + recorder → MediaRecorder', () => {
    expect(
      chooseVideoExportEngine({ webcodecs: false, mediaRecorder: true, mediaRecorderAudio: false, hasPageAudio: false }).engine,
    ).toBe('mediarecorder')
  })

  it('neither engine → null (exportVideo throws, same as before R2)', () => {
    const d = chooseVideoExportEngine({ webcodecs: false, mediaRecorder: false, mediaRecorderAudio: false, hasPageAudio: false })
    expect(d.engine).toBeNull()
    expect(d.reason).toContain('neither')
  })
})

describe('computeExportSize', () => {
  it('scales the longest edge down to the cap with even pixels', () => {
    expect(computeExportSize(1080, 720, 960)).toEqual({ width: 960, height: 640 })
    expect(computeExportSize(720, 1080, 960)).toEqual({ width: 640, height: 960 })
  })

  it('never upscales and never returns odd dimensions (VP8/VP9 chroma)', () => {
    expect(computeExportSize(800, 600, 1280)).toEqual({ width: 800, height: 600 })
    expect(computeExportSize(1001, 501, 2000)).toEqual({ width: 1002, height: 502 }) // half-up round to even
    const s = computeExportSize(1081, 719, 960)
    expect(s.width % 2).toBe(0)
    expect(s.height % 2).toBe(0)
  })

  it('clamps degenerate designs to the 2-pixel floor', () => {
    expect(computeExportSize(0, 0, 960)).toEqual({ width: 2, height: 2 })
  })
})

describe('pagesHaveAutoplayAudio — mirrors the recorder filter exactly', () => {
  it('no elements → false', () => {
    expect(pagesHaveAutoplayAudio([page([])])).toBe(false)
  })

  it('audio + autoplay + visible → true', () => {
    expect(
      pagesHaveAutoplayAudio([
        page([{ type: 'audio', autoplay: true, visible: true }]),
      ]),
    ).toBe(true)
  })

  it('autoplay audio that is hidden does not count (it never plays)', () => {
    expect(
      pagesHaveAutoplayAudio([
        page([{ type: 'audio', autoplay: true, visible: false }]),
      ]),
    ).toBe(false)
  })

  it('visible audio without autoplay does not count', () => {
    expect(
      pagesHaveAutoplayAudio([
        page([{ type: 'audio', autoplay: false, visible: true }]),
      ]),
    ).toBe(false)
  })

  it('any page carrying one counts', () => {
    expect(
      pagesHaveAutoplayAudio([
        page([]),
        page([{ type: 'audio', autoplay: true, visible: true }]),
      ]),
    ).toBe(true)
  })

  it('non-audio elements never count', () => {
    expect(
      pagesHaveAutoplayAudio([
        page([{ type: 'rect', autoplay: true, visible: true }]),
      ]),
    ).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
// v0.15 R3 — moving video in exports
//
// windowedSourceTime is the ONE source-time mapping both engines
// share (WebCodecs seeks to it per frame; MediaRecorder's trim tick
// and segment resets assume it), and the playability filter decides
// which videos get a live <video> at all. Both are pure — the whole
// contract is unit-testable without a browser.
// ─────────────────────────────────────────────────────────────

describe('windowedSourceTime — the R3 source-time mapping', () => {
  it('t = 0 → trimStart; plain playback advances 1:1 with page time', () => {
    expect(windowedSourceTime(0.1, 1.8, false, 0)).toBe(0.1)
    expect(windowedSourceTime(0.1, 1.8, false, 0.5)).toBe(0.6)
    expect(windowedSourceTime(0, 6, false, 2.2)).toBe(2.2)
  })

  it('non-looping HOLDS the final frame once the window is spent', () => {
    expect(windowedSourceTime(0.1, 1.8, false, 5)).toBe(1.8)
    expect(windowedSourceTime(0, 6, false, 100)).toBe(6)
  })

  it('looping wraps within [trimStart, end]', () => {
    // span = 1.7: 3.5 = 2 × 1.7 + 0.1 → 0.1 past the start
    expect(windowedSourceTime(0.1, 1.8, true, 3.5)).toBeCloseTo(0.2, 10)
    // an exact multiple of the span lands back on the start
    expect(windowedSourceTime(0.1, 1.8, true, 1.7)).toBe(0.1)
    expect(windowedSourceTime(0, 6, true, 14.5)).toBeCloseTo(2.5, 10)
  })

  it('a trim past what the file contains clamps to the loaded duration', () => {
    expect(windowedSourceTime(0.1, 1.8, false, 0.5, 1.0)).toBe(0.6)
    expect(windowedSourceTime(0.1, 1.8, false, 5, 1.0)).toBe(1.0)
    expect(windowedSourceTime(0, 6, true, 14.5, 2.0)).toBeCloseTo(0.5, 10)
  })

  it('degenerate window (end ≤ start) holds the start, never NaN', () => {
    expect(windowedSourceTime(2, 1, false, 10)).toBe(1)
    expect(windowedSourceTime(1, 1, true, 10)).toBe(1)
  })

  it('garbage inputs never produce NaN or negative times', () => {
    expect(windowedSourceTime(Number.NaN, Number.NaN, false, Number.NaN, Number.NaN)).toBe(0)
    expect(windowedSourceTime(Number.NaN, Number.NaN, true, Number.NaN, 5)).toBe(0)
    expect(windowedSourceTime(0, 10, false, -5)).toBe(0)
    expect(windowedSourceTime(0.5, 2, true, -3)).toBe(0.5)
    // Infinity page time is garbage too — clamped, and the loop branch
    // can never reach Infinity % span = NaN
    expect(windowedSourceTime(0, 10, false, Number.POSITIVE_INFINITY)).toBe(0)
    expect(windowedSourceTime(0, 10, true, Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('isPlayableExportVideo / pagesHaveAutoplayVideo — the R3 gate', () => {
  it('video + visible + autoplay plays in the export', () => {
    expect(isPlayableExportVideo({ type: 'video', visible: true, autoplay: true } as never)).toBe(true)
  })

  it('non-autoplay and hidden videos keep the poster render', () => {
    expect(isPlayableExportVideo({ type: 'video', visible: true, autoplay: false } as never)).toBe(false)
    expect(isPlayableExportVideo({ type: 'video', visible: false, autoplay: true } as never)).toBe(false)
    expect(isPlayableExportVideo({ type: 'video', visible: false, autoplay: false } as never)).toBe(false)
  })

  it('any other element type never counts', () => {
    expect(isPlayableExportVideo({ type: 'audio', visible: true, autoplay: true } as never)).toBe(false)
    expect(isPlayableExportVideo({ type: 'rect', visible: true, autoplay: true } as never)).toBe(false)
  })

  it('pagesHaveAutoplayVideo walks groups and needs at least one playable video', () => {
    expect(pagesHaveAutoplayVideo([page([{ type: 'video', visible: true, autoplay: true }])])).toBe(true)
    expect(
      pagesHaveAutoplayVideo([
        page([{ type: 'group', children: [{ type: 'video', visible: true, autoplay: true }] }]),
      ]),
    ).toBe(true)
    expect(
      pagesHaveAutoplayVideo([
        page([]),
        page([{ type: 'group', children: [{ type: 'video', visible: true, autoplay: false }] }]),
      ]),
    ).toBe(false)
  })

  it('MAX_EXPORT_VIDEOS pins the decode cap', () => {
    expect(MAX_EXPORT_VIDEOS).toBe(12)
  })
})
