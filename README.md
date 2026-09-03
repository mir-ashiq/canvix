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
  cards `#16171D` and the signature **cyan→purple gradient topbar** (`#02C0CC → #7B2FF7`)
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

> **Prerequisites:** [Node.js 20+](https://nodejs.org) or [Bun](https://bun.sh), and a SQLite-capable machine (any machine).

```bash
git clone https://github.com/mir-ashiq/canvix.git
cd canvix
bun install            # or: npm install

# set up the database
cp .env.example .env   # then edit DATABASE_URL if you like
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
| Database | Prisma ORM + SQLite |
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
- [ ] PDF export
- [ ] Rulers & manually placed guides
- [ ] Gradient fills for shapes & text
- [ ] Curated stock photo library
- [ ] Real-time collaboration (CRDT)
- [ ] AI-assisted design (local models)
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
