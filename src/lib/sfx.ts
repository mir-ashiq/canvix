// ─────────────────────────────────────────────────────────────
// sfx — play offline pack sounds in the browser (the Sound wave).
//
// A tiny, allocation-conscious player for /sfx/<id>.wav:
//   • one pooled <audio> per id (16 max — the pack size), reused
//     across plays, so repeated triggers never leak elements
//   • hard same-id retrigger guard (60 ms) — double fires, rAF
//     restarts and collab replays don't machine-gun one sound
//   • total-concurrency cap (8) — a page with 30 animated elements
//     each carrying a sound still degrades gracefully
//   • SSR-safe and testable: every entry point no-ops when
//     `window` or `Audio` is absent (unit tests run in Node)
//
// Used by the preview/presenter playback engines (element
// animation SFX at their delay, page-transition SFX on page
// change) and by the Audio panel's audition buttons. Since v0.22
// the video export fires the same triggers onto its recorded audio
// track (buildSfxCues in video-export.ts — this player stays
// UI-only; the export schedules decoded buffers on the recorder's
// audio clock instead of pooling <audio> elements).
// ─────────────────────────────────────────────────────────────

import { isSfxId, sfxUrl } from '@/lib/assets/sfx-pack'

/** ms — one id cannot retrigger within this window */
const RETRIGGER_GUARD_MS = 60
/** max simultaneously playing pooled sounds */
const MAX_CONCURRENT = 8

const pool = new Map<string, HTMLAudioElement>()
const lastPlayed = new Map<string, number>()

function activeCount(): number {
  let n = 0
  for (const a of pool.values()) if (!a.paused) n++
  return n
}

/** Release everything (called on unmount of long-lived surfaces). */
export function stopAllSfx(): void {
  for (const a of pool.values()) {
    a.pause()
    a.currentTime = 0
  }
}

/** Play a pack sound by id. Unknown ids are ignored (defensive —
 *  sanitizeAnimation already gates what can be stored). `volume`
 *  clamps to 0..1. Never throws. */
export function playSfx(id: string, volume = 0.8): void {
  if (!isSfxId(id)) return
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return
  try {
    const now = performance.now()
    const last = lastPlayed.get(id) ?? -Infinity
    if (now - last < RETRIGGER_GUARD_MS) return
    lastPlayed.set(id, now)

    let audio = pool.get(id)
    if (!audio) {
      audio = new Audio(sfxUrl(id))
      audio.preload = 'auto'
      pool.set(id, audio)
    }
    // concurrency cap: stop the oldest playing sound if we're full
    if (activeCount() >= MAX_CONCURRENT) {
      for (const a of pool.values()) {
        if (!a.paused) {
          a.pause()
          break
        }
      }
    }
    audio.volume = Math.min(1, Math.max(0, volume))
    audio.currentTime = 0
    void audio.play().catch(() => {
      /* autoplay policy / decode race — silence is acceptable */
    })
  } catch {
    /* player must never take playback down */
  }
}

/** Test-only: wipe the pool + guards. */
export function resetSfxPlayer(): void {
  pool.clear()
  lastPlayed.clear()
}
