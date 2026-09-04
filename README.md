<div align="center">

<img src="public/canvix.svg" width="72" alt="Canvix logo" />

# Canvix

**Design anything. Free for everyone.**

Free & open-source graphic design tool — a community-built [Canva](https://canva.com) alternative.

[![License: MIT](https://img.shields.io/badge/License-MIT-00C4CC.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js%2016-black?logo=next.js)](https://nextjs.org)
[![React 19](https://img.shields.io/badge/React%2019-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-7D2AE8.svg)](CONTRIBUTING.md)

[Features](#-features) · [Quick start](#-quick-start) · [Self-hosting](#-self-hosting) · [Roadmap](#-roadmap) · [Contributing](#-contributing)

</div>

---

## ✨ What is Canvix?

Canvix is a browser-based design tool that lets anyone create social media posts,
presentations, posters, logos and thumbnails — with a drag-and-drop editor, a template
library and one-click export. It runs entirely on your own infrastructure, stores designs
in your own database, and exports files locally in your browser. No accounts, no
watermarks, no paywalls.

## 🎨 Features

### v0.6.0 — the Agent Edition: MCP, tables, frames, curved text & embeds

- **MCP server (Model Context Protocol)** — Canvix becomes an **agent-native design platform**:
  `POST /api/mcp` speaks standard MCP (JSON-RPC 2.0 over Streamable HTTP, stateless —
  same transport profile Canva's AI Connector uses), so AI assistants like Claude
  Desktop, Cursor, ChatGPT and any MCP client can **create and edit real designs on
  your server**. **20 tools**: browse templates, search/get/create designs, add
  text/shapes/images/tables/embeds, restyle & move elements, set backgrounds,
  animate pages, comment, and export (SVG/PNG/JSON) — plus **`generate_design`**,
  which asks the server AI provider for a structured, fully-validated page layout
  and materializes it as native editable elements. Every tool maps to a real
  subsystem; without a provider everything works except `generate_design`, which
  says so plainly. Agent edits append to the same event log the editor replays, so
  **a design an agent is editing updates live for humans in the editor**
- **Security by default** — the endpoint stays disabled until you set
  `CANVIX_MCP_TOKEN`; requests need `Authorization: Bearer <token>` (timing-safe
  compare), cross-origin requests are rejected, per-IP rate limits apply, image
  fetches are SSRF-guarded (private hosts denied, 8 MB cap), patches are
  whitelisted & clamped per element type, and errors never leak stack traces
- **Tables** — Canva-style native tables: click any cell on the canvas to edit it,
  add/remove rows & columns from the toolbar, style borders/header/text, four
  starter styles. Cells export to SVG and translate with the design
- **Frames** — image-in-shape frames (rectangle, rounded, ellipse, circle,
  triangle, hexagon). Drop an upload or photo on a frame to fill it — the image is
  clipped to the shape with cover-fit (also true vector `<clipPath>` in SVG export)
- **Curved text** — Canva's signature arc effect: curve any text −180°…+180°
  (arch up / valley down), rendered as a real text-on-path (Konva `TextPath`, SVG
  `<textPath>`) so it stays crisp in PNG/PDF/video exports and editable everywhere
- **Embed cards** — YouTube videos, Google Maps places and any link become native
  vector link cards (media band, play/pin glyph, title). Clicking a card in Preview
  or shared views opens the URL — honest scope: a styled card, not an iframe
- **Translate covers tables** — the AI translator now also walks table cells, not
  just text boxes
- **Dashboard “AI agents (MCP)” card** — shows the live endpoint status and a
  copy-paste client config (endpoint URL + bearer headers) for Claude Desktop /
  Cursor / any MCP client

### v0.5.0 — Magic Layers, real-time collaboration & production AI infrastructure

- **Magic Layers** — upload any flat design (or pick an image on your canvas) and a
  vision model decomposes it into **real, editable Canvix layers**: text becomes
  live text boxes (color, weight and size recovered), photos become cropped image
  elements, shapes become native shapes, the background becomes a page background.
  Every region carries a confidence score — uncertain regions are flagged amber in
  the review step and can be discarded. Honest limitations are surfaced in-product
  (fonts are matched by class, not recovered exactly; illustrations become image
  regions)
- **Real-time collaboration** — share a design link and edit together: live
  multiplayer with **colored cursors + name tags**, remote selection outlines,
  presence avatars in the top bar, a live/offline connection indicator, and
  gap-free catch-up after disconnects. Architecture: an append-only event log in
  Postgres + server-sent events downstream + batched op POSTs upstream — works on
  Vercel serverless and self-hosted Node alike, no WebSocket server required.
  Optimistic local edits always keep the canvas butter-smooth
- **Comments & annotations** — a first-class comments mode: click anywhere on the
  canvas (or on an element — the pin follows it) to drop a threaded comment.
  Replies, resolve/reopen, delete-own, unread badges, collaborator avatars and
  live propagation to everyone in the design
- **Animations — Magic Animate** — an Animate panel (Page / Element tabs) with 9
  element animations (fade, rise, pan, pop, wipe, zoom, rotate, breathe), speed
  presets, duration/delay/easing/direction controls, and **page transitions**
  (fade/slide/morph, 0.1–2.5 s). One-click **Magic Animate** gives the whole page
  a tasteful animation pass. Animated playback in Preview with autoplay and a
  reduce-motion accessibility toggle
- **SVG export** — true vector export: text, shapes, paths, gradients, opacity,
  transforms, images and shadows serialize to clean, sanitized SVG (no
  rasterization of vector elements, opens in browsers and vector editors)
- **Video export (MP4/WebM)** — a real rendering pipeline: the animation timeline
  is rendered frame-by-frame to an offscreen canvas and encoded locally via
  MediaRecorder — **MP4 (H.264)** where the browser can encode it, WebM otherwise.
  Honest format detection is shown before you export. No uploads, no server
  rendering
- **AI Assistant 2.0** — the assistant is now design-aware: it sees your page's
  elements, colors, fonts and selection, and answers with **structured, validated
  actions** ("move the title to the top", "change all heading colors to purple",
  "make the layout more balanced", "add a CTA"). Every change lands as a normal,
  undoable edit
- **AI provider abstraction** — all AI features route through one server-side
  provider layer: per-IP rate limits, usage accounting, capability probing and
  **graceful degradation** when no provider is configured (local features like
  background removal, palette generation and layout balancing keep working; the
  rest show a clear "requires an AI provider" notice)

### v0.4.0 — the Magic Suite: AI editing, PostgreSQL & infrastructure

- **PostgreSQL database** — Prisma migrated from SQLite to Postgres (native `jsonb`
  documents); one database technology everywhere, local & serverless-ready
  (Neon / Supabase / RDS). Includes the `.env.example` Postgres URL guide
- **Magic Resize** — Canva Magic-Switch-style resize dialog: check any of 12
  channel presets (Story / Reels / posts / A4 / poster / business card…), then
  **resize in place** or **Copy & resize** — every copy gets an automatic
  smart re-layout (elements scale, keep their relative positions, fonts &
  strokes re-proportion)
- **BG Remover** — one-click background removal on any selected image, powered
  by an in-browser ONNX segmentation model (real alpha cut-outs, first use
  downloads the model once, then it's cached)
- **Magic Eraser** — describe an unwanted object ("the person in the
  background") and AI removes it, reconstructing the background behind it
- **Enhance image** — one-click AI photo cleanup: sharpening, lighting and
  colour balance while keeping the framing identical
- **Translate design** — File → Translate: pick from 24 languages, and every
  text across all pages is AI-translated in place (layout intact, one undo)
- **Canvix AI assistant** — a chat copilot app (Canva AI-style) that sees your
  design: ask for headlines, palettes or taglines and tap the suggested
  actions to add text, generate images, save palettes or translate the design
- **Live photo search** — the Photos panel now searches real web photos (not
  just the bundled library) with debounced live results
- **Server-side version history** — snapshots now persist in Postgres
  (30 per design, cascade-deleted), with localStorage as an offline fallback
- **Dashboard trash** — deleting a design moves it to a Trash section
  (restore / delete forever), plus a Recent/Name sort control
- **5 new document templates** — Minimal Resume, Certificate of Achievement,
  Clean Invoice, Monthly Calendar and Business Card under a new
  "Docs & office" category (21 templates total)

### v0.3.2 — fonts, gradients, PDF, photos & AI

- **63-font library** — 15 → **63 families** across five categories (sans / serif /
  display / handwriting / new **Mono**) in a searchable, pill-filtered Canva-style
  font dropdown
- **Gradient fills** — linear & radial gradients on all shapes **and text**, edited
  straight in the colour menu: preset swatches, Linear/Radial toggle, 0-360° angle
  slider, from/to colour pickers, one-click remove
- **PDF export** — print-ready, multi-page PDF downloads straight from the browser
  (jsPDF, zero watermarks)
- **Photos tab** — new side panel with a bundled, license-free stock library
  (7 categories × 6 AI-generated photos), tag search, category chips and
  click-to-place
- **Magic Write** — AI copywriter app: describe what you need, pick kind (headline /
  tagline / body / caption) and tone, get 3 on-brand options, add one to the canvas
- **AI image generator** — prompt + style + aspect ratio → a design-ready image on
  your canvas
- **Design Trends 2026 templates** — five templates from Canva's official 2026
  trend report: Prompt Playground, Notes App Chic, Texture Check, Opt Out Era and
  Granny Wave
- **Per-page guides** — ruler guides now belong to their page; snapping and
  Clear-guides act on the current page only

### v0.3.1 — editor completeness: rulers, crop, layers rename, version history

- **Rulers & manual guides** — Canva-style ruler strips (top/left) with adaptive tick
  ladders and pointer markers; drag out of a ruler to pull a `#9954FF` guide, drag it
  to move, drag off-page or double-click to delete, and snap elements to it. Toggle
  with **Shift+R** or the File menu
- **Image crop** — select an image → Crop button (or right-click → Crop image): drag
  handles or draw a brand-new crop region, lock to aspect presets (1:1, 4:3, 16:9…),
  rule-of-thirds overlay, live pixel readout, flips baked in
- **Layer renaming** — double-click any row in the Layers list for an inline rename;
  custom names persist with the design
- **Version history** — File → Version history (or **Ctrl+Alt+S**): labelled local
  snapshots per design with restore (undo-able), delete and relative timestamps
- **Group rotation fixed & refined** — rotating a group no longer double-rotates its
  children, and ungrouping a rotated group keeps every child exactly where it was
- **Clickable app tiles** — app cards and chart rows open on any click (not just the
  Open/Add button), with full keyboard support

### v0.3.0 — deep visual parity & feature expansion

- **Canva-exact selection chrome** — selection border and handles re-skinned to the
  measured purple `#7630D7` with white circular anchors, 2px border and rotation snapping
- **Alignment guides** recolored to the measured guide purple `#9954FF` at 2px
- **Context toolbar in the topbar** — selecting an element swaps the topbar middle for a
  Canva-style toolbar (32px / r10 buttons): font dropdown with live previews + search +
  category pills, size stepper, colour menu, B/I/U/S/Uppercase, alignment, spacing,
  transparency, effects and position
- **Canva-style colour menu** — spectrum + eyedropper + current colour, Brand Kit
  swatches, 4×7 default solids and gradient swatch rows
- **Text effects: 10 presets** — Drop, Lift, Glow, Hollow, Outline, Background, Splice,
  Neon and Echo in a 3-column thumbnail grid
- **Position popover** — 2×2 layer ordering (forward/backward/to front/to back),
  6 align-to-page tiles and W/H/X/Y/Rotate numeric fields with ratio lock
- **Right-click context menus** — element & page variants with keyboard shortcuts,
  layer ordering, group/lock/hide and delete (244px, 32px items, 13px)
- **Groups** — Ctrl+G / Ctrl+Shift+G group & ungroup; children move and scale together
- **Marquee selection** — drag on empty canvas to box-select; space+drag or middle-mouse
  to pan; Ctrl+A select-all
- **Zoom dropdown** — 300%→10% presets plus Fit & Fill (128px listbox, 40px items)
- **Expanded elements library** — search, basic shapes, polygons (pentagon/hexagon/
  octagon/diamond/semicircle) and 11 new decorative graphics & icons
- **Media upgrades** — image brightness/contrast/saturation adjustments, flips,
  replace-image flow, set-image-as-background and drag-and-drop onto the canvas
- **Templates panel** — search, category chips, recommended section, skeleton loading
  and a full-size preview modal with one-click apply
- **Brand kit 2.0** — colour palettes, logo uploads, and one-click “apply brand style
  to page” (nearest-colour mapping + font swapping)
- **Apps ecosystem** — a registry-driven plugin panel: Charts, QR generator, Icons,
  Colour palette generator, Placeholder text and Stickers. New apps register in
  `apps/registry.tsx`
- **Dashboard polish** — account avatar menu, help & shortcuts modal (Get help FAB),
  skeleton loading states, and toast notifications
- **Mobile contextual action bar** — selecting an element on phones swaps the bottom
  navigation for text/shape tools
- **New keyboard shortcuts** — group/ungroup, select-all, lock, layer ordering (`]`/`[`)

### v0.2.0 — the Canva-accurate dark refresh

- **Canva-2026 dark theme** — every surface re-skinned from live canva.com research:
  deep-purple app background `#1F142E`, editor workspace `#0F1015`, rail `#1D1F26`,
  cards `#16171D` and the signature **cyan→purple gradient topbar**
- **New 8-tab editor rail** (72 px, exactly like Canva): Templates · Elements · Text ·
  Brand · Uploads · Tools · Projects · Apps
- **New topbar**: File menu, Resize, Editing/Viewing mode toggle, “All changes saved”
  pill, Preview, Share (white Canva pill) and Download
- **Text effects** — Shadow, Lift, Hollow, Neon and Echo presets from the context toolbar
- **Draw tool** — freehand brush (color + size) committed as editable vector strokes
- **Brand kit** — save brand colors & fonts, apply them to any selection (localStorage)
- **Charts** — bar, line and donut charts built from native editable elements (Apps panel)
- **Preview mode** — fullscreen presentation with keyboard navigation
- **Share dialog** — copy link + access levels (local-first)
- **Resize dialog** — preset sizes or custom, elements stay centered
- **Canva-style home** — “What will you design today?” hero, left rail with purple
  Create button, brand-kit section, and the purple “Get help” FAB

### Core (v0.1.0)

- **Drag-and-drop editor** — move, resize and rotate text, shapes, lines, graphics,
  stickers and images on a smooth HTML5 canvas (Konva.js)
- **Typography** — 15 bundled Google Fonts, bold/italic/underline/strike, letter &
  line spacing, alignment, colors
- **Smart snapping guides** — elements magnetically align to the page center, edges
  and other elements
- **Layers panel** — reorder, lock, hide and delete any element
- **Pages** — multi-page designs (great for decks), duplicate & reorder pages
- **Templates** — 11 starter templates: Instagram posts & stories, pitch decks,
  posters, logos, YouTube thumbnails
- **Backgrounds** — solid colors, curated palettes and gradient presets
- **Uploads** — drag-and-drop your own images (kept locally in your session)
- **Undo / redo** — full history stack with keyboard shortcuts
- **Autosave** — designs persist to the database automatically
- **Export** — PNG & JPG at 1× / 2× / 3× quality, current page or all pages,
  generated 100% client-side
- **Responsive** — the same editor adapts to desktop, tablet and mobile with
  touch gestures (pinch-zoom, drag-to-pan)

## 🚀 Quick start

> **Prerequisites:** [Node.js 20+](https://nodejs.org) or [Bun](https://bun.sh), and a [PostgreSQL](https://www.postgresql.org) database (local install, Docker, or a free serverless host like [Neon](https://neon.tech)).

```bash
git clone https://github.com/mir-ashiq/canvix.git
cd canvix
bun install            # or: npm install

# set up the database
cp .env.example .env   # then edit DATABASE_URL with your Postgres connection string
bun run db:push        # create tables
bun run db:seed        # load the built-in templates

bun run dev            # → http://localhost:3000
```

Production build:

```bash
bun run build
bun run start
```

## 🛠 Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 + TypeScript |
| Styling | Tailwind CSS 4 + shadcn/ui |
| Canvas engine | [Konva.js](https://konvajs.org) via react-konva |
| State | Zustand |
| Database | Prisma ORM + PostgreSQL (jsonb) |
| Realtime | Postgres event log + SSE (no WebSocket server needed) |
| AI | server-side provider layer (z-ai-web-dev-sdk, vision-capable) |
| Fonts | 15 hand-picked Google Fonts |

## 📁 Project structure

```
src/
├── app/                    # Next.js App Router
│   ├── page.tsx            # single-page app shell (landing / dashboard / editor + ?design= deep links)
│   └── api/                # REST endpoints: designs, templates, collab (SSE), comments, ai
├── components/
│   ├── landing/            # marketing page
│   ├── dashboard/          # home screen: presets, templates, recent designs
│   └── editor/             # the design editor
│       ├── canvas/         # Konva stage, element renderers, collab overlay, comment pins, export bridge
│       └── panels/         # templates / elements / text / brand / uploads / photos / tools / projects / apps / animate
├── lib/
│   ├── ai/                 # v0.5 AI provider abstraction (config, rate limits, usage)
│   ├── collab/             # v0.5 realtime: protocol, client session, participant identity
│   ├── magic-layers/       # v0.5 image → editable layers pipeline
│   ├── animations.ts       # v0.5 animation engine (pure functions of time)
│   ├── svg-export.ts       # v0.5 vector export
│   ├── video-export.ts     # v0.5 MediaRecorder MP4/WebM pipeline
│   └── design-actions.ts   # v0.5 validated, undoable AI editor actions
├── store/                  # zustand stores (app + editor + comments)
└── hooks/
prisma/                     # schema + seed
research/                   # architecture decision records & audits
```

## 🤖 AI provider setup

Canvix works fully **without** any AI provider — the editor, templates, exports,
collaboration and comments need nothing but the database. AI features
(Magic Layers, Assistant, Magic Write, image generation/editing, translate,
photo search) activate when a provider is configured **on the server**:

Option A — environment variables (recommended for Vercel etc.):

```bash
# .env (server-side only — never exposed to the browser)
ZAI_BASE_URL=https://your-provider.example/v1
ZAI_API_KEY=your-key
```

Option B — a `.z-ai-config` JSON file on the server host (checked at the working
directory, then `~`, then `/etc`):

```json
{ "baseUrl": "https://your-provider.example/v1", "apiKey": "your-key" }
```

The provider layer (`src/lib/ai/provider.ts`) resolves credentials in that order,
probes capabilities at runtime and answers `/api/ai/capabilities` (booleans only —
never secrets). When no provider is configured, AI features degrade gracefully:
background removal (local ONNX), color palettes and layout balancing keep working,
and provider-backed features show a clear setup notice. Every AI route is rate-
limited per IP and logs usage into the `AIUsage` table.

### Local-only vs provider-backed features

| Feature | Works without a provider? |
|---|---|
| Editor, templates, uploads, draw, groups, rulers, crop | ✅ always local |
| Exports — PNG / JPG / PDF / SVG / video | ✅ always local |
| Collaboration, presence, comments | ✅ only needs the database |
| Background remover | ✅ local (in-browser ONNX) |
| Color palettes, layout balancing | ✅ local (deterministic) |
| Magic Layers, AI Assistant, Magic Write | ⚙️ needs a server AI provider |
| AI image generation / eraser / enhance | ⚙️ needs a server AI provider |
| Translate, live photo search | ⚙️ needs a server AI provider |
| MCP server (agent tools) | ✅ with token set — `generate_design` additionally needs the AI provider |

## 🤖 AI agents (MCP)

Canvix ships a **Model Context Protocol server** — the same interoperability
standard Canva's “AI Connector” uses. It turns your Canvix instance into a set of
tools an AI assistant can call: create designs, add elements, restyle, animate,
comment, export.

### Enable it

```bash
# 1. set a secret on the server (openssl rand -hex 24)
CANVIX_MCP_TOKEN=your-long-random-secret
# 2. restart Canvix — the dashboard "AI agents (MCP)" card flips to Enabled
```

### Connect a client

Endpoint: `https://your-canvix.example.com/api/mcp` (Streamable HTTP, stateless).
Client config (Claude Desktop / Cursor / any MCP client that supports remote
HTTP servers):

```json
{
  "mcpServers": {
    "canvix": {
      "url": "https://your-canvix.example.com/api/mcp",
      "headers": { "Authorization": "Bearer <CANVIX_MCP_TOKEN>" }
    }
  }
}
```

### Tool surface (20 tools)

| Area | Tools |
|---|---|
| Discover | `get_capabilities`, `list_templates`, `search_designs`, `get_design`, `get_design_content` |
| Create | `create_design` (blank or from template), `generate_design` (AI) |
| Edit | `add_text`, `add_shape`, `add_image`, `add_table`, `add_embed`, `set_background`, `update_element`, `delete_element`, `animate_page` |
| Export | `export_design` (svg / png / json) |
| Collaborate | `comment_on_design`, `list_comments` |
| Reference | `list_fonts` |

Every write tool validates and clamps its arguments (hex colors, coordinates,
font whitelists, size caps) and appends a `pages:replace` event to the design's
collab log — so edits by agents appear live in any open editor session, and
humans can undo or keep refining them.

`generate_design` asks the server's AI provider for a structured page layout,
normalizes it into native elements (clamped sizes, whitelisted fonts, element
caps) and saves a real, editable design — not a raster. Without a provider
configured, the tool returns an honest setup error; template-based creation
keeps working.

PNG export rasterizes server-side with sharp (system fonts render the text);
SVG is true vector with font-family references — both caveats are stated in the
tool descriptions so agents pick the right format.

## 🔐 Security notes

- **Secrets never reach the browser** — provider credentials are resolved
  server-side only; the public capabilities endpoint exposes booleans only
- **Validated collaboration ops** — every realtime event is type-checked,
  size-capped (256 KB) and dropped (never crashed) if malformed; see
  `research/V05-SECURITY-AUDIT.md`
- **Sanitized SVG export** — all text is XML-escaped, path data is whitelisted,
  image hrefs only allow `data:`/`https:`; no scripts or event handlers
- **AI actions are double-validated** (server clamps + client re-checks) and
  always undoable
- **MCP endpoint hardening** — disabled until `CANVIX_MCP_TOKEN` is set; Bearer
  auth with timing-safe compare; cross-origin requests rejected (DNS-rebinding
  guard per the MCP spec); 120 req/min/IP; SSRF-guarded image fetches (private
  hosts denied, 8 MB/10 s caps); tool arguments whitelisted & clamped per element
  type; agent writes ride the same validated event log as human edits
- Known limitation: designs are link-accessible (no per-user ownership yet) —
  the v0.5 identity layer is the migration path; see the security audit

## 🧭 Roadmap

- [x] Canva-accurate dark theme & 8-tab editor rail *(v0.2.0)*
- [x] Text effects, draw tool, brand kit, charts, preview & share *(v0.2.0)*
- [x] Canva-exact selection, context menus, groups, colour menu, apps ecosystem *(v0.3.0)*
- [x] Rulers & manually placed guides, image crop, layer renaming, version history *(v0.3.1)*
- [x] 63-font library, gradient fills, PDF export, stock photo library, AI apps *(v0.3.2)*
- [x] Magic Suite: AI image editing, Magic Resize, Translate, PostgreSQL *(v0.4.0)*
- [x] Magic Layers, real-time collaboration, comments, animations, SVG & video export, AI Assistant 2.0 *(v0.5.0)*
- [x] MCP server (20 agent tools), tables, frames, curved text, embed cards *(v0.6.0)*
- [ ] Accounts & per-design ownership (identity layer groundwork shipped in v0.5)
- [ ] Yjs-grade offline merge for collaboration
- [ ] Audio/video elements & Beat Sync
- [ ] Plugin system (external, installable apps)

## 🤝 Contributing

Contributions are very welcome! Areas that especially need help:

- New templates (add them in `src/lib/templates.ts`)
- New fonts, sticker packs, shape graphics
- Mobile UX polish
- Tests

1. Fork the repo & create a branch
2. Make your change (`bun run lint` should pass)
3. Open a pull request

## ⚖️ License

[MIT](LICENSE) © 2026 Ashiq Hussain Mir

Canvix is an independent open-source project and is not affiliated with, endorsed by,
or connected to Canva.
