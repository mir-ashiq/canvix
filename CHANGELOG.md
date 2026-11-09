# Changelog

All notable changes to Canvix will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.17.0] — 2026-11-09

The Wave 2 feature drop from the consolidation programme — the asset &
template ecosystem (see `docs/COMPETITIVE-ANALYSIS.md` for the roadmap).
Ten features in one release; re-scoring the Wave 1 matrix after this
wave is the acceptance bar.

### Added

- **Icon library — 562 offline icons + the Iconify universe online.**
  The Icons app grew from 12 shapes to a two-source library: a bundled
  offline pack (extracted from the ISC-licensed lucide-react set at
  build time by `scripts/gen-icon-pack.mjs`, flattened to editable
  vector paths in the Canvix 100×100 box — recolour from the properties
  bar, full export parity in PNG/SVG/vector-PDF) and an online toggle
  proxying api.iconify.design (`GET /api/icons?q=` search and
  `?svg=prefix:name` fetch — strictly validated, 30/min rate limit,
  hard edge caching, inserts as image elements with full colour
  fidelity). Works offline; the online half degrades gracefully.
- **Illustration packs — 48 original flat-art pieces.** Six packs
  (business, people, nature, tech, abstract, festive) authored
  in-house from primitives (`scripts/gen-illustrations.mjs` — clean
  room, nothing copied), bundled offline as standalone SVGs, inserted
  as image elements with search and pack filters.
- **Font catalog ×5.8 — 63 → 369 families with on-demand loading.**
  The catalog moved to `lib/fonts/catalog.ts`; the historic 63 stay on
  the preload link and every other family loads lazily via
  `ensureFontLoaded` (font dropdown hover/select, document open scan,
  template preview mounts). Konva stages repaint on font arrival
  (`canvix:fonts-loaded` broadcast). The dropdown keeps Canva-style
  search + category pills over the full 369.
- **Custom font upload.** `POST /api/fonts/custom` (raw bytes,
  .ttf/.otf/.woff/.woff2, 8 MB cap, session-or-anon attribution,
  stored in the Media table) + client FontFace registration; the font
  dropdown gained an "Upload a font" button, a `custom` category pill
  and per-font delete.
- **Save as template.** File → "Save as template…" persists the open
  document as a private starter template (`UserTemplate` table,
  design-style attribution, 50-kit quota, structural validation). The
  editor Templates panel lists "Your templates" first, with apply and
  delete.
- **Smart templates — fields, CSV bulk fill and a REST fill API.**
  Templates may declare fields; text elements carry `{{key}}` markers.
  One substitution engine (`lib/templates/fields.ts` — pure, tested)
  powers three surfaces: the editor's guided fill dialog (opens when
  applying a fielded template), the dashboard CSV bulk flow (upload or
  paste, column mapping preview, one design per row, `?persist=1`),
  and `POST /api/templates/[slug]/fill` for agents and MCP (JSON
  values/rows, raw CSV or multipart; render-only by default, persist
  opt-in; agents without browser Origin headers pass CSRF by design).
  12 new field-enabled templates ship (4 certificates, 3 business
  cards, 2 quote posts, 2 event flyers, 1 invoice).
- **Server-side brand kits.** `BrandKitRecord` + full CRUD at
  `/api/brand-kits` (10 kits per attribution, validated colours/
  palettes/fonts/logo data-URLs). The Brand panel syncs the active kit
  debounced, keeps localStorage as offline fallback, and gained a kit
  selector with create/delete and a live sync indicator.
- **Preset catalog 8 → 60.** `PRESET_GROUPS` spans social, video,
  docs, print and web/marketing sizes; the dashboard's 9th quick card
  opens a searchable grouped browser ("More sizes") with custom-size
  escape hatches.
- **Template library 110 → 366.** Two deterministic computed variants
  per design (Aurora colourway, Ink typography swap — pure transforms
  in `lib/templates/variants.ts`, zero extra bundle bytes, stable
  slugs, idempotent re-seeds) plus the 12 smart templates. Whites
  survive colourways; field markers survive both transforms.
- **Schema migration 0011** — `UserTemplate` + `BrandKitRecord` tables
  and the nullable `Template.fields` column. Upgrade-safe from any
  v0.16.5 database (new tables only; `npm run db:setup` applies and
  re-seeds, refreshing the library to 366).

### Changed

- `FONTS` re-exported from `lib/fonts/catalog.ts` (same import path
  via `lib/editor-utils`); layout preload unchanged for the original
  63 families.
- Dashboard template click on a smart template now substitutes EXAMPLE
  values — raw `{{markers}}` never reach the canvas.

## [0.16.5] — 2026-11-08
## [0.16.5] — 2026-11-08

### Added

- **Pexels & Pixabay keys in the admin console — the Stock media
  card (A5).** The two free stock-media keys behind the Photos and
  Videos search rails are now managed on the AI & models page like
  the AI providers: write-only key fields (stored keys echo as
  masks only), a per-provider Test button and a per-provider Clear,
  in a fixed two-provider card below Model slots. They are library
  catalogs, not AI providers — the A4 decision, now manageable
  without editing `.env` and redeploying. Precedence mirrors every
  other credential in the console: a stored key wins over
  `PEXELS_API_KEY` / `PIXABAY_API_KEY`, clearing it restores the env
  fallback, and saving takes effect immediately (the key store rides
  `AppConfig` behind the config module's 10 s in-process cache —
  the same cost profile as the feature switches already sitting on
  every AI route). The Model-slots banner now points at the card
  instead of telling the operator to go edit environment variables.
- **Stock-key Test button** — one minimal one-result search through
  the provider's real search endpoint (`/v1/search` for Pexels,
  `/api/` for Pixabay) with the effective key: the same call the
  Photos rail makes, so a pass there is a pass in the panel, and a
  401 says "rejected the key" in plain words. Admin-only,
  same-origin, rate-limited to one probe per 10 s — it is one of
  the only console actions that spends real provider quota. The
  verdict never echoes the key, the request URL (Pixabay's key
  rides the query string) or the provider's response body.

### Changed

- `stockPhotoProviders` / `stockVideoProviders` /
  `stockPhotoAvailable` are now **async** — key resolution reads the
  console store first. Internal API only; the routes that consume
  them await, and `/api/stock-photo/available` +
  `/api/stock-video/available` + `/api/ai/capabilities` answer
  exactly as before (booleans and provider names, never keys).

## [0.16.4] — 2026-11-07

### Added

- **Stock photo search on Pexels/Pixabay keys — the `imageSearch`
  AI slot is retired (A4, #44).** "Find me a photo of a coffee
  shop" is a library query against licensed stock catalogs, not a
  generative one, and almost no OpenAI-compatible vendor serves the
  `images/search` endpoint the old slot demanded — the standing 404
  behind the A3 incident. Photo search now rides the same
  self-hoster-key architecture as the Videos rail (v0.15 R6):
  Pexels + Pixabay, plain REST, one free key each, and the same two
  env keys (`PEXELS_API_KEY` / `PIXABAY_API_KEY`) activate both
  rails. Every result carries a sanitized, durable credit block
  (provider, author, license, source page) stored on the inserted
  element and shown at insert and on selection — never burned into
  the canvas or exports. No key configured ⇒ the Photos panel keeps
  its bundled library, search answers `503 NO_PROVIDER` with the
  operator hint, everything else is untouched (the F2b pattern). No
  migration — stored provider tables that still carry an
  `imageSearch` slot are read fine and drop it on the next save.

### Fixed

- **Photos categories are the results-mode exit hatch — always
  render (#45).** A category chip could disappear behind the
  results header after a web search, leaving no way back to the
  bundled library.

## [0.16.3] — 2026-11-07

### Added

- **Admin Logs view (`/admin/logs`) — "why did the AI feature fail?"
  finally answerable from the console.** Every AI request through
  `withProvider` now writes a durable telemetry row (AIUsage, extended
  by migration `0010_ai_request_log`): feature, provider, model,
  outcome status, round-trip duration and a scrubbed failure reason —
  every outcome recorded, not just successes: provider failures carry
  the provider's HTTP status, and the guard exits are logged with
  their codes (403 rejected · 429 rate-limited · 503 disabled or
  unconfigured, slot named). The page leads with a slot-status strip
  (what each of the five capability slots resolves to right now), then
  the request log with live tail (5 s, pauses on hidden tabs), window /
  feature / outcome filters and per-feature call/error counters. Rows
  are swept after 90 days like TrafficStat.
- **Per-slot "Test" buttons on the AI & models page.** The A2 test
  connection only proved chat worked — a chat-only provider (NVIDIA NIM
  et al.) passed every test while image generation 404'd in production,
  which is exactly the incident that prompted this release. Each slot
  is now probed through the endpoint it actually uses: text/vision via
  a minimal chat completion, image via a real minimal generation,
  imageEdit via a deliberately image-less probe (a 400-class "must
  provide images" answer PROVES the endpoint exists, costlessly),
  imageSearch via a one-result search. Verdicts explain themselves —
  a 404 says "this provider does not serve image generation; pin those
  slots to a provider that does". Every slot row also shows the
  endpoint path it exercises.

### Fixed

- **AI failure responses now carry the reason.** The 502 body from AI
  routes includes `code: "PROVIDER_ERROR"` and a scrubbed `detail`
  ("404 page not found (HTTP 404)") — the same string the Logs view
  shows, so end users and the admin see one truth. Credential-shaped
  tokens (nvapi-/sk-/Bearer…) are masked before anything is logged or
  returned.
- **OpenAI-style `b64_json` image responses work.** The SDK passes
  non-URL items through untouched, and the image/image-edit routes only
  read `data[0].base64` — providers answering `b64_json` (the OpenAI
  shape) returned "no image". Both routes now accept either field.

## [0.16.2] — 2026-11-07

### Fixed

- **Every console/env-configured AI provider failed with "Configuration
  file not found or invalid" (A2 root-cause fix).** A1 injected the
  resolved provider into `process.env.ZAI_BASE_URL`/`ZAI_API_KEY` before
  calling `ZAI.create()`, on the belief that the SDK resolved env vars.
  It does not — the SDK's `loadConfig()` only ever reads
  `.z-ai-config` files (cwd → ~ → /etc). On any host without that file
  (the canvix.app VPS included) every "Test connection" answered
  502 "Provider initialization failed" and every AI feature answered
  503, no matter what was saved in the console. `makeClient()`
  (src/lib/ai/provider.ts) now constructs the SDK directly with the
  resolved `{ baseUrl, apiKey }` — the constructor takes exactly that
  shape, and any OpenAI-compatible endpoint works through it.

### Added

- **Multi-provider AI configuration (A2).** `/admin`'s AI page now has
  a providers table — up to eight OpenAI-compatible endpoints (NVIDIA
  NIM, OpenRouter, Z.ai, Groq, OpenAI…), one write-only key each — and
  five capability slots (`text`, `vision`, `image`, `imageEdit`,
  `imageSearch`) that can each be pinned to a different provider +
  model, so Magic Write can run on one vendor while image generation
  runs on another. Per-slot precedence: providers table → legacy
  single override → env vars → `.z-ai-config` → unconfigured.
  `/api/ai/capabilities` probes per slot; keys are preserved on edit
  (empty field = keep the stored credential); one click imports the
  A1 single-provider override into the table. Storage is one more
  `AppConfig` JSON row (`ai.providers`) — no schema change. Per-row
  Test buttons probe a specific provider (`{ providerId }` body on
  `/api/admin/config/ai-test`).
- **Real-time traffic panel (A2).** `/admin`'s overview now leads with
  a live panel fed by `GET /api/admin/realtime` (2 s polling,
  self-excluded from its own counters): requests/errors per second
  over the last 60 s, 5-minute request/error/active-visitor/AI-call
  totals, p50/p95 latency and the window's top routes. Counters live
  in `src/lib/admin/realtime.ts` — a zero-import, hard-capped,
  in-memory module statically linked into the observability wrapper
  (cannot repeat the v0.16.1 edge-bundle regression); visitors are
  per-boot salted hashes, never raw IPs; `CANVIX_TRAFFIC=0` disables
  live recording together with the durable counters. Process-local by
  design — TrafficStat/AIUsage remain the durable record.

### Changed

- `withProvider()` handlers now receive one `{ zai, model }` context
  instead of a bare client — a slot's provider and model can no longer
  drift apart between resolution and the request.
- MCP `generate_design` uses the text slot's provider + model (was:
  SDK default on whatever `getZAI()` resolved).

## [0.16.1] — 2026-11-07

### Fixed

- **Self-hosted `next build` regression (A1 follow-up).** A1 wired the
  traffic counters into `withLogging` with a static import of
  `@/lib/admin/traffic` — the Prisma client — which broke the
  observability module's stdlib-only contract (v0.12.5) and with it
  every self-hosted production build: Next also compiles
  `src/instrumentation.ts` for the edge runtime, Turbopack followed the
  new import into Prisma's query-compiler wasm loader, and `next build`
  failed with "The export default was not found in module
  …query_compiler_bg.postgresql.raw.wasm" (first seen on the canvix.app
  VPS, where the failed build also wiped `.next/standalone` under the
  running process — every static asset 500'd until a successful
  rebuild). The counter now loads lazily behind the documented
  `NEXT_RUNTIME` define — the edge compilation context folds the guard
  to `return` at build time, so Prisma is never traced into the edge
  instrumentation bundle — while runtime behaviour on Node is unchanged
  (fire-and-forget, error-swallowing, `CANVIX_TRAFFIC=0` opt-out).
- **CI never ran `next build`.** The lint-unit gate type-checked,
  linted and unit-tested, and the e2e suite boots `npm run dev` — so
  the edge-instrumentation breakage passed every check and only failed
  on a real deployer. lint-unit now runs the production build too
  (timeout raised to fit).

### Changed

- `package-lock.json` version fields re-synced with `package.json`
  (the 0.16.0 bump missed them, so every `npm install` on a deploy
  VPS dirtied the lockfile).

## [0.16.0] — 2026-11-07

### Added

- **Admin console, part 1 (A1).** `/admin` — the operator surface for
  a self-hosted instance, with **zero new dependencies** (Prisma
  models, hand-rolled SVG charts, the existing stack). Operator guide
  and full decision record: `docs/ADMIN.md`. The highlights:
  - **Fail-closed admin access.** Two paths only: the
    `CANVIX_ADMIN_USERS` env bootstrap (set it, restart, sign in —
    also the lockout recovery path) or a `User.role = 'admin'` granted
    by another admin from the console. No first-user-is-admin, no
    secret URL. The API re-checks every call independently of the UI
    (401 unsigned / 403 non-admin); mutations are same-origin guarded;
    self-role-change is refused.
  - **Traffic analytics.** Every API request (all routes already pass
    through the `withLogging` wrapper) increments a per-day aggregate:
    route template, method, status, count — **never ids, IPs or query
    strings**. The Overview page shows 14-day traffic, daily-active
    users (userIds + hashed anon keys from dashboard/editor opens),
    signups and AI calls (teal ok / red failed), plus top routes and
    AI usage by feature. 90-day lazy retention; `CANVIX_TRAFFIC=0`
    opts out; the workerd fire-and-forget caveat is documented.
  - **User directory.** Searchable, paginated, with design counts,
    active sessions and last activity per user; admin grant/revoke
    with a two-step inline confirm; force sign-out (one bounded
    DELETE on `Session`).
  - **AI provider & model configuration.** A console override that
    wins over `ZAI_BASE_URL`/`ZAI_API_KEY` (write-only key, masked
    echo, half-configured states rejected), configurable
    text/vision/image model ids validated before use, a live
    connection test (1 per 10 s, 15 s circuit breaker), and seven
    per-feature kill switches that gate the routes *and* the public
    capabilities endpoint — a switched-off feature greys out in the
    editor and answers 503 before any provider work.
  - **Instance settings.** "Allow new sign-ups" answers
    `503 SIGNUPS_CLOSED` — checked *before* the rate limiter so a
    closed instance burns none of a visitor's attempt budget.
    "Anonymous editing" gates anonymous design creation/saves only;
    reading, sharing and exporting never break.
  - **Honest e2e without registrations.** The acceptance spec seeds
    its fixture users and sessions straight into Postgres (the `pg`
    driver already in the tree) — the suite stays inside the 5/h/IP
    register budget while proving the full path: gating, role
    round-trip, switches reaching `/api/ai/capabilities`, counters
    landing in the overview.

### Changed

- Prisma migration `0009_admin_console` (additive): `User.role`
  default `'user'`, `AppConfig`, `TrafficStat`, `DailyActive`.
- The Word Cloud plugin's `engines.canvix` range widened to
  `>=0.13.4 <0.17.0` for this minor series.

## [0.15.5] — 2026-11-07

### Added

- **Rich content & export, part 6 — stock video depth (R6).** A
  provider-gated **Videos** rail: configurable stock-video
  connectors (Pexels + Pixabay — free self-hoster keys), license
  and attribution surfaced, **zero new dependencies**. Decisions
  and the operator guide live in `docs/STOCK-VIDEO.md`; the
  highlights:
  - **The F2b gate, one class over.** No `PEXELS_API_KEY` /
    `PIXABAY_API_KEY` on the server ⇒ the rail item never renders
    and `/api/stock-video/*` answers `503 NO_PROVIDER` —
    everything else in the editor keeps working. Availability is
    probed once per editor mount from a secret-free endpoint.
  - **One normalized result set.** `src/lib/stock-video.ts` maps
    both providers to one shape (mp4 ladder + poster + sanitized
    credit), parses every field defensively (unknown keys
    ignored, `javascript:` URLs can never become credit links,
    control characters stripped, lengths hard-capped) and caches
    responses in memory for 24 h per instance (Pixabay's request).
  - **Inserts ride the existing rails.** The browser downloads
    the chosen rendition (both CDNs are CORS-open on GET —
    verified, not assumed) into the chunked media store, so
    quota, sha256 dedupe, the 32 MB cap and the library listing
    all apply; a 413 or failed download falls back to the next
    smaller rendition automatically.
  - **Attribution is durable.** The credit block is stored on
    `VideoElement.credit` (it rides autosave, versions, collab
    and the offline merge), shown in the insert toast and as a
    chip in the properties bar whenever the element is selected —
    deliberately never rendered on canvas or burned into exports.
  - **Honest testing without provider keys.** Unit suite parses
    recorded provider fixtures; the acceptance e2e runs the FULL
    path (search → browser download → upload → poster probe →
    element with credit) against a local mock Pexels API serving
    real ffmpeg-generated renditions
    (`playwright.stockvideo.config.ts`, wired into CI); the
    default suite asserts the gated world (hidden rail + 503).
- **Verified**: tsc/eslint clean · unit 975/975 (25 new) ·
  anonymous zero-registration e2e: gated spec + mock-provider
  acceptance 2/2 · full local regression 65/65 in three
  fresh-server batches · plugins flag-on 5/5 · production build
  clean.

## [0.15.4] — 2026-11-06

### Added

- **Rich content & export, part 5 — GIF export (R5).** Animated,
  looping GIFs from any page range, rendered entirely in the browser
  with **zero new dependencies** (a hand-rolled GIF89a writer + LZW
  compressor, the R2/R4 house pattern). Every dependency decision is
  on record in `docs/GIF-EXPORT.md`; the highlights:
  - **One render session, three engines.** The GIF engine rides the
    exact `createRenderSession` the two video engines use — R2's
    deterministic fixed-timestep pacing and R3's frame-accurate
    autoplay videos apply to GIFs for free.
  - **A real quantizer, not a first-fit hack.** Median cut over 8
    deterministic timeline samples (the same design always yields
    the same palette); each palette colour is the most-popular
    colour of its box, so flat fills pass through exactly. Per-pixel
    indexing is a 15-bit nearest-colour LUT — O(1) per pixel.
  - **Dithering is an option** (default on): standard Floyd–Steinberg,
    error clamped into gamut. Turn it off for smaller files.
  - **Size cap + honest timing.** 480/720/1080 px caps, a 25 MB byte
    cap checked *during* the encode (early abort with advice), an
    1800-frame cap refused *before* rendering in the dialog. Delays
    are centiseconds and durations are reported from the actual
    encoded delays (15 fps = 7 cs = 14.29 effective — stated, not
    hidden). GIFs are silent; the dialog says so before you click.
  - **Verified**: unit 60 new (PIL golden LZW streams decoded by an
    independent in-test decoder; byte-level container assertions;
    4096-entry table exhaustion) · new anonymous zero-registration
    e2e with ffprobe as the independent parser, the page-range
    acceptance, and the pre-flight cap refusal.

## [0.15.3] — 2026-11-06

### Added

- **Rich content & export, part 4 — vector-text PDF (R4).** The PDF
  export now emits **real selectable, searchable text** with embedded
  subset fonts instead of rasterized pages, and shapes, lines,
  strokes, tables, charts, embeds and frames render as true vectors
  (photos keep their original JPEG bytes — `DCTDecode` passthrough).
  The architecture and every dependency decision are on record in
  `docs/PDF-VECTOR-EXPORT.md`; the highlights:
  - **Text model via the SVG serializer's** — `layoutRichLines`
    positions every run (rich spans or flat), baselines use Konva's
    exact measured-metrics formula, underline/strike use Konva's
    exact geometry, and per-glyph `TJ` adjustments are computed from
    the same canvas measurements the editor wraps with, so glyph
    placement matches the canvas to the pixel.
  - **Font ladder, fail-closed:** embed a subset of the real Google
    font (a tiny `/api/fonts/ttf` route negotiates TrueType bytes
    through the same css2 CDN the app already renders with — legacy-UA
    negotiation, weights snapped per family) → fall back to the
    documented per-category standard-14 face (Helvetica/Times/
    Courier + WinAnsi) when offline or unreachable → rasterize the
    element only when glyph coverage drops below 75%.
  - **Subsetting is hand-rolled** (`src/lib/pdf/ttf.ts`): used
    glyphs only, composite components rewritten, re-indexed cmap,
    rebuilt hmtx/loca/maxp, correct checksums — verified against
    real Google-served fonts, cross-checked by fontTools on dev
    machines, byte-compared through the module's own re-parser.
  - **Per-element raster strips** (the video-export Konva compositor
    reused) keep emoji stickers, plugin renders, filtered images,
    drop shadows, curved/fx/gradient text pixel-perfect — a page
    never degrades as a whole.
  - **jsPDF removed** (net dependencies −1): the new ~250-line
    writer covers the old raster path in 40 lines and does what no
    jsPDF API exposes cleanly — per-glyph positioning, Type0
    dictionaries, raw streams. 60 new unit tests (890 total), plus
    an anonymous e2e asserting `pdftotext` extractability.

### Changed

- Export dialog: the PDF format renders from design data (no more
  page-flipping waits during multi-page export); the quality control
  now sets raster detail for photos/stickers while text stays
  resolution-independent.

## [0.15.2] — 2026-11-06

### Added

- **Rich content & export, part 3 — moving video in exports (R3).**
  Autoplay video elements render their MOVING content in exported
  videos — frame-accurately — instead of the poster frame they had
  shown since v0.11.
  - **`windowedSourceTime`** — the one source-time mapping both export
    engines share (pure, unit-tested): page-local t=0 → trimStart,
    looping wraps within the trim window, non-looping holds the final
    frame, a trim past the file clamps to the loaded duration, and
    every input is garbage-safe (never NaN, never negative).
  - **WebCodecs engine: seek + draw per fixed timestep.** Before each
    frame is composited, every visible autoplay video is seeked to its
    exact source position — seeks are deduped (same rounded target ⇒
    no-op), parallel across videos and individually bounded (3 s); a
    seek that never completes draws the last decoded frame, so a slow
    video source can only make the export take longer, never drop or
    duplicate a frame (R2's deterministic pacing preserved).
  - **MediaRecorder engine: wall-clock playback.** Autoplay videos
    play beside the page audio — segment entry seeks to trimStart and
    plays (muted — the export muxes page audio only; that boundary is
    the R3 acceptance, unchanged), segment exit pauses + resets, and
    the frame loop applies the trim window with the same rule the
    presentation rAF tick uses.
  - **Honest degradation everywhere**: non-autoplay videos keep the
    static poster render (the presentation semantic); a source that
    fails to load (CORS-blocked remote, gone media id, 12 s canplay
    budget missed) falls back to the poster — fail-closed, the same
    rule as the image loader; decode is capped at 12 simultaneous
    videos (`MAX_EXPORT_VIDEOS`), the rest keep posters. Live videos
    render without the play chip (an editor affordance — this one is
    playing).
  - The export dialog says so before you click: "Autoplay videos
    export with their moving content frame-accurately."
  - CPU cost, on the record: each visible autoplay video costs one
    seek round-trip per exported frame on the WebCodecs path
    (typically ~5–15 ms in Chromium — a 30 fps × 10 s page with one
    video ≈ 300 seeks ≈ a few extra seconds); the MediaRecorder path
    decodes in real time, same as presentation.
  - New anonymous zero-registration e2e acceptance: a moving
    test-pattern video uploads through the media store and exports
    through BOTH engines; extracted frames at t=0.6 vs t=1.8 must
    differ substantially (moving content) — while the same design
    with autoplay OFF must stay static (the poster gate). Plus the
    pure mapping/filter contracts in the unit suite.

## [0.15.1] — 2026-11-05

### Added

- **Rich content & export, part 2 — WebCodecs export pipeline (R2).**
  Silent designs export through `VideoEncoder` (VP9 with a VP8
  fallback, `latencyMode: 'quality'`, explicit bitrate) into a
  hand-rolled WebM muxer — zero new dependencies.
  - **`src/lib/webm-muxer.ts`** — an EBML writer with the ordering
    trap handled explicitly (small trees composed bottom-up;
    streamed Segment/Cluster elements get 8-byte placeholders that
    `finalize()` patches), 1 ms timecode scale, a cluster split
    policy (≤ 5 s age, keyframe splits at ≥ 1 s, int16 relative
    timecode ceiling, out-of-order re-base guard) and one CuePoint
    per cluster. 21 unit tests verify it through an INDEPENDENT
    mini EBML parser, plus an ffprobe cross-check that muxes real
    ffmpeg-encoded VP9 frames and reads the file back as
    matroska,webm.
  - **Deterministic frame pacing** — every frame carries its exact
    `frame / fps` microsecond stamp; there is no wall clock in the
    loop, so slow rendering can only make the export take longer,
    never drop or duplicate a frame. Backpressure rides
    `encodeQueueSize`.
  - **One render session, two engines** — the MediaRecorder loop
    and the WebCodecs loop share the same canvas, Konva stages and
    frame compositor (extracted in this release), so they draw
    identical pixels.
  - **Engine matrix** (`chooseVideoExportEngine`, pure and
    unit-tested): page-audio designs keep MediaRecorder when it can
    mux audio (WebCodecs is video-only for now — Opus-in-WebM via
    `AudioEncoder` is a documented post-R3 evaluation); silent
    designs get WebCodecs; WebCodecs-less browsers keep
    MediaRecorder; a browser with audio but no audio-muxing
    recorder now exports silent WebM instead of hard-failing.
  - The export dialog shows which engine will run before you click.
- **MP4 decision point, on the record**: MP4-everywhere needs a
  hand-rolled moov/mdat muxer (multi-week) or a ~30 KB muxing
  dependency — both rejected for R2; MP4 stays on the MediaRecorder
  path where the browser can encode H.264.

### Fixed

- A float-precision trap in the muxer's vint bounds check: at
  doubles ≥ 2^53 the guard `> 2**56 - 2` silently never fired
  because `2**56 - 2` rounds back to `2**56` (16-wide spacing); the
  guard is now `>= 2**56`. Found by the unit suite before any real
  file was written.

## [0.15.0] — 2026-11-05

### Added

- **Rich content & export, part 1 — rich text (R1).** Per-range
  styling inside a single text box: bold, italic, underline,
  strikethrough, colour and links as `spans` — style runs laid over
  `TextElement.text`, with the existing flat fields kept as the
  inherit-base.
  - **One geometry module for all three renderers** —
    `src/lib/rich-text.ts` normalizes, sanitizes, edits and LAYS OUT
    the runs (`layoutRichLines`: greedy word-wrap across span
    boundaries, hard breaks for over-wide words, textarea `\n` as a
    hard line break, trailing whitespace dropped at wraps, per-run
    coalescing, align-resolved line x). The editor's Konva nodes, the
    SVG serializer and the video-export frame builder all consume the
    same `PositionedRun[]` — the D7 charts pattern, so no renderer
    re-derives positions.
  - **The editing UX** — the existing textarea overlay gains a
    floating selection toolbar (B / I / U / S, a colour input, a link
    popover with Apply/Remove, and clear-styling) that applies to the
    current selection, plus a styled mirror layer behind a transparent
    textarea so the formatting is visible while editing. Every
    keystroke reconciles the runs (`reconcileSpans`: common
    prefix/suffix diff — insert, delete, cut, paste and replace all
    ride one path; typing at a style boundary extends the run you are
    inside).
  - **Migration is lossless by construction** — legacy elements have
    no `spans` and render through the untouched flat path; styling a
    range CREATES the array; clearing it returns to flat with the base
    fields never modified. A malformed array (text-length mismatch,
    over the 128-run cap) normalizes to `null` — styling data can
    never corrupt the text. 38 new unit tests cover the module
    (sanitization, normalization, range ops, keystroke reconcile,
    layout math with a deterministic fake measure).
  - **Security** — links are http(s)-only, control-char-stripped and
    length-capped (`sanitizeLink`, fail-closed) on every write path:
    the editor toolbar, the MCP `update_element` patch whitelist, and
    the normalize pass. The MCP patch validates runs against the
    (possibly simultaneously patched) text and drops malformed arrays
    instead of storing them.
  - **Two bugs found by the new e2e while wiring the renderers,
    both fixed**: the rich `Group`'s tight glyph `clientRect` put the
    Transformer's anchors on the text itself (a click at the element
    centre hit a bottom anchor and fired a phantom `transformstart`,
    eating an undo step — now a transparent hit rect keeps the
    declared box exactly like the flat `Konva.Text`), and a blur from
    the textarea into the link popover committed the editing session
    early (blur now ignores focus moves inside the toolbar).
  - **Honest limits, on the record** — collab merge stays whole-box
    LWW: two offline editors of one text box still last-writer-win
    the ENTIRE element (text + spans ride together; per-span stamps
    are a post-1.0 evaluation on real usage). Curved text
    (`curve ≠ 0`) ignores spans in all three renderers. The splice
    ghost-copies effect falls back to the flat path. SVG exports
    render links styled (blue + underline) but not as clickable
    `<a>` anchors. Gradient fills map across the whole element box
    via per-run point offsets.
  - **e2e acceptance** (anonymous, zero registrations): a legacy flat
    element opens losslessly; bolding a range saves exactly
    `[{Hello, bold}, { rich world}]` with the text untouched; the
    mirror carries `<strong>` while editing; ONE undo reverts the
    spans to null; the exported SVG contains both `font-weight="700"`
    and `font-weight="400"` tspans; a `javascript:` URL applied
    through the UI is stripped (never stored) while an `https://` URL
    survives; the properties-bar "Rich text · Clear" chip flattens
    the element.

## [0.14.5] — 2026-11-05

### Added

- **Daily-driver depth, part 6 — even distribution (D3).** Select
  three or more elements and space them evenly, the Canva/Figma
  "spacing" behaviour: equal gaps between element edges, the outermost
  elements stay exactly where they were.
  - **One pure geometry module** — `src/lib/distribute.ts` holds the
    distribution math (edge-gap semantics, floats walked with integer
    output so rounding never drifts); the store action, the AI
    assistant path and the unit tests all share it. Geometry uses the
    element's local box, the same documented simplification the
    page-align modes use.
  - **A real store action** — `distributeElements` follows the
    `alignElements` house pattern: ONE history entry (one undo step —
    the old assistant path did one `updateElements` per element),
    fresh HLC stamps on touched elements only, one collab
    `page:replace` broadcast.
  - **Position popover tiles** — a "Distribute" section with
    Spacing H / Spacing V appears when three or more elements are
    selected (hidden below the threshold where there is nothing to
    space evenly).
  - **Assistant + plugin parity** — the `distributeElements` agent
    action (already in the Assistant vocabulary and the plugin
    allowlist) now rides the same store action and geometry. Two
    honest fixes came with it: the old inline math measured the span
    to the last box's *leading* edge (off by its size — gaps were
    uneven for unequal elements), and it refused overlapping
    selections outright; Canva and Figma distribute those (the
    overlap is evened out), and now Canvix does too.
  - **Fixed** while auditing the README roadmap: the v0.14 checklist
    was missing its image-filters entry (shipped as 0.14.3) — added.

### Changed

- The `distributeElements` AI/plugin action no longer refuses
  overlapping selections with "Elements overlap — no distribution
  applied"; it distributes them evenly (Canva/Figma behaviour) and
  reports success.

## [0.14.4] — 2026-11-05

### Added

- **Daily-driver depth, part 5 — data-bound charts (D7).** Charts
  were one-shot decorations (the Apps panel exploded them into loose
  rects and lines — edit one bar and the "chart" was gone). They are
  now a native `chart` element whose data stays editable.
  - **Four kinds, one element** — bar (grouped or stacked), line
    (optional Catmull-Rom smoothing), donut (first series, centre
    total, adjustable hole) and scatter (flat x,y pairs on numeric
    axes). The toolbar converts between kinds in place; converting
    out of scatter reuses the y values so nothing is lost.
  - **One geometry module, three renderers** —
    `src/lib/chart-geometry.ts` turns the element into pure vector
    primitives; the editor (react-konva), the video exporter (Konva)
    and the SVG exporter (strings) are thin adapters over the same
    list, so all three render identical geometry by construction.
    Smooth lines are sampled in the geometry itself; anchored text
    uses the same wide-box trick in both Konva and SVG.
  - **Editable after creation** — the toolbar's "Edit data" popover
    is a spreadsheet: category labels, per-series values, series
    names and colours, add/remove labels and series (typing updates
    live; structural edits are one undo step each — the house
    pattern). Plus grid / values / legend toggles, text size and
    panel colours.
  - **Everywhere a chart should be** — Elements panel "Charts" tab,
    the Apps rail (now adding the native element), the layers panel,
    SVG exports (annular-sector arc paths for donuts), video exports
    — and while wiring the video exporter, tables, frames and embed
    cards stopped vanishing from video exports entirely (they
    previously fell through to an empty group; a pre-existing parity
    gap closed while here).
  - **Safe + agent-ready** — pasted charts run the hostile-input
    gauntlet (kind whitelist with bar fallback, ≤ 6 series / 24
    labels / finite clamped values, hole clamped); MCP gains
    `add_chart` and `update_element` understands `series`,
    `labels`, `kind`, `barMode`, `hole` and the display toggles.

## [0.14.3] — 2026-11-05

### Added

- **Daily-driver depth, part 4 — the image filter gallery (D4).**
  The context toolbar's "Filter tint (soon)" stub is gone: image
  elements now carry a filter preset + intensity, rendered live in
  the editor, in video exports, and approximated in SVG exports.
  - **Eight presets** — Original, Mono (grayscale), Warm, Cool,
    Vintage (sepia-lerp + black-lift), Blur (3-pass box ≈ gaussian),
    Sharpen (3×3 unsharp) and Vignette (radial falloff) — as a chip
    grid in the new **Filters** popover, each chip a live preview
    canvas of the element's own image, plus an intensity slider.
  - **One pixel pipeline, every renderer** (`src/lib/image-filters.ts`):
    the editor rides the existing Konva cache pipeline; the video
    exporter pre-bakes pixels through a Konva-exact twin (and now
    exports flips/rotation for image elements too — a parity gap
    closed while here); SVG exports emit real filter primitives
    (`feColorMatrix`/`feComponentTransfer`/`feConvolveMatrix`/
    `feGaussianBlur`, vignette as a clipped radial-gradient overlay)
    with each approximation documented in the module header. Adjust
    (brightness/contrast/saturation) now renders in exports as well
    — previously editor-only.
  - **Persistent + safe**: `filter`/`filterIntensity` live on the
    element (undo/redo, collab, autosave all just work); pasted
    elements whitelist the preset id and clamp intensity (junk
    resets to none, never throws); `update_element` (MCP) patches
    images' adjustments and filter fields too.

## [0.14.2] — 2026-11-04

### Added

- **Daily-driver depth, part 3 — dashboard folders (D6).** "Recent
  designs" was one flat grid; every project jostled every other. Now
  the caller organizes designs into folders — private, attribution-
  scoped, and account-following like everything else.
  - **`Folder` model + `Design.folderId`** (migration 0008, additive
    and nullable — zero folders = "All designs", byte-for-byte the
    pre-v0.14 view). Deleting a folder UNFILES its designs (FK `ON
    DELETE SET NULL`): a folder delete can never destroy work, live
    or trashed. Trashed designs keep their folder and return to it on
    restore.
  - **API**: `GET/POST /api/folders` (list with live design counts;
    create with name sanitize + 50-folder ceiling) and
    `PATCH/DELETE /api/folders/[id]` — all attribution-scoped
    (ownerId or the canvix_anon hash), foreign ids are a flat 404
    (no cross-account existence oracle), CSRF-guarded, rate-limited
    (`folders:create`/`folders:update` buckets). `GET /api/designs`
    gains `?folder=<id>` (caller-owned or 404) and returns
    `folderId`; `POST /api/designs` accepts `folderId` so designs can
    be born filed; `POST /api/designs/[id]/move` files/unfiles (edit
    access on the design + ownership of the target folder — never
    someone else's tree).
  - **Login/register claims this browser's anonymous folders**
    (`claim-folders.ts`, the D1 media pattern) — organization follows
    the account across devices.
  - **Dashboard UI**: folder chips between the section header and
    the grid ("All designs" + per-folder chips with counts + "New
    folder"), one dialog for create/rename, chip ⋯ menu (rename /
    delete with an honest confirm: "designs inside are NOT deleted"),
    design-card ⋯ menu gains a "Move to folder" submenu (with a check
    on the current folder + "Remove from folder"), the section title
    shows the open folder, and anything created while a folder is
    open is born inside it. Duplicates stay in their folder when it
    is one of the caller's own.
  - **Verification**: vitest 676/676 (32 new: folder list/create
    scoping + sanitize + ceiling, rename/delete flat-404 matrices,
    move-route authz incl. foreign-folder 404 + read-only 403,
    designs `?folder=` + create-folderId paths); e2e +2 specs
    (anonymous full lifecycle: create → file → filter → rename →
    delete → designs survive at the root, API-truth asserts; and
    cross-attribution isolation: a second browser cannot list,
    mutate, filter by, or create into the first one's folders);
    default suite 49 specs green locally (fresh-server batches —
    see worklog for the fuse-watcher caveat), flag-on plugins 5/5;
    tsc/eslint/build clean. Zero new registrations in the new specs
    (the PR #26 register budget).

## [0.14.1] — 2026-11-04

### Added

- **Daily-driver depth, part 2 — the system clipboard & cross-tab
  copy (D2).** Copy used to be tab-local (a module-level array): the
  moment you switched tabs it was gone, and pasting anything from the
  OS — a screenshot, an image copied from another site — did nothing.
  Now the OS clipboard carries a Canvix envelope, and OS images paste
  straight onto the canvas.
  - **Copy/cut mirror to the system clipboard**: a JSON envelope
    (`application/x-canvix` custom MIME where supported, plus the same
    JSON as `text/plain` so Firefox's writeText-only clipboard still
    round-trips). The internal clipboard stays the same-tab fast
    path — zero latency, no permissions.
  - **One native paste pipeline** (the old mod+V keydown branch is
    gone — keydown can't read clipboard contents): OS image file →
    image element through the uploads-library rail (D1) with document
    embed as fallback; Canvix envelope → sanitized elements; anything
    else → the internal clipboard. Read-only designs never paste;
    typing surfaces keep their default paste.
  - **Clipboard files are captured synchronously** — the DataTransfer
    (and its files) is neutered the moment the handler returns, so the
    byte read starts inside the event and the File is rebuilt after.
    The envelope text is likewise read synchronously.
  - **Pasting is an untrusted-input surface**: `sanitizePastedElements`
    keeps only known element types, caps every string (20 KB) / array
    (600) / depth (8) / element count (50), forces finite clamped
    geometry, strips `__proto__`/`constructor`/underscore keys, and
    recurses the same gauntlet through group children — the document
    pipeline only ever sees shapes it could have produced itself.
  - **Ids are always remapped** on paste (`pasteElements`, the single
    insertion path) — a paste can never collide with an existing
    element id, locally or through collab.
  - **Verification**: 12 new unit tests (the sanitizer gauntlet:
    hostile types, prototype pollution, oversized payloads, depth
    bombs, geometry clamps, group recursion; envelope round-trip;
    DataTransfer stubs) + a 3-spec e2e: copy in tab A pastes in tab B
    with a fresh id and the paste offset; an OS image lands as an
    image element with a media-store src; a read-only viewer pressing
    paste adds nothing (API truth).

## [0.14.0] — 2026-11-04

### Added

- **Daily-driver depth, part 1 of the v0.14 menu — the persistent
  uploads library (D1).** Uploads used to live two half-lives: images
  embedded as data URLs inside the document (bloated designs, no
  reuse, no account), audio/video in the media store but invisible
  after reload. Both now share one DB-backed library that survives
  reload and follows the account — upload on device A, log in on
  device B, insert from the Uploads panel.
  - **Images join the media store**: the upload rail accepts
    `image/*` alongside audio/video (same chunked protocol, same
    32 MB cap), with the original bytes kept server-side — no more
    silent downscaling into the document.
  - **sha256 dedupe at finalize**: identical bytes within the SAME
    attribution (account or anon cookie — never across accounts, so
    uploads can't be probed through someone else's library) collapse
    to the existing row; the finalize response carries
    `deduplicated: true` and the old id.
  - **Quota, surfaced**: `CANVIX_UPLOAD_QUOTA_MB` (default 256 MB)
    per attribution, enforced at upload-init (in-flight rows count
    too, so parallel uploads can't sail past the cap together) and
    shown in the panel footer ("42.3 MB of 256.0 MB").
  - **Library API**: `GET /api/media/library` (projection-only —
    never the bytes; attribution-scoped), `PATCH`/`DELETE
    /api/media/library/[id]` (rename / remove). A foreign id is a
    flat 404 — no cross-account existence oracle. Removing an item
    clears `keepInLibrary` only: designs already referencing it keep
    working; the orphan GC owns reaping unreferenced rows.
  - **Anonymous uploads follow the account**: login/register claims
    this browser's anon-attributed media rows (scoped by the
    canvix_anon hash — the design-adopt lesson, with none of the
    eligibility subtlety).
  - **UploadsPanel reads the DB**: grid of your files (image
    thumbnails from the serve route, audio/video rows with icons),
    click-to-insert (images keep replace-mode, audio/video re-probe
    their blobs for duration/peaks), inline rename, hover delete,
    set-as-background, upload progress, and the quota line.
  - **Portable SVG exports**: media-store images inline to data URLs
    at export time (`inlineMediaImages`, deep-copy — the live
    document is never mutated); `safeHref` accepts the first-party
    `/api/media/` srcs. A fetch that fails degrades honestly: the
    relative URL stays (a visibly broken image beats silently
    losing content).
  - **GC discipline**: the media orphan GC skips `keepInLibrary`
    rows (a library item is kept on purpose, not orphaned);
    `--prune-library` opts back in.
  - **Verification**: 23 new unit tests (library scoping/authz/CSRF,
    dedupe + attribution-scoping, claim-on-login, safeHref +
    inlining + no-mutation) and a 3-spec e2e acceptance
    (`tests/e2e/uploads-library.spec.ts`): upload → reload →
    second-design insert → inlined SVG export; remove-never-breaks-
    designs; anonymous upload claimed on register (checked from a
    second browser context).

## [0.13.4] — 2026-11-03

### Added

- **Plugin system, part 5 of 5 — the first-party validation plugin
  (P5): `com.canvix.wordcloud`.** The plugin whose end-to-end use *is*
  the v0.13 MVP acceptance test (research §5): install → consent →
  generate → render → export → restyle → disable → uninstall, all on
  the public API, zero per-plugin host code. **This closes the v0.13
  plugin-system MVP.**
  - **The bundle** (`public/plugins/wordcloud/`): manifest v1.1 with
    one `cloud` element kind (seed/density/mask/palette schema for the
    host-rendered properties card), panel + service entries, and
    exactly four permissions — `design:read`, `design:write`,
    `element:plugin`, `storage`. **No network**, proving the
    default-deny path. `wordcloud.js` is one shared zero-dependency
    UMD script for both frames: the plugin half of the v1 RPC envelope
    (handshake echo, call/result correlation, host→plugin call
    answering) plus a mulberry32-seeded spiral layout whose SVG passes
    the P1 sanitizer by construction (asserted in the unit suite on
    hostile inputs). Widths are estimated from character classes, so
    output is machine-independent and determinism — the render-cache
    contract — holds exactly. The panel pulls page text via
    `design.getSnapshot`, previews with the same code the service
    renders with, remembers settings via namespaced storage, and
    generates through `addPluginElement` / `updatePluginElementData`.
  - **First-party distribution** (`firstparty.ts` +
    `firstparty-fetch.ts`): bundled plugins ship in
    `public/plugins/<slug>/` and install through the SAME rail
    (validate → sha256-pin → consent → per-user rows) from the strict
    relative form `/plugins/<slug>/manifest.json`. The server reads
    the files from disk behind a synthetic origin — no network hop,
    so the SSRF guard's correct loopback denial never applies, and
    `allowFirstParty` is true on that branch ONLY: `com.canvix.*`
    remains reserved to what the instance itself serves. The Apps
    grid gains a one-click "+ Word Cloud (bundled)" chip. On
    runtimes without a filesystem (Cloudflare Workers) a bundled
    install answers an honest error; every other plugin route is
    unaffected (lazy import).
  - **The acceptance e2e** (`tests/e2e-plugins/wordcloud.spec.ts`,
    5 specs, run flag-on via the new `playwright.plugins.config.ts`,
    port 3100): UI install with all four consent lines asserted
    verbatim; mid-session install → panel handshake → page-text
    collection → generate → the service frame's render observed →
    element persisted (API truth); exported SVG embeds the real
    cloud; restyle through the host schema card; disable → the
    export degrades to the honest placeholder; signed-out viewer
    inert; uninstall leaves design data byte-identical. CI's e2e job
    runs the flag-on suite after the default one.
  - **Plugin author docs** (`docs/PLUGINS.md`, ~350 lines): the trust
    model, a hello-world quickstart, the manifest spec, the
    permissions table with consent lines, the full RPC reference
    (both directions, error codes, caps), the element/renderer
    contract, packaging rules, hosting guide (incl. the bundled-plugin
    path for forks), the Word Cloud walkthrough, and the FAQ
    ("no marketplace, ever").

### Fixed

- **Four integration gaps the validation plugin exposed** — all
  shipped silently in P3/P4 because every earlier e2e ran flag-off,
  so no service frame or panel-driven element had ever really
  mounted:
  1. `manifest.ts` spoke a stale plugin API version — its private
     `PLUGIN_API_MINOR = 0` copy was never bumped with the P4
     renderer minor, so the install rail rejected every real
     `"canvixPluginApi": "1.1"` manifest. The constants now alias
     the RPC envelope's single source of truth.
  2. Service frames pointed at `/api/plugins/undefined/serve/…` —
     the install route's projection names the key `id`, the service
     layer read `installId`; every service iframe 404'd and every
     plugin element rendered as a "not responding" placeholder. The
     projection now carries both names.
  3. Panels could not generate elements — the panel host dropped the
     broker's `caller` identity (`addPluginElement` always refused)
     and its record carried no `elementKinds` (the declared kind was
     refused too). Both now ride the panel record, mirroring the
     service frame.
  4. Mid-session installs never mounted a service frame — the
     service layer fetched the install list once on editor mount.
     InstalledApps now dispatches `canvix:plugins-changed` after
     install/uninstall/enable/disable and the layer re-fetches.

### Changed

- Version 0.13.4; README plugin-system roadmap item updated with the
  P5 paragraph; zero new npm dependencies.

## [0.13.3] — 2026-11-03

### Added

- **Plugin system, part 4 of 5 — plugin elements & the renderer
  contract (P4).** The research §4.5 milestone: an installed plugin
  can now put its OWN element types on the canvas, draw them from
  inside its sandbox, and have them ride every pipeline a native
  element rides — save, versions, collab, offline merge, SVG/PNG/
  JPG/PDF/video export — with zero per-plugin host code. 56 new
  unit tests + a durability e2e; zero new npm dependencies.
  - **The `plugin` element** (`src/lib/types.ts`): ONE new union
    member — `type: 'plugin'` with `pluginId`, `kind`,
    `pluginVersion` and a capped `data` record. All per-plugin
    variety lives in `data`; the structural move that dodges the
    "three independent switches" problem (§4.4). Factory +
    `addPluginElement` / `updatePluginElementData` design actions:
    caller identity is stamped from the INSTALL row (a plugin can
    never forge another plugin's namespace or edit its elements),
    kinds checked against the manifest, data against the collab
    caps (64 KB/element). Undoable, HLC-stamped, collab-broadcast —
    ordinary elements, only their pixels are delegated.
  - **Renderer contract** (`broker.ts` + `renderer-cache.ts`):
    service iframes answer host→plugin `elements.render` calls
    (`{ kind, data, width, height, mode }`, 10 s deadline →
    E_TIMEOUT → placeholder). Output is `{ svg }` (≤ 2 MB, through
    the P1 accept-or-reject sanitizer — the one place untrusted
    SVG enters the host) or `{ raster }` (base64 png/jpeg/gif/webp
    data URL). `elements.registerRenderer` is service-context only
    and manifest-scoped. Render results ride a widened result
    envelope (2 MB + slack); every other result keeps the 256 KB
    RPC cap (enforced after correlation).
  - **The render cache** (`renderer-cache.ts`): module-level store
    keyed by `(pluginId, elementId, hash(data), size, mode)` —
    restyles and resizes re-render, everything else is a hit;
    in-flight dedupe; LRU 120; transport unmount drops settled
    renders. Failure philosophy (§4.5/§4.9): error/timeout/missing
    plugin → a neutral placeholder card, never a thrown exception,
    never a blocked editor.
  - **Service iframe host** (`PluginServiceLayer` +
    `PluginServiceFrame`): one hidden
    `<iframe sandbox="allow-scripts">` per installed plugin with
    elements in the open design, loading the manifest's
    `entry.service` through the DB-served CSP-pinned route; the
    frame's broker registers with the cache as the plugin's render
    transport. Frames derive purely from present elements (a
    plugin with no elements mounts no iframe); flag off / signed
    out / offline → zero iframes and placeholders.
  - **Canvas + exports**: `PluginNode` (element-node) draws the
    sanitized data URL as a Konva Image or the placeholder card
    with the honest §4.9 reason (checking / disabled on this
    instance / install hint / disabled app / not responding).
    svg-export embeds sanitized svg as a nested `<svg>` pinned to
    the element box (raster output embeds as `<image>`); video
    export awaits renders into its image map; PNG/JPG/PDF ride the
    live stage. The ExportDialog primes renders before SVG export.
    Missing renderers still export a visible placeholder card —
    the element is never silently dropped from a file.
  - **Properties slot** (`PropertiesBar`): selecting a plugin
    element shows a host-rendered schema card (text/number/color/
    select inputs from the manifest `schema` — no plugin code in
    the toolbar) + an "Open in app" button; edits go through the
    same scoped `updatePluginElementData` action.
  - **Snapshot projection**: `design.getSnapshot` returns plugin
    elements with their `data` verbatim (arrays and nesting
    included — it is the plugin's own capped output) so panels can
    restyle their elements; `_m`/bookkeeping still never crosses.
  - **Manifest v1.1** (`canvixPluginApi` minor bump): optional
    `entry.service` (same path rules as the panel, must be in
    `files`); declaring `elements[]` without `entry.service` is
    rejected at install — elements that could only ever render
    placeholders fail honestly, upfront.
  - **Durability, verified end-to-end** (`plugin-elements.spec.ts`):
    a design containing plugin elements from a plugin that is not
    available opens without a crash on a flag-off instance, stays
    editable, and round-trips load → placeholder → edit → autosave
    with the element byte-identical at the API layer. Unit suite
    pins the same for offline merge (LWW by id, type-agnostic) and
    `validateOpPayload`. Uninstall/disable/flag-off never touch
    document data — the §4.9 promise, now executable.

## [0.13.2] — 2026-11-02

### Added

- **Plugin system, part 3 of 5 — the panel runtime (P3).**
  The host half of research §4.3/§4.8: an installed row can now
  become running code — inside the boundary P1/P2 pinned. 57 new
  unit tests, zero new npm dependencies.
  - **RPC broker** (`src/lib/plugins/broker.ts`): one instance per
    mounted iframe, and the ONLY path between plugin and host.
    Origin discipline by window identity (`ev.source === the frame
    we mounted` — an opaque-origin iframe cannot be named, so the
    object IS the origin check), one-time handshake token echoed
    on the first call (rides the iframe URL fragment, never the
    wire), 200 calls/min sliding-window budget (`E_THROTTLE`),
    default-deny dispatch against the install's consented
    permissions, typed `BrokerError`s that stay wire-legal, and
    `E_INTERNAL` + server-side-only logging for host failures.
    Full method surface: `info`/`ping` (no permission),
    `design.getSnapshot` (lossy read-only projection, RPC-capped),
    `subscribe('selection'|'document')` with ack-bounded pushes,
    `actions.apply` (the §4.3 whitelist — AI actions excluded,
    `addPluginElement` reserved for P4), `storage.*`, `ui.notify`
    (sanitized, 200-char cap), `ui.closePanel`. Read-only designs
    suspend `design:write` at the broker (E_PERMISSION).
  - **Design snapshot projection** (`src/lib/plugins/snapshot.ts`):
    what `design.getSnapshot` returns — geometry + small own data
    + background, groups projected recursively; heavy fields
    (image dataURLs) omitted-and-listed, internal bookkeeping
    (`_m` HLC stamps, `magicLayer`, `shadow`) never crossing the
    boundary.
  - **Namespaced plugin storage** (`src/lib/plugins/plugin-storage.ts`):
    `canvix:plugin:<pluginId>:*`, 256 KB per plugin, 64 KB per
    value, structured-clone-checked — the prefix is the isolation
    (one plugin can never see another's keys or the host's).
  - **Panel iframe host** (`PluginRuntime.tsx`):
    `<iframe sandbox="allow-scripts">` — nothing else in the
    attribute — loading the DB-served entry panel with the
    handshake token in the fragment; mounts the broker, wires
    store subscriptions to `pushEvent`, and unmount = deactivate
    (broker disposed, listeners removed, zero residue).
  - **"Installed" section in Apps** (`InstalledApps.tsx`, lazy
    dynamic import — flag-off instances never download a byte):
    install by manifest URL, **consent modal listing every
    requested permission verbatim** (grant keeps it / remove
    deletes the row), per-plugin enable/disable, uninstall that
    never touches the design. Silent degradation: flag off (503),
    signed out (401) or offline → the section never renders.
  - **`addImage` design action** (`design-actions.ts`): the §4.3
    whitelist's image entry — `/api/media` id or dataURL ≤ 4 MB
    (png/jpeg/gif/webp), natural-size clamped, same clamps the AI
    path applies.
  - **E2E regression spec** (`tests/e2e/plugins-panel.spec.ts`):
    with the flag off the built-in app grid is untouched, no
    plugin UI leaks, and `/api/plugins` answers 503
    `PLUGINS_DISABLED`.

## [0.13.0] — 2026-11-02

### Added

- **Plugin system, part 1 of 5 — the security-boundary core (P1).**
  First milestone of the v0.13 plugin MVP, ordered exactly as the
  research doc prescribes: boundary first, runtime second, DX last.
  Pure library code — no routes, no UI, no DB, **zero new npm
  dependencies** — that every later milestone composes:
  - **Manifest validator** (`src/lib/plugins/manifest.ts`):
    enforces every §4.1 rule with plain-language errors collected
    in one pass — `canvixPluginApi` major/minor gates (mismatch
    blocks install, never a silent no-op), the id grammar with
    `com.canvix.*` reserved for first-party, semver `engines.canvix`
    checked against the running app, safe relative `.html` entry
    paths (no traversal, no schemes), element-kind/field-schema
    grammar with `initialData` coherence, and an install-time HTML
    packaging check (no inline `<script>`, no `javascript:` URIs,
    no `on*=` handlers — so the serve route's strict CSP stays
    defensible). Reserved key names (`__proto__`, `constructor`,
    `prototype`) are rejected outright.
  - **Versioned RPC envelope** (`src/lib/plugins/rpc.ts`): the
    one bidirectional postMessage wire format (`v`/`id`/`dir`/
    `method`/`params` ↔ `ok`/`result`|`error`) with typed error
    codes (`E_VERSION`, `E_MALFORMED`, `E_PAYLOAD`, `E_PERMISSION`,
    `E_METHOD`, `E_THROTTLE`, `E_NOT_FOUND`, `E_TIMEOUT`,
    `E_INTERNAL`), strict id/method/handshake charsets, and
    256 KB payload caps — unknown methods are `E_METHOD`, not
    `E_PERMISSION`, so misconfiguration is diagnosable.
  - **Permission model** (`src/lib/plugins/permissions.ts`):
    the manifest-declared → consent-granted → broker-enforced
    catalog (`design:read`, `design:write`, `element:plugin`,
    `storage`, `ui:notify`, repeatable `network:<origin>`), each
    with the verbatim plain-language line the consent screen will
    show, plus the §4.3 method→permission table that makes the
    broker default-deny by construction.
  - **Plugin data caps** (`src/lib/plugins/data-caps.ts`): one
    clone-safety checker (JSON-typed values only, depth ≤ 12,
    arrays ≤ 500, strings ≤ 100 k, ≤ 60 keys, no prototype-
    pollution key names) at numerical parity with the collab op
    validator, so plugin data rides autosave/collab/jsonb
    unchanged.
  - **Renderer SVG sanitizer**
    (`src/lib/plugins/sanitize-svg.ts`): accept-or-reject — never
    rewrite — validation of plugin renderer output before it is
    rasterized on canvas or embedded in exports: 2 MB / 20 k
    element / depth-64 caps, an SVG tag allowlist (no `script`,
    `foreignObject`, `animate`/`set`, `iframe`…), no event
    handlers or `javascript:` URIs, `data:`-only hrefs, `url()`
    and `@import` policing in `<style>` and `style=` CSS, and
    XXE/DOCTYPE/CDATA rejections. Hardened against comment-split
    payloads and quadratic-backtracking inputs.
  - **Security regression suite**
    (`src/lib/plugins/security-regression.test.ts`): the protocol-
    level seed of the §6 corpus — 20 hostile manifests, 16 hostile
    SVG documents, RPC replay/spoof/smuggle attempts, and four
    cross-module attack chains (default-deny, permission→CSP
    flow, data→export flow, entry-HTML smuggling). Runs on every
    PR via the existing `lint-unit` gate.
  - Semver engine matching is a hand-rolled comparator/x-range/
    hyphen/OR/caret/tilde range matcher (`semver.ts`, ~200 lines)
    with spec-correct prerelease ordering — no `semver` dependency,
    per the zero-dependency rule.

## [0.13.1] — 2026-11-02

### Added

- **Plugin system, part 2 of 5 — the install rail (P2).**
  The store half of research §4.2: submit → fetch → validate →
  consent → store. Everything ships behind `CANVIX_PLUGINS`
  (default **off** — the same opt-in pattern as the MCP token;
  with the flag off every plugin route answers 503
  `PLUGINS_DISABLED` and behavior is byte-identical to v0.12.5):
  - **`POST /api/plugins`** — install from a manifest URL. The
    server fetches the manifest + every declared file through
    the existing `safeFetch` SSRF guard (DNS pinning, private-
    range denial, per-hop redirect revalidation), enforcing the
    §4.7 caps: 2 MB total bundle, ≤ 50 files, 10 s per file.
    Each file is sha256-pinned; `.html` files re-pass the P1
    packaging check at install; the whole snapshot lands in one
    transaction (a reinstall atomically replaces the previous
    row — no version mixing, no orphan assets). CSRF + per-IP
    rate limit (`plugins:install`, 10/min) + session required.
  - **`GET /api/plugins`** — the user's installs as a consent
    payload: name/version/author, the file list with integrity
    hashes, and **every permission in plain language** — the
    exact lines the consent screen will show. Never bytes.
  - **`PATCH/DELETE /api/plugins/<installId>`** — the per-plugin
    enable/disable kill switch and uninstall. Uninstall deletes
    the row + assets (FK cascade) and **never touches elements**:
    plugin elements are plain jsonb data and degrade to
    placeholders, not data loss.
  - **`GET /api/plugins/<installId>/serve/<path>`** — the asset
    route: DB-served, extension-allowlisted mime types, sha256
    ETag with 304 revalidation, `nosniff`, and the **per-manifest
    CSP** from the v0.12.1 pre-staged `plugin-csp.ts` — consented
    `network:` origins become `connect-src`, zero grants collapse
    to `'none'`. Documented auth decision: the route is not
    session-gated (sandboxed iframes cannot carry SameSite=Lax
    cookies); the boundary is unguessable cuids +
    `frame-ancestors 'self'` + per-IP rate limiting + the flag,
    and design data never flows through it.
  - **Migration 0006** — `PluginInstall` + `PluginAsset`
    (additive only; rollback = flag off, no data removed).
  - Manifest validator extended with the **`files` list** (the
    install fetch list): safe paths only, entry panel must be
    declared, ≤ 50 files, deduped.
  - New rate-limit buckets `plugins:install` (10/min) and
    `plugins:serve` (600/min); `.env.example` documents
    `CANVIX_PLUGINS`.

## [0.12.5] — 2026-11-02

### Added

- **Observability floor (H7) — all opt-in, off by default.** The
  last v0.12 epic gives self-hosters the three primitives the
  roadmap research named, with privacy as the design constraint:
  - **Structured request logging** (`CANVIX_LOG=requests`): every
    API request emits one JSON line on stdout — method, path,
    status, duration (`event: http_request`). Query strings are
    deliberately never logged (they carry design ids and cursor
    data) and neither are IPs. Implemented as a `withLogging()`
    wrapper applied to **every API route handler** (29 files, ~60
    handlers — designs, collab, media, auth, comments, versions,
    templates, health, MCP, photos and all eight AI routes); with
    the env unset it is a zero-behavior-change passthrough, and
    the SSE stream's response passes through untouched.
  - **`/api/health?v=2`** — the observability payload: aggregate
    counts (live designs, users, finalized media count **and
    bytes**, version snapshots, comments), a DB latency probe
    (measured on the existing `SELECT 1`), and app version +
    uptime. Counts only, **never ids** — asserted by an e2e test
    that scans the payload for cuid/uuid shapes. Plain
    `/api/health` keeps its v1 shape (plus an explicit `v: 1`) so
    liveness probes stay as cheap as before.
  - **Optional error webhook** (`CANVIX_ERROR_WEBHOOK_URL`):
    every *unhandled* request error — any route, page or server
    action — POSTs a JSON report (message, stack head, path,
    method, route type, app version, timestamp) via Next's
    `onRequestError` hook in the new `src/instrumentation.ts`.
    One file instruments the whole app; 5-second timeout,
    fire-and-forget, and a failing webhook logs locally instead
    of taking the error path down.
- **8 unit tests** (`src/lib/observability.test.ts`): the opt-in
  gate, passthrough-vs-logging behavior, JSON line shape, query-
  string redaction, error-path 500 logging + rethrow, params
  passthrough, and the webhook payload contract (bounded,
  id-free). Plus a Playwright spec for health v1/v2.

## [0.12.4] — 2026-11-02

### Added

- **Docs & ops runbook (H6).** Self-hosters get the two guides the
  roadmap research called the missing floor of the operations story:
  - **`docs/BACKUP-AND-RESTORE.md`** — one-command `pg_dump` backup
    (custom format) with the notes that actually matter in practice:
    the **bytea media travels inside the dump** (size implications,
    32 MB/file cap), the Supabase session-vs-transaction-pooler
    pitfall for pg_dump, and cross-owner restore flags. The core is a
    **restore drill executed and verified end-to-end**, documented
    step-by-step with its real output: dump (753 KB, 167 designs,
    110 templates, 30 media) → scratch database → `pg_restore
    --no-owner --no-privileges` → count-and-byte verification
    (identical, including `SUM(size)` on media) → **booting the app
    against the restored database** (`/api/health` green, designs
    served) → teardown. Plus real-recovery steps and a scheduled-
    backup cron example.
  - **`docs/UPGRADING.md`** — the routine upgrade path (snapshot →
    pull → `npm ci` → `db:migrate:deploy` → rebuild → health check),
    jumping minors (cumulative migrations, one command, what to read
    in the CHANGELOG), and rollback guidance with the honest caveat:
    Prisma migrations are forward-only, so the safe path is
    restore-forward from the pre-upgrade snapshot — and the note that
    0.9–0.12 migrations are additive, so code-only rollbacks can
    leave the schema migrated.
  - **`scripts/media-gc.ts`** — media orphan GC: reports (default) or
    prunes (`--prune`, `GRACE_DAYS`) never-finalized uploads older
    than 24 h and finalized uploads no live design references anymore
    (elements reference media as `/api/media/<id>`; deleting a design
    intentionally keeps its media for version snapshots). Verified by
    a drill (`scripts/media-gc-drill.ts`) that plants one orphan and
    one referenced row and asserts exactly the orphan is pruned.
- **README pointers** to both guides from the Deploy section.

## [0.12.3] — 2026-11-02

### Added

- **Rate limits & connection caps (H5).** The roadmap research
  noted every mutating surface except `/api/mcp` accepted unlimited
  traffic. Now a single limiter module (`src/lib/rate-limit.ts`)
  guards the epic's list with per-IP fixed-window budgets — designs
  create/update/delete (30/300/60 per min), collab events (600/min;
  active clients flush 150/min each), presence heartbeats (120/min),
  comment creation (60/min) and media upload init (30/min) — each
  budget ≥ 4× the heaviest legitimate client, so a working editor
  never notices. Rejected requests get `429` + `Retry-After` + a
  `RATE_LIMITED` body and never touch the database. The SSE stream
  route caps **concurrent connections per IP** (default 6, the
  per-domain browser limit), releasing slots on every exit path —
  abort, recycle, db-timeout and consumer cancel all funnel through
  one `close()`. 12 unit tests cover the window math (injected
  clock), bucket/IP isolation, the off switch and the slot
  lifecycle; a mocked-route test proves POST /api/designs actually
  429s and stops short of the DB.
- **Load probe** `scripts/rate-limit-probe.sh` — proves both caps
  against a live instance: hammers design creation until the 429
  (asserting `Retry-After`), opens the stream cap + 1 and asserts
  the refusal, then verifies a fresh stream connects once slots are
  released (no leak). Documented for scratch instances.
- **README “Rate limiting” section** — the caps table, the knobs
  (`CANVIX_RATE_LIMITS=off`, `CANVIX_SSE_MAX_PER_IP`), and the
  honest multi-instance limitation the epic demanded: counters are
  in-memory per instance, so an N-instance fleet enforces each cap
  per instance, not per deployment; the shared-store upgrade is
  deliberately deferred past 1.0 with the reasoning written down.

## [0.12.2] — 2026-11-02

### Added

- **Error boundaries — a crash is never a white screen anymore (H4).**
  The v1.0 roadmap research flagged this as tech-debt #4: any
  render-time throw in the editor tree unmounted React root-down —
  a blank page, no recovery, no diagnostics. Now three boundaries
  guard the app: a top-level one around `AppShell` on both routes
  (`/` and `/design/<id>`), plus per-surface ones around the editor
  and the dashboard. The recovery UI offers the three escapes that
  actually help — **Reload editor** (fresh mount, URL and design id
  preserved), **Back to dashboard** (switches the app-store view and
  remounts the crashed surface from scratch, no reload needed) and
  **Copy diagnostics** — and the diagnostics carry exactly what a
  bug report needs: the design id, the last saved collab seq
  (from the replay cursor), save state (savedAt/saving/dirty), page
  and element counts, the error and its stack head, URL, timestamp
  and user agent. Honest scope note: boundaries catch render/lifecycle
  errors; event-handler and async errors were already contained by the
  validated-collab and db-error paths.
- **Dev-only crash probe** (`DevCrashProbe` in
  `src/components/ErrorBoundary.tsx`) — throws during render when
  `window.__canvixRequestDevCrash()` is called, which is the only
  class of error a boundary can catch. `NODE_ENV`-gated, so the
  throw branch is dead code that production builds drop entirely.
- **Playwright spec** `tests/e2e/error-boundary.spec.ts` — forces a
  crash in a child of the editor boundary, asserts the recovery UI
  renders (never a white screen), that the clipboard diagnostics
  parse as JSON with the design id + last-saved-seq fields, that
  “Back to dashboard” recovers without a reload, and that the
  editor still opens afterwards with no collateral page errors.

### Changed

- **`reactStrictMode` re-enabled** (was `false` since the
  pre-accounts era). The H4 epic called for a re-evaluation, and the
  current codebase tolerates double-invoked effects: the full
  Playwright suite passes unchanged under strict mode (dev server,
  which is where the double-invocation happens). This surfaces
  effect-cleanup bugs at development time instead of in production
  remounts.

## [0.12.1] — 2026-11-02

### Added

- **Security headers + CSP baseline (H3).** Every response from every
  route class — landing/editor pages, read APIs, the health probe,
  even 404s and static assets — now carries the hardening baseline
  the roadmap research flagged as missing: `X-Content-Type-Options:
  nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Frame-Options: SAMEORIGIN` (with a matching `frame-ancestors
  'self'` in the CSP), `Strict-Transport-Security` (180 days —
  documented that browsers ignore HSTS over plain HTTP, so
  `http://` self-hosters are unaffected by definition) and a
  `Permissions-Policy` turning off camera/mic/geo. The CSP itself
  ships as **Report-Only**: the policy the app needs today is
  written down directive by directive (Google Fonts css + files,
  `data:`/`blob:` images, blob workers for the background remover,
  TLS-only `frame-src` for embed cards, `object-src 'none'`,
  `base-uri`/`form-action 'self'`) and nothing breaks while the
  violation reports are reviewed — the enforcement flip is a
  one-line change in `next.config.ts`, documented in the README.
  The single source of truth is `next.config.ts → headers()`, so
  Vercel, Cloudflare Workers (OpenNext), Netlify and Node
  standalone all serve byte-identical values.
- **Drafted the strict per-manifest CSP for the v0.13 plugin serve
  route** (`src/lib/security/plugin-csp.ts`): `default-src 'none'`,
  `script-src 'self'` (no inline scripts — the packaging rule),
  `connect-src` collapsing to `'none'` unless the user consented to
  specific https origins, canonicalised and deduplicated, with
  loopback http allowed for development builds only. Unit tests pin
  the header byte-for-byte so the consent screen, the serve route
  and the P4 security suite all agree on what “strict” means.
- **Playwright spec `tests/e2e/security-headers.spec.ts`** — asserts
  the whole baseline on one representative URL per route class in
  CI (landing, design deep-link, templates/designs APIs, health,
  static asset), plus the CSP allowlist contents and the fact that
  no enforcing CSP header exists yet.

## [0.12.0] — 2026-11-02

### Added

- **CI gate — tests finally gate what ships (H2).** A new **CI** workflow
  (`.github/workflows/ci.yml`) closes the gap the v1.0 roadmap research
  flagged as the highest-leverage fix: the repo had 316 unit tests and 28
  browser tests, but both GitHub workflows were manual-only and all three
  deploy pipelines (Vercel, Cloudflare Workers Builds, Netlify) publish
  `main` directly — so every test ran only on a contributor's laptop.
  Now: every **pull request** runs `npm ci` (with the npm cache) →
  `tsc --noEmit` → `eslint .` → `vitest run` — no database required, the
  check lands in minutes; every **merge to `main`** additionally runs the
  full Playwright browser suite against a real Postgres 17 service
  container (migrations + the 110-template seed + `next dev`, all inside
  the job), with traces uploaded on failure. The pipeline is also
  manually dispatchable on any branch for pre-merge e2e on risky PRs.
  Runtime targets: PR gate < 10 min, e2e job verified at ~4 min locally.
  The whole command sequence was verified end-to-end before this
  release: 316/316 unit, 28/28 Playwright against a fresh database.
  The e2e job also installs ffmpeg on the runner — the video-export
  test shells out to `ffprobe`/`volumedetect` (and the preview test
  encodes a WebM fixture), and GitHub's runner images ship without
  ffmpeg, which the pipeline's first `main` run caught (26 passed /
  1 skipped / 1 ENOENT → whole suite once installed).
- **README CI badge** — live build status for `main` next to the license
  badge.
- **CONTRIBUTING: "CI & required checks"** — documents what each check
  runs and the one-time branch-protection setup that makes `lint-unit`
  a required status check on `main` (branch protection cannot be enabled
  from a PR, so the exact click-path is written down), plus the
  contributor-facing local equivalents (`npm run lint`, `npm run
  typecheck`, `npm run db:setup && npx playwright test`).

### Fixed

- **`image-guard` happy-path test is now hermetic** — the first catch of
  the new CI gate. The test mocked the AI SDK but not the provider-config
  resolution (`ZAI_BASE_URL`/`ZAI_API_KEY` env → `.z-ai-config` file chain
  cwd → ~ → /etc), so the "same-origin POSTs pass the guard" assertion
  only held on machines that carry a real provider config (dev sandbox:
  200) while clean CI runners answered 503. The test now stubs the env
  pair in `beforeEach` (restored after each test), so every machine
  exercises the same code path.

### Changed

- **CONTRIBUTING setup flow modernized** — the quick-start now matches
  what CI itself runs (`npm install` → `npm run db:setup`, the one
  command that applies migrations and seeds the template library)
  instead of the pre-v0.8 `db:push` + `db:seed` two-step, and the
  stale `src/lib/templates.ts` pointer now names the real
  `src/lib/templates/collection-v08-*.ts` files.

## [0.11.8] — 2026-11-01

### Security

- **Collab rail now enforces design ownership (P0).**
  `POST /api/collab/[designId]/events` verified the design existed but
  never consulted the access rule the document rail
  (`PUT /api/designs/[id]`) enforces — so anyone holding an *owned*
  design's link could append collab ops (up to and including
  `pages:replace`), mutating the owner's live session and riding the
  owner's next autosave. The route now resolves the same three-case
  rule (`canEditDesign`, extracted from `design-guard.ts` so the two
  rails can never drift) with a lean column set — ownerless designs
  stay link-editable for everyone, owned designs accept ops from their
  owner only, everyone else gets 403 `READ_ONLY_DESIGN`. Found during
  the v1.0 roadmap research (`research/V0118-ROADMAP-RESEARCH.md` §3.7).
- **Same-origin (CSRF) enforcement on the collab routes** — `events`
  and `presence` were the only mutating routes without it; a cross-site
  page could previously drive an authenticated owner's session cookie
  at the events endpoint.
- **Presence writes are design-gated** — the presence route now 404s
  for missing/trashed designs instead of upserting junk rows for
  arbitrary ids. Heartbeats stay open to signed-out visitors and
  read-only viewers on purpose (they are legitimate room members, and a
  presence row carries no document authority — element ops go through
  `/events`, which enforces ownership).

### Fixed

- **Read-only sessions no longer queue collab ops.** The op emitter
  skips when the store is read-only, and `CollabSession` treats a 403
  flush like 404/503 (drop the queue) instead of retrying every 400 ms —
  a misbehaving read-only tab can no longer spin against the 403.

### Added

- `scripts/collab-guard-probe.sh` — live API probe, 8 assertions:
  the anonymous/second-account/owner/cross-site flush matrix, the
  ownerless flow, viewer presence, and the junk-row 404.
- Unit coverage for both collab routes: `events.test.ts` (9 tests) +
  `presence.test.ts` (5) — **316 unit** total; Playwright **28/28**
  green (incl. the offline-sync and presence-latency specs, proving the
  anonymous ownerless path is byte-for-byte unchanged).

## [0.11.7] — 2026-11-01

The three findings that stayed open after the v0.11.4–v0.11.6 QA sweep
(§5.2 of `research/V0114-QA-PASS.md`): one interaction gap, one React
anti-pattern, one documentation debt.

### Fixed
- **F1 — no deselect on empty-canvas click.** Clicking empty canvas kept
   the current selection; only Escape (and touch) deselected. A bare click
   is a zero-size marquee, and `selectInMarquee` now clears the selection
   for it — Canva parity (`research/V0117-QA-FOLLOWUPS.md`).
- **F5 — React render-phase update warning.** Console:
  "Cannot update a component (`MagicLayersDialog`/`TopBar`) while
  rendering a different component (`CanvasStage`)". Three store writes
  lived inside `setState` updaters — the draw-stroke commit
  (`addElement` inside `setDraft`), the marquee select
  (`setSelection`/`clearSelection` inside `setMarquee`) and the ruler
  guide drop (`addManualGuide` inside `setDraftGuide`). Updaters run
  during render, so each write synchronously re-rendered other
  components mid-render (which component the warning names depends on
  subscriber order — hence the misleading "MagicLayers" attribution).
  All three now commit at event time, outside any updater, with local
  mirrors (`marqueeShapeRef`, the stroke `points`, the guide `position`)
  keeping the gesture data exact. Amusingly, F1 had been masking the
  marquee variant: a bare click early-returned before any store write.
- **F6 — Share dialog documented the wrong access model.** The dialog
  offered a decorative Only me / Anyone with the link / Public selector
  that nothing enforced ("Public — listed in the community gallery"
  described a gallery that does not exist). It now documents the rules
  the server actually enforces (`src/lib/auth/design-guard.ts`):
  anyone who can reach the instance can open the link; ownerless
  designs (created signed-out) stay link-editable; owned designs open
  read-only for everyone else (view-only banner, 403 on saves); there is
  no cloud gatekeeping — reachability is decided by the deployment. When
  you are viewing someone else's design, the dialog says so.
- **Ruler→guide initial position used the wrong coordinate** (found while
  verifying the guide fix): `rulers.tsx beginGuide()` computed the seed
  position from the swapped axis — mouse X for a horizontal guide, mouse
  Y for a vertical one. Mid-drag the first mousemove masked it, but a
  bare ruler click committed a guide at a nonsense position and the
  dashed draft flashed one frame in the wrong place.

### Changed
- `ShareDialog` no longer reads/writes the `canvix:share:<id>`
  localStorage preference (the old decorative selector's storage).

### Added
- Playwright `qa-followups.spec.ts` (5 tests): the F1 deselect click
  (plus re-select of the element), the marquee re-select and
  empty-marquee clear, stroke draw and ruler-guide drop with zero
  render-phase warnings, and the F6 access-model documentation.

## [0.11.6] — 2026-11-01

Two QA-pass findings in panel state hygiene (§5.2 of
`research/V0114-QA-PASS.md`): the Photos panel kept a stale search
filtering its grid after a category switch, and the top-bar mode control
could disagree with the Tools-panel Draw toggle.

### Fixed
- **F2 — Photos panel search state sticks.** After a web search, clicking
  a category tab left the query filtering the bundled library, so "All
  photos" showed the stale 6-of-42 result set until the panel was closed
  and reopened. A category click now exits results mode: the query, the
  visible search box (the `PanelShell` search input is optionally
  controlled now), the web results and any error all clear together.
- **F2b — web search on a provider-less server reads as broken.** With no
  AI provider configured, `/api/photos/search` answers 503
  `NO_PROVIDER`; the panel used to render that as "No web photos
  matched". It now says web search needs an AI provider configured on
  the server (pointing at `ZAI_BASE_URL` / `ZAI_API_KEY`) and that the
  free library below still works. Other API errors surface their message.
- **F3 — editing-mode toggles can disagree.** The top-bar "Editing mode"
  control (`editingMode`) and the Tools-panel Select/Draw toggle (`tool`)
  were separate states: the panel could show "Draw" pressed over a
  read-only canvas, and only the panel toggle reliably started drawing.
  Both controls now label the same derivation
  (`interactionMode()` in `lib/editor-utils`: viewing / draw / editing —
  viewing wins, then the active tool), the top-bar menu offers Draw
  directly, and `setTool` leaves read-only viewing so either control
  activates drawing from any state. The Tools panel explains itself in
  viewing mode ("picking a tool resumes editing").

### Added
- `src/lib/editor-utils.ts` → `interactionMode()` + 4 unit tests pinning
  the truth table (`src/lib/editor-utils.test.ts`).
- Playwright `panel-state.spec.ts` (3 tests): category-tab exit of search
  mode, the NO_PROVIDER configuration hint (503 mocked via `page.route`
  so it is deterministic on any machine), and the F3 top-bar ↔ Tools
  panel agreement across all four toggle paths.

## [0.11.5] — 2026-11-01

A newly joined collaborator took **60–90 s to appear** for clients that
were just *looking* at a design (QA finding F4, the one flagged most
impactful in `research/V0114-QA-PASS.md`). Two delays stacked: the joining
client announced nothing until its first 15 s heartbeat, and the stream
pump only pushed a frame on design events or every 20th tick — ~64 s
apart on a quiet design at the 3.2 s idle tick cadence.

### Fixed
- **Presence join latency — per-tick diff + announce-on-join.** The pump
  now queries presence every tick and compares a stable key of the
  *visible* snapshot (`id`/`name`/`color`/`cursor` — never `lastSeen`,
  never row order, see `src/lib/collab/presence-diff.ts`) against the
  last key it actually sent; any change pushes a frame within one tick
  (≤ 3.2 s idle, ≤ 800 ms active) and counts as activity for the
  adaptive backoff. `CollabSession.start()` fires one presence POST
  immediately, so a fresh participant exists in Postgres from the first
  moment instead of at `start() + 15 s`. Remote cursors on an idle client
  drop from ~64 s to ≤ 3.2 s too.
- Cost: the presence `findMany` doubles (every 2nd → every tick; 0.31 q/s
  idle / 1.25 q/s active per client — still ~3× below the pre-v0.9.2
  constant) while idle frame traffic is unchanged: heartbeats and row
  reorderings don't touch the key, so the diff stays silent when nothing
  visible changed. The every-20th-tick frame remains as a keepalive.

### Added
- `src/lib/collab/presence-diff.ts` + 13 unit tests pinning the diff-key
  contract (changes on join/leave/name/color/cursor; silent on lastSeen,
  reorder, cursor key order, null-vs-undefined cursor).
- Playwright `presence-latency.spec.ts`: two contexts, client A held idle
  past the full tick backoff, client B joins cold — A must see B within
  15 s and B must see A immediately. Negative-tested: fails on the
  v0.11.4 code, passes with the fix.
- `research/V0115-PRESENCE-JOIN-LATENCY.md` — full analysis, cost math
  and resulting latency table.

## [0.11.4] — 2026-11-01

Share links looked like query strings. Every design URL a user ever
copied — `/?design=cmvxd70oo…` — carried the app's SPA implementation
detail in the one place users actually look at it. Deep links worked,
but they didn't look like they would.

### Added
- **Canonical design URLs — `/design/<id>`** (new `src/app/design/[id]`
  route rendering the same app shell). The address bar now follows the
  app: opening a design (from the dashboard, the Projects panel, or a
  link) lands on `/design/<id>`; going home resets to `/`. Refresh on a
  design URL reopens the design. An unknown id falls back to the landing
  page with the URL reset — a dead path renders the app, not a blank page.
- `src/lib/design-url.ts` — one home for URL concerns: `designPath`,
  `designShareUrl`, `readDesignIdFromLocation` (path → `?design=` → `?d=`,
  in that order) and a `replaceUrl` helper. `AppShell` is the extracted
  single-page shell shared by `/` and `/design/[id]`.
- Playwright suite `design-urls.spec.ts` (5 tests): address-bar sync on
  create/back, cold-open of a canonical link, legacy query link
  resolution into the canonical path, Share-dialog link format, and the
  unknown-id fallback.

### Changed
- **Share dialog now generates `/design/<id>` links.** `/?design=<id>`
  and `/?d=<id>` remain first-class — old links, QR codes and printed
  URLs keep resolving (the legacy query resolves into the canonical
  path once the editor opens, so the address bar self-heals).
- The app store (`openEditor` / `goLanding` / `goDashboard`) keeps the
  URL in sync via `history.replaceState` — deliberately not `pushState`:
  popstate is not routed in this shell, and replace keeps the history
  stack honest while giving refresh/share the URL they need.

## [0.11.3] — 2026-10-30

One mobile UI bug with two loud symptoms and a quiet third one hiding in
plain sight on desktop.

### Fixed
- **Elements panel category tabs broke out of their bar on narrow
  screens** — the strip was `grid grid-cols-4` with a fixed `h-8`, but
  there are 7 categories: Shapes/Lines/Graphics/Stickers filled row one
  and Tables/Frames/Embeds wrapped into a second row that painted
  outside the 32px-tall bar. On a phone the Tables tab floated detached
  over the panel divider and content (the reported screenshot); the same
  overflow existed on desktop — the side panel is 320px there too — it
  was just less obvious against the content. The strip is now a
  single-row, horizontally scrollable bar (`overflow-x-auto`, hidden
  scrollbar, no horizontal scroll chaining). Every category stays
  reachable by swipe/scroll and keyboard (Radix roving focus scrolls
  the trigger into view) — nothing is hidden or dropped.
- **Inactive tab labels were nearly invisible in dark panels (≈1.3:1)** —
  the app never applies Tailwind's `.dark` class (the editor's dark
  chrome is hand-painted), so the shadcn Tabs default `text-foreground`
  resolved to the light-theme near-black `oklch(0.145 0 0)` ≈ `#0a0a0a`
  on the dark bar. Tabs now set an explicit `text-white/65` — 7.4:1 on
  the white@5% bar (WCAG AA; the active white-on-purple pill is 6.6:1).
- **Inconsistent tab metrics** — the last three tabs shipped at
  `text-[11px]` beside `text-xs` siblings (and measured 25px vs 26px
  tall). All seven tabs now render from one shared class: identical
  height, padding, font size, radius, hover and active states.
- **Photos & Templates filter chips wrapped unpredictably at narrow
  widths** — same treatment: single-row swipeable chip strips that
  scroll full-bleed under the panel padding; chips no longer wrap or
  shrink. Their label colors already passed AA (7.0:1 / 8.0:1) and are
  unchanged.

### Added
- `.cv-tabscroll` utility (globals.css) for the single-row scroll
  strips: `scrollbar-width: none` + `overscroll-behavior-x: contain`.
- Playwright regression suite `panels-responsive.spec.ts` (7 tests):
  at 320 / 360 / 390 / 430px and desktop — one row, shared metrics,
  strip scrollable, no overlap with the divider/description/content,
  the last tab reachable and functional, and a computed-style WCAG
  contrast lock (≥ 4.5:1) on the inactive label.

## [0.11.2] — 2026-10-30

Two production bugs: an editor crash with an easy-to-miss root cause,
and a Cloudflare git-deploy that could never have worked.

### Fixed
- **Editor's Projects panel crashed the whole editor ("This page couldn't
  load")** — `/api/designs` has returned a keyset-paginated
  `{ designs, nextCursor }` envelope since v0.9.2; the dashboard was
  updated back then, but the editor's left-rail Projects panel still
  assumed the pre-v0.9.2 bare array. The envelope object hit `.filter()`
  on first render and took down the entire React tree the moment the
  fetch resolved — every time, on every design list (opening a template
  was just the way users got to the panel). The panel now parses the
  envelope (first page, newest first — it's a quick switcher), and a
  Playwright regression test locks the flow: open a design → Projects
  panel → designs listed, zero page errors.
- **Cloudflare Workers Builds deploys failed with "Could not find
  compiled Open Next config"** — the git-connected pipeline runs
  `npm run build` then `npx wrangler deploy`; wrangler detects the
  OpenNext project and delegates to `opennextjs-cloudflare deploy`,
  which requires the compiled `.open-next/` output. But `npm run build`
  only ever produced the standalone Node output — and wrangler's OpenNext
  delegation runs *before* it would execute any configured `build.command`,
  so nothing in the pipeline ever built the worker. Fix: `npm run build`
  is now `scripts/build.mjs`, which detects the Workers Builds environment
  via its documented `WORKERS_CI=1` marker and runs
  `opennextjs-cloudflare build` there (plain `next build` + standalone
  copy steps everywhere else — Vercel, Netlify and self-hosted builds are
  byte-identical to before). Second half of the fix:
  `opennextjs-cloudflare build` builds the Next.js app by spawning the
  project's own `npm run build` — with the new branch that would recurse
  forever inside Workers CI, so `open-next.config.ts` now sets
  `buildCommand: "next build"` to break the cycle. Verified locally:
  `WORKERS_CI=1 npm run build` produces `.open-next/worker.js` (single
  build pass), and `npx wrangler deploy` proceeds through the OpenNext
  delegation to the auth check (Workers Builds injects the token in the
  real pipeline).

### Changed
- README: the Cloudflare Workers section now documents git-connected
  Workers Builds (keep the dashboard defaults — the build auto-detects).

## [0.11.1] — 2026-10-30

Production smoke-test release: the focused v0.11.0 verification
(`research/V0110-SMOKE-TEST.md`) confirmed the v0.10.1 fixes hold — zero
P2002s, zero 30-second hangs across the whole probe session — and found
four real bugs in the browser-only paths that API probes and unit tests
cannot reach. All four shipped in v0.11.0's headline features and none
had ever worked end-to-end.

### Fixed
- **Preview never played audio/video (and could skip entry animations)** —
  `PreviewStage` mounts its Konva stage only after the ResizeObserver
  measures the container, but the playback effects bailed on the first
  run (layer ref still null) and their deps never changed afterwards.
  Whether media played was a commit-vs-observer race — manual testing
  usually won it, headless browsers deterministically lose it. A
  `stageReady` dep re-runs both effects when the stage actually mounts.
- **Live video frames never swapped in** — the swap looked up
  `findOne('#id')` as a Konva `Image`, but `VideoNode` renders a Group;
  every video silently kept its poster. The swap now targets the Image
  inside the group.
- **Video froze at trimStart in a `canplay` seek-loop** — the handler
  sought to `trimStart` on every `canplay` event; each completed seek
  re-fired `canplay` (~130 `play()` calls/s, playback never advancing).
  The trim seek now happens once, and looping videos wrap back to
  `trimStart` instead of the source start.
- **Video export could record digital silence** — two stacked races: the
  recorder could start before `audioCtx.resume()` landed, and the export
  render loop's tight MessageChannel yielding starves the audio element's
  resource-selection task (the fetch never started; `readyState` stayed 0
  and the pending `play()` aborted in cleanup). The export now bounded-
  awaits both the context resume and `canplay` on every audio element
  before recording begins; on timeout it still exports (silent, honestly)
  rather than hanging.
- **Collab status stayed "Live" through a hard network cut** — a
  silently-dead SSE socket never fires `onerror`, so the editor claimed
  Live while every flush failed and queued. The session now listens to
  the browser's `online`/`offline` events: an honest "Offline — edits
  save locally" badge appears immediately, and reconnect happens the
  moment the network returns instead of waiting out the backoff.
- **Flaky white-noise BPM unit test** — `Math.random()` input meant ~1 in
  3 runs drew noise spurious enough to clear the detector's periodicity
  gate; the test now uses a seeded PRNG (5/5 stable re-runs).

### Verification
- `scripts/smoke-v0110.ts` — focused API-level production smoke: auth,
  ownership/read-only, the two-designs-one-browser P2002 scenario,
  SSE drop/reconnect/gap-free replay, idempotent retried flushes, the
  chunked media lifecycle, latency ceiling tracking, composite-PK DB
  state. **46/46 green**; probe rows cleaned up afterwards.
- `tests/e2e/v0110-smoke.spec.ts` — the browser-only surface: preview
  plays uploaded audio AND video (playback observed, not assumed), video
  export muxes a **non-silent** audio track (ffprobe + volumedetect), an
  edit made offline syncs on reconnect and survives reload. 3/3 green,
  stable across re-runs.
- Offline-merge probe 18/18 · deploy-readiness ALL GREEN · 285 unit tests.

## [0.11.0] — 2026-10-29

The "sound & motion" release: native audio/video elements, a chunked
media store, and Beat Sync. Full design: `research/MEDIA-AND-BEAT-SYNC.md`.

### Audio & video elements
- **Audio** renders as a waveform player card (peaks baked in at upload,
  so every replica draws it without the multi-MB file) with volume,
  loop, "play on page open" and a BPM chip when a tempo was detected.
- **Video** renders its poster frame on the canvas (dataURL, replicates
  through the document) and plays frames in preview/present, with
  volume, mute, loop, autoplay and a trim window.
- **Media store** (migration `0005`): A/V files live in Postgres `bytea`
  behind `/api/media/<id>` — **chunked uploads** (3 MB per PATCH) work
  within every serverless body limit; appends are offset-guarded so
  replayed chunks 409 instead of corrupting the stream; GET is
  Range-aware (206/416) with immutable caching; `CANVIX_MAX_MEDIA_MB`
  (default 32) caps file size; unfinalized uploads GC after 24 h.

### Beat Sync
- Uploading audio analyzes it in-browser (pure DSP, unit-tested):
  onset envelope → mean-centered autocorrelation tempo (60–180 BPM,
  harmonic-checked toward 90–180) → phase-aligned beat grid, capped at
  480 beats. No grid detected → the feature simply stays hidden.
- Any element gets a **Beat** popover (0–100 % pulse) when its page has
  a beat-carrying audio element; pulses run in preview, presentation
  and video export, composing with entry animations.

### Playback & export
- Preview/present plays page audio, swaps video posters for live
  `<video>` frames, and rAF-drives beat pulses off the audio clock.
- Video export renders media cards + beat pulses and **muxes the page
  audio** (best-effort: needs a MediaRecorder mime with an audio codec;
  otherwise a correct silent video). Honest limitation: exports render
  the video poster, not moving frames.

### Verification
- 285 unit tests (18 new: click tracks at 90/120/140/160 BPM, silence,
  white noise — which caught and fixed a false-tempo autocorrelation
  bias — grid spacing, envelope decay, source selection).
- `scripts/verify-media.ts` — live probe, **19/19 green** against the
  production DB: two-chunk byte-exact round-trip, offset-guard replay
  → 409, finalize guards, Range 206/416, immutable headers, audio
  element save/load round-trip, mime/size/CSRF rejections.
- Offline-merge regression probe still 18/18; Cloudflare 2.14 MB gz /
  Netlify 19.6 MB zip unchanged.

## [0.10.1] — 2026-10-29

Production hotfix: the presence P2002 storm + 30-second function hangs.
Full analysis: `research/PRESENCE-P2002-POSTMORTEM.md`.

### Fixed
- **Presence P2002 on every heartbeat** — `Presence` had a primary key
  on the participant id alone, but identity is per-browser and shared
  across designs; a second open design collided with the first on every
  heartbeat (~15 s) and cursor update. Migration `0004` makes the PK
  `(designId, id)` — one browser can now be present in many designs —
  and the heartbeat route falls back to a plain update on a
  concurrent-create P2002 instead of 502ing.
- **Functions running to exactly 30,000 ms** — the pg pool had no
  acquisition timeout and no keepAlive, so one stale pooled connection
  (pooler idle-drop without FIN) hung every request sharing the instance
  until the platform killed it at `maxDuration`. The pool now fails fast
  (`connectionTimeoutMillis 10 s`, `idleTimeoutMillis 30 s`, TCP
  keepAlive); the SSE stream closes cleanly when a tick wedges >8 s and
  self-recycles at 240 s (< the 300 s ceiling); a `retry: 1500` hint
  makes the client's reconnect invisible.
- **Duplicate events on retried flushes** (latent) — the v0.10 client
  retains and retries failed batches; a flush killed mid-batch could
  re-insert its persisted prefix. `DesignEvent.eventId` is now stored
  with a unique `(designId, eventId)` index and flushes insert via one
  idempotent `createMany({ skipDuplicates: true })` — retries are exact
  no-ops, and a flush costs one pooler round-trip instead of up to
  twenty.

### Verification
- Migration 0004 applied to production (composite PK + eventId dedupe
  verified in `information_schema`); 267/267 tests; tsc + eslint clean.
- Live probe extended to **18 checks** — all green against the real
  database, including the incident regressions (one pid heartbeating
  into two designs; a replayed batch inserting zero duplicates; each
  op streaming exactly once). Zero `[collab/presence]` errors in the
  server log afterwards.
- Cloudflare 2.14 MB gz / Netlify 19.6 MB zip — unchanged, within all
  free-tier limits.

## [0.10.0] — 2026-10-29

The "no lost work, ever" release: offline and concurrent edits merge
deterministically — Yjs-grade convergence without leaving the existing
document model. Full design rationale: `research/OFFLINE-MERGE.md`.

### Offline editing that survives reloads
- Every collab op is stamped with a **hybrid logical clock**
  (`w:counter:actor` — `src/lib/collab/hlc.ts`) persisted per browser;
  causality-aware ordering even with skewed clocks or hours-long offline
  sessions.
- The working document **and** the pending op queue persist to IndexedDB
  (debounced; capped 200 pages / 500 ops) — a crash, reload or offline
  spell loses nothing. On reopen, local work is restored when it is
  newer than the server's ("Recovered" chip) and its queue flushes on
  reconnect.
- v0.9's three data-loss windows are closed: offline edits are never
  dropped (the queue persists and retries instead of discarding),
  autosave no longer clobbers whole documents (see merge below), and
  fresh tabs no longer replay stale events over a fresh document
  (`GET /api/designs/[id]` returns the event-log `seq`; the replay
  cursor survives reloads).

### Deterministic merging (client AND server, one pure function)
- Elements are last-write-wins registers keyed by id, arbitrated by HLC
  stamps (`_m`); deletes are **tombstones** that ride the saved document;
  pages match by id (union). `src/lib/collab/merge.ts` — one rule,
  applied identically by every replica, so content converges regardless
  of arrival order.
- `PUT /api/designs/[id]` carries `baseUpdatedAt`; on divergence (the
  tab was offline while others saved) the server merges element-wise
  instead of overwriting and returns `merged:true` + the merged pages.
- `applyRemoteOp` gates stale updates/adds/deletes by stamp; coarse
  replace ops (undo, resize, restore, template) broadcast fully-stamped
  copies so they win/lose deterministically instead of clobbering.
- Legacy clients/documents: unstamped data reads as epoch (any stamped
  write beats it); legacy events get a server stamp at persist time.

### Verification
- 267 unit tests (35 new: HLC monotonicity/absorption/skew, merge
  matrix incl. delete-vs-edit and re-add resurrection, order-independent
  `applyRemoteOp`, restore arbitration); tsc + eslint clean.
- `scripts/verify-offline-merge.ts` — reusable live probe (15 checks)
  against the production database: fast-path save, divergent-PUT merge
  (offline edit wins, addition kept, delete tombstoned), converging
  re-save, SSE stamps (client hlc verbatim, legacy server-stamped).
  **15/15 green.**
- Deploy matrix intact: Cloudflare worker 2.14 MB gz (limit 3), Netlify
  function zip 19.6 MB (limit 50), Node standalone live-verified.
- **No migration required** — stamps and tombstones ride the existing
  `pages` jsonb; v0.9.x databases work untouched.

### Honest limitations
- Element z-order / page order follows the merging side's array; the
  server is the canonical convergence point (transient divergence in
  order only, never in content).
- A page deleted offline can re-appear when the other side held edits
  to it (the page set is a union; element deletes are exact). Element
  work is never lost — the page may need re-deleting.
- Two cursors in one text box still don't merge character-level (that
  is the Yjs upgrade path; the HLC stamps here are the migration seam).

## [0.9.4] — 2026-10-29

The "third platform + leaner artifact" release: **Netlify** joins Vercel
and Cloudflare Workers as a first-class deploy target, and every platform's
bundle gets ~70 % smaller.

### Netlify, zero-config
- `netlify.toml` + pinned `@netlify/plugin-nextjs` 5.16.5 (Netlify's
  OpenNext-based Next.js runtime — officially supports Next.js 16).
  Connect the repo in the Netlify UI, set `DATABASE_URL`, done.
- Functions run on AWS Lambda: full Node API surface, so scrypt auth,
  `pg` sockets and `sharp` PNG export are all native — no runtime
  guards ever trip.
- The exact Netlify build pipeline runs locally without an account:
  `npx netlify-cli build --offline`.

### The 70 MB → 20.8 MB function bundle (why it was 70 MB)
- Netlify's 50-MB-zipped function limit exposed that the traced
  `@prisma/client` shipped **~90 MB of wasm the patched client provably
  never loads** — in BOTH copies Next traces (nft's `node_modules/…` and
  Turbopack's hashed `.next/node_modules/…`):
  `*wasm-base64*` compilers for all five dialects, the old
  `query_engine_bg*` library-engine wasm (dead with `engineType="client"`),
  and the other dialects' `query_compiler_bg.{mysql,sqlite,…}` wrappers.
- New `outputFileTracingExcludes` in `next.config.ts` remove exactly
  those (+ sharp's darwin/win32 binaries), keeping the live files
  (postgresql wrappers, `raw.wasm`, `wasm-module.mjs`) — verified by
  booting the rebuilt standalone against the real database: health,
  designs and templates all green.
- Netlify function zip: **70.4 → 20.8 MB zipped** (52 MB unzipped, limit
  250). Cloudflare worker: unchanged **2.13 MB gzipped** (limit 3).
  Node standalone: proportionally smaller for every self-hoster.

### Deployment verification (all against the live database)
- `scripts/verify-deploy-readiness.ts` — one command proving migrations
  applied, schema complete (tables/columns/indexes), data present
  (110 templates), and parameterized queries through the transaction
  pooler. Reusable before any deploy, on any host.
- Production Node standalone: `/api/health` `{"ok":true}`, landing,
  templates, designs, auth register/login, anonymous `/api/auth/me`,
  SSE stream sample, MCP 503 (no AI provider configured), cross-origin
  CSRF rejection — all verified live; probe rows cleaned up.
- Cloudflare: OpenNext build + `wrangler deploy --dry-run` +
  workerd preview (landing 200, auth/me works, health degrades to the
  documented structured 503 — no crashes).
- Full gate: **232/232 vitest**, `tsc --noEmit` clean, eslint clean.

## [0.9.3] — 2026-10-29

The "run it anywhere" release: Canvix now deploys to **Cloudflare
Workers** (free tier) with the exact same codebase that runs on
Vercel/self-hosted Node — one database, zero behavioural divergence.

### Prisma without native binaries (the foundation)
- Migrated to the **rust-free Prisma client** (dependency floor 6.11 →
  6.16+; installed 6.19): no Rust query-engine binary, and it executes
  on any JS runtime including workerd. The switch is
  `generator client { provider = "prisma-client"; engineType = "client" }`
  — `prisma-client-js` + the queryCompiler flag silently keeps the
  library engine (found the hard way; documented in the patch script).
- Postgres access now goes through **`@prisma/adapter-pg`** (the real
  `pg` driver). On Cloudflare Workers pg auto-switches to
  `pg-cloudflare`'s socket layer and rides workerd's `nodejs_compat`
  straight into Supabase's transaction pooler — the same URL Vercel
  uses.
- **`scripts/patch-prisma-wasm.mjs`** (runs from postinstall, idempotent,
  fails loudly on template drift) makes the generated client
  runtime-portable: the sync `new WebAssembly.Module` becomes async
  `WebAssembly.compile`; workerd gets an ESM-imported `.wasm` (wrangler
  compiles it at deploy — runtime compilation is forbidden there); Node
  reads the raw wasm from disk. The Node import of the 2.6 MB base64
  module is gone entirely (bundler tracing is relentless — Turbopack
  resolves even env-conditional specifiers), so the wasm ships exactly
  once: **worker 2.13 MB gzipped vs the 3 MB free-plan cap** (3.11 MB
  before the deduplication).
- The client generates to `src/generated/prisma` (gitignored,
  postinstall regenerates); imports are `@/generated/prisma/client` in
  app code, relative paths in scripts.
- `src/lib/db-url.ts` grows `driverConnectionString()` — the pg driver
  gets TLS defaults translated to its semantics (`sslmode=require` →
  `no-verify`: node-postgres currently treats `require` as `verify-full`,
  which rejects hosted-pooler CA chains; user-pinned verify levels pass
  through) but not Prisma-engine-only params (`pgbouncer`,
  `connection_limit`); pool sizing is set in code (`max: 1` per
  process/isolate). The env-var normalization for `prisma migrate` is
  unchanged.
- New script-side factory `src/lib/db-script.ts` (alias-free so plain
  `tsx` runs it) used by seed, db-check, usage-forensics and the
  auth-e2e probes — `datasources` overrides (unsupported by the
  rust-free client) are gone everywhere.
- Raw-query compatibility: the rust-free client refuses Postgres catalog
  `name` columns — `/api/health` and the forensics script now cast to
  `::text`.

### Cloudflare Workers deployment
- `@opennextjs/cloudflare` + `wrangler` wired in: `wrangler.jsonc`
  (nodejs_compat + `global_fetch_strictly_public`, Workers assets,
  self-reference service binding, observability) and a dependency-free
  `open-next.config.ts` (no R2/KV/Images bindings needed — every Canvix
  route is dynamic and no `next/image` is used).
- `npm run preview` (local workerd), `npm run deploy`, `npm run upload`,
  `npm run cf-typegen`; `.dev.vars.example` documents the secrets;
  `.open-next`, `.dev.vars`, `src/generated/` are gitignored.
- Database on Workers = the Supabase **transaction pooler** URL (6543) —
  the direct endpoint is IPv6-only and workers cannot reach it.

### Runtime-portable internals
- **SSRF guard** (`src/lib/mcp/ssrf-guard.ts`): `node:net`'s `isIP` is
  replaced by a strict local implementation (verified against
  `node:net` as an oracle across a 60-case corpus, including v4-mapped
  v6, NAT64, compressed/full forms and malformed literals) — and
  `node:dns`/`node:http(s)`/`node:stream` are now lazily imported.
  Node/Bun behaviour is byte-identical (lookup-pinned transport). On
  workerd the guard resolves via **DNS-over-HTTPS** (Cloudflare's JSON
  API) and validates every A/AAAA record before `fetch()` runs; the
  wrangler `global_fetch_strictly_public` flag backstops it. The
  theoretical DoH→fetch rebinding window (unpinnable on workerd) is
  documented in the file header.
- **sharp rasterizer** (`src/lib/mcp/tools.ts`): loaded through a
  non-literal specifier guarded by a loader — Node keeps it (and
  `outputFileTracingIncludes` pins it into the standalone trace for
  self-hosters), workerd never tries to load it. MCP PNG export
  degrades to a clear "use SVG" error; fetched images fall back to
  default dimensions.
- **AI provider**: the `.z-ai-config` file fallback is Node-only (on
  workerd the unenv fs stub is swallowed by the existing try/catch —
  env vars via wrangler secrets are the provider source there).
- Auth needed no changes: workerd implements `node:crypto` scrypt,
  `timingSafeEqual`, `createHash`; SSE collab is pure web streams.

### Verification
- New suite `src/lib/cross-runtime.test.ts`: isIP parity corpus,
  driverConnectionString matrix, runtime detection.
- Full vitest run, `tsc --noEmit`, eslint and the production Node build
  stay green; the Node standalone server was live-verified against the
  real Supabase (health, designs, templates, MCP guards). The worker
  builds at 2.13 MB gzipped, boots in workerd and serves the app.
- **Known limitation (documented):** local `wrangler dev` in some
  environments (including the development sandbox this was built in)
  cannot complete the Postgres TLS upgrade — workerd's `startTls()`
  breaks after any stream-reader use (isolated with raw-socket tests
  across wrangler 4.100/4.145/4.155; the same dance works from Node
  against the same servers; `node:net`+`node:tls` upgrade is likewise
  blocked by a permanently-pending internal read). Real deployments run
  the documented pg/pg-cloudflare path — verify with
  `npm run deploy` + `/api/health`; Hyperdrive is the documented
  fallback. Full audit: research/CLOUDFLARE-WORKERS-PORTABILITY.md.
- Bonus: two pre-existing `react-hooks/set-state-in-effect` lint errors
  fixed (AuthDialog resets via Radix unmount; useAuth sets state from
  async continuations only).

## [0.9.2] — 2026-10-28

The "stop the bleeding" release — evidence-based fixes for the Vercel
usage spike (5h05m Fluid CPU / 29.08 GB Fast Origin Transfer over two
days), each traced to a measurable driver before a line was changed:

- `GET /api/designs` returned every ownerless row with base64 thumbnails
  (~7 MB/response) → keyset-paginated (60/page + Load more), ownership
  scoping AND-composed with the cursor (regression-tested).
- `GET /api/templates` (~0.7 MB, public, uncached) → CDN cache headers
  (`s-maxage=86400`, SWR 604800).
- SSE collab stream fired 3 Postgres queries every 800 ms per client →
  adaptive pump (presence every 2nd tick, MAX(id) every 5th, idle
  backoff 800 ms → 3.2 s, instant snap-back on activity; ~10× cheaper
  idle streams, unchanged editing latency).
- Presence writes throttled (cursor 120 ms → 300 ms, heartbeat 5 s →
  15 s; 48.5k slow upserts/day measured on the live DB).
- AI routes: strict same-origin guard (Origin-less/foreign POSTs get
  403 before any provider work) and tightened generation limits.
- `robots.txt` disallows `/api/`; `/api/health` is no-store + noindex.
- Infra: `scripts/usage-forensics.ts` + workflow — pg_stat_statements
  and table stats on demand for the next spike.
- 168/168 tests green (13 new regression tests).

## [0.9.1] — 2026-10-28

The "never claim someone else's work" release: claim eligibility is now
enforced, CSRF is closed out, and the verification report the roadmap
called for exists as executable tests.

### Claim eligibility (adopt-all made safe)
- **Anonymous attribution** — the first anonymous design creation sets a
  `canvix_anon` cookie (256-bit, HttpOnly, 1 year); the design row stores
  sha256(token) in the new indexed `Design.anonKey` (migration
  `0003_anon_attribution`, purely additive). A database leak never
  contains usable attribution tokens.
- **adopt-all is scoped** — `POST /api/designs/adopt-all` now claims only
  ownerless designs whose `anonKey` matches the caller's own browser.
  Another person's anonymous work and legacy (pre-attribution) rows are
  structurally outside the UPDATE. A browser with no attribution cookie
  claims nothing.
- **Per-design adoption** — new `POST /api/designs/[id]/adopt` claims ONE
  ownerless design deliberately: your own browser's designs and legacy
  rows are claimable; a foreign browser's design answers
  `403 NOT_ELIGIBLE`; races between two claimants are resolved atomically
  by a conditional `updateMany` (`409` on loss).
- **Dashboard** shows the honest claimable count ("Save my designs to
  this account (N)" counts only browser-attributed designs), a per-design
  "Save to my account" action, and — for self-hosters — a separate,
  confirmation-guarded "Adopt legacy (pre-accounts) designs" bulk item
  (`adopt-all { includeLegacy: true }`; foreign attributions remain
  excluded even then). The list API exposes boolean `claimable` and
  `mine` flags per design (never the hash). Dialog-driven sign-in/up now
  refreshes the dashboard's auth state immediately (the account chip no
  longer waits for a reload).

### CSRF protection for cookie-authenticated writes
- Every mutating API route (`POST /api/designs`, `PUT`/`DELETE` on a
  design, restore, adopt, adopt-all, register, login, logout) now
  enforces same-origin: browsers always attach `Origin` (or `Referer`)
  to cross-site requests; when present it must match the request's host
  (`x-forwarded-host` honoured behind proxies). Non-browser clients
  (curl, MCP, health probes) send neither header and pass — they carry
  no ambient cookie authority. This is defence-in-depth on top of the
  existing `SameSite=Lax` session cookie.

### Verification (the pre-Phase-4 gate)
- `scripts/auth-e2e.sh` now proves, against a real database: register →
  me → owned create → owner save → anonymous 403 → logout → **revoked
  token replay is dead** → wrong-password 401 → login → **cross-origin
  PUT/POST rejected (CSRF)** → same-origin unaffected → **two anonymous
  browsers: adopt-all claims only the caller's own design** → foreign
  per-design adopt refused, legacy allowed → **cross-account isolation
  (B cannot modify/delete/adopt C's design, opens it view-only)**.
  All probe rows are removed afterwards.
- New unit suites: session expiry/revocation/cookie hardening (mocked
  DB), CSRF guard matrix, adopt-all eligibility (the WHERE-clause
  invariant), per-design adopt matrix. SSRF suite extended with
  DNS-flip regressions (between requests and mid-redirect-chain).
  **152/152 tests green.**
- `package-lock.json` version resynced with `package.json` (skew since
  0.8.1 — tolerated by npm but confusing for tooling).
- **Vercel deployment fix** — v0.9.0/v0.9.1 pushes failed on Vercel
  (~35s, "Deployment has failed") while building clean everywhere else.
  Root cause (reproduced locally): Vercel restores a cached
  `node_modules` between builds; with no `postinstall` hook the
  Prisma client generated against the pre-v0.9 schema stayed cached,
  so `next build` typechecked the new `db.user`/`db.session`/
  `Design.ownerId` code against a client that lacked them and failed.
  Fresh installs (CI, local) regenerate the client and never see it.
  Fix: `"postinstall": "prisma generate"` (root lifecycle scripts run
  on every install, cached or not — Prisma's documented Vercel setup)
  and removal of the v0.4-era stale `bun.lock` (the repo is
  npm-first; a second, stale lockfile invites package-manager
  ambiguity on PaaS detection).

## [0.9.0] — 2026-10-28

The "Your designs, yours" release: free accounts, per-design ownership,
and the SSRF DNS-pinning close-out promised in the Phase 3 plan.

### Accounts — free forever, zero dependencies
- **Username + password accounts** with scrypt hashing straight from
  `node:crypto` (N=16384, r=8, p=1, per-hash random salt, parameters
  stored alongside the hash for future cost upgrades) — no bcrypt/argon2
  native builds, no external provider, no email. A self-hoster runs the
  whole account system for $0.
- **Opaque DB-backed sessions** — the cookie carries a 256-bit random
  token; the `Session` row id is sha256(token), so a database leak never
  contains usable session tokens. 30-day expiry, HttpOnly + SameSite=Lax
  (+ Secure in production), server-side revocation on logout, and a
  best-effort expiry sweep on every new session.
- **Input rules** (NIST SP 800-63B-flavoured): usernames 3–32 chars of
  `[a-z0-9_-]` canonicalised to lowercase; passwords 8–200 with a tiny
  top-password blocklist. Login answers one generic error (no account
  enumeration) and is rate-limited (10/10min/IP); register 5/hour/IP —
  reusing the existing sliding-window limiter.

### Per-design ownership
- `Design.ownerId` (nullable FK → `User`, `SetNull` on user deletion,
  indexed). Migration `0002_accounts` is purely additive.
- **Three access cases, one helper** (`src/lib/auth/design-guard.ts`):
  ownerless designs stay link-editable (the exact pre-v0.9 behaviour —
  existing setups and intentionally shared designs keep working); the
  owner has full edit; everyone else gets view-only.
- Enforced at every mutating API — save (PUT), delete (DELETE), restore,
  version snapshots — with a structured `403 READ_ONLY_DESIGN` body.
  `GET /api/designs/[id]` still serves share links but now carries a
  `readOnly` flag.
- **Dashboard scoping** — signed-in users see their designs plus shared
  (ownerless) ones; anonymous visitors see ownerless designs only.
  New designs created while signed in are automatically owned.
- **One-click migration** — "Save all designs to my account" adopts every
  ownerless design into the signed-in account (`POST /api/designs/adopt-all`,
  idempotent, never touches already-owned designs).
- **Editor view-only mode** — autosave is disabled and an amber banner
  explains why, instead of silently failing saves.

### Collab identity
- Signed-in users automatically appear under their real username in
  presence, cursors and comments (the local participant identity is
  upgraded on login; anonymous users keep the generated names).

### Security — SSRF DNS-rebinding pinning (the v0.6.1 residual, closed)
- `safeFetch` no longer uses `fetch()` for the exchange: it connects via
  `node:http(s)` with a **custom DNS lookup pinned to the validated
  address**. The guard resolves and range-checks every address, hands the
  connection exactly that IP, and there is no second resolution — a
  rebinding attack between validation and connect is now impossible.
  TLS keeps the real hostname for SNI/Host, so certificate validation is
  unaffected. The transport is injectable for tests; the suite now asserts
  the pinned IP on every hop (including the rebinding scenario) and
  exercises the real transport end-to-end against a local server.

### Verification
- 115 unit tests (10 new: scrypt round-trip/salting/tamper-resistance,
  username/password rules, token derivation; SSRF suite upgraded to
  assert pinning). `tsc --noEmit` clean, production build clean.
- **`scripts/auth-e2e.sh`** — boots the built standalone server against a
  real database and drives the whole flow with curl: register → me →
  owned create → owner save → anonymous `403 READ_ONLY_DESIGN` → logout →
  me(null) → wrong-password `401` → login → cleanup. Wired into the
  "Canvix Database Setup" workflow, so every re-run of the workflow now
  proves accounts + ownership against *your* live database before it
  reports success.
- `/api/health` now also checks for the `User` and `Session` tables and
  tells you to re-run `npm run db:setup` after upgrading.

### Upgrade notes
- Run `npm run db:setup` once after pulling (applies `0002_accounts`).
  Existing designs are untouched: they stay link-editable until you
  choose "Save all designs to my account" while signed in.
- Nothing else changes — anonymous/local editing works exactly as before
  for anyone who never creates an account.

## [0.8.0] — 2026-10-28

The "Supabase-ready & 110 Templates" release: switching your database to
Supabase (or any Postgres host) is now a one-command, self-diagnosing
operation, and the template library grows from 60 to **110** — still
100% free forever, no subscriptions, no paywalls.

### Database: Supabase-first infrastructure
- **Real migrations ship in the repo** (`prisma/migrations/0001_init`) —
  `npm run db:setup` applies them plus the template seed against any
  Postgres host: brand-new Supabase project, Neon, RDS, Docker or local.
  The SQL is idempotent (`IF NOT EXISTS` + guarded constraints), and the
  setup wrapper self-heals the "old database provisioned via `db push`"
  case by baselining the migration history (Prisma's documented path)
  instead of failing with P3005.
- **Smart connection handling** (`src/lib/db-url.ts`) — copy-pasting a
  Supabase URI just works: TLS is auto-required for remote hosts, and the
  transaction pooler (`…pooler.supabase.com:6543`) automatically receives
  `pgbouncer=true&connection_limit=1` so Prisma's prepared statements
  survive. Every auto-fix is logged so nothing is silent magic.
- **`GET /api/health`** — one-page diagnosis: env → connectivity →
  migration → seed, with the exact fix printed per step (including the
  Supabase IPv6/pooler hint when a direct connection can't route).
- **Template-opening failures now explain themselves** — the reported
  "could not open template" dead end is gone. API errors are classified
  (`DB_NOT_MIGRATED`, `DB_UNREACHABLE`, `DB_TIMEOUT`), the dashboard
  shows a persistent setup banner with the command to run, and toasts
  carry the fix text.
- **Quieter production Prisma logs** — query logging is dev-only now.
- `.env.example` rewritten Supabase-first; README quick start covers both
  pooler and direct connection styles.

### Template library: 60 → 110, all free
- **50 new original premium-grade templates** (designed in-house, styled
  after 2026 template-platform trends — nothing copied), organized as
  collections in the new `src/lib/templates/` module:
  - **social +14** — podcast quote card, real-estate new listing, bootcamp,
    restaurant daily special, quiet-luxury lookbook, webinar announcement,
    LinkedIn banner, recipe pin, birthday story, Black Friday, playlist
    cover, Monday motivation, flash-sale countdown story, grand opening
  - **presentation +8** — investor pitch (4-page system), marketing plan,
    course intro, agency portfolio, quarterly review, demo day, nonprofit
    impact, product launch keynote
  - **print +9** — wedding invitation, gym flyer, cafe menu, concert
    poster, yoga flyer, gift certificate, business card, open mic, moving
    sale
  - **documents +9** — executive & creative resumes, matching cover letter,
    project proposal, invoice, school newsletter, whitepaper, meeting
    agenda, press release
  - **thumbnails +7** — gaming, tech review, vlog, tutorial, podcast,
    fitness, cooking
  - **logos +3** — roastery badge, geometric tech mark, salon monogram
- `scripts/validate-templates.ts` — structural validator (unique slugs,
  pages/backgrounds/element geometry) wired for CI-style checks.
- Category totals now: social 33 · presentation 17 · print 19 ·
  documents 22 · thumbnails 12 · logos 7.

## [0.7.0] — 2026-10-28

The "Fast & Free Forever" release: the canvas rendering hot path is rebuilt
(structural sharing, memoized nodes, O(1) history), the template library
nearly triples to 60 — and the project formally commits to staying
**100% free forever**: no subscriptions, no paywalls, no locked features.

### Rendering performance
- **Structural sharing in the editor store** (`src/store/editor-store.ts`) —
  every mutation (typing, slider drags, align/flip, group/ungroup, remote
  `applyRemoteOp`, MCP live edits) now performs immutable updates that give
  new identities *only* to the touched page/elements; untouched objects keep
  their references. The old code deep-cloned the whole `pages` tree via
  `structuredClone` on every keystroke. Result: a live edit re-renders exactly
  one `ElementNode` instead of every node on the canvas.
- **O(1) undo/redo history** — since pages are never mutated in place any
  more, history snapshots are plain references (Immer-style structural
  sharing, zero dependencies). `pushHistory` no longer clones the document;
  a 60-entry history of a large design costs a fraction of the old memory.
- **Memoized canvas nodes** (`element-node.tsx`) — `ElementNode` no longer
  subscribes to the entire editor store (it reads actions at event time via
  `getState()`), is wrapped in `React.memo`, gets a stable node-ref callback,
  and `CanvasStage` passes stable handler props — selection changes, panel
  toggles, collaborator cursors and remote typing no longer re-render any
  shape they don't affect.
- **Split Konva layers** (`CanvasStage.tsx`) — interaction chrome (transformer,
  snap guides, manual ruler guides, marquee, freehand draft) moved to a second
  `<Layer>`: dragging with snapping active repaints only the overlay canvas,
  and content edits never repaint the chrome.
- **Snap-guide equality guard** — `handleDragMoveNode` compares guide sets by
  value and skips `setGuides` when nothing visibly changed (previously every
  mousemove created a fresh array and re-rendered the tree).
- **Shared image cache** (`use-loaded-image.ts`) — module-level cache keyed by
  URL with in-flight dedup, negative caching of failures and a bounded
  ~300-entry eviction. Images decode once per URL instead of once per mount.
- **`perfectDrawEnabled: false`** on element nodes — skips Konva's hit-canvas
  "perfect draw" pass during drag/transform.
- **Lazy template thumbnails** (`TemplatesPanel.tsx`) — preview stages mount
  via `IntersectionObserver` with a 300 px pre-roll; cards are memoized. The
  60-template panel only pays canvas cost for visible cards.
- **Regression-locked** — new `src/store/editor-store.test.ts` (5 tests)
  asserts the identity invariants: patched-only new identities, untouched
  pages/elements keep references, history shares structure, snapshots never
  mutate in place, remote ops preserve untouched pages.

### Premium template collection — all free (21 → 60)
- 39 new templates across every category, each with real copy, considered
  typography and Canva-grade layouts: **social** (flash-sale story, minimal
  quote, trattoria special, open house, bootcamp, webinar announcement,
  podcast cover, birthday story, wanderlust story, LinkedIn banner),
  **presentation** (pitch deck noir 2-pager, quarterly report, webinar 101,
  course welcome, product roadmap timeline, meet the team),
  **print** (neon gig poster, charity gala flyer, artisan cafe menu, spa
  voucher, open-house yard sign, luxe dark card, wedding thank-you, tear-off
  coupon), **document** (project proposal, community newsletter, ebook cover,
  tech whitepaper, press release, meeting agenda, studio invoice, case
  study), **thumbnail** (gaming, tutorial, podcast episode, unboxing) and
  **logo** (orbit tech, bloom cafe, apex fitness).
- `TemplateDef.badge` ('premium' | 'new') is a **quality label only** — the
  templates panel shows a "Premium collection · free forever" section and
  premium chips on cards; nothing is ever gated.
- DB re-seeded (60 templates upserted by slug).

### Free forever — formalized
- README gains a "Free forever — the promise" section: every feature, every
  template, every export is free; no Pro tier, no trials, no watermarks,
  ever. This is a project principle, not a launch promotion.

## [0.6.1] — 2026-10-28

Hardening & hygiene release: closes a real SSRF bypass in the MCP image
fetch, fixes JSON-RPC spec violations, ships the test infrastructure the
0.6.0 notes promised, and deletes ~24% of dead weight from the tree.

### Security
- **SSRF: redirect bypass fixed** (`src/lib/mcp/ssrf-guard.ts`) — the old
  private-host check ran on the *initial* URL only while `fetch()` followed
  redirects automatically, so any public URL that 302'd to
  `http://169.254.169.254/…` (cloud metadata) or an internal host bypassed
  it. `safeFetch()` now follows redirects **manually** and re-validates every
  hop: protocol allow-list (no `file:`/`data:`/…), full IPv4/IPv6
  private/reserved-range checks (incl. CGNAT, link-local, v4-mapped, NAT64),
  intranet-name blocklist (bare dot-less hosts, `.local`/`.internal`/…), and
  DNS resolution where **every** resolved address must be public. Decimal/
  octal/hex IP encodings (`http://2130706433/`) are normalized by the
  resolver and caught. Max 5 redirect hops. Known residual: DNS-rebinding
  TOCTOU (guard resolves, then fetch re-resolves) — documented in the source,
  full pinning planned with the Phase 3 auth work.
- **JSON-RPC `id` echo fixed** — `tools/list` answered with `id: null`
  instead of echoing the request id (spec violation that breaks strict
  client request/response correlation). Every method now echoes correctly,
  covered by regression tests.
- **Request body cap** — `/api/mcp` reads bodies through a capped stream
  reader (1 MB, works for chunked requests too) and answers `413` with a
  JSON-RPC error (`-32002`) instead of buffering unbounded payloads.
- **Image fetch size guard** — content-length is checked *before* the body
  is streamed (the old code capped only after reading the full response).

### Tests — the infrastructure 0.6.0 claimed, now real
- **Vitest** (`npm test`) — 97 unit tests: SSRF guard (range tables, DNS
  resolution, redirect pinning — including the exact v0.6 bypass scenario),
  JSON-RPC conformance (id echo, error codes, batches, notifications).
- **`scripts/mcp-e2e.sh`** (`npm run test:mcp`) — 38 live assertions over
  the HTTP transport: auth, initialize negotiation, tool catalogue, a full
  create→edit→export workflow against the database, **live SSRF-guard
  rejections**, transport hardening (invalid JSON, unknown methods,
  batches, the 413 cap). *(0.6.0's changelog referenced this script before
  it existed — mea culpa.)*
- **Playwright** (`npm run test:ui`) — browser smoke suite (landing →
  dashboard → editor canvas with react-konva mounted) plus config with
  auto-booted dev server; `BASE_URL` reuses a running instance.
- `npm run typecheck` — fast `tsc --noEmit` gate.

### Cleanup — −45 dependencies, −40 dead files (~24% of the tree)
- Removed **39 unused shadcn/ui components** (import-graph verified; the 9
  actually used — button, dialog, dropdown-menu, input, popover, progress,
  tabs, toast, toaster — remain; `npx shadcn add <x>` restores any other).
- Removed **45 unused dependencies** incl. `next-auth`, `framer-motion`,
  `zod`, `@dnd-kit/*`, `@tanstack/react-query`, `react-table`, `recharts`,
  `date-fns`, `next-intl`, `next-themes`, `sonner`, `uuid`, 19 unused
  Radix packages and more (dependency count 70 → 25).
- Removed the vestigial Tailwind v3 `tailwind.config.ts` (v4 uses the
  CSS-first config in `globals.css`; `tailwindcss-animate` → already
  replaced by `tw-animate-css`).
- **`ignoreBuildErrors: false`** — the production build typechecks strictly
  again (the codebase was already clean; now it stays that way).
- Fixed the 3 `react-hooks/set-state-in-effect` violations surfaced by the
  current eslint-config-next (`useSyncExternalStore` for `useIsMobile`,
  render-time prop mirroring in `ColorMenu`, microtask-deferred fetch in
  the dashboard hook) — `npm run lint` is fully green (0 errors, 0 warnings).
- Committed `package-lock.json` for reproducible installs.

## [0.6.0] — 2026-09-04

The Agent Edition: Canvix speaks the Model Context Protocol, so AI assistants
(Claude Desktop, Cursor, ChatGPT, any MCP client) can create and edit real
designs on your server — and the editor closes the remaining Canva-parity gaps
with native tables, image frames, curved text and embed cards.

### MCP server — AI agents drive Canvix
- **`POST /api/mcp`** implements MCP 2025-03-26 *Streamable HTTP* (stateless
  profile): JSON-RPC 2.0 requests answered with one JSON object, notifications
  with `202 Accepted`, `GET` → `405` (no server-initiated stream — spec-compliant),
  full lifecycle (`initialize` → `notifications/initialized` → `tools/list` /
  `tools/call`), `ping`, empty `resources/list` / `prompts/list`, batches ≤ 32.
- **20 tools, all backed by real subsystems** — discover (`get_capabilities`,
  `list_templates`, `search_designs`, `get_design`, `get_design_content`),
  create (`create_design` blank-or-template — id *or* slug accepted, first page
  auto-created), edit (`add_text`, `add_shape`, `add_image`, `add_table`,
  `add_embed`, `set_background`, `update_element`, `delete_element`,
  `animate_page` — the same Magic Animate engine), export (`export_design`:
  true-vector SVG server-side, PNG via sharp, JSON), collaborate
  (`comment_on_design`, `list_comments`) and `list_fonts`.
- **`generate_design`** — AI-generated designs as *native editable elements*:
  the provider is asked for a structured page spec (strict JSON mode with
  repair + one retry), then every field is normalized/clamped (coords, hex
  colors, whitelisted fonts, ≤ 25 elements) before a real Design row is
  created. Without a provider the tool errors honestly and points at
  template-based creation.
- **Live propagation**: every MCP write appends a `pages:replace` event to the
  design's collab log (actor `agent:mcp`) — open editor sessions replay agent
  edits in real time; comments emit `comment:activity` markers.
- **Hardening** — disabled until `CANVIX_MCP_TOKEN` is set (503 with setup
  instructions otherwise); Bearer auth with timing-safe comparison; Origin
  validation (DNS-rebinding guard); 120 req/min/IP; SSRF-guarded image fetch
  (private hosts denied, 8 MB / 10 s caps, content-type allow-list) → dataURL;
  per-type patch whitelists with clamps; no stack traces on the wire.
- **Dashboard "AI agents (MCP)" card** — live status probe (`OPTIONS /api/mcp`),
  copyable endpoint + client config JSON for Claude Desktop / Cursor / any
  remote MCP client. `.env.example` documents the token.
- **Protocol E2E** (`scripts/mcp-e2e.sh`): 38 assertions — initialize handshake,
  202 notifications, tools/list (20), auth (401), GET 405, unknown method/tool,
  full create → style → add (text/shape/table/embed) → update (curve) →
  animate → get → comment → export (svg/png/json) → delete flow, batch, parse
  errors, AI generation — **38/38 passing**.

### Tables (native, editable)
- New `table` element: rows × cols with per-cell text/fill/bold, proportional
  column widths, header band, border color/width, text style — four starter
  styles (classic / minimal / bold / soft).
- **Click any cell to edit it in place** (cell-scoped textarea overlay), add /
  remove rows & columns from the context toolbar, restyle via the Style popover.
- Renders in editor, previews, thumbnails, PNG/PDF/video exports; SVG export
  serializes per-cell rects + text; **AI Translate now walks table cells too**.

### Frames (image-in-shape)
- New `frame` element: rect (with corner radius), ellipse, circle, triangle,
  hexagon — images clip to the shape with cover-fit (Konva `clipFunc`).
- **Drop an upload or photo onto a frame to fill it** (drop-to-fill), or use
  the Fill button / shape switcher in the context toolbar. Empty frames show a
  dashed placeholder. SVG export uses true vector `<clipPath>`.

### Curved text
- `TextElement.curve` (−180…180°): arch up or valley down, rendered as real
  text-on-path (Konva `TextPath`) — editable, transformable, exports to
  SVG `<textPath>` and rides PNG/PDF/video export unchanged. Curve slider in
  the text toolbar with live reset.

### Embed cards
- New `embed` element for YouTube / Google Maps / generic links — a native
  vector card (tinted media band, play / pin / link glyph, host + title) that
  opens the URL when clicked in Preview or shared views. YouTube pulls the
  public thumbnail (CORS-safe, graceful fallback). Honest scope: a styled
  card, not an iframe.

### Infrastructure
- **`src/lib/v06-geometry.ts`** — pure shared geometry (arc math, table
  layout, frame clip paths, embed card metrics) used by BOTH the Konva
  renderers and the server-side SVG exporter (server-safe, no DOM imports).
- SVG exporter gained table / frame (clipPath) / embed (band + glyphs) /
  curved-text (defs path + textPath) serializers, all escaped and
  `data:`/`https:`-only hrefs.
- MCP tool schema definitions double as living API documentation for agents.

## [0.5.0] — 2026-09-04

The AI-native collaborative release: Magic Layers turns flat images into editable
designs, real-time multiplayer arrives with comments, designs learn to move with
animations and export as SVG and video, and the AI stack gets a production-grade
provider abstraction.

### Magic Layers — image → editable design
- Upload (or select) a flat design and a **vision model decomposes it into real,
  editable Canvix layers**: text regions become live text elements (color, weight,
  approximate font size and class recovered), photo regions become cropped image
  elements, shapes become native shapes, and the background becomes a page
  background/gradient.
- The analysis returns a **validated region schema** (bounds, confidence 0–1,
  layer order) — the client reconstructs native elements, never a raster. Each
  element carries `magicLayer` provenance metadata (source region, confidence,
  original bounds) for future tooling.
- Honest-by-design review UX: region overlays with confidence colors, per-region
  keep/discard toggles, low-confidence flags, model limitations surfaced in the
  dialog ("illustrations become image regions", "fonts matched by class").
- Server route `POST /api/ai/magic-layers`: dataURL-only input, 8 MB cap,
  `validateAnalysis()` clamps every field (bounds 0..1, hex colors, whitelisted
  font classes, text ≤ 400 chars, ≤ 40 regions, deduped overlapping text).

### Real-time collaboration
- **Multiplayer editing on Postgres + SSE** — an append-only `DesignEvent` log
  (global monotonic seq) is the replication stream; clients subscribe via
  server-sent events (~800 ms ticks) and push ops via batched POSTs (400 ms flush,
  coalesced `elements:update` patches). Deployable on Vercel serverless *and*
  self-hosted Node — no WebSocket server.
- **Presence**: colored cursors with name tags, remote selection outlines,
  stacked avatars + connection status (Live/Syncing/Offline) in the top bar,
  collaborator list popover with per-user page/selection state, editable display
  name (persisted anonymous identity — no account required).
- **Gap-free reconnection**: clients track `lastSeq`; on stream drop they
  reconnect with `?since=<seq>` and replay missed events; offline edits queue and
  flush on recovery. Local input is never blocked (optimistic, sync in background).
- Ops are small and explicit (`elements:update`, `element:add`, `page:replace`,
  `pages:replace`, …) and apply through the existing store actions, so undo stays
  local and Konva rendering stays fast. Share links now deep-link
  (`/?design=<id>`); unknown ids stay on the landing page.
- Abuse hardening: payloads ≤ 256 KB with recursive type/size/depth validation,
  ≤ 20 events/flush, whitelisted op kinds, presence GC (30 s offline / 24 h rows),
  event log pruned to 500 per design, malformed events dropped (never crash).

### Comments & annotations
- First-class **comments mode**: click the canvas to drop a pin (clicking an
  element anchors the thread to it — the pin follows the element), type and post.
- Threads with **replies, resolve/reopen, delete-own**, collaborator
  avatars/colors, relative timestamps; pins keep their anchor when pages resize
  (coordinates stored as page fractions).
- **Unread badges** on the topbar icon + open/resolved/all filters in the panel.
- Live propagation rides the collab event log (`comment:activity` markers →
  refetch), with optimistic local updates for the author.

### Animations — Magic Animate
- Animation model on the document (`element.animation`, `page.transition`) that
  is **independent from Konva** — pure functions of time
  (`src/lib/animations.ts`), shared by preview playback and video export.
- 9 element animations — fade, rise, pan, pop, wipe, zoom, rotate, breathe —
  with duration, delay, easing (linear/ease/spring), direction and speed presets
  (slow/medium/fast); page transitions none/fade/slide/morph with 0.1–2.5 s
  durations.
- **Magic Animate** — one-click deterministic pass: headings rise, body text
  fades, images pan from their nearest edge, shapes pop, separators wipe,
  transition fades.
- Preview gains animated playback, autoplay presentation mode and a
  reduce-motion accessibility toggle. Static exports (PNG/JPG/PDF/SVG) ignore
  animations entirely.

### SVG export
- True vector serialization of every element type: text (word-wrap measured via
  canvas 2D, per-line tspans, align/letterSpacing/decorations), shapes with
  gradients + rounded corners, paths (scaled from the 100×100 authoring box),
  lines with arrowheads, freehand strokes, images (href allowlist, rounded-clip,
  flips), stickers, groups, shadows (feDropShadow) and page backgrounds.
- **Sanitized by construction**: all text XML-escaped, path data whitelisted,
  image hrefs only `data:`/`https:`, no scripts/events/foreignObject. Multi-page
  exports as one file per page.

### Video export (MP4/WebM)
- A real, fully-local rendering pipeline: design timeline → headless Konva frame
  renderer (element animations + page transitions composited per frame) →
  `canvas.captureStream(0)` + manual `requestFrame()` → **MediaRecorder**.
- **Honest format detection**: MP4 (H.264) where the browser supports encoding
  it, WebM (VP9/VP8) otherwise — the export dialog tells you which and why
  before you start. Real-time pacing keeps duration exact (frames drop to stay
  on schedule); progress bar with frame counter; nothing leaves the browser.
- Verified end-to-end: an ffprobe-clean 1080×1080 H.264 MP4 (2.8 s, ~100 KB).

### AI Assistant 2.0
- The assistant now sees the **live design context** — elements with ids/types/
  positions/styles, selection, colors and fonts in use, page dimensions.
- It answers with **structured `DesignAction`s** (addText, updateElements,
  moveElements, scaleElements, setHeadingsColor, setFont, setBackground,
  align/distribute, addPage, duplicatePage, generateImage, suggestPalette,
  translate, magicAnimate, balanceLayout) instead of just chat.
- **Double validation**: the server clamps every field (hex colors, numeric
  ranges, id existence) and the client re-validates + resolves ids against the
  page before executing. Every action applies as a normal undoable edit, with an
  inline "Undo last change" affordance. Deterministic local fallbacks
  (balanceLayout, palettes) work without any provider.

### AI provider abstraction & fallbacks
- `src/lib/ai/provider.ts` centralizes: config resolution (`ZAI_BASE_URL`/
  `ZAI_API_KEY` env → `.z-ai-config` file → absent), capability probing,
  per-IP sliding-window rate limits on every AI route (429 + Retry-After) and
  `AIUsage` accounting.
- `/api/ai/capabilities` — public, secret-free feature detection; panels show
  "AI provider not configured" states *before* you try a feature, with local
  alternatives (background removal ONNX, deterministic palettes/layout) still
  working. No provider key ever reaches the browser (audited + grep-verified).
- All five v0.4 AI routes refactored onto the abstraction; no behavioral change
  when a provider is present.

### Performance
- **Image downscaling on embed** — uploads > 2048 px longest edge are re-encoded
  (alpha-preserving PNG / JPEG q0.9) before entering the document; 25 MB input
  cap; Magic Layers crops capped at 1024 px.
- Collaboration updates coalesce (consecutive same-id `elements:update` patches
  merge in the queue), remote batches apply as single store writes, presence
  rows and the event log are garbage-collected, and collab cursors render in a
  DOM overlay that never enters Konva's pipeline.
- Fixed an uncached zustand selector that caused an infinite re-render loop in
  the editor (Magic Layers dialog).

### Infrastructure
- Prisma schema gains `DesignEvent`, `Presence`, `Comment` and `AIUsage` models
  (backward compatible — `prisma db push`, no destructive migrations).
- Deep links `/?design=<id>` / `?d=<id>` open the editor directly (invalid ids
  fall back to the landing page).
- Research docs shipped: current-state audit, AI provider audit, fresh Canva
  research, collaboration architecture decision record and a full security
  audit (`research/V05-SECURITY-AUDIT.md`).

## [0.4.0] — 2026-09-03

The Magic Suite release: AI image editing (BG remover, Magic Eraser, Enhance),
Magic Resize with smart re-layout, design translation, live photo search,
PostgreSQL migration and server-side version history. (Full notes in the v0.4
commit message; the feature list also lives in README.md.)

## [0.3.2] — 2026-09-03

Fresh canva.com research pass (fonts, design trends 2026, feature taxonomy) plus the
next tier of editor features: gradient fills, PDF export, a Photos library and AI apps.

### Fonts — 15 → 63 families
- Font library expanded to **63 families** across five categories with Canva-style
  pills + search in the font dropdown: 18 sans, 14 serif, 14 display, 14 handwriting
  and a new **Mono** category (DM Mono, JetBrains Mono, Space Mono).
- New arrivals include Raleway, Lato, Open Sans, Nunito, Quicksand, Rubik, Work Sans,
  DM Sans, Josefin Sans, Barlow, Manrope, Outfit, Figtree, Lora, Merriweather, Libre
  Baskerville, EB Garamond, Cormorant Garamond, DM Serif Display, Prata, Bitter,
  Fraunces, Bodoni Moda, Cinzel, Alfa Slab One, Bungee, Righteous, Ultra, Passion One,
  Monoton, Rye, Titan One, Luckiest Guy, Permanent Marker, Great Vibes, Sacramento,
  Satisfy, Kaushan Script, Alex Brush, Allura, Parisienne, Amatic SC, Shadows Into
  Light, Indie Flower and Kalam.
- All fonts load through one consolidated Google-Fonts stylesheet with subset weights.

### Gradient fills (shapes & text)
- **Linear and radial gradients** on rectangles, ellipses, triangles, stars, paths and
  text — `fillGradient` on `ShapeElement`/`TextElement`, rendered via Konva
  `fillLinearGradient*`/`fillRadialGradient*` with per-shape local coordinate frames.
- The colour menu gains a full **gradient editor**: 12 preset swatches + radial chip,
  Linear/Radial type toggle, 0-360° angle slider, from/to colour pickers, and
  *Remove gradient*. The toolbar swatch previews the live gradient.
- Text effects that own the fill (Hollow, Outline, Neon…) intentionally skip the
  gradient so the effect stays intact; picking any solid colour clears the gradient.

### PDF export
- **Multi-page PDF download** in the export dialog (jsPDF, client-side, no watermark):
  print-ready page-sized PDF, per-page capture at the selected quality, all-pages
  option, automatic landscape/portrait orientation.

### Photos (new side-panel tab)
- **Photos rail tab** with Canva-style panel: search + category chips (Nature,
  Business, People, Food, Travel, Textures, Abstract), hover-to-add grid, broken tiles
  self-hide. Clicking places a 900×514 image element on the canvas.
- Bundled **42-photo stock library** (7 categories × 6) — AI-generated for Canvix,
  license-free, served locally from `public/photos/` (no external requests).

### AI apps (Canva AI parity)
- **Magic Write** app — prompt + copy kind (headline/tagline/body/caption) + tone;
  generates 3 options server-side (`/api/ai/write`, z-ai SDK) and adds any option to
  the canvas as a styled text element.
- **AI image generator** app — prompt + style chips + size (1:1/16:9/9:16/4:3);
  server-side generation (`/api/ai/image`) with preview, *Generate another*, and
  add-to-canvas as an image element.
- Both apps lead the Apps grid, mirroring Canva's AI-first 2026 navigation.

### Templates — Design Trends 2026
- Five new templates from Canva's official 2026 trends (research doc): **Prompt
  Playground** (playful productivity), **Notes App Chic** (raw handwritten notes),
  **Texture Check** (tactile warm gradients), **Opt Out Era** (structured minimalism),
  **Granny Wave** (maximalist heritage remix) — several showcase the new gradient
  fills and new fonts (Fraunces, Cinzel, Kalam, Manrope, Bodoni Moda).

### Guides
- Manual guides are now **per-page** (`ManualGuide.pageId`): each page owns its own
  set, snapping only considers the current page's guides, and *Clear guides* clears
  just the current page.

## [0.3.1] — 2026-09-03

Editor-completeness release: the remaining gap-analysis features — rulers & guides,
image crop, layer renaming, version history — plus correctness fixes found by E2E.

### Rulers & guides
- **Rulers** along the top/left of the workspace (22px strips, DPR-aware canvas ticks,
  adaptive major/minor ladder, pointer-tracking triangles). Toggle via File menu or
  **Shift+R**; fit-to-screen accounts for the ruler inset.
- **Manual guides**: drag out of either ruler to create a `#9954FF` guide; drag a guide
  to reposition, drag it off-page (or double-click) to delete; guides act as snap
  targets for element edges. Right-click the page → **Clear guides (n)**.

### Image crop
- **Crop dialog** (toolbar button, right-click → Crop image): drag handles or draw a
  brand-new region anywhere outside the current one, aspect presets (Free/Original/
  1:1/4:3/3:4/16:9/9:16/3:2/2:3) with locked-ratio drawing, rule-of-thirds overlay,
  live px readout, baked-in flips, `displayScale`-preserving apply via canvas
  re-encoding; JPEG/PNG-aware output.

### Layers
- **Rename layers**: double-click a row (or press Enter on it) — inline edit with the
  purple focus ring; empty name falls back to the auto label. `name` persisted on
  `BaseElement`; groups get a dedicated icon + label.

### Version history
- **File → Version history**: labelled snapshots per design (max 30, ~4.5MB
  localStorage budget with automatic pruning), restore (undo-able — current state is
  pushed to history first), delete, relative timestamps, pages × dimensions meta.
- **Ctrl+Alt+S** saves an instant snapshot.

### Groups (rotation correctness)
- Fixed double-rotation on group transform (children no longer get the group's angle
  baked on top of the group's own rotation).
- Ungrouping a rotated group now **orbits children around the group origin** and
  transfers the rotation, so nothing jumps.

### Apps & panels polish
- App cards and chart rows are now fully clickable tiles (role=button, keyboard
  support) — matching Canva's tile behaviour, not just the inner button.
- Tools → Layers tab reachable via role-based selectors (a11y names verified by E2E).

### Editor
- New shortcuts: **Shift+R** (rulers), **V** (select tool), **Ctrl+Alt+S** (version
  snapshot); shortcut lists in the editor modal and dashboard help modal synced.

### Design system
- Topbar gradient re-weighted purple→magenta dominant (`#02c0cc → #6425f0 → #9333ea →
  #b04fd7`) per VLM visual-QA feedback.

### Technical
- Type-check, ESLint, production build clean.
- E2E suite extended to **40 checkpoints** (rulers, guide pull, clear-guides menu,
  layers panel, version history save, QR→crop pipeline) — zero console errors.
- VLM visual QA: **8.5/10 average** across 13 key surfaces
  (`research/canvix-v03-qa-scores.md`).
- `.gitignore`: root `research/*.md` curated docs are now committed by exception.

## [0.3.0] — 2026-09-03

Deep visual-parity release informed by a fresh live audit of canva.com (logged-in,
stealth browser, computed-style + pixel-sampling extraction). Research artifacts:
`research/CANVA-V03-RESEARCH.md`, `research/CANVIX-V03-GAP-ANALYSIS.md`.

### Editor
- **Selection chrome re-skinned to measured values**: border + anchors now `#7630D7`
  with white circular handles, 2px border, 45° rotation snapping.
- **Alignment guides**: `#9954FF`, 2px.
- **Groups**: new `group` element type; Ctrl+G / Ctrl+Shift+G; children move/scale
  together and ungroup restores page positions.
- **Marquee (box) selection** on empty canvas; space+drag / middle-mouse panning;
  Ctrl+A select all.
- **Right-click context menus** (element & page): copy/cut/paste/duplicate, layer
  ordering, group, lock, hide, delete, page ops — 244px menu, 32px items, r10.
- **Context toolbar moved into the topbar** (Canva behaviour) with 32px / r10 buttons;
  mobile gets a bottom contextual action bar.
- **Zoom dropdown**: 300%→10% presets + Fit + Fill (128px listbox, 40px items),
  plus store-level `fitToScreen()`.
- New shortcuts: Ctrl+G/Shift+G (group), Ctrl+A, Ctrl+L (lock), `]`/`[` (layers).

### Text
- **10 text effects** (Drop, Lift, Glow, Hollow, Outline, Background, Splice, Neon,
  Echo, None) in a 3-column grid with live "Ag" previews.
- **FontDropdown**: search, category pills, live font previews, favourites star.
- Full toolbar: size stepper, colour, B/I/U/S, Uppercase, alignment, spacing
  (letter/line sliders), transparency slider.
- `uppercase` + `justify` model fields.

### Colour
- **Canva-style ColorMenu**: header + hex search, spectrum/eyedropper/current quick row,
  Brand Kit swatches, 4×7 default solids, gradient rows (background context).

### Panels
- **Position popover**: 2×2 arrange tiles, 6 align-to-page tiles, W/H/X/Y/Rotate with
  ratio lock.
- **Templates panel**: search, category chips, recommended section, skeletons, preview
  modal, one-click apply.
- **Brand kit 2.0**: palettes, logo uploads, “apply brand style to page”
  (nearest-colour remap + brand font swap).
- **Elements panel**: search, polygons, 11 new graphics, grouped categories.
- **Uploads panel**: replace-mode when an image is selected, set-image-as-background,
  empty state; drag-and-drop images onto canvas.

### Apps
- **Registry-driven apps ecosystem** (`apps/registry.tsx`): Charts (bar/line/donut),
  QR generator (colour + size + add to canvas), Icons (colourable), Colour palette
  generator (analogous/complementary/triad/monochrome), Placeholder text
  (lorem/real-feel), Stickers.

### Dashboard
- Account avatar menu, Help & shortcuts modal (via Get-help FAB), skeleton loading
  for recent designs, toast notifications.

### Design system
- New tokens: `--cv-selection #7630D7`, `--cv-guide #9954FF`, `--cv-menu`, slider fill.
- New shared classes: `cv-menu`, `cv-menu-item`, `cv-tbtn`, `cv-pop`, `cv-slider`,
  `cv-tip`, `cv-swatch`, `cv-skeleton`, `cv-toast`.
- Dialogs: 28px radius. Rail tooltips with 600ms delay. Focus-visible rings.

### Media
- Image adjustments (brightness/contrast/saturation via Konva filters), horizontal &
  vertical flips, `replaceSelectedImage`, `addImageAt`, `readImageFile` helpers.

### Technical
- `qrcode` dependency added.
- Type-check, ESLint and production build clean; full E2E pass (29 checkpoints,
  zero console errors); VLM visual parity 8.5–9/10 across key surfaces.

## [0.2.0] — 2026-08-31

Canva-accurate dark re-skin from live-site research: gradient topbar, 8-tab rail,
text effects (5), freehand draw, brand kit, charts, preview, share, resize,
Canva-style dashboard & mobile polish.

## [0.1.0] — 2026-08-30

Initial release: Konva.js editor (text/shapes/lines/graphics/stickers/images),
smart snapping, layers, templates, dashboard, autosave, PNG/JPG export,
responsive mobile/tablet/desktop UI.
