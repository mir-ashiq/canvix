// beat-detect tests — synthetic signals with KNOWN tempi, so the DSP is
// verified without any audio fixture (pure Float32Array in, numbers out).
import { describe, expect, it } from 'vitest'
import {
  ANALYSIS_RATE,
  analyzeMono,
  beatEnvelopeAt,
  beatGrid,
  beatSourceOf,
  computePeaks,
  detectBpm,
} from './beat-detect'

/** clicks: short exponential-decay bursts at `bpm` for `seconds`, with a
 *  touch of noise so the signal is not mathematically perfect. */
function clickTrack(bpm: number, seconds: number, clickMs = 12): Float32Array {
  const n = Math.floor(seconds * ANALYSIS_RATE)
  const out = new Float32Array(n)
  const period = 60 / bpm
  const clickLen = Math.floor((clickMs / 1000) * ANALYSIS_RATE)
  let t = 0
  let next = 0.1 // first click at 100 ms
  for (let i = 0; i < n; i++) {
    t = i / ANALYSIS_RATE
    if (t >= next) {
      for (let j = 0; j < clickLen && i + j < n; j++) {
        out[i + j] += Math.exp(-j / (clickLen / 5)) * (j % 2 === 0 ? 1 : -1)
      }
      next += period
    }
    out[i] += (Math.random() - 0.5) * 0.01
  }
  return out
}

function onsetOf(samples: Float32Array): Float32Array {
  // reuse the module's internals through analyzeMono's public path
  const win = Math.max(1, Math.round(ANALYSIS_RATE / 86))
  const n = Math.floor(samples.length / win)
  const env = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (let j = 0; j < win; j++) {
      const v = samples[i * win + j]
      sum += v * v
    }
    env[i] = Math.sqrt(sum / win)
  }
  const out = new Float32Array(Math.max(0, env.length - 1))
  for (let i = 1; i < env.length; i++) {
    const d = env[i] - env[i - 1]
    out[i - 1] = d > 0 ? d : 0
  }
  return out
}

describe('computePeaks', () => {
  it('normalizes to 0..1 with the max at 1', () => {
    const samples = new Float32Array([0, 0.5, -0.25, 0.1, 0, 0, 0, 0])
    const peaks = computePeaks(samples, 4)
    expect(peaks).toHaveLength(4)
    expect(Math.max(...peaks)).toBeCloseTo(1, 2)
    expect(peaks.every((p) => p >= 0 && p <= 1)).toBe(true)
  })

  it('returns empty for empty input', () => {
    expect(computePeaks(new Float32Array(0))).toEqual([])
  })

  it('caps the bucket count at MAX_PEAKS', () => {
    const samples = new Float32Array(ANALYSIS_RATE * 60) // a minute
    expect(computePeaks(samples).length).toBeLessThanOrEqual(200)
  })
})

describe('detectBpm', () => {
  it.each([
    { bpm: 120, label: '120 (2 Hz)' },
    { bpm: 90, label: '90' },
    { bpm: 140, label: '140' },
    { bpm: 160, label: '160' },
  ])('detects a click track at $label', ({ bpm }) => {
    const track = clickTrack(bpm, 12)
    const got = detectBpm(onsetOf(track), ANALYSIS_RATE / Math.max(1, Math.round(ANALYSIS_RATE / 86)))
    expect(got).toBeDefined()
    // within ±2% or exactly half/double (the felt-tempo ambiguity is
    // resolved toward 90–180; all four test tempi live in that band)
    expect(got!).toBeGreaterThan(bpm * 0.98)
    expect(got!).toBeLessThan(bpm * 1.02)
  })

  it('returns undefined for near-silence', () => {
    const silence = new Float32Array(ANALYSIS_RATE * 6).fill(0.0001)
    expect(detectBpm(onsetOf(silence), ANALYSIS_RATE / Math.max(1, Math.round(ANALYSIS_RATE / 86)))).toBeUndefined()
  })

  it('returns undefined for white noise (no periodicity)', () => {
    const noise = new Float32Array(ANALYSIS_RATE * 8)
    for (let i = 0; i < noise.length; i++) noise[i] = Math.random() * 2 - 1
    expect(detectBpm(onsetOf(noise), ANALYSIS_RATE / Math.max(1, Math.round(ANALYSIS_RATE / 86)))).toBeUndefined()
  })
})

describe('beatGrid', () => {
  it('spans the duration with ~period spacing', () => {
    const bpm = 120
    const beats = beatGrid(bpm, onsetOf(clickTrack(bpm, 10)), ANALYSIS_RATE / Math.max(1, Math.round(ANALYSIS_RATE / 86)), 10)
    expect(beats.length).toBeGreaterThan(10)
    const gaps = beats.slice(1).map((b, i) => b - beats[i])
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
    expect(avg).toBeCloseTo(0.5, 2) // 60/120
  })

  it('is empty without a tempo', () => {
    expect(beatGrid(undefined, new Float32Array(0), 86, 10)).toEqual([])
  })
})

describe('analyzeMono (end-to-end on synthetic audio)', () => {
  it('produces peaks, tempo and a beat grid for a 120 BPM track', () => {
    const a = analyzeMono(clickTrack(120, 12), ANALYSIS_RATE)
    expect(a.duration).toBeCloseTo(12, 1)
    expect(a.peaks.length).toBeGreaterThan(50)
    expect(a.bpm).toBeDefined()
    expect(Math.abs(a.bpm! - 120)).toBeLessThan(2.5)
    expect(a.beats?.length).toBeGreaterThan(20)
    if (a.beats) {
      for (const b of a.beats) expect(b).toBeGreaterThanOrEqual(0)
    }
  })

  it('renders silence as a flat (all-zero) waveform, no tempo', () => {
    const a = analyzeMono(new Float32Array(ANALYSIS_RATE * 8), ANALYSIS_RATE, 8)
    expect(a.bpm).toBeUndefined()
    expect(a.beats).toBeUndefined()
    expect(a.peaks.length).toBeGreaterThan(0)
    expect(a.peaks.every((p) => p === 0)).toBe(true)
  })
})

describe('beatEnvelopeAt', () => {
  const beats = [0, 0.5, 1, 1.5]

  it('peaks exactly on a beat', () => {
    expect(beatEnvelopeAt(beats, 0.5)).toBeCloseTo(1, 3)
  })

  it('decays after a beat and hits 0 before the first beat', () => {
    const v = beatEnvelopeAt(beats, 0.57)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(1)
    expect(beatEnvelopeAt(beats, -0.1)).toBe(0)
  })

  it('returns 0 with no grid', () => {
    expect(beatEnvelopeAt([], 1)).toBe(0)
  })
})

describe('beatSourceOf', () => {
  it('finds the first visible audio element carrying a grid', () => {
    const page = {
      elements: [
        { type: 'text', id: 't', visible: true },
        { type: 'audio', id: 'a', visible: true, bpm: 128, beats: [0, 0.46] },
      ],
    }
    expect(beatSourceOf(page)?.bpm).toBe(128)
  })

  it('skips hidden or grid-less audio elements', () => {
    expect(beatSourceOf({ elements: [{ type: 'audio', id: 'a', visible: false, bpm: 100, beats: [0] }] })).toBeNull()
    expect(beatSourceOf({ elements: [{ type: 'audio', id: 'a', visible: true, bpm: undefined }] })).toBeNull()
    expect(beatSourceOf({ elements: [] })).toBeNull()
  })
})
