# Canvix v0.5.0 — Current-State Audit

> Audited at `main` = `bc78723` (`feat(v0.4): the Magic Suite — AI editing, Magic Resize, Translate, Postgres infra`), working tree clean. This document is the ground truth the v0.5 implementation was planned against.

## 1. Overall architecture

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript | `output: "standalone"`; `reactStrictMode: false`; build script copies `static` + `public` into `.next/standalone` |
| Styling | Tailwind CSS 4 + shadcn/radix primitives | Dark editor chrome (`#0F1015` / `#16181D`), teal-purple accents (`#00C4CC`, `#7630D7`) |
| State | Zustand (`useEditorStore` = editor doc + history; `useAppStore` = view routing) | Single global store per tab; no persistence middleware |
| Canvas | Konva 10 + react-konva 19 | `CanvasStage` renders `PageData.elements` via `element-node.tsx` |
| DB | PostgreSQL via Prisma 6 (`@prisma/client`) | `src/lib/db.ts` — global singleton client, dev `log: ['query']` |
| AI | `z-ai-web-dev-sdk` 0.0.18 (server-only, dynamic import per route) | See `AI-PROVIDER-AUDIT.md` |
| Export | Client-side: Konva `stage.toDataURL` (PNG/JPG), jsPDF (multi-page PDF) | `ExportDialog.tsx` + `canvas/canvas-bridge.ts` |
| Dev runtime | `bun` (dev server, seed); embedded PG 18 on `localhost:5433` (gitignored `tools/`) | Dev server must start via `scripts/run-dev.sh` (forces correct `DATABASE_URL` because the sandbox shell injects a stale `file:` URL) |

## 2. Frontend / editor architecture

- **View routing is client-side**: `app/page.tsx` renders `<Landing>`, `<Dashboard>` or `<Editor>` from `useAppStore.view`. There is exactly one Next route; everything else is state. Deep links do not exist (no `/design/[id]` URL) — relevant for collaboration links (v0.5 adds `?design=` / `?d=` URL params).
- **Editor composition** (`src/components/editor/Editor.tsx`, 419 lines): `TopBar` (menus: File / Resize / Translate / Share / Export / Save), `LeftRail` (11 panels) → panel `aside` (desktop 320px sidebar / mobile overlay), `CanvasStage` (dynamic, ssr:false) + `PageBar` + `ZoomControls`, `PreviewOverlay`, `CropDialog`, mobile contextual `ContextToolbar`, keyboard-shortcut dialog.
- **Panels** (`panels/`): Templates, Elements, Text, Brand, Uploads, Photos, Tools, Projects, Apps, Background, Layers. Apps registry adds slide-out apps (Assistant, Magic Write, AI Image, Charts, QR, Palette, Icons, Stickers, Lorem).
- **Store** (`src/store/editor-store.ts`, 695 lines): holds `designId, designName, width, height, pages: PageData[], currentPage, selectedIds, zoom, panel, past/future (undo), dirty/saving/savedAt, version (mutation counter), editingMode, previewOpen, tool/draw*, brand, showRulers/manualGuides, versions, cropTargetId`.
  - Undo = full-page snapshots (`HISTORY_LIMIT = 60`), `pushHistory()` before every committed mutation; "live" ops (`updateElementsLive`) mutate without history (drag, nudge).
  - `version` counter increments on every content mutation → drives debounced autosave in `Editor.tsx` (1.6 s debounce, PUT `/api/designs/:id`, thumbnail via `canvasBridge.captureThumbnail`).
  - `loadDesign()` fetches server versions with localStorage fallback; `resizeDesign` uses `magicRelayoutPages` (smart re-layout); `translateTexts` batch-updates texts across all pages incl. group children.

## 3. Document model (`src/lib/types.ts`)

- `PageData { id, background: Background, elements: AnyElement[] }`; `DesignSnapshot { name, width, height, pages }` = exactly what is stored in the DB `pages` Json column.
- Element types: `text, rect, ellipse, triangle, star, line, path, stroke, image, sticker, group` — with per-type props (gradients, shadows, effects, filters, flip, cornerRadius, pathData in 100×100 box, stroke points, group children at page coords).
- `uid()` = prefix + timestamp + counter + random. Fine for single-user; **not collision-safe across concurrent collaborators** → v0.5 session emitter must use a richer id (or keep uid but prefix with actor id) for cross-session safety.
- No `animation` field yet; no comment/anchor concept yet.

## 4. API architecture

All routes under `src/app/api/`:

| Route | Methods | Purpose |
|---|---|---|
| `/api/designs` | GET (list, `?trash=1`), POST (create) | dashboard list/create |
| `/api/designs/[id]` | GET, PUT, DELETE (soft; `?permanent=1`) | CRUD + trash |
| `/api/designs/[id]/versions` | GET, POST | version history (prune 30) |
| `/api/designs/[id]/restore` | POST | restore version snapshot |
| `/api/versions/[id]` | DELETE | delete one version |
| `/api/templates` | GET | template library |
| `/api/photos/search` | POST | web photo search (AI provider) |
| `/api/ai/write` | POST | Magic Write |
| `/api/ai/image` | POST | AI image generation |
| `/api/ai/image-edit` | POST | BG-erase / enhance (provider edit) |
| `/api/ai/translate` | POST | batch translate |
| `/api/ai/assistant` | POST | chat assistant + suggested actions |

Conventions: `export const runtime = 'nodejs'`, `maxDuration = 60`, explicit body validation/clamping, JSON `{ error }` responses, `console.error('[route]')` + 502 on provider failure. No auth, no rate limiting (v0.5 adds rate limits on AI + collab routes).

## 5. Prisma / PostgreSQL schema

- `datasource db { provider = "postgresql", url = env("DATABASE_URL") }`.
- `Design`: cuid id, name, width/height, `pages Json` (native jsonb, default `"[]""`), thumbnail?, `source` (blank/template:/duplicate:/resize:), `deletedAt?` (soft delete), `versions[]`, timestamps.
- `DesignVersion`: cuid, designId FK cascade, label, name, width, height, pages Json, `@@index([designId, createdAt(sort: Desc)])`.
- `Template`: cuid, unique slug, name, category, width, height, pages Json, accent.
- Local dev DB: embedded postgres 18 at `localhost:5433/canvix` (user `postgres`), started via `tools/` (gitignored); **`.env` currently points at it** — user will swap for Neon when deploying. No destructive migrations are used; `prisma db push` only.
- Seed: `prisma/seed.ts` — 21 templates across 6 categories.

## 6. Authentication model

**None.** The app is account-less and local-first: every browser sees every design via plain REST (no ownership column, no sessions). This is a deliberate v0.1–v0.4 simplification. Consequences for v0.5: collaboration must introduce a **participant identity layer** (Phase 6) without breaking the anonymous flow — collaborator = random participant id + display name + color, persisted in localStorage; no login required. Design ownership checks are documented as a known limitation (see `V05-SECURITY-AUDIT.md`).

## 7. AI routes / SDK initialization

Every AI route follows the identical pattern:

```ts
export const runtime = 'nodejs'
export const maxDuration = 60
…
const { default: ZAI } = await import('z-ai-web-dev-sdk')
const zai = await ZAI.create()          // reads .z-ai-config (see audit)
const completion = await zai.chat.completions.create({ messages, thinking: { type: 'disabled' } })
```

No route reads `process.env` for keys; nothing AI-related is imported client-side. SDK capabilities used today: `chat.completions.create`, `images.generations.create`, `images.generations.edit` (quirk: needs `images: [{ url }]` at runtime), `images.search.create`. Unused but available: `chat.completions.createVision` (vision, `/chat/completions/vision`), `audio.tts/asr`, `video.generations`, async jobs. v0.5 Magic Layers uses `createVision` (already in the SDK — no new dependency).

## 8. Environment variables

| Var | Where | Value |
|---|---|---|
| `DATABASE_URL` | `.env` (gitignored), `.env.example` (committed template) | local `postgresql://postgres:postgres@localhost:5433/canvix` |
| AI provider credentials | **not env vars** — `.z-ai-config` JSON at cwd → `~` → `/etc` (gitignored) | `{ baseUrl, apiKey, chatId?, userId?, token? }` |

No `NEXT_PUBLIC_*` secrets anywhere (only Google Fonts links in `layout.tsx`). `.gitignore` covers `.env*` (except `.env.example`), `.z-ai-config`, `tools/`, `db/`, `research/*` raw captures, `scripts/`, `tests/`.

## 9. Vercel configuration

No `vercel.json`, no `.vercel/` committed. `output: "standalone"` + custom start script (`bun .next/standalone/server.js`) is geared for self-hosting. Implication for v0.5 collaboration: **no persistent WebSocket server on Vercel serverless** → SSE (streaming Node runtime) + short-poll fallback is the deployable choice (see `COLLABORATION-ARCHITECTURE.md`). `maxDuration = 60` on AI routes is Vercel-friendly.

## 10. Storage

- Design documents + versions + templates: Postgres jsonb.
- Uploaded images / AI images: stored **inline in the document** as dataURLs inside `pages` Json (no file storage). Thumbnails: small dataURL in `Design.thumbnail`.
- Brand kit: localStorage. Versions: Postgres + localStorage mirror.
- No S3/blob storage anywhere — keeps the app zero-config; large images bloat the document (v0.5 performance pass adds image downscaling before embed; still no external storage).

## 11. Version history & autosave

- Autosave: `Editor.tsx` debounces 1.6 s after `version` bumps → PUT `/api/designs/:id` (+thumbnail); also saves on unmount. `dirty/saving/savedAt` power the TopBar save state.
- Versions: `saveVersion()` (Ctrl+Alt+S) POSTs a full snapshot; server prunes to 30; restore applies pages back into the store (undoable via pushHistory).

## 12. Existing realtime-related code

**None.** No WebSocket, SSE, polling, Yjs/CRDT, presence, or comment code exists anywhere in the repo (grep-verified). The editor is strictly single-user, single-tab. `uid()` collision risk and full-document PUT autosave are the two integration points v0.5 collaboration must respect.

## 13. Editor collaboration assumptions baked into v0.4

- One Zustand store owns the truth; history = whole-page snapshots; autosave = whole-document PUT. A naive "sync everything" approach would clobber concurrent edits → v0.5 adds an **op-based event layer** that applies remote ops through the same store actions (`updateElementsLive`, `addElement`, …) so undo/history stay local and rendering stays Konva-fast.
- Elements are identified by `id`; page index is mutable (add/delete/duplicate reorder pages) → remote page ops must reference page ids, not indices, when possible.

## 14. Export architecture

- `canvas-bridge.ts`: `captureStage({ pixelScale, mimeType, quality })` — flips to the target page, waits 260 ms, `stage.toDataURL`, restores page. `captureThumbnail` = 320px JPEG. `canvasBridge` exposes live stage refs.
- `ExportDialog.tsx`: PNG/JPG (1×/2×/3×, current page or all pages as sequential downloads) + PDF (jsPDF, all pages, px units). `PreviewOverlay` = paged slideshow via `preview-stage.tsx` (Konva `Image` of captured pages — a natural seam for v0.5 animation playback & video export).
- No SVG export, no video export today.

## 15. Tests / E2E infrastructure

No unit tests. QA so far = manual scripted browser passes (Playwright-driven by the dev agent) + `bun run lint` + `bun run build`. The v0.5 E2E matrix (Phase 17) follows the same approach: scripted two-browser-session collaboration test, curl API checks, console-error watch, production build.

## 16. Known quirks carried into v0.5 planning

1. Sandbox shell injects stale `DATABASE_URL=file:...` — all db commands need explicit `DATABASE_URL` prefix; dev server runs via `scripts/run-dev.sh`.
2. `next.config.ts` sets `typescript.ignoreBuildErrors: true` (v0.4 ships with it) — v0.5 must still keep 0 `tsc` errors per the QA gate.
3. `uid()` is not globally unique across tabs (timestamp+counter+5 rand chars).
4. Photo search returns remote URLs that are hot-linked (CORS-dependent) — image fetch for exports relies on `crossOrigin` handling in Konva.
5. Editor URL never changes (single `/` route) — collaboration deep links need new URL param handling.
