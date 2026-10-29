// ─────────────────────────────────────────────────────────────
// beat-detect — tempo + beat-grid extraction (v0.11 Beat Sync)
//
// Pure DSP on a mono Float32Array (the browser glue that decodes an
// AudioBuffer lives in decode.ts — everything here is testable in Node).
//
// Pipeline (classic onset/beat induction, kept deliberately small):
//   1. onset envelope: RMS energy per short window, then the positive
//      first difference (energy flux) — percussive events stand out
//   2. tempo: autocorrelate the envelope over the 60–180 BPM lag range;
//      pick the strongest lag, then harmonic-check (prefer 90–180 BPM by
//      comparing the half-tempo and double-tempo candidates)
//   3. beat grid: phase = the envelope peak nearest the strongest beat
//      period; beats at phase + k·period, clipped to duration
//
// Everything is capped to the element-friendly sizes the collab op
// validator accepts (MAX_PEAKS / MAX_BEATS in lib/types.ts).
// ─────────────────────────────────────────────────────────────

import { MAX_BEATS, MAX_PEAKS } from '@/lib/types'

/** analysis sample rate — 11.025 kHz is plenty for onset detection and
 *  keeps even a 5-minute track at ~3.3M samples */
export const ANALYSIS_RATE = 11_025

export interface BeatAnalysis {
  /** abs-peak envelope, 0..1, at most MAX_PEAKS buckets */
  peaks: number[]
  /** detected tempo — undefined when no stable beat was found */
  bpm?: number
  /** beat grid (seconds), at most MAX_BEATS entries */
  beats?: number[]
  duration: number
}

/** Downsampled abs-peak envelope for the waveform card. */
export function computePeaks(samples: Float32Array, buckets = MAX_PEAKS): number[] {
  if (!samples.length) return []
  const out: number[] = []
  // ceil guarantees at most `buckets` buckets (floor can spill one)
  const bucketSize = Math.max(1, Math.ceil(samples.length / buckets))
  let max = 0
  for (let i = 0; i < samples.length; i += bucketSize) {
    let peak = 0
    const end = Math.min(i + bucketSize, samples.length)
    for (let j = i; j < end; j++) {
      const a = Math.abs(samples[j])
      if (a > peak) peak = a
    }
    out.push(peak)
    if (peak > max) max = peak
  }
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] = Math.round((out[i] / max) * 1000) / 1000
  return out
}

/** RMS energy per window (window = win samples). */
function energyEnvelope(samples: Float32Array, win: number): Float32Array {
  const n = Math.floor(samples.length / win)
  const env = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    const base = i * win
    for (let j = 0; j < win; j++) {
      const v = samples[base + j]
      sum += v * v
    }
    env[i] = Math.sqrt(sum / win)
  }
  return env
}

/** positive first difference (energy flux) — the onset envelope. */
function onsetEnvelope(env: Float32Array): Float32Array {
  const out = new Float32Array(Math.max(0, env.length - 1))
  for (let i = 1; i < env.length; i++) {
    const d = env[i] - env[i - 1]
    out[i - 1] = d > 0 ? d : 0
  }
  return out
}

/** autocorrelation score for one lag (in frames), normalized. */
function autocorr(envelope: Float32Array, lag: number): number {
  if (lag <= 0 || lag >= envelope.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = lag; i < envelope.length; i++) {
    dot += envelope[i] * envelope[i - lag]
    na += envelope[i] * envelope[i]
    nb += envelope[i - lag] * envelope[i - lag]
  }
  if (na === 0 || nb === 0) return 0
  return dot / Math.sqrt(na * nb)
}

/**
 * Detect tempo (BPM) of an onset envelope sampled at `fps` frames/sec.
 * Returns undefined when nothing is periodic enough (silence, noise).
 */
export function detectBpm(onsets: Float32Array, fps: number): number | undefined {
  if (onsets.length < fps * 2) return undefined // < 2 s of audio
  const minBpm = 60
  const maxBpm = 180
  const maxLag = Math.floor((fps * 60) / minBpm)
  const minLag = Math.max(2, Math.floor((fps * 60) / maxBpm))
  if (minLag >= maxLag || maxLag >= onsets.length) return undefined

  // mean-center first: onset flux is non-negative, so its raw autocorrelation
  // has a positive baseline that white noise rides (a false-tempo source the
  // v0.11 tests caught). Centered, uncorrelated signals score ~0.
  let mean = 0
  for (let i = 0; i < onsets.length; i++) mean += onsets[i]
  mean /= onsets.length
  const centered = new Float32Array(onsets.length)
  for (let i = 0; i < onsets.length; i++) centered[i] = onsets[i] - mean

  let bestLag = 0
  let bestScore = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    const s = autocorr(centered, lag)
    if (s > bestScore) {
      bestScore = s
      bestLag = lag
    }
  }
  if (!bestLag || bestScore < 0.12) return undefined

  // harmonic check: the raw winner may be a double/half of the felt tempo.
  // prefer the candidate in 90–180 BPM; fall back to the raw winner.
  const bpmOf = (lag: number) => (fps * 60) / lag
  const raw = bpmOf(bestLag)
  const half = bpmOf(bestLag * 2)
  const dbl = bpmOf(Math.max(1, Math.round(bestLag / 2)))
  const inPreferred = (b: number) => b >= 90 && b <= 180
  if (!inPreferred(raw)) {
    if (inPreferred(half) && half >= minBpm) {
      bestLag *= 2
    } else if (inPreferred(dbl) && dbl <= maxBpm) {
      bestLag = Math.max(1, Math.round(bestLag / 2))
    }
  }
  const bpm = bpmOf(bestLag)
  return Math.round(bpm * 10) / 10
}

/**
 * Beat grid from a tempo + onset envelope: phase-align to the strongest
 * onset, then emit beats every period until duration. Empty when the
 * tempo is unknown or the grid would be pure guesswork.
 */
export function beatGrid(bpm: number | undefined, onsets: Float32Array, fps: number, duration: number): number[] {
  if (!bpm || !Number.isFinite(bpm) || bpm <= 0 || duration <= 0) return []
  const period = 60 / bpm
  // phase = onset frame with the maximum envelope value
  let peakFrame = -1
  let peakVal = 0
  for (let i = 0; i < onsets.length; i++) {
    if (onsets[i] > peakVal) {
      peakVal = onsets[i]
      peakFrame = i
    }
  }
  const phase = peakFrame >= 0 ? (peakFrame / fps) % period : 0
  const beats: number[] = []
  for (let t = phase; t <= duration && beats.length < MAX_BEATS; t += period) {
    beats.push(Math.round(t * 1000) / 1000)
  }
  return beats
}

/**
 * Full analysis of a mono signal at `sampleRate`.
 * Pure — decode.ts is the only place that touches Web Audio.
 */
export function analyzeMono(samples: Float32Array, sampleRate: number, duration?: number): BeatAnalysis {
  const dur = duration ?? samples.length / sampleRate
  const peaks = computePeaks(samples)
  const win = Math.max(1, Math.round(sampleRate / 86)) // ~11.6 ms windows → ~86 fps
  const fps = sampleRate / win
  const env = energyEnvelope(samples, win)
  const onsets = onsetEnvelope(env)
  const bpm = detectBpm(onsets, fps)
  const beats = beatGrid(bpm, onsets, fps, dur)
  return {
    peaks,
    bpm: bpm && beats.length >= 4 ? bpm : undefined,
    beats: beats.length >= 4 ? beats : undefined,
    duration: dur,
  }
}

// ── Beat Sync playback helpers (pure, shared by preview + export) ──

/** Find the audio element a page's Beat Sync pulses follow: the first
 * visible audio element with a beat grid (autoplay preference ignored —
 * the user may mute it but still want the grid). */
export function beatSourceOf(page: { elements: unknown[] }): {
  beats: number[]
  bpm: number
} | null {
  for (const el of page.elements as Array<{ type?: string; visible?: boolean; beats?: number[]; bpm?: number }>) {
    if (el?.type === 'audio' && el.visible !== false && Array.isArray(el.beats) && el.beats.length && el.bpm) {
      return { beats: el.beats, bpm: el.bpm }
    }
  }
  return null
}

/**
 * Beat envelope at time `t`: 1 at each beat, decaying to ~0 midway to the
 * next. Used by preview playback and video export to scale beat-synced
 * elements: `scale = 1 + strength * beatEnvelopeAt(...)`.
 */
export function beatEnvelopeAt(beats: number[], t: number, decay = 0.14): number {
  if (!beats.length) return 0
  // binary search the last beat <= t
  let lo = 0
  let hi = beats.length - 1
  let idx = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (beats[mid] <= t) {
      idx = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (idx < 0) return 0
  const dt = t - beats[idx]
  const nextGap = idx + 1 < beats.length ? beats[idx + 1] - beats[idx] : 0.5
  if (dt >= nextGap) return 0
  return Math.exp(-dt / decay)
}
