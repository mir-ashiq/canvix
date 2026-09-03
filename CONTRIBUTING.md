# Contributing to Canvix

Thanks for helping build the open-source Canva alternative! 🎨

## Getting set up

```bash
git clone https://github.com/mir-ashiq/canvix.git
cd canvix
bun install
cp .env.example .env
bun run db:push
bun run db:seed
bun run dev
```

> `bun run lint` must pass before every commit.

## Where to help

| Area | Files |
|---|---|
| New templates | `src/lib/templates.ts` (compose elements with the builder helpers) |
| New fonts | `src/lib/editor-utils.ts` → `FONTS` + the Google Fonts link in `src/app/layout.tsx` |
| Stickers / graphics | `src/lib/editor-utils.ts` → `STICKER_GROUPS`, `GRAPHICS` |
| Canvas behavior | `src/components/editor/canvas/` |
| Panels & toolbars | `src/components/editor/panels/`, `src/components/editor/PropertiesBar.tsx` |
| Export | `src/components/editor/canvas/canvas-bridge.ts` |
| API & data | `src/app/api/`, `prisma/schema.prisma` |

## Adding a template

1. Open `src/lib/templates.ts`.
2. Compose pages using `tx` (text), `sh` (shape), `ln` (line), `st` (sticker), `gr` (graphic).
3. Pick a unique `slug`, `category` (`social | presentation | print | logo | thumbnail`) and an `accent` color.
4. Run `bun run db:seed` and restart the dev server.

## Guidelines

- Keep the Canva-style UI conventions: pill buttons, the teal → violet gradient, dark editor rail.
- TypeScript strict: no `any` unless unavoidable.
- Test your change in the browser on **desktop and mobile** widths.
- Keep design documents small: templates are plain JSON, no binary assets in the repo.

## Pull requests

1. Fork & branch (`feat/my-feature`).
2. One logical change per PR.
3. Describe what changed + screenshots for UI changes.
4. `bun run lint` passes.
