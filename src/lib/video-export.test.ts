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
import { chooseVideoExportEngine, computeExportSize, pagesHaveAutoplayAudio } from './video-export'
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
