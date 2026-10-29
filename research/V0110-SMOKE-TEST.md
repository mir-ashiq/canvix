# Canvix — v0.11.0 Focused Production Smoke Test

Date: 2026-10-30 · Build under test: `163a071` (v0.11.0) → findings fixed
as **v0.11.1** during the run · Verdict: **PASS after fixes** — and the
smoke caught **four real product bugs** that unit tests and API probes
could not see.

## Environment

The self-host / Vercel-equivalent reference path (per
`research/DEPLOYMENT-VERIFICATION.md`):

- `npm run build` → `NODE_ENV=production node .next/standalone/server.js`
- Live Supabase transaction pooler (PostgreSQL 17.11, ap-southeast-2)
- API-level probe: `scripts/smoke-v0110.ts` (plain HTTP, latency-ledgered)
- Browser-level probe: `tests/e2e/v0110-smoke.spec.ts` (Playwright Chromium,
  `--autoplay-policy=no-user-gesture-required`; ffprobe/ffmpeg verify media)
- Unit suite 285 · offline-merge probe 18 · deploy-readiness probe

Re-run:

```bash
npm run build
PORT=3100 NODE_ENV=production DATABASE_URL=<supabase-pooler-url> \
  node .next/standalone/server.js &
npx tsx scripts/smoke-v0110.ts http://127.0.0.1:3100
BASE_URL=http://127.0.0.1:3100 npx playwright test tests/e2e/v0110-smoke.spec.ts
npx tsx scripts/cleanup-v0110-probes.ts   # removes the browser probes' rows
```

## Results matrix

| Area | Probe | Result |
|---|---|---|
| Account registration/login | API §1 | ✓ 7/7 (register, me, logout, wrong-pw 401, login, 2nd account, dup 409) |
| Ownership & read-only | API §2 | ✓ 8/8 (owner save fast-path, anon/other-account `readOnly:true` + PUT 403, CSRF 403) |
| Realtime across two designs | API §3 | ✓ 10/10 — the v0.10.1 P2002 scenario: one pid live in designs A **and** B, 8/8 interleaved heartbeats + cursors 200, 3-way concurrent-create race 200, events isolated per design, presence visible in both, DB rows = 2 under the composite PK |
| Reconnect behaviour | API §4 | ✓ 5/5 (drop → events keep landing → `?since` replay gap-free, duplicate flush accepted 0, `retry: 1500`, keepalives) |
| A/V upload & playback | API §5 | ✓ 15/15 (2-chunk WAV byte-exact, offset-guard 409, finalize guards, Range 206/416, immutable headers, real MP4 round-trip + seek slice, A/V document round-trip, 415/413/403 guards) |
| Latency ceiling | API §6 | ✓ max 8.05 s (4.4 MB bytea finalize to Sydney) — **nothing near 30 s** |
| DB state | API §7 | ✓ same pid present in both designs (impossible under the old PK) |
| Browser: preview playback | e2e #1 | ✓ after fixes — audio AND video issue `play()` and `currentTime` genuinely advances |
| Browser: export with audio | e2e #2 | ✓ after fixes — ffprobe: video+audio streams; volumedetect: non-silent track |
| Browser: offline edit | e2e #3 | ✓ after fixes — honest Offline badge, queued op syncs on reconnect (server-side watcher), survives reload |
| Offline-merge regression | verify-offline-merge | ✓ 18/18 |
| Deploy readiness | verify-deploy-readiness | ✓ ALL GREEN |
| Unit suite | vitest | ✓ 285/285 (5/5 re-runs after de-flaking) |

## The P2002 / 30-second-timeout question

**No new P2002 errors and no 30-second timeouts appeared.**

- The production server log across the entire fixed-build session (two
  browser suites + the full API smoke + regression suites) contains **zero**
  `P2002`, zero `[collab/presence]` / `[collab/events]` errors, zero
  `tick failed`, zero `db-timeout`/`recycle` comments — boot banner and
  pooler-detection notes only.
- The API probe times every request: **56 requests, median ~1.3 s, max
  8.05 s** (the slowest five are all multi-MB media bytea round-trips to
  the Sydney pooler — expected, and an order of magnitude under the 30 s
  ceiling).
- The exact v0.10.1 incident scenario (one browser heartbeating into two
  designs simultaneously, plus a concurrent-create race on the same
  `(designId, pid)`) returns 200 every time, and the composite-PK rows
  coexist in the database.

## Findings — four real bugs (all fixed in v0.11.1)

The browser-level probes are what found these: three of the four live in
code paths that only execute in a real browser (Konva refs, media element
lifecycle, MediaRecorder), and the fourth was masked by the first.

### 1. Preview audio/video/animation effects never ran (race)

`PreviewStage` renders its Konva `<Stage>` only after the ResizeObserver
measures the container (`scale > 0`), but both playback effects bail when
`layerRef.current` is null on first run — and their deps
(`[page, animated, reduceMotion, playKey]`) never change afterwards.
Whether media played was a commit-vs-observer **race** — manual testing
usually won it, headless Chromium deterministically lost it.
**Fix:** a `stageReady = scale > 0` dep re-runs both effects when the
stage actually mounts (`preview-stage.tsx`).

### 2. Live video frames never swapped in (dead code)

The swap did `layer.findOne<Konva.Image>('#id')` — but `VideoNode`
renders a Konva **Group** (poster + play chip + badges) carrying the id.
`typeof group.image !== 'function'` → every video silently kept its
poster. This dead path also masked finding #3.
**Fix:** find the `Image` **inside** the group.

### 3. `canplay` seek-loop froze video at `trimStart` (~130 play()/s)

The `canplay` handler sought to `trimStart` unconditionally; the completed
seek re-triggered `canplay`, which sought again — playback never advanced
past `trimStart` while `play()` was re-invoked ~130 times/second.
**Fix:** seek once per element; the rAF tick now also wraps looping
videos back to `trimStart` (the native loop wraps to 0).

### 4. Video export recorded digital silence (two stacked races)

(a) `audioCtx.resume()` was fire-and-forget — a recorder started while the
context was still suspended records silence. (b) Worse: the export render
loop yields via a tight MessageChannel cycle that **starves the media
element's resource-selection task** — the audio element sat at
`readyState 0` (fetch never started) for the entire export, then
`finally` aborted the pending `play()` (AbortError) and the track was
-91 dB silence. Deterministic in headless, racy on real machines.
**Fix:** bounded `await` for context resume **and** for `canplay` on every
audio element *before* `recorder.start()` (main thread still idle); on
timeout the export still completes (silent, honestly) instead of hanging.

### 5. Collab status stayed "Live" through a hard network cut

A silently-dead SSE socket never fires `onerror` (no read timeout in
EventSource), so through a network cut the editor kept claiming "Live"
while every flush failed and queued. The browser's `online`/`offline`
events are the reliable signal.
**Fix:** `CollabSession` now listens: offline → honest "Offline — edits
save locally" badge immediately; online → reconnect instantly (clears the
backoff timer) instead of waiting it out. This is also what the e2e
offline-edit test now asserts end-to-end: badge → edit while offline →
reconnect → op observed landing on the server event log → survives reload.

### 6. Flaky unit test (pre-existing)

`beat-detect.test.ts` "white noise → undefined" used `Math.random()`, so
roughly one run in three drew a noise sample with enough spurious
autocorrelation to clear the detector's gate. **Fix:** seeded PRNG —
5/5 stable re-runs.

## Honest limitations

- Single server instance, single region (Sydney pooler), synthetic
  payloads; no multi-region or failover behaviour was exercised.
- The browser video probe uploads WebM (VP8+Vorbis) because Playwright's
  Chromium lacks proprietary codecs; the H.264/AAC MP4 path is verified at
  the HTTP level (byte-exact + Range) but not decoded in the browser here.
- Video export still renders poster frames, not moving video frames —
  documented v0.11 scope (`research/MEDIA-AND-BEAT-SYNC.md`).
- The e2e spec leaves probe rows (designs/media) in the DB by design —
  media has no delete API. Run `scripts/cleanup-v0110-probes.ts` after
  browser-suite runs; it matches only the spec's distinct design name and
  harvests media ids from those designs' own elements.
- The register route's in-memory rate limit (5 sign-ups/h/IP per instance)
  makes back-to-back API-smoke runs 429 on the duplicate-username check —
  the probe treats that as environmental and reports it as a note.
