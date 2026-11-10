# Sound — operator guide & decision record (the Sound wave)

The Audio rail puts every way of getting sound into a design in
one place: an **offline pack of 16 synthesized sounds** (works with
zero configuration), **Freesound search** (provider-gated, CC0 by
default), **voiceover recording** (your mic), and a pointer to
audio **uploads**. Sound effects also attach to **element
animations and page transitions** (`sfxId`) and play in Preview and
Present.

This closes the audit's Sound gap cluster in full: 3.1 the CC0
library, 3.2 the Freesound connector, 3.3 voiceover recording,
3.4 animation and transition sound effects.

## The licence manifest (3.1)

Every file in `public/sfx/*.wav` is an **original synthesis by the
Canvix project** — oscillators, shaped noise and envelopes in pure
code (`scripts/gen-sfx-pack.mjs`, deterministic LCG noise so builds
are reproducible). No samples, no third-party recordings. The pack
is released **CC0** (`docs/SOUND.md` is the manifest): use the
sounds anywhere, no attribution required — the credit block on an
inserted pack sound says so for the record.

Freesound results carry the licence the API reports; the connector
**filters to Creative Commons 0 by default**, and the credit block
stored on the element shows provider · author · licence with the
source URL (the A4 photo attribution pattern — durable on the
element, shown in the properties bar, never burned into exports).

## Why sound search is NOT an AI feature (the A4 pattern, again)

"Find me a rain sound" is a library query against a licensed
catalog — the same reasoning that moved photo search off the AI
provider table (docs/STOCK-PHOTO.md). Freesound is the **fourth
stock-media connector**, riding the R6/A4/A5 architecture: plain
REST, one free key, console-manageable, 24 h in-memory response
cache, status-only errors, normalized results with durable credit
blocks.

## Providers

| Provider | Console card | Env fallback | Where to get it | License |
|---|---|---|---|---|
| Freesound | Stock media → Freesound | `FREESOUND_API_KEY` | https://freesound.org/apiv2/apply/ (free) | CC0 (default filter) · CC BY & friends opt-in |

**Key resolution (A5 pattern):** a key stored on the admin AI &
models page (Stock media card) wins over the env var; clearing the
stored key restores the env fallback; no key at all ⇒ the Freesound
section shows the operator hint and `POST /api/stock-sound/search`
answers `503 NO_PROVIDER` — the offline pack and everything else
keep working (F2b fail-closed).

The admin **Test** button runs one minimal real search through the
effective key (`POST /api/admin/config/stock-test` with
`{provider: 'freesound'}`) — the same probe shape as Pexels and
Pixabay, rate-limited to one per 10 s.

## The insert path (and its honest limits)

- **Freesound results** insert the **preview MP3** (HQ when
  present). Original FLAC/WAV/OGG downloads need OAuth2 on
  Freesound's side — out of scope for the self-hoster key flow, and
  the preview quality is what Canva-class tools insert anyway.
  Downloads happen in the browser (the CDN is CORS-open), then ride
  the existing chunked media store: quota, sha256 dedupe and the
  size caps all apply.
- **Every insert** (pack sound, Freesound result, voiceover) runs
  the full audio analysis — waveform peaks, BPM, beat grid — so
  **Beat Sync works on day one** (an audio element with a beat grid
  drives the beat clock in Preview).
- **Voiceover** records through `MediaRecorder` (Opus/WebM, MP4 on
  Safari), capped at 5 minutes, and stores the "recorded by the
  author" credit block. Mic permission denials surface as an honest
  toast, never a broken UI.

## Animation + transition SFX (3.4)

`ElementAnimation.sfxId` and `PageTransition.sfxId` (both additive,
nullable, no migration) name one of the 16 pack sounds:

- The **Animate panel** exposes "Entrance sound" on animated
  elements and "Transition sound" on page transitions — a select
  with an inline audition button.
- **Playback**: the Preview/Presenter engine fires element SFX on
  the rAF clock when the animation triggers (at its delay), and the
  transition SFX when a page appears. `prefers-reduced-motion`
  mutes everything (the accessibility posture of the animations
  themselves).
- **Sanitization**: `sanitizeAnimation` / `sanitizePageTransition`
  validate the id against the pack catalogue — hostile or stale
  input can only pick from the bundled files, and unknown ids are
  dropped, never stored.
- **Video export does not fire sfxId triggers in v1** (the export
  muxer mixes page audio elements, not per-animation triggers —
  recorded here so nobody has to rediscover it). The panel says the
  workaround inline: insert the sound from the Audio panel as an
  autoplay audio element and it rides the existing export path.

## API surface

| Route | What |
|---|---|
| `GET /api/stock-sound/available` | secret-free feature detection (`{available, providers}`) |
| `POST /api/stock-sound/search` | `{query, count, includeOtherLicenses?}` → normalized CC0-first results (rate bucket `stocksound:search`, 20/min; admin `soundSearch` kill switch) |
| `POST /api/admin/config/stock-test` | `{provider: 'freesound'}` — one real probe through the effective key |

`/api/ai/capabilities` reports `soundSearch` (stock key + admin
flag — never an AI slot). The admin console's feature toggles
include the Sound search switch.

## Dependency decision

**Zero new runtime dependencies** — the Freesound API is
JSON-over-GET with one token, the SFX pack is generated at build
time by a Node script with no imports, and the player is ~80 lines
over the native `Audio` element. Recorded per the house rule.
