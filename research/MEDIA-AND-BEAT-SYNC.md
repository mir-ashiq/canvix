# Canvix v0.11 — Audio/Video elements & Beat Sync

Date: 2026-10-29 · Status: **implemented, unit-verified (285 tests),
live-verified against the production database (19/19 media checks,
18/18 collab checks).**

## What shipped

- **Audio elements** — a native waveform player card on the canvas, a
  media store for the actual file, and playback in preview/present plus
  video export.
- **Video elements** — poster-frame representation on the canvas (what
  every replica and every export renders), frame playback in
  preview/present, trim window, volume/mute/loop.
- **Beat Sync** — audio uploaded to Canvix is analyzed in the browser
  (tempo + beat grid + waveform peaks); any element can pulse on the
  beats, in preview, presentation and video export.

## The design

### Why a media store (not dataURLs like images)

Images embed as dataURLs inside the element — fine for ~100 KB assets,
catastrophic for 4–32 MB audio/video: every autosave PUT would carry the
whole file. A/V lives in a new `Media` table (migration 0005, `bytea`),
and elements reference it by id: `src = /api/media/<id>`.

Chunked upload, because serverless body limits (Vercel 4.5 MB) would
cap files at a useless size:

| Step | Route | Notes |
|---|---|---|
| init | `POST /api/media` `{mime,size}` | 201 → `{id, chunkSize}`; mime must be audio/* or video/*; cap `CANVIX_MAX_MEDIA_MB` (default 32) |
| append | `PATCH /api/media/<id>?offset=n` (raw body) | **offset-guarded** raw SQL `UPDATE … SET bytes = bytes ‖ chunk WHERE octet_length(bytes) = n` — a replayed or racing chunk gets 409 instead of interleaving |
| finalize | `PUT /api/media/<id>` `{expectedSize}` | verifies length; sets `finalizedAt`; GET 404s until then |
| stream | `GET /api/media/<id>` | Range-aware (206/416), immutable cache, `Accept-Ranges` |

Unfinalized uploads are GC'd after 24 h (lazy, on init). Finalized media
has no delete API in v0.11 — deleting a design does not delete its media
(honest limitation: orphans are possible; documented, bounded by the
upload cap).

### Analysis baked into the element

`src/lib/media/beat-detect.ts` (pure DSP, Node-testable) +
`decode.ts` (browser glue):

1. decode via Web Audio → mono, downsampled to 11.025 kHz
2. onset envelope: RMS energy per ~11.6 ms window → positive first
   difference (energy flux)
3. tempo: **mean-centered** autocorrelation over the 60–180 BPM lag
   range (centering is what keeps white noise from false-positive
   tempi — the unit tests caught that), harmonic check preferring
   90–180 BPM
4. beat grid: phase-aligned to the strongest onset, capped at
   `MAX_BEATS = 480`

The result (`peaks` ≤ 200, `bpm`, `beats`, `duration`) rides the element
— every replica renders the waveform and beat-syncs **without the
multi-MB file**. Sizes respect the collab validator (≤ 500-array,
≤ 256 KB per op).

### Playback model (where media actually plays)

- **Editor canvas**: never — the canvas always shows the poster /
  waveform card (editing stays deterministic; a playing video would
  fight the transformer).
- **Preview / Present** (`preview-stage.tsx`): audio elements with
  "Play on page open" play via DOM `Audio`; video elements swap their
  poster Konva image for a live `<video>` (restored on unmount); the
  first audio with a beat grid drives a rAF loop that scales
  beat-synced elements (`1 + strength × 0.12 × envelope`).
- **Video export** (`video-export.ts`): waveform cards + posters render
  (mirroring the canvas geometry); beat pulses are applied in
  `drawPage` so they compose with entry animations; page audio is
  **muxed into the recording** (best-effort: AudioContext
  MediaStreamDestination + a codec that declares audio, e.g.
  `vp9,opus`; browsers that refuse — autoplay policies — produce a
  correct silent video).

### Beat Sync UX

Any single-selected element gets a "Beat" popover when its page has an
audio element with a detected grid: a 0–100 % pulse strength. The audio
element itself exposes volume / loop / "play on page open" (and BPM
chip); video adds mute + trim start/end. The popover tells the user to
enable autoplay on the audio — pulses run only while the music runs.

## Verification

- **Unit (18 new, 285 total):** synthetic click tracks at 90/120/140/160
  BPM (±2 %), silence → no tempo + flat waveform, white noise → no
  tempo, beat-grid spacing, envelope decay, `beatSourceOf` selection,
  peaks normalization/caps.
- **Live (`scripts/verify-media.ts`, 19 checks, production DB):**
  two-chunk upload with exact byte round-trip, **replayed chunk → 409**
  (the offset guard), pre-finalize 404, wrong-size finalize → 409,
  Range 206 + 416, immutable cache headers, design save/load round-trip
  of a full audio element, mime/size rejections, CSRF. All green; probe
  media cleaned up afterwards.
- **Collab regression:** the offline-merge probe still 18/18 — new
  element types flow through the same stamped ops.
- Cloudflare 2.14 MB gz / Netlify 19.6 MB zip — unchanged.

## Honest limitations (documented, deliberate)

- **Video in exports**: exports render the poster + play affordance +
  beat pulses, not the moving frames (the frame renderer is page-hold
  based; re-timing it around video playback is future work). Audio IS
  muxed (best-effort).
- **Audio muxing is browser-dependent** — requires a MediaRecorder mime
  with an audio codec and a resumable AudioContext; falls back to
  silent video without failing the export.
- **Media has no delete/GC once finalized** — orphaned uploads persist
  until an operator clears them (`DELETE FROM "Media" WHERE …`). The
  32 MB default cap bounds the damage; a usage view + GC is roadmap
  material.
- **Beat detection is onset-based** — steady percussive music works
  great; ambient/drone/free-tempo material yields no grid (the element
  then simply has no Beat Sync chip, and pulses don't run).
- **One beat clock per page** — the first visible audio element with a
  grid; multiple beat-synced audio files on one page pulse to the
  first.
