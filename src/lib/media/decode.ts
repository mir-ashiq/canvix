// ─────────────────────────────────────────────────────────────
// decode — browser glue for beat-detect (v0.11).
//
// Turns a media File into (a) the analysis Beat Sync needs and (b) a
// poster frame for video. All heavy lifting is pure (beat-detect.ts);
// this file only touches Web Audio / DOM media APIs.
// ─────────────────────────────────────────────────────────────

import { ANALYSIS_RATE, analyzeMono, type BeatAnalysis } from './beat-detect'

/** Decode an audio file and run the beat analysis (mono, downsampled). */
export async function analyzeAudioFile(file: File | Blob): Promise<BeatAnalysis> {
  const arrayBuffer = await file.arrayBuffer()
  const Ctx: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new Ctx()
  try {
    const buffer = await ctx.decodeAudioData(arrayBuffer)
    // downmix to mono
    const mono = new Float32Array(buffer.length)
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch)
      for (let i = 0; i < buffer.length; i++) mono[i] += data[i] / buffer.numberOfChannels
    }
    // downsample to ANALYSIS_RATE (linear pick — fine for onset work)
    const ratio = buffer.sampleRate / ANALYSIS_RATE
    const n = Math.floor(mono.length / ratio)
    const down = new Float32Array(Math.max(1, n))
    for (let i = 0; i < n; i++) down[i] = mono[Math.floor(i * ratio)]
    return analyzeMono(down, ANALYSIS_RATE, buffer.duration)
  } finally {
    void ctx.close().catch(() => {})
  }
}

export interface VideoProbe {
  duration: number
  naturalWidth: number
  naturalHeight: number
  /** JPEG dataURL captured near the first frame */
  poster: string
}

/**
 * Probe a video file: duration, dimensions, and a poster frame (seeked to
 * ~10% or 0.5 s, whichever is smaller — trailers often fade in from black
 * at t=0). The poster is a JPEG dataURL so it rides the document (jsonb)
 * and replicates through collab without touching the media store.
 */
export function probeVideoFile(file: File): Promise<VideoProbe> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    const cleanup = () => URL.revokeObjectURL(url)
    const fail = (err: Error) => {
      cleanup()
      reject(err)
    }
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      const seekTo = Math.min(0.5, duration * 0.1)
      const capture = () => {
        try {
          const w = video.videoWidth || 640
          const h = video.videoHeight || 360
          const canvas = document.createElement('canvas')
          const scale = Math.min(1, 640 / Math.max(w, h))
          canvas.width = Math.max(2, Math.round(w * scale))
          canvas.height = Math.max(2, Math.round(h * scale))
          canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
          const poster = canvas.toDataURL('image/jpeg', 0.72)
          cleanup()
          resolve({ duration, naturalWidth: w, naturalHeight: h, poster })
        } catch (err) {
          fail(err instanceof Error ? err : new Error('poster capture failed'))
        }
      }
      // some browsers need canplay before seek/capture works
      video.onseeked = capture
      try {
        video.currentTime = seekTo
      } catch {
        capture()
      }
    }
    video.onerror = () => fail(new Error('Could not read this video file.'))
    video.src = url
  })
}
