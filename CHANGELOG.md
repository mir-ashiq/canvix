# Changelog

All notable changes to Canvix will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
- **Protocol E2E** (`scripts/mcp-e2e.sh`): 37 assertions — initialize handshake,
  202 notifications, tools/list (20), auth (401), GET 405, unknown method/tool,
  full create → style → add (text/shape/table/embed) → update (curve) →
  animate → get → comment → export (svg/png/json) → delete flow, batch, parse
  errors, AI generation — **37/37 passing**.

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
