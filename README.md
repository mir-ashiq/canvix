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
- **Dark tool rail & contextual toolbars** — a UI that will feel instantly familiar

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
│       └── panels/         # templates / elements / text / uploads / background / layers
├── lib/                    # types, editor utilities, template library
├── store/                  # zustand stores (app + editor)
└── hooks/
prisma/                     # schema + seed
```

## 🧭 Roadmap

- [ ] PDF export
- [ ] Multi-select grouping & alignment guides toolbar
- [ ] Gradient fills for shapes & text
- [ ] Curated stock photo library
- [ ] Real-time collaboration (CRDT)
- [ ] Brand kits (saved fonts & colors)
- [ ] Design duplication & sharing links
- [ ] Plugin system

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
