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
| Fonts | 15 hand-picked Google Fonts |

## 📁 Project structure

```
src/
├── app/                    # Next.js App Router
│   ├── page.tsx            # single-page app shell (landing / dashboard / editor)
│   └── api/                # REST endpoints: designs, templates
├── components/
│   ├── landing/            # marketing page
│   ├── dashboard/          # home screen: presets, templates, recent designs
│   └── editor/             # the design editor
│       ├── canvas/         # Konva stage, element renderers, export bridge
│       └── panels/         # templates / elements / text / brand / uploads / tools / projects / apps
├── lib/                    # types, editor utilities, template library
├── store/                  # zustand stores (app + editor)
└── hooks/
prisma/                     # schema + seed
```

## 🧭 Roadmap

- [x] Canva-accurate dark theme & 8-tab editor rail *(v0.2.0)*
- [x] Text effects, draw tool, brand kit, charts, preview & share *(v0.2.0)*
- [x] Canva-exact selection, context menus, groups, colour menu, apps ecosystem *(v0.3.0)*
- [x] Rulers & manually placed guides, image crop, layer renaming, version history *(v0.3.1)*
- [x] 63-font library, gradient fills, PDF export, stock photo library, AI apps *(v0.3.2)*
- [ ] Real-time collaboration (CRDT)
- [ ] Comment & annotation mode
- [ ] SVG export
- [ ] Video/MP4 export
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
