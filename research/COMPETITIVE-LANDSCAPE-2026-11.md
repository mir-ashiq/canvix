# Canvix competitive landscape — the full-field audit (November 2026)

> **TL;DR** — Nine repos were audited feature-by-feature against Canvix
> (v0.16.5). On **engineering depth Canvix is #1 in the field**: no
> competitor has GIF export, a WebCodecs muxer, vector-text PDF, a
> sandboxed plugin system, an admin console, or Canvix's test/security
> posture. But Canvix is **behind on five fronts**: content-library
> breadth (20 graphics + 84 emoji vs Doory's ~27,500 icons), the entire
> audio/sound story, presentation mode (no speaker notes / presenter
> view), enterprise auth & teams (password-only, no SSO/2FA/workspaces),
> and AI-video generation. The union of all nine repos yields **~46
> missing feature areas**; this document is the master checklist and the
> absorption plan, phased into six waves.

---

## 1. The field at a glance

Stars are snapshots of 2026-11-09. "Velocity" is stars/day over the
repo's lifetime — a rough traction signal, not a quality signal.

| Repo | ⭐ | Age | Velocity | License | Stack | One-liner |
| --- | --- | --- | --- | --- | --- | --- |
| **11cafe/jaaz** | 6,730 | 17 mo | ~13/d, **stalled** | NOASSERTION (dual) | React/Vite + Python server, desktop | Multimodal creative *agent* — "Canva + Manus" substitute, local-first, ComfyUI |
| **shaongitbd/doory** | 2,564 | **4 weeks** | **~85/d** | AAL (attribution) | React 19 + Fabric.js + Yjs / Django 5 + Channels + PG | Complete browser Canva clone, print-grade exports |
| **fancyboi999/Loomic** | 310 | 7.5 mo | ~1.4/d, stalled 6 wk | MIT | Next.js 15 + Fastify + LangGraph + Supabase + Excalidraw | Chat-driven AI canvas agent — Lovart/CapCut alternative |
| **hyscaler/HyCanvas** | 276 | 4.5 mo | ~1.8/d | AGPL-3.0 + CLA | Next.js + one Go binary + PG | Five document types: graphics, slides, video, whiteboards, docs & sheets |
| **clawnify/OpenDesign** | 126 | 7 mo | ~0.6/d | MIT | Preact + Fabric.js + Hono + SQLite | SaaS-embeddable editor, template fields + fill API |
| **sanidhyy/canva-clone** | 106 | 25 mo | ~0.1/d | MIT | Next.js + Drizzle + Neon + Auth.js | Tutorial-grade clone (Stripe, Unsplash, UploadThing) |
| **striker561/Avnac-Studio** | 78 | 6.5 mo | ~0.4/d | GPL-3.0 | Wails v2 + Go + Saraswati Canvas2D | Native desktop port, MCP-first (27 tools) |
| **TheOrcDev/orcanva** | 75 | **10 days** | ~7.5/d | MIT | **Next.js 16 + Konva 10** (Canvix's stack) | YouTube-thumbnails niche, 40 fonts, live collab |
| **ashmoonori-afk/BurnGuard** | 34 | 6.5 mo | ~0.2/d | Apache-2.0 | Desktop (Win/macOS), Claude Code/Codex-driven | Local design workspace wired to your coding agent |
| **(us) mir-ashiq/canvix** | 180 | 2.2 mo | ~2.6/d | MIT | Next.js 16 + React 19 + Konva + Prisma + PG | Free-forever Canva alternative, export-depth + plugins + admin |

**Three reads of the table:**

1. **Doory is the event of the season.** 2.6k stars in four weeks is a
   Hacker-News-grade launch. It is a *complete* product (editor,
   animations, sound, presenter mode, print PDFs, SSO, MCP) built by a
   Django shop with real velocity. It is Canvix's most direct rival for
   the "self-hosted Canva" crown.
2. **The star leaders are stalling.** jaaz (6.7k) hasn't been pushed
   since March 2026; Loomic since September. Their ideas — magic canvas,
   chat-driven generation, video models — are absorbable without their
   baggage.
3. **orcanva runs Canvix's exact stack** (Next.js 16 + Konva 10) and is
   10 days old with a fast niche wedge (thumbnails). Direct overlap;
   watch it.

---

## 2. Repo-by-repo: what they are, what they have, what to take

### 2.1 shaongitbd/doory — the complete clone (threat: HIGH)

React 19/Vite/Fabric.js/Yjs/Zustand frontend; Django 5/DRF/Channels/
PostgreSQL backend; Docker Compose. ~2,280 files, real test suites on
both sides. **The only repo whose editor feature surface beats Canvix's
in breadth.** What it has that Canvix lacks:

- **Content library**: ~27,500 icons/emoji/illustrations + stickers +
  QR codes, open-licensed font catalogue **+ your own fonts**
- **Audio**: 24 bundled CC0 music loops + 88 CC0 sound effects,
  **Freesound search** (free API key), **voiceover recording**
- **Motion**: 27 enter/exit + 12 emphasis animations, 16 page
  transitions (Canvix: 8 + 4), animation SFX
- **Present mode**: speaker notes, timing, auto-advance, **second
  presenter window** (`presenter-view.html` + full state machine)
- **Photo depth**: masks, 2×–4× **pure-code upscaling** (Web Worker
  resampler — works offline), Unsplash *or* Pexels stock search
- **Export**: MP4 (Canvix parity), print PDFs with **bleed and crop
  marks**; optional **server-side export**
- **Platform**: Google sign-in, **OIDC SSO**, email, S3 storage,
  high-contrast accessibility mode, password-protected share links with
  view/comment/**edit permission levels**, pinned comments
- **Template engine**: `fill_design` / `bulk_fill` by field key (MCP +
  REST, per-row rate budgets) — same idea as OpenDesign's fields

What it lacks that Canvix has: GIF export, WebCodecs, vector-text PDF,
plugins, admin analytics, stock *video*, beat sync, offline merge
(uses stock Yjs — fine, but no offline doc queue), zero-dep discipline
(Django pulls the world). License (AAL) requires prominent in-app
credit — a mild repellent for adopters, an advantage for us.

### 2.2 hyscaler/HyCanvas — the breadth play (threat: HIGH, different axis)

Next.js + **one Go binary** (API + realtime + export) + PG; 140
templates; weekly releases; proper docs site; AGPL-3.0 + CLA + paid
commercial dual-license. Its wedge is **document types**, not editor
depth:

- **Presentations**: slide layouts & themes, Magic Move transition,
  presenter view, **live audience polls and Q&A**, **PPTX in and out**
- **Whiteboards**: sticky notes, connectors, workshop templates,
  **shared timer, dot voting**, board→deck conversion
- **Docs & sheets**: block editor with DOCX/PDF export, spreadsheets
  with a **formula engine**
- **Video**: multi-track timeline, keyframes, captions (SRT/VTT),
  green-screen keying, **screen + webcam recording**
- **Brand**: brand kits incl. **brand voice** + **brand lock** (warns
  or blocks off-brand edits)
- **Enterprise**: workspaces with roles, **OIDC SSO, TOTP 2FA**,
  encrypted per-workspace AI keys (13 provider presets), scoped API
  keys + OpenAPI docs
- **Export**: PPTX, **APNG, Lottie**, portable `.hyc` JSON design file
- 9 chart types (Canvix: 4)

Its AGPL+CLA is a contributor repellent and its Go/Next split is a
heavier ops story than ours. But its breadth sets the ceiling for what
"an open-source Canva alternative" is expected to include.

### 2.3 fancyboi999/Loomic — the AI-agent canvas (threat: MEDIUM, stalled)

Fastify 5 + **LangGraph agent** + Supabase + PGMQ job queue + workers;
Excalidraw infinite canvas; LemonSqueezy credits. No timeline, no
templates — "just talk". The parts worth absorbing:

- **Chat-driven generation on canvas**: multi-turn refinement, agent
  sees canvas context ("make the left one warmer")
- **Model catalog**: 15+ image models (Imagen 4, GPT Image, Flux
  Kontext, SDXL, Recraft, Seedream…) and **video models (Veo 3.1,
  Kling V3, Sora 2, Seedance, Wan, Hailuo)** via Replicate/Vertex
- Brand kit honored during generation; credits/billing; Markdown
  "skills" for per-project agent behavior

### 2.4 11cafe/jaaz — the star champion, now dormant (threat: LOW, ideas HIGH)

6.7k stars, desktop app (Win/macOS), Python server, local-first with
ComfyUI + cloud APIs. Dormant since 2026-03. Ideas worth absorbing:
**magic canvas** (sketch/annotate → AI generates, no prompting),
storyboarding, **multi-character coherence** across generations, local
model support (Ollama/ComfyUI), built-in prompt & media library.

### 2.5 clawnify/OpenDesign — the embeddable template engine (threat: LOW)

Preact + Fabric.js + Hono + SQLite; tiny, focused, MIT. Two genuinely
good patterns: **template fields** (name any text/image object, fill
from API/agent — one field drives many objects/pages) and **agent-mode
UI** (`?agent=true`: always-visible buttons, large targets, semantic
labels for browser automation). Both are cheap to adopt and compound
with our MCP surface.

### 2.6 sanidhyy/canva-clone — the tutorial clone (threat: NONE)

CodeWithAntonio-lineage Next.js app: Drizzle/Neon, Auth.js (GitHub +
Google OAuth), Unsplash, UploadThing, **user-supplied AI keys in an
encrypted cookie**, Stripe subscriptions. Nothing to absorb except
 confirming that OAuth and per-user AI keys are table stakes in this
category.

### 2.7 TheOrcDev/orcanva — the same-stack niche player (threat: MEDIUM, watch)

Created 2026-10-30, already 75⭐. Next.js 16 + React 19 + **Konva 10** +
Drizzle + Neon Realtime. Thumbnails/social niche. Has: 40 fonts,
"thousands of icons, emoji and stickers", bg removal, object erase,
**upscale**, live collab, comments, version history, **WebP export**.
A direct stack twin — whatever it ships, we can ship, and vice versa.

### 2.8 striker561/Avnac-Studio — MCP-first desktop (threat: LOW, patterns HIGH)

Wails v2 + Go; custom **Saraswati** scene engine (command-reducer
architecture — academically interesting, our Konva + pure geometry
modules achieve the same testability); no backend process; native
storage. **Best-in-field MCP story**: 27 tools, streamable HTTP + SSE,
OS-keyring bearer token, and — the killer pattern —
**`get_canvas_image`: the agent screenshots its own work to
self-verify**, plus ready-made MCP *prompts* (design-graphic,
edit-canvas, design-audit). Also: vector boards (nested editable
drawing areas), MCP-driven layout tools.

### 2.9 ashmoonori-afk/BurnGuard — agent-driven design systems (threat: LOW, ideas HIGH)

Local desktop workspace that **drives Claude Code/Codex CLIs** to
produce websites/decks/graphics/logos. Daily releases. Absorbable
ideas: **design systems as first-class citizens** (43 themes, 60
Do/Don't rules injected into every generation), direction previews,
**quality/UX audit panels** (contrast, layout, links — advisory),
**print check** (flags <300 ppi at print size), 8 chart kinds incl.
Sankey, 3D objects panel, i18n UI (en/ko/zh), reference-file
attachments, project instructions (4 KB standing notes per project).

---

## 3. The master feature matrix

✓ shipped · ◐ partial/different scope · ✗ missing. Repos: CVX=Canvix,
Doo=Doory, HyC=HyCanvas, Loo=Loomic, Jz=jaaz, OD=OpenDesign,
Orc=orcanva, Avn=Avnac, BG=BurnGuard, CC=canva-clone.

### 3.1 Editor fundamentals

| Feature | CVX | Doo | HyC | Loo | Jz | OD | Orc | Avn | BG | CC |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Shapes/lines/arrows | ✓ | ✓ | ✓ | ◐ | ◐ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Rich text (per-range) | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Curved text | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Text effects/presets | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ◐ | ◐ | ✗ |
| **Text lists (ul/ol)** | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Layers/groups/reorder | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ✓ |
| Rulers/guides/snapping | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Crop | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ | ◐ | ✓ |
| **Image masks (shape)** | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Multi-page | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | ✗ |
| Magic Resize | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ◐ | ✗ | ✗ |
| Tables | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Frames | ✓ | ◐ | ✓ | ✗ | ✗ | ✗ | ✗ | ◐ | ◐ | ✗ |
| Charts | ◐4 | ✗ | ✓9 | ✗ | ✗ | ✗ | ✗ | ✗ | ✓8 | ✗ |
| Draw/freehand | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | ◐ | ✗ | ✗ |
| QR codes | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Align/distribute | ✓ | ✓ | ✓ | ◐ | ◐ | ◐ | ✓ | ✓ | ◐ | ◐ |
| Undo/redo (O(1)) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

### 3.2 Content libraries

| Library | CVX | Doo | HyC | Loo | Jz | OD | Orc | Avn | BG | CC |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Templates | ✓110 | ✓10 | ✓140 | ✗ | ◐ | ✓6 | ✓ | ✗ | ✓43 sys | ◐ |
| Icons/illustrations | ◐20 | ✓27.5k | ✓ | ✗ | ◐ | ✗ | ✓k's | ✓ | ◐ | ✗ |
| Emoji/stickers | ◐84 | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ |
| Stock photos | ✓P+Px | ✓U/P | ◐ | ✗ | ✗ | ✗ | ◐U | ✓U | ✗ | ✓U |
| Stock videos | ✓P+Px | ✗ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Stock audio (search)** | ✗ | ✓Fsnd | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Bundled CC0 music/SFX** | ✗ | ✓112 | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Fonts | ✓63 | ✓+upload | ✓+upload | ◐ | ◐ | ✓10+upload | ✓40 | ✓G | ✓72 | ◐ |
| **Custom font upload** | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ |
| Font pairing presets | ✗ | ✓ | ✓ | ✗ | ✗ | ◐ | ✗ | ✗ | ✓ | ✗ |

### 3.3 AI

| Capability | CVX | Doo | HyC | Loo | Jz | OD | Orc | Avn | BG | CC |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AI image generation | ✓ | ◐ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ |
| AI image editing | ✓ | ◐ | ✓ | ✓ | ✓ | ✗ | ◐ | ✗ | ✓ | ✓ |
| Background removal (local) | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ |
| Object erase | ✓ | ✗ | ◐ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| Magic Write / copy AI | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ◐ |
| Translate | ✓ | ✗ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Vision (Magic Layers) | ✓ | ✗ | ◐ | ✗ | ◐ | ✗ | ✗ | ✗ | ◐ | ✗ |
| Chat assistant w/ design actions | ✓ | ✗ | ◐ | ✓ | ✓ | ✗ | ✗ | ◐ | ✓ | ✗ |
| **Multi-provider BYO keys** | ✓ | ◐ | ✓13 | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ |
| **Video generation** | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Image model catalog (15+)** | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Local models (ComfyUI/Ollama)** | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Upscaler (offline, pure-code)** | ✗ | ✓ | ◐ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| Layout suggestions (local) | ✓ | ✗ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ | ✗ |
| Color palette (local) | ✓ | ◐ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Design-system/rules for AI** | ✗ | ✗ | ✗ | ◐ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |

### 3.4 Collaboration & sharing

| Feature | CVX | Doo | HyC | Loo | Jz | OD | Orc | Avn | BG | CC |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Real-time co-editing | ✓ | ✓Yjs | ✓ | ◐ | ✓ | ✗ | ✓Neon | ✗ | ✗ | ✗ |
| Presence + cursors | ✓ | ✓ | ✓ | ◐ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| Offline merge queue | ✓ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Comments | ✓ | ✓pinned | ✓+mentions | ✗ | ✗ | ✗ | ✓ | ✗ | ✓pins | ✗ |
| Version history | ✓ | ✓ | ✓+approvals | ◐ | ◐ | ✗ | ✓ | ✗ | ✓thumbs | ◐ |
| Share links (view/edit) | ✓ | ✓v/c/e | ✓v/c/e | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Password-protected links** | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Guest/anonymous editing | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Per-design ownership | ✓ | ✓ | ✓wksp | ◐ | ◐ | ✗ | ◐ | ✗ | ✓ | ✓ |

### 3.5 Presentation, video & audio

| Feature | CVX | Doo | HyC | Loo | Jz | OD | Orc | Avn | BG | CC |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Element animations | ◐8 | ✓39 | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ | ✗ |
| Page transitions | ◐4 | ✓16 | ✓+MagicMove | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Present mode | ◐auto | ✓full | ✓presenter | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| **Speaker notes** | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| **Second presenter window** | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Auto-advance/timing | ◐ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Audience polls & Q&A** | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Audio elements | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Beat sync | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Voiceover recording** | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Video timeline (multi-track) | ✗ | ✗ | ✓ | ✗ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Captions (SRT/VTT) | ✗ | ✗ | ✓ | ✗ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Green-screen keying | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Screen/webcam recording | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

### 3.6 Export

| Format/feature | CVX | Doo | HyC | Loo | Jz | OD | Orc | Avn | BG | CC |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PNG/JPG | ✓ | ✓ | ✓ | ✓ | ✓ | ✓2x | ✓ | ✓ | ✓ | ✓ |
| **WebP** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| SVG (editable) | ✓ | ✓ | ✓ | ◐ | ◐ | ✗ | ✗ | ✗ | ◐ | ✗ |
| **PDF w/ vector text** | ✓ | ◐ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Print bleed + crop marks** | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| MP4/WebM video | ✓2 engines | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **GIF (hand-rolled LZW)** | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| APNG / Lottie | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| PPTX (in/out) | ✗ | ✗ | ✓ | ✗ | ◐ | ✗ | ✗ | ✗ | ✓out | ✗ |
| DOCX | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓in | ✗ |
| **Portable design file** | ✗ | ✗ | ✓.hyc | ✗ | ✗ | ✗ | ✗ | ✓JSON | ✓proj | ✗ |
| Server-side export | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Website/HTML export | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |

### 3.7 Platform & ops

| Feature | CVX | Doo | HyC | Loo | Jz | OD | Orc | Avn | BG | CC |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Accounts | ✓pw | ✓+OAuth+OIDC | ✓+OIDC+TOTP | ✓ | ✓ | ✗ | ◐ | ✗ | local | ✓OAuth |
| **2FA (TOTP)** | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Team workspaces/roles** | ✗ | ✗ | ✓ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Folders | ✓ | ✗ | ✓ | ✓ | ◐ | ✗ | ◐ | ✓ | ✓ | ✓ |
| Uploads library + quota | ✓ | ◐ | ✓ | ◐ | ✓ | ◐ | ◐ | ✓ | ✓ | ✓UT |
| S3 storage option | ✗db | ✓ | ✓ | ✓ | ✗ | ◐R2 | ✗ | ✗ | ✗ | ✓UT |
| Admin console | ✓deep | ✓Django | ◐keys | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Traffic/usage analytics | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| MCP server | ✓20 | ✓ | ✓7 | ✗ | ✗ | ✗ | ✗ | ✓27 | ◐ | ✗ |
| **Agent self-verify (screenshot)** | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| Plugins/extensions | ✓sandbox | ✗ | ✗ | ◐skills | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Observability/logging | ✓ | ◐ | ◐ | ◐ | ✗ | ✗ | ✗ | ✗ | ◐ | ✗ |
| Rate limiting/security | ✓deep | ◐ | ◐ | ◐ | ✗ | ✗ | ◐ | ✗ | ✗ | ✗ |
| Docker/self-host | ✓multi | ✓ | ✓ | ✓ | ◐ | ✓ | ◐ | n/a | n/a | ✗ |
| Desktop app | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ |
| Mobile/touch editor | ◐resp | ◐ | ◐ | ◐ | ◐ | ✗ | ◐ | ✗ | ✗ | ✗ |
| **Accessibility mode** | ✗ | ✓ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **i18n UI** | ✗ | ✗ | ✗ | ✗ | ◐zh | ✗ | ✗ | ✗ | ✓3 | ✗ |
| Light/dark themes | dark | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Credits/billing | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |

---

## 4. The verdict: how behind is Canvix?

**Category scores (0–5), audited against source code, not marketing:**

| Category | CVX | Doo | HyC | Loo | Jz | OD | Orc | Avn | BG | CC |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Core editor | 4.5 | 4.5 | 4.0 | 2.0 | 2.5 | 2.5 | 3.0 | 3.0 | 3.0 | 2.5 |
| Content libraries | **1.5** | 5.0 | 4.0 | 1.0 | 2.0 | 1.5 | 3.5 | 3.0 | 3.5 | 1.5 |
| Export engines | **5.0** | 4.5 | 4.5 | 2.0 | 2.5 | 2.0 | 2.5 | 2.0 | 3.0 | 2.0 |
| Collaboration | **4.5** | 4.5 | 4.5 | 2.5 | 3.0 | 0.5 | 3.0 | 0.5 | 1.0 | 1.5 |
| Presentation story | **2.0** | 4.0 | 5.0 | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 | 2.5 | 0.5 |
| Audio & video | 3.0 | 4.0 | 4.5 | 1.0 | 2.0 | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 |
| AI surface | 3.5 | 2.5 | 3.5 | **5.0** | 4.5 | 0.5 | 1.5 | 1.0 | 4.0 | 2.0 |
| Platform/enterprise | 3.0 | 4.0 | **4.5** | 3.0 | 2.0 | 1.0 | 2.0 | 1.0 | 1.0 | 2.5 |
| Extensibility (plugins/MCP/API) | **5.0** | 3.5 | 3.5 | 2.5 | 0.5 | 3.0 | 0.5 | 4.0 | 1.5 | 0.5 |
| Engineering discipline (tests/security/docs) | **5.0** | 4.5 | 4.0 | 3.0 | 1.5 | 3.0 | 2.0 | 3.0 | 3.0 | 1.5 |
| **Weighted overall** | **3.8** | **3.9** | **3.9** | 2.5 | 2.6 | 1.7 | 2.1 | 2.1 | 2.5 | 1.7 |

**The honest answer: Canvix is not "behind" — it is #1 in depth and #3
in overall breadth, within ~0.1 of Doory and HyCanvas, which win on
different axes.** Canvix's core editor, export stack, collaboration
core and extensibility are unmatched. What separates Canvix from
"obvious best in field" is concentrated in **five clusters**:

1. **Content poverty** (worst gap, cheapest to fix): 20 graphics +
   84 emoji vs Doory's 27,500 icons/illustrations; no bundled audio;
   no custom fonts; no font pairings. Users judge a design tool by its
   libraries first.
2. **No presentation story**: no speaker notes, no presenter view, no
   themes, no PPTX. Doory and HyCanvas both treat "present" as a
   first-class mode.
3. **No sound**: zero audio library, no Freesound, no voiceover —
   while Canvix's beat-sync engine (unique!) has nothing to sync to.
4. **Enterprise wall**: password-only auth, no SSO/OIDC/2FA, no team
   workspaces, brand kit stuck in localStorage (not account-synced).
   This is what blocks self-hosted adoption by companies.
5. **AI-video gap + model catalog**: Loomic/jaaz generate *video* and
   offer 15+ image models; Canvix generates images through one
   provider slot. (Note: the operator's own VibesAI-openai proxy
   already serves `/v1/videos/generations` — dogfooding opportunity.)

Secondary gaps (matter, fix opportunistically): masks, text lists,
upscale-offline, WebP, bleed/crop marks, more charts, share-link
passwords + comment scope, comment mentions, approvals, portable
design file, light theme + high-contrast, i18n, S3 option,
agent-verified MCP screenshot loop, quality/print-check panels.

**What Canvix has that nobody else has** (protect and market these):
GIF export with a hand-rolled LZW encoder; WebCodecs + hand-rolled
WebM muxer with deterministic pacing; vector-text PDF with font
subsetting; moving-video-in-export; the sandboxed plugin system with
security regression suites; the admin console with traffic analytics
and per-slot multi-provider AI config; offline merge with persisted
op-queues; beat sync; stock video with durable attribution;
zero-new-dependency discipline with 1,100+ unit tests.

---

## 5. The absorption plan — every feature, six waves

House rules apply throughout: zero new dependencies where feasible
(hand-rolled codecs/muxers precedent), provider-gated AI (F2b: no key
= hidden, never broken), local-first features, tests + decision
records per feature, additive migrations. Effort: **S** ≤ 2 days,
**M** ≤ 1 week, **L** multi-week (slice it).

### Wave 1 — Content & polish quick wins (closes the worst gap first)

| # | Feature | Source | Effort | Notes |
| --- | --- | --- | --- | --- |
| 1.1 | Icon/illustration library — bundle MIT/Apache sets (Lucide, Tabler, Bootstrap Icons, Heroicons, Material Symbols, Simple Icons for brands) with category search + license table | Doo | M | SVG→path pipeline into GRAPHICS; 5k–20k icons achievable, license-safe |
| 1.2 | Emoji picker — full Unicode set as text/sticker elements | Doo/Orc | S | extends STICKER_GROUPS; native rendering, zero assets |
| 1.3 | WebP export | Orc | S | canvas.toBlob('image/webp'); quality slider |
| 1.4 | Print PDF bleed + crop marks options | Doo | S | rides the vector-PDF engine; PDF/X-style marks |
| 1.5 | Offline upscaler 2×/4× — pure-code Lanczos/multi-step resampler in a Worker | Doo/Orc | M | zero-dep, works without provider; complements AI enhance |
| 1.6 | Rich-text lists (ul/ol) | Doo/HyC | M | extends spans model + shared geometry |
| 1.7 | Custom font upload (TTF/OTF/WOFF/WOFF2, ≤10 MB, license checkbox) + account-synced | Doo/OD/BG | M | uploads rail + font-store service; PDF export needs the subsetter to accept user fonts |
| 1.8 | Font pairing presets | Doo/HyC/BG | S | curated pairs in Text panel |
| 1.9 | Unsplash as third stock-photo connector | Doo/CC/Avn | S | same connector pattern as Pexels/Pixabay |
| 1.10 | Chart kinds: area, pie, radar, stacked bar (+Sankey later) | HyC/BG | M | extend chart-geometry (one pure module drives all renderers) |
| 1.11 | Share links: comment-only scope + optional password | Doo | M | token-hash column, scope enum, gate in design rail |
| 1.12 | Brand kit → account-synced (DB) + brand voice field | HyC | S/M | currently localStorage; migrate on login-claim pattern |

### Wave 2 — The presentation story

| # | Feature | Source | Effort | Notes |
| --- | --- | --- | --- | --- |
| 2.1 | Speaker notes per page (schema, panel, presenter) | Doo/HyC | S | page.notes + textarea in PageBar popover |
| 2.2 | Presenter view — fullscreen stage, timer, auto-advance, keyboard remote, notes; **second window via BroadcastChannel** | Doo | M | Doory's presenter-view.html pattern; reuse PreviewOverlay renderer |
| 2.3 | Slide themes — design-level typography/palette tokens, one-click switch | HyC | M | theme = token set; apply like apply-brand-style |
| 2.4 | PPTX export + import | HyC/BG | L | decision point: hand-rolled minimal OOXML writer (WebM-muxer precedent) vs pptxgenjs dep; import subset (text/shapes/images) first |
| 2.5 | More animations (39+) & transitions (16+) incl. emphasis | Doo | M | extend animations.ts; pure CSS/keyframe definitions |
| 2.6 | Audience polls & Q&A | HyC | L | defer to Wave 6/plugin; needs realtime + moderation design |

### Wave 3 — Sound (feed the beat-sync moat)

| # | Feature | Source | Effort | Notes |
| --- | --- | --- | --- | --- |
| 3.1 | Curated CC0 sound library (music loops + SFX) with license manifest | Doo | M | bundle only verifiable-CC0; manifest + THIRD_PARTY notice |
| 3.2 | Freesound search connector (free key, CC0 default filter) | Doo | M | stock-connector pattern #4; attribution like photos/videos |
| 3.3 | Voiceover recording (MediaRecorder → chunked uploads rail) | Doo | M | reuse audio element + media store |
| 3.4 | Animation SFX + page-transition audio | Doo | S | once 3.1 lands |

### Wave 4 — Enterprise platform

| # | Feature | Source | Effort | Notes |
| --- | --- | --- | --- | --- |
| 4.1 | OAuth (Google + GitHub) | Doo/CC | M | hand-rolled OAuth2 code flow (zero-dep is feasible) behind env flags |
| 4.2 | OIDC SSO for self-hosters | Doo/HyC | M | discovery + PKCE; enterprise adoption key |
| 4.3 | TOTP 2FA | HyC | M | RFC 6238 via WebCrypto + otpauth URI + QR (we already render QRs) |
| 4.4 | Team workspaces + roles (owner/editor/viewer) | HyC | L | schema migration (Workspace, Membership); designs gain workspace scope; folders move under workspaces |
| 4.5 | Comment @mentions + notification surface | HyC | M | username resolution + badge in dashboard |
| 4.6 | S3-compatible media storage option (env-gated; DB bytea stays default) | Doo/HyC | M | storage adapter interface over the media store |
| 4.7 | Email (SMTP) module — optional | Doo | M | invites, shares, 2FA codes |
| 4.8 | Approvals on share links (review statuses) | HyC | S | comment/status model extension |

### Wave 5 — AI-native leapfrog (the Loomic/jaaz answer, on our rails)

| # | Feature | Source | Effort | Notes |
| --- | --- | --- | --- | --- |
| 5.1 | Provider preset catalog in admin (Gemini/Groq/OpenRouter/CF Workers AI/Z.ai/NVIDIA + any OpenAI-compatible endpoint) | Loo/CC | S | extends A2 multi-provider table with curated presets |
| 5.2 | Video generation connector (provider-gated; **dogfood VibesAI-openai `/v1/videos/generations`**) | Loo/Jz | M/L | new AI slot kind `video-gen`; inserts as video element through media rail |
| 5.3 | Assistant canvas-context upgrade: streaming replies, selection/page awareness, full DesignAction surface in a docked chat | Loo/BG | M | builds on Assistant 2.0; add screenshot-to-vision for grounding (optional, provider-gated) |
| 5.4 | Template fields + bulk fill (named fields on text/image; fill API + CSV/XLSX bulk + MCP `fill_design`/`bulk_fill`) | Doo/OD | M/L | the OpenDesign pattern; compounds with MCP + plugins |
| 5.5 | Agent self-verify loop: MCP `get_canvas_image` (rasterize page server-… no — client-side snapshot endpoint or export API) + design-audit prompt recipes | Avn | M | export API already renders pages; expose to MCP |
| 5.6 | Image model catalog per request (model picker in Image AI panel when provider exposes multiple) | Loo | S/M | rides 5.1 |
| 5.7 | Local-model support (Ollama/ComfyUI endpoints) | Jz | M | any OpenAI-compatible base URL already works; document + presets |
| 5.8 | Design rules / "keep as rule" for AI turns (project instructions ≤4 KB) | BG | S | design-level notes injected into Assistant/MCP context |
| 5.9 | Quality/UX audit panel + print check (contrast, link, layout, ppi warnings) | BG | M | advisory checks; pure functions + panel UI |

### Wave 6 — Document modes & strategic bets (evaluate, then slice)

| # | Feature | Source | Effort | Notes |
| --- | --- | --- | --- | --- |
| 6.1 | Whiteboard mode — sticky notes, connectors, timer, dot voting, workshop templates, board→deck | HyC | L | pages already support free size; connectors + stickies are the core lift |
| 6.2 | Captions: SRT/VTT import → caption elements + burn-in for video export | HyC | M | parser + timed text element riding video export scheduler |
| 6.3 | Green-screen keying (WebGL shader filter) | HyC | M | extends image-filters pipeline |
| 6.4 | Screen + webcam recording → media rail | HyC | M | getDisplayMedia/getUserMedia + chunked store |
| 6.5 | Multi-track video timeline | HyC | L | the biggest single lift; evaluate against "video pages" identity |
| 6.6 | Docs mode (block editor) + DOCX export | HyC | L | evaluate as plugin first |
| 6.7 | Portable `.canvix` design file export/import | HyC/Avn/BG | S | design JSON + inlined media manifest; import through hostile-input gauntlet |
| 6.8 | Light theme + high-contrast accessibility mode | Doo | M | design-token split; respect prefers-contrast |
| 6.9 | i18n framework + community translations (zh/es/hi/ko first) | BG/Jz | M | string extraction; community-sourced dictionaries |
| 6.10 | MP4-everywhere export (moov muxer decision point — already on record) | field | L | hand-rolled vs mux.js dependency decision |
| 6.11 | APNG / Lottie export | HyC | S/M | APNG rides GIF encoder ideas; Lottie needs a schema mapping |
| 6.12 | Desktop wrapper (Tauri) | Avn/BG/Jz | L | optional distribution channel, not core |
| 6.13 | Infinite-canvas AI board mode | Loo/Jz | L | strategic decision: new surface vs plugin; defer until 5.x proves chat-canvas |

### Explicit non-goals (recorded so we stop relitigating)

- **Payments/credits/subscription billing** (Loomic LemonSqueezy,
  canva-clone Stripe) — conflicts with the README's free-forever
  promise. If ever needed: a clearly-separated optional module, never
  core. Default answer: no.
- **Community plugin registry** — already decided against
  (docs/PLUGINS.md FAQ).
- **Website/HTML site builder** (BurnGuard's core) — different
  product category; Canvix is a design canvas. Revisit only as an
  export target, not an editing mode.
- **Server-side rasterization on Workers** — no canvas API in
  workerd; documented constraint. Server-side export, if ever, ships
  as an optional Node-sidecar service, never a Workers requirement.

### Sequencing rationale

Wave 1 first because content poverty is the most visible deficiency
and the cheapest to close; it also feeds marketing screenshots.
Wave 2 makes Canvix presentable to the deck/pitch audience (the
largest design-tool use case after social). Wave 3 is cheap and
unlocks the beat-sync moat. Wave 4 unlocks organizational adoption
(and procurement). Wave 5 is where Canvix leapfrogs rather than
catches up — every piece rides existing rails (multi-provider table,
DesignActions, MCP, export API). Wave 6 items each get their own
evaluate-then-slice decision record before committing.

---

## 6. Growth observations (why doory got 2.6k in a month)

1. **Launch discipline**: doory shipped *complete* (docs, Docker,
   self-hosting guide, FAQ, demo GIFs, license clarity) before
   posting. Canvix is technically readier than doory was — but has
   never had a coordinated launch (HN Show, r/selfhosted,
   r/opensource, awesome-selfhosted PR).
2. **A single sharp promise**: "no paid plan, no account needed, run
   it yourself." Canvix's version is stronger: "free forever, zero
   lock-in, your database, plugins, admin console, best exports in
   open source."
3. **README as landing page**: doory's README is a product tour with
   screenshots per feature. Canvix's README is an engineering log —
   historically honest, but re-organizing it (product-first, changelog
   after) costs nothing.
4. **Recommendation**: do a coordinated launch after Waves 1–2 land
   (content library + presenter mode close the "looks complete" gap),
   with a demo GIF, the export-depth differentiators up front, and an
   awesome-selfhosted listing.

---

## 7. Method & sources

- All data gathered 2026-11-09 via the GitHub REST API (metadata,
  READMEs, recursive file trees) and direct source inspection; every
  "✓" for Canvix was verified against `/home/z/canvix` @ v0.16.5
  (2cf9a8b) — e.g. animation kinds counted from `src/lib/animations.ts`
  (8 kinds, 4 transitions), GRAPHICS/STICKERS counted from
  `src/lib/editor-utils.ts` (20 graphics, 84 emoji), brand kit
  confirmed localStorage-scoped in `BrandPanel.tsx`.
- Competitor claims cross-checked against file trees where README
  claims were load-bearing (doory's presenter/upscale/QR/masks/Freesound
  modules confirmed in `frontend/src/editor/**`; OpenDesign's
  fields/fill confirmed in `src/server/fields.ts`; Avnac's 27 MCP
  tools confirmed in `docs/MCP_GUIDE.md` references).
- Star counts are point-in-time; velocities are lifetime averages.
- Raw research artifacts: `/home/z/my-project/research/competitors/`
  (metadata JSON, READMEs, trees).
