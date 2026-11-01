# Canvix v0.11.7 → v1.0 — Roadmap Research & Current-State Analysis

Date: 2026-11-01 · Status: **research document — no code changed, no migrations
applied, no editor behavior changed.** Studied against `main` = `25a4d6b`
(v0.11.7, post QA close-out); the P0 it reports (§3.7) was fixed the
same day as **v0.11.8** (PR #8), which landed on `main` before this
document. This is the decision record for the version
arc from here to **v1.0**: what Canvix actually is today (verified in
code, not in marketing), where it stands against the 2026 landscape, and
a phased, prioritized plan with effort estimates, acceptance criteria and
a risk register.

Companion decisions already on file: `research/PLUGIN-SYSTEM.md`
(v0.12 plugin proposal), `research/COLLABORATION-ARCHITECTURE.md`
(transport decision record), `research/OFFLINE-MERGE.md` (v0.10 merge
design).

---

## 1. Executive summary

Canvix v0.11.7 is a **broad, genuinely functional, self-hostable design
tool** — 16 element types, 110 templates, 63 fonts, 9 first-party apps,
20 MCP agent tools, realtime collaboration with offline merge, and a
deployment matrix (Vercel / Cloudflare Workers / Netlify / any Node)
that very few web apps of this complexity can match. The codebase is
unusually clean for its age: zero TODO/FIXME markers, zero stray
console.logs, 302 unit + 28 e2e tests, and versioned rationale written
into comments instead of debt.

Five findings shape the road to v1.0:

1. **A server-side enforcement gap (P0 — found by this research, fixed
   in v0.11.8).** The collaboration rail —
   `POST /api/collab/[designId]/events` and `/presence` — verified the
   design existed and was not trashed but **never called
   `resolveDesignAccess`** (verified: only `designs/[id]`,
   `versions`, `restore` routes did). A signed-out or second-account
   visitor who learned an *owned* design's id — e.g. from its share
   link — could append collab events — including `pages:replace` —
   that reached the owner's live session and rode the owner's next
   autosave, bypassing the v0.9 read-only contract the PUT path
   enforces. **Fixed as v0.11.8 (#8)**: `canEditDesign()` extracted
   from `design-guard.ts` so both rails share one rule, CSRF added to
   both collab routes, design-gated presence, 14 regression tests + an
   8-assertion live probe — 316 unit / 28 e2e green (§3.7).
2. **The test suite exists but gates nothing.** 302 unit + 28 e2e
   tests ran only locally at the time of study (316 unit after the
   v0.11.8 regression tests); the only GitHub workflows are manual
   (`db-setup.yml`, `usage-forensics.yml`), and all three deploy
   pipelines ship whatever `main` has (§3.6, epic **H2**).
3. **The plugin system is the right flagship next step.** The README's
   first unchecked box already has a strong decision record
   (`PLUGIN-SYSTEM.md`): sandboxed-iframe + postMessage, the proven
   Figma/Canva model shrunk to Canvix scale, zero new dependencies,
   ~15–25 KB host cost. But shipping untrusted code onto instances
   without a CI gate and a security-headers baseline would be
   negligent — the remaining v0.12 hardening is the plugin phase's
   prerequisite (§5.2).
4. **The gap profile is "broad but shallow."** An experienced Canva
   user's daily misses are concentrated in mid-size items with existing
   seams: persistent uploads, system clipboard, folders, distribute,
   image filters, rich text, moving-video export (§3.4). None requires
   new infrastructure — the media store, element model and store
   actions already support most of them.
5. **Collaboration has a known, safe scaling ceiling.** Every SSE
   connection polls Postgres (≈0.31 q/s idle, ≈1.25 q/s active per
   client through a `max=1` pool per isolate) — comfortable for tens
   of concurrent editors, a wall at hundreds. The `?since=` replay
   design makes a later LISTEN/NOTIFY fan-out migration safe; it is
   correctly scheduled late (v0.16), not before (§3.5, epic **M4**).

**The recommended arc** (§5 details each phase; effort = S ≤3 days,
M = 1–3 weeks, L = 3–8 weeks for one experienced contributor):

| Phase | Theme | Flagship epics | Effort |
|---|---|---|---|
| **v0.12** | Trust & rails | PR CI gate, security headers, error boundaries, rate limits, docs/ops runbook (H1 shipped ahead as v0.11.8) | 3 M + 3 S |
| **v0.13** | Plugin system MVP | Runtime core, plugin element + renderer, Word Cloud reference plugin, security suite | 2 M/L + 2 M + 1 S |
| **v0.14** | Daily-driver depth | Persistent uploads, system clipboard, distribute, filters, folders, auto-snapshots, charts, tables | 9 S/M + 1 M/L |
| **v0.15** | Rich content & export | Rich text (spans), WebCodecs-quality export, moving video in exports, vector-text PDF, GIF | 3 L + 1 M/L + 2 M |
| **v0.16** | Mobile & collab scale | Touch-first editing, bottom sheets, LISTEN/NOTIFY fan-out, @mentions, op-level undo sync | 3 M + 2 S/M + 1 L |
| **v1.0-rc** | Stabilization | Perf budgets, a11y audit, handbook, "README promises = shipped" | 2 M + 1 S/M + 1 S |

If only three things happen next, in order: **H2** (make tests gate
merges), **H3** (headers/CSP baseline — also the plugin serve route's
groundwork), **H5** (rate limits where none exist). H1 — the P0 this
research opened with — already shipped as v0.11.8.

---

## 2. Method, sources & how to read the estimates

**Internal evidence.** Three parallel audits of the working tree at
`25a4d6b` — (a) architecture & tech debt, (b) user-facing feature
inventory & Canva gap analysis, (c) backend/collab/deployment/security/
tests — cross-checked against the repo's own 23 research documents. The
P0 security finding and the collab cost model were re-verified directly
in source before writing them here. Every internal claim carries a file
path; the load-bearing ones are indexed in Appendix A.

**External evidence.** The 2026 landscape was researched on the open
web (Canva's current product surface and AI-allowance model, Penpot's
plugin system, tldraw's SDK positioning, Yjs/CRDT maturity and the
AI-as-peer trend, Liveblocks/PartyKit, WebCodecs vs MediaRecorder,
Figma's two-runtime plugin architecture). Sources are listed with URLs
in Appendix B; anything not verifiable externally is attributed to the
repo's own documents instead.

**Effort scale.** S ≤ 3 days, M = 1–3 weeks, L = 3–8 weeks — for one
experienced contributor already familiar with this codebase, including
tests and docs, at the quality bar the repo currently holds (which is
high: every recent PR shipped with regression specs). Calendar time for
a part-time maintainer is roughly 3–4× these numbers.

The full arc totals roughly **40–60 contributor-weeks** — call it a
year full-time, or a multi-year part-time project. The phases are
deliberately truncatable (§5.7) and the v0.14 menu parallelizes across
contributors, which is exactly what an MIT project wants.

**Reading order.** §3 is the honest current state (what to preserve,
what to fix). §4 is the outside world (what "good" means in 2026 and
where the differentiated bets are). §5 is the plan. §6 risks, §7
post-1.0, §8 the deliberate non-goals that keep the project coherent.

---

## 3. Current state — what v0.11.7 actually is

### 3.1 The product at a glance

| Surface | Count | Evidence |
|---|---|---|
| Element types | 16 (text, rect, ellipse, triangle, star, line, path, stroke, image, sticker, group, table, frame, embed, audio, video) | `src/lib/types.ts:5-21` |
| Templates | 110, 6 categories, code + DB-seeded | `src/lib/templates/*` |
| Fonts | 63 Google families (searchable, categorized) | `src/lib/editor-utils.ts:16-85` |
| First-party apps | 9 (Assistant, MagicWrite, AIImage, Charts, Palette, Lorem, QR, Icons, Stickers) | `src/components/editor/apps/registry.tsx` |
| AI features (provider-gated) | 8: Magic Layers, Assistant, Write, image gen, Eraser/Enhance, Translate, photo search, + local BG remover & Magic Resize that always work | `src/app/api/ai/*`, `ImageAI.tsx` |
| MCP agent tools | 20 (design CRUD → export, SSRF-guarded, token-gated) | `src/lib/mcp/tools.ts` |
| Bundled stock photos | 42 (7 categories, AI-generated, license-free) | `public/photos/` |
| Export formats | PNG/JPG (1–3×), PDF (raster), SVG (true vector), MP4/WebM (MediaRecorder) | `ExportDialog.tsx`, `svg-export.ts`, `video-export.ts` |
| Collaboration | SSE presence + cursors + live ops, offline queue + HLC merge, comments with threads | `src/lib/collab/*` |
| Accounts & ownership | scrypt + opaque sessions, owner/ownerless/read-only design guard, adopt flows | `src/lib/auth/*` |
| Deploy targets | Vercel, Cloudflare Workers (2.13 MB gz / 3 MB cap), Netlify (20.8 MB zip), any Node host | `research/DEPLOYMENT-VERIFICATION.md` |
| Tests | 302 unit (18 specs) + 28 e2e (7 specs) + 5 live probe suites | `src/**/*.test.ts`, `tests/e2e/` |
| Hand-written source | ≈33,000 LOC across 198 files (73 components, 62 lib modules, 3 stores) | repo census |

### 3.2 Architecture map

```
Next.js 16 (App Router, standalone) ── effectively a client-side SPA
│   75 'use client' files; only API routes + layout are server work
├─ React 19 + Konva 10 + react-konva (declarative canvas)
├─ Zustand 5 (no middleware) — editor-store.ts (1,240 lines, 77 actions)
│   • structural sharing → memoized Konva nodes skip re-renders (v0.7)
│   • two-tier updates: updateElementsLive (drag hot path) vs updateElements (history)
│   • HLC stamps on every mutation (_m per element, _pm per page, tombstones)
├─ Three independent renderers of the same element model  ← THE deepest constraint
│   1. canvas/element-node.tsx   (Konva — editor, preview, thumbnails, raster export)
│   2. lib/svg-export.ts         (hand-written SVG strings)
│   3. lib/video-export.ts       (imperative Konva re-implementation)
├─ 27 API route files — all runtime='nodejs', all mutations CSRF-checked
├─ Prisma 6.16 rust-free client + @prisma/adapter-pg (max=1 pool/isolate)
│   10 models: User, Session, Design (pages jsonb), DesignVersion, Template,
│   DesignEvent (BigInt seq + eventId dedupe), Presence (PK designId+id),
│   Comment, Media (bytea), AIUsage
└─ Collab: append-only DesignEvent log → SSE pump (800ms→3.2s adaptive)
    ← ops up via batched POST (400ms, ≤20) · presence upserts · ?since= replay
```

The architecture's defining bet — **SSE + POST + Postgres instead of
WebSocket + Yjs** (`research/COLLABORATION-ARCHITECTURE.md`) — has aged
well: it is the reason the app deploys unchanged to three serverless
platforms, and v0.10 subsequently added the property people assumed
only CRDTs could give ("Yjs-grade offline merge" via HLC-stamped LWW +
tombstones, `research/OFFLINE-MERGE.md`) without a document-model
rewrite. §4.3 re-evaluates that bet against 2026 options.

**Structural weaknesses worth naming now** (full register §3.9): the
editor is effectively a per-tab singleton (module-level `clipboard`,
`emitOp`, `canvasBridge`, `uploadGallery`); five components subscribe
to the whole store and re-render on every mutation
(`PropertiesBar` ×2, `ToolsPanel`, `BrandPanel`, `context-menu`); the
store does I/O (`loadDesign` writes localStorage, restores IndexedDB,
fetches versions); and five files have passed god-file mass
(`mcp/tools.ts` 1,316 · `editor-store.ts` 1,240 · `Dashboard.tsx` 992 ·
`CanvasStage.tsx` 981 · `PropertiesBar.tsx` 848).

### 3.3 What is genuinely strong (preserve at all costs)

These are the differentiators — capabilities Canva does not have at any
price, and that the roadmap must not trade away:

- **Self-host-first with a verified three-platform matrix.** One build
  script (`WORKERS_CI` switch), bundle sizes measured under every
  limit, `/api/health` self-diagnosis that tells the self-hoster the
  exact fix. Penpot is the only comparable open-source neighbor with a
  credible self-host story, and it needs its own stack (Clojure + two
  databases) to run.
- **Offline-safe collaboration with deterministic merge.** HLC stamps,
  tombstones, IndexedDB queue, same pure merge on client and server.
  Even most commercial editors (including Canva) offer no offline
  editing at all.
- **An agent surface (MCP) that treats AI as a first-class editor.**
  20 tools, SSRF-guarded fetches, agent writes riding the same
  validated event log as human edits. This is where the industry is
  visibly heading (§4.3) and Canvix is already there.
- **True vector SVG export** — hand-written serializer covering every
  element type, sanitized. Most canvas apps export raster.
- **Honest degradation everywhere.** No AI key → local features still
  work and the UI says what's missing (v0.11.6 F2b); read-only designs
  say so (v0.11.7 F6); Workers can't run sharp → "use SVG". This
  honesty is a product feature.
- **The QA discipline itself.** Six findings found and closed across
  v0.11.5–.7, each with regression specs; comments that cite research
  docs and incident dates instead of TODOs.

### 3.4 Where it is shallow — the Canva parity gap profile

Verified absences a daily Canva user hits, ranked by how often they'd
bite, with the seam that makes each tractable:

| Gap | Bite frequency | Seam that exists today | Effort |
|---|---|---|---|
| Rich text (per-word bold/color/links in one box) | Every session | text model is one flat style; overlay is a textarea | **L** (R1) |
| No persistent uploads library (session-only!) | Every session | Media store + attribution already exist for A/V | **M** (D1) |
| Copy/paste confined to one tab | Daily | elements are plain JSON; system clipboard API is free | **S/M** (D2) |
| No folders on the dashboard | Weekly | trivial schema addition; keyset pagination already | **M** (D6) |
| No image filter gallery (Auto/blur/vignette…) | Daily for photo work | Konva filters + node cache pipeline already used for adjustments | **M** (D4) |
| No distribute-evenly | Weekly | sits next to `alignElements` (6 modes exist) | **S** (D3) |
| No spellcheck | Daily | textarea overlay already hosts editing | **S/M** (D10) |
| Stock video: none; video exports render posters only | Weekly for social work | chunked media store + beat sync exist; export renderer is deterministic already | **L** (R3, R6) |
| PDF is raster (no vector text/fonts) | Per delivery | SVG serializer already emits vector text | **M/L** (R4) |
| No GIF export | Occasionally | fixed-timestep frame renderer exists | **M** (R5) |
| Tables shallow (no row/col resize, per-cell fonts) | Weekly for doc work | table geometry is pure (`v06-geometry.ts`) | **M** (D8) |
| Charts are one-shot static elements | Weekly | ChartsApp proves the geometry; a data-bound `chart` type follows the frame/table precedent | **M/L** (D7) |
| Comments: no @mentions, no reactions | Team settings | accounts exist; comment store is separate already | **S/M** (M5) |
| Version snapshots are manual-only | Rarely but painfully | server version model + 30-cap pruning exist | **S** (D5) |
| Brand kit is per-browser (localStorage) | Multi-device pain | per-user rows + existing adopt patterns | **M** (D9) |
| Mobile: no touch-first handles / bottom-sheet properties | Every mobile session | v0.11.3 responsive groundwork exists | **M** (M1–M3) |

Deliberately absent by philosophy (do not "fix"): paid tiers, watermark
ransom, cloud gatekeeping, email/OAuth accounts, a community gallery,
server-side render farms (README "Free forever" section;
`ShareDialog.tsx:12-21` post-F6).

### 3.5 The collaboration scaling ceiling — the honest math

Each SSE connection runs a per-connection polling loop: events
`findMany` + presence `findMany` per tick, adaptive 800 ms → 3.2 s
(`stream/route.ts`). Cost per client ≈ **0.31 q/s idle, 1.25 q/s
active**, through a Prisma pg pool hard-capped at `max=1` connection
per isolate (the P2002/postmortem design). Verified in production
notes: 100 concurrent editors ≈ 31–125 q/s of indexed queries — fine
on Supabase, and the documented sizing is "personal/small-team
self-hosting" anyway. The wall arrives at hundreds of concurrent
*viewers* (a shared link opened wide), where a fan-out layer becomes
mandatory. The `?since=` gap-free replay cursor already in the client
makes that migration safe whenever it's needed: Postgres
**LISTEN/NOTIFY → in-process hub → SSE** keeps the zero-new-infra
philosophy (epic M4, scheduled v0.16 — late, on purpose: not before
the plugin phase, not before CI can catch regressions).

Latency floor today: the tick (≤800 ms active) plus batched upstream
flush (400 ms) — a ~1–2 s end-to-end edit propagation, matching the
measured 1.9 s join visibility (v0.11.5). WebSockets would buy ~100 ms
and cost the serverless deployability; the original decision record's
call stands for 1.0.

### 3.6 Quality, test & CI posture

The pyramid is strong where it's hardest to fake: **302 unit tests at
the studied revision (316 after v0.11.8)** cover the algorithms that
would silently corrupt data (merge
convergence, HLC monotonicity, offline arbitration, SSRF edge corpus,
beat-detect DSP, store invariants, adopt eligibility, and now the
collab access matrix), and **28 e2e tests** cover the regression
history (URL canonicalization, panel
state, presence latency, mobile widths, render-phase-write guards,
media playback/export).

The gaps, ranked:

1. **Nothing runs automatically.** No PR/push workflow runs `vitest`,
   `test:ui`, `tsc` or `eslint`. Both GitHub workflows are
   `workflow_dispatch`-only. Every deploy pipeline (Workers Builds,
   Netlify, Vercel) ships `main` untested. This is the single highest
   leverage fix in the roadmap (H2).
2. **No component-level tests.** The 15.8k-LOC component tree is
   covered only by e2e smoke; there is no React Testing Library
   anywhere. The five whole-store subscriptions (§3.9) are exactly the
   class of bug component tests catch and e2e misses.
3. **Untested subsystems**: the SSE pump itself (backoff/recycle/
   pruning — only exercised live), `CollabSession` transport
   (reconnect/queue — one e2e), AI route handlers beyond the image
   guard, the SVG/video serializers, `mcp/tools.ts` (live-script-only).
4. **eslint has ~25 rules disabled**, including
   `react-hooks/exhaustive-deps` — the rule that would have caught F5
   class bugs statically (it's off because the codebase predates the
   rule's strictness; re-enabling is a real refactor, listed in the
   debt register, not scheduled before 1.0).

### 3.7 Security posture — and the P0

**Strong:** server-only AI credentials (audited: zero browser
exposure); scrypt + opaque sha256-keyed sessions; CSRF on every
mutation; SSRF guard with DNS pinning that survived a 27-case corpus;
validated/clamped collab payloads (256 KB, ≤20/flush); sanitized SVG
export; zero `dangerouslySetInnerHTML`; upload mime/size gates; design
ownership enforced on the document rail.

**The P0 (verified during this research; fixed in v0.11.8, PR #8).**
`events/route.ts:62-69` and `presence/route.ts` checked existence +
trash state only — `resolveDesignAccess` was imported by exactly three
routes (`designs/[id]`, `versions`, `restore`). Consequence: the
read-only contract for owned designs was enforced on
`PUT /api/designs/[id]` but **not on the collab rail**, which mutates
the same document via live ops and can ride the owner's autosave.
Comments are open-by-design (parity with Canva's comment-first
review), but element ops are not. The v0.11.8 fix: the three-case rule
extracted as pure `canEditDesign()` in `design-guard.ts` (both rails
now share it), same-origin enforcement on both collab routes,
design-gated presence, a 403-aware client (queue dropped, read-only
sessions never emit), 14 unit tests and
`scripts/collab-guard-probe.sh` (8/8 live assertions). Blast radius if
it had stayed open would have grown with every feature touching the
event log — including the plugin system's `actions.apply`.

**The known-open residuals** (from `V05-SECURITY-AUDIT.md` + current
code check), in fix-priority order: no CSP/security headers anywhere
(H3); rate limiting absent on designs CRUD / collab / comments / media
and per-instance-only where present (H5 — an in-memory sliding window
scales linearly with serverless instances); no SSE connection cap;
media GET streams whole bytea rows from memory (no Range cap on
buffer size); comments resolve/reopen open to anyone (documented
parity decision).

### 3.8 Operations & self-hoster story

The good: `/api/health` (env → reachability → migration → seed, with
exact fixes), `db:setup` one-command upgrades that transparently route
migrations through the Supabase session pooler and baseline P3005s,
`verify-deploy-readiness.ts`, and the deploy runbooks per platform.
`AIUsage` gives basic AI telemetry.

The missing, all cheap: **no DB backup story documented anywhere**
(media lives in Postgres, so DB backup *is* media backup — a self-hoster
following nothing today loses everything); no versioned upgrade doc for
jumping multiple minors; no error tracking (a crash in a self-hosted
instance is invisible to the maintainer); media has no delete/GC once
finalized (orphans persist until manual SQL — e2e probes already leave
rows); the register/429 smoke footgun is per-instance. Epics H6–H7.

### 3.9 Tech-debt register (ranked by risk ÷ cost)

| # | Debt | Risk | Cost to fix | When |
|---|---|---|---|---|
| 1 | Collab rail bypassed design-guard (§3.7) — **fixed v0.11.8 (#8)** | **High** | S | ✅ **shipped** |
| 2 | No CI gate on 302+28 tests (§3.6) | High | M | **v0.12 (H2)** |
| 3 | 5 whole-store subscriptions re-render on every mutation | Med (perf, mobile) | S each | v0.14 |
| 4 | No error boundaries + `reactStrictMode: false` | Med (crash = white screen) | S | v0.12 (H4) |
| 5 | Store does I/O (localStorage/IndexedDB/fetch inside actions) | Med (testability, SSR) | M | v0.14–15 (incremental) |
| 6 | God files (mcp/tools 1,316 · editor-store 1,240 · Dashboard 992 · CanvasStage 981 · PropertiesBar 848) | Med (change velocity) | M each, incremental | opportunistically |
| 7 | `DesignAction` type declared in two places (server route + lib) — drift risk | Med | S | v0.12 (ride H1's PR) |
| 8 | Duplication: `timeAgo` ×3, `initials` ×2, `toPages` ×2 | Low | S | v0.14 |
| 9 | `z-ai-web-dev-sdk@0.0.18` — only pre-1.0 dep, vendor-locked AI | Med (breaking changes) | M (adapter interface) | v0.15 |
| 10 | Stale README claims ("15 fonts" → actually 63; "no per-user ownership yet" → v0.9 shipped it) | Low (trust) | S | **this PR** |
| 11 | eslint `exhaustive-deps` + `no-explicit-any` off (~25 rules) | Med (F5-class bugs invisible) | M (real refactor) | post-1.0 |
| 12 | In-memory rate limits per-instance | Med (multi-instance fleets) | M (shared store needed) | post-1.0 |
| 13 | Autosave/PUT-merge logic lives inline in `Editor.tsx` | Low | S | v0.14 |

---

## 4. External landscape (2026)

### 4.1 Canva — the benchmark, and what it gates

Canva's 2026 surface spans far beyond the editor: Docs, Sheets,
Whiteboards, Websites, PDF editor, Print fulfillment, video editing
with AI voiceover/music, an Apps Marketplace and a Templates
Marketplace (canva.com navigation, Appendix B). The AI stack was
rebranded from "Magic Studio" to **Canva AI 2.0** — a conversational
layer that drives the older per-task tools (Magic Write, Magic
Design/Edit/Eraser/Grab/Expand/Morph, Magic Resize, Translate, Magic
Animate, Magic Layers).

Two facts matter for Canvix's positioning:

- **The allowance model.** Canva Free caps AI at roughly **20 uses per
  month**; Pro ~200 Premium uses; the conversational layer is the most
  allowance-expensive path (moda.app FAQ, Appendix B). Canvix's
  counter-offer — *your* key, unlimited local use, everything else
  free forever — remains a clean differentiator, and the roadmap
  should keep exploiting it (e.g. D4 filters and D3 distribute are
  Canva-pro-gated features that Canvix ships free).
- **The feature delta that remains.** Canvix now covers Canva's core
  editing surface surprisingly well (selection, groups, effects,
  crop, brand kit, templates, resize, translate, beat sync — several
  of which Canva gates). The durable deltas are: rich text, stock
  media depth (Canva: millions of assets incl. video/audio), moving
  video in exports, doc-style app breadth, and team/enterprise
  workflows. §5 sequences the ones that matter; the rest are
  post-1.0 (§7).

### 4.2 Open-source neighbors — where Canvix sits

- **Penpot** (33k+ GitHub stars) is the open-source *design platform*
  for product teams — design systems, CSS/SVG export, dev handoff,
  self-hosting — and shipped a **plugin system** (PenpotHub gallery)
  plus continued 2026 initiatives (community threads, Appendix B).
  Overlap with Canvix is smaller than it looks: Penpot is
  Figma-shaped (UI/UX design, components, prototyping), Canvix is
  Canva-shaped (marketing/social content, templates, AI generation).
  Penpot's plugin maturation is useful validation for v0.13.
- **tldraw** pivoted to an **infinite-canvas SDK for React** — the
  deliberate choice to be the *engine under other people's apps*
  rather than an end-user tool (tldraw.dev). Canvix's inverse
  position (own engine via Konva, own product) is defensible: Konva
  gives the declarative-react canvas tldraw sells, and Canvix's
  three-renderer model is the cost of owning export fidelity.
- **Excalidraw** owns the hand-drawn-whiteboard niche and has become
  the diagram substrate other tools embed. Not a competitor; its
  lesson (opinionated scope + embeddability) is already reflected in
  Canvix's honest-scope pattern.

**Positioning statement for 1.0** (worth putting in the README): *the
self-hosted, free-forever content-design tool with offline-safe
collaboration and an agent surface — Canva's editor for people who
keep their own data, Penpot's freedom of self-hosting for people who
make posters, not design systems.*

### 4.3 Collaboration tech — re-evaluating the 2024 bet

The SSE+POST+Postgres decision (made against WebSocket/Yjs/Liveblocks
in `COLLABORATION-ARCHITECTURE.md`) still wins on deployability, and
v0.10's HLC merge delivered the offline properties without a CRDT
migration. What 2026 adds to the ledger:

- **Yjs is the settled CRDT standard** (the default in every new
  collaborative stack), and the interesting frontier is **AI agents
  as CRDT peers** — server-side agent peers editing through the same
  sync as humans, with awareness/presence (Electric's Durable Streams
  article, Appendix B). Canvix already has this architecture through
  MCP (agent writes ride the human event log, presence included via
  `actorId`) — a genuine head start worth deepening (§7).
- **Turnkey collaboration backends** (Liveblocks, PartyKit-class)
  keep maturing but are commercial hosted dependencies — a non-starter
  for "free forever, self-hostable, zero lock-in".
- **The gap that would force a change**: character-level text merge
  when rich text lands (R1). Whole-box LWW is correct-but-coarse for
  a single text element edited offline by two people. The plan of
  record: ship R1 with box-level LWW + honest documentation (the
  existing pattern), and evaluate per-span stamps or a Yjs *sub-document*
  for text elements only, post-1.0, if real usage demands it. A
  wholesale Yjs migration is explicitly **not** scheduled (§8).

### 4.4 Plugin ecosystems — the Figma/Canva model vs Canvix's proposal

Figma's plugins run in **two runtimes**: a UI `<iframe>` (normal
browser, no API access, postMessage only) plus a sandboxed background
script that originally used a custom QuickJS-WASM VM after the Realms
API proved vulnerable (sam.today analysis, Appendix B). Canva's
equivalent (Apps SDK, unified 2026 into the "Canva Developers SDK"
with Connect APIs and MCP — canva.dev) is iframe-first with a
manifest + permission consent flow. Penpot shipped iframe-based
plugins with a hosted gallery and is still working through the
practical gaps (community thread, Aug 2025).

Canvix's `PLUGIN-SYSTEM.md` proposal is a faithful distillation of
this industry model at Canvix scale: sandboxed iframe with
`allow-scripts` only, versioned postMessage RPC, manifest-declared /
user-consented / broker-enforced permissions, sha256-pinned assets
snapshotted into Postgres (install = offline forever), declarative
SVG renderer contract solving the three-renderer problem, and a
default-off instance flag. The one architectural divergence from
Figma — *no* same-origin background runtime at all — is a strength:
it sidesteps the entire VM-sandbox arms race at the cost of
async-only APIs and poster-style canvas output, both honestly
documented. **The evaluation stands; what's missing is execution and
its prerequisite floor (§5.2).**

### 4.5 Export tech — MediaRecorder's ceiling

Canvix's video export (fixed-timestep Konva renderer →
`captureStream(0)` → MediaRecorder) works and is tested, but
MediaRecorder is a capture API, not an encoding pipeline: codec
availability is browser-lottery, bitrate control is coarse, and
frame-perfect determinism is approximate. **WebCodecs**
(`VideoEncoder` + muxing) is the modern path — frame-level control,
explicit codec config, hardware acceleration — and is now shipping
broadly (Appendix B). The honest catch for a zero-dep project:
WebCodecs gives you encoded chunks, not a container — muxing MP4
without a library is a real project, while WebM muxing is tractable.
R2 therefore scopes as: WebCodecs encoder + hand-rolled WebM muxer
first (no new deps), MP4 via the existing MediaRecorder path where
the browser supports H.264, and an explicit decision point on a muxing
dependency (mux.js, ~30 KB) if MP4-everywhere is required.

---

## 5. The roadmap to v1.0

### 5.0 Principles & non-goals (inherited, reaffirmed)

Free forever, no metering, no watermark. Self-host first-class — every
feature must run on Vercel, Workers, Netlify and plain Node with no
new infrastructure. Zero new npm dependencies by default — each
proposed dep needs a documented decision (none are currently
required to reach 1.0). Honest scope notes over silent stubs. Security
boundary before feature surface. And the project's own meta-rule:
**each phase ships with its regression specs, docs, and CHANGELOG** —
the discipline that got v0.11.7 here.

### 5.1 Phase v0.12 — "Trust & Rails" (hardening; 3 M + 3 S remaining)

**Goal:** make Canvix safe to run and safe to change. Nothing here is
glamorous; all of it is prerequisite. Estimated total: 3–4 weeks.
(H1 — the collab-rail ownership fix — was pulled out of this phase and
shipped immediately as v0.11.8, PR #8, when the research found it.)

| ID | Epic | Acceptance criteria (abridged) | Effort | Depends |
|---|---|---|---|---|
| ~~**H1**~~ | ~~**Collab-rail access enforcement (P0)**~~ — **✅ shipped as v0.11.8 (#8)**: `canEditDesign()` shared by both rails, CSRF on events/presence, design-gated presence, 403-aware client; 14 unit tests + live probe; 316/316 + 28/28 green | — | ✅ done | — |
| **H2** | **PR CI gate** — GitHub Actions on pull_request/push: install → prisma generate → `tsc --noEmit` → `eslint` → `vitest run`; Playwright (chromium, Postgres service container) on `main` merges; cache node_modules | A PR that breaks a test cannot merge (branch protection doc); CI runtime < 10 min; README badge | **M** | — |
| **H3** | **Security headers + CSP baseline** — `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`/`frame-ancestors`, HSTS (documented HTTP-self-host caveat), report-only CSP that whitelists Google Fonts + `data:`/`blob:` images; draft the strict per-manifest CSP the plugin serve route will use | Headers verified by a Playwright assertion on every route class; zero functional regressions in a full e2e pass; CSP report-only log reviewed for a week before enforcement | **S** | — |
| **H4** | **Error boundaries** — top-level boundaries around `Editor` and `AppShell` with recovery UI ("reload editor / back to dashboard / copy diagnostics"); re-evaluate `reactStrictMode` | Forced crash in a child renders the boundary, never a white screen; diagnostics include design id + last saved seq | **S** | — |
| **H5** | **Rate limits & connection caps where absent** — per-IP limits on designs CRUD, collab events/presence, comments, media init; SSE connections capped per IP (≈6); document per-instance semantics honestly | 429s returned with `Retry-After`; load probe script proves the caps; docs section "rate limiting on multi-instance fleets" states the limitation | **M** | H1 |
| **H6** | **Docs & ops runbook** — backup guide (pg_dump + bytea note + tested restore), versioned upgrade doc (jumping minors), rollback guidance, media orphan GC script, fix the two stale README claims (done in the research PR) | Restore drill executed against a scratch Supabase project and documented step-by-step | **S** | — |
| **H7** | **Observability floor** — opt-in structured request logging (env flag), `/api/health` v2 (design/user/media-size counts + DB latency probe), optional error-webhook (POST on route catch) | Health v2 returns counts without leaking ids; logging off by default (self-hoster privacy) | **M** | — |

### 5.2 Phase v0.13 — Plugin System MVP (the flagship; 2 M/L + 2 M + 1 S)

**Goal:** third-party panel apps and plugin elements, running in a
real security boundary, on any deployment — per
`research/PLUGIN-SYSTEM.md` phases 1–2. Estimated total: 6–10 weeks.

| ID | Epic | Acceptance criteria (abridged) | Effort | Depends |
|---|---|---|---|---|
| **P1** | **Runtime core** — manifest + validator (incl. hand-rolled semver ranges), install/consent/uninstall UI, serve route with per-manifest CSP, sandboxed panel iframes, RPC broker with default-deny permissions, `CANVIX_PLUGINS` flag (default off), namespaced storage | The doc's full fuzz corpus rejected; consent screen lists permissions verbatim; CSP + sandbox assertions in Playwright; flag-off behavior byte-identical to v0.12; 0 new deps; deploy-readiness size check green on all 3 targets | **M/L** | H1, H3 |
| **P2** | **Plugin element & renderer contract** — the single `'plugin'` union member, pure/deterministic SVG renderer contract + sanitizer + cache, service iframes, host-rendered properties slot from manifest schema, placeholder states in all four host states, three-renderer integration | Word Cloud e2e of §5 of the proposal incl. export inclusion (SVG/PNG/video) and collaboration: A adds, B without the plugin sees placeholder and loses no data; read-only designs deny `design:write`; beat pulse + entry animations apply to plugin elements | **M/L** | P1 |
| **P3** | **Reference plugins** — Word Cloud (`com.canvix.wordcloud`) + 1–2 community-shaped examples (e.g. a gradient-mesh generator, an icon-pack importer) | Each exercises a different permission set (one with zero network); each installable from a static URL on a scratch instance | **M** | P2 |
| **P4** | **Security test suite** — the proposal's full matrix: CSRF'd installs, cross-plugin storage, CSP-blocked fetch, sandbox-attribute verification, oversized/hostile renderer output, RPC caps | All cases automated (unit + Playwright), wired into H2's CI | **M** | P1, P2 |
| **P5** | **Plugin author docs** — quickstart, API reference, manifest spec, hosting guide, "no marketplace, ever" FAQ | A developer with no Canvix internals knowledge builds and installs a hello-world panel from the docs alone (dogfood-test this) | **S** | P3 |

### 5.3 Phase v0.14 — "Daily-driver" editor depth (the parity menu; 9 S/M + 1 M/L)

**Goal:** remove the small frictions that make a Canva user feel the
difference daily. Items are independent — pull them forward in any
order; none depends on the plugin phase. Estimated total: 8–12 weeks
at full scope, but it parallelizes and truncates gracefully.

| ID | Epic | Acceptance criteria (abridged) | Effort | Depends |
|---|---|---|---|---|
| **D1** | **Persistent uploads library** — extend the Media store to images (mime allowlist + sha256 dedupe), owner/anon attribution, UploadsPanel reads DB; uploads survive reload and follow the account | Upload on device A visible on device B after login; orphan GC documented; quota surfaced | **M** | — |
| **D2** | **System clipboard & cross-tab copy** — copy elements as JSON to the system clipboard (custom MIME + text fallback), paste handler (also enables paste-image-from-OS); keep internal clipboard for same-tab latency | Copy in tab A pastes in tab B; image from OS clipboard lands as an image element; read-only designs can't paste | **S/M** | — |
| **D3** | **Distribute evenly** — H/V distribute in `alignElements` + Position popover tiles + Assistant action | Works for ≥3 selected; single/multi align behavior unchanged; unit tests for geometry | **S** | — |
| **D4** | **Image filter gallery** — Konva filter presets (blur, sharpen, grayscale, warm/cool, vintage, vignette…), intensity slider, "Filter tint" stub replaced | Filters live during adjustment (existing cache pipeline), persist in the element, render in all three renderers + SVG export approximation documented | **M** | — |
| **D5** | **Auto version snapshots** — snapshot with label on template apply, Magic Resize, Translate, Magic Layers, before page-delete; auto entries visually distinct; 30-cap pruning keeps manual ones preferentially | Every major destructive op has a restore point; version list shows "auto" chips; no snapshot storms (debounced) | **S** | — |
| **D6** | **Folders** — `Folder` model + `designId.folderId`, dashboard tree, move/rename, trash integration | Designs sortable by folder; zero folder = "All designs" unchanged; migration is a no-op nullable column | **M** | — |
| **D7** | **Data-bound chart element** — native `chart` type (bar/line/donut/scatter) with editable series data; *or* implement as the flagship first-party plugin if v0.13 has shipped (decide then — the plugin path proves the ecosystem) | Chart data editable after creation; re-renders in all three paths; MCP `update_element` supports series | **M/L** | — |
| **D8** | **Tables depth** — drag row/col resize, per-cell font family/size, header styling presets | Column resize persists + collab-safe (element-level update); no regression in table geometry tests | **M** | — |
| **D9** | **Brand kit server sync** — BrandKit rows per user, localStorage cache + last-write merge, adopt-on-login | Brand kit follows the account across devices; offline edits merge without prompting | **M** | — |
| **D10** | **Spellcheck (overlay)** — spellcheck enabled in the text-editing textarea + "Check spelling" pass that lists and jumps to misspelled words | No squiggle-rendering promise on canvas (honest scope note); typing surface catches typos | **S** | — |

Also in this phase, quietly: debt items 3, 5, 8, 13 from §3.9 (the
whole-store subscriptions, the duplicated helpers, extracting the
autosave module) — each rides the epic it touches.

### 5.4 Phase v0.15 — Rich content & export (3 L + 1 M/L + 2 M)

**Goal:** the two genuinely hard capabilities left: rich text and
export quality. These are the roadmap's heavy lifts; schedule them
with headroom. Estimated total: 12–20 weeks.

| ID | Epic | Acceptance criteria (abridged) | Effort | Depends |
|---|---|---|---|---|
| **R1** | **Rich text — per-span styling** — `TextElement` gains a spans model (per-span bold/italic/color/link), migration for existing flat text, contentEditable-lite overlay, all three renderers, **box-level LWW merge kept and documented** (per-span merge is explicitly out) | Existing designs migrate losslessly (round-trip test); spans render in editor + SVG + video; undo/redo span-aware; honest doc: two offline editors of one box still LWW the whole box | **L** | — |
| **R2** | **WebCodecs export pipeline** — `VideoEncoder` path with hand-rolled WebM muxer (no new deps); MP4 stays on the MediaRecorder path where H.264 exists; documented decision point on a muxing dependency (mux.js or similar) for MP4-everywhere; deterministic frame pacing | Export quality/bitrate visibly improved at same file size; frame-exact timeline (no dropped frames at 60-element pages); fallback matrix documented per browser | **L** | — |
| **R3** | **Moving video in exports** — render video elements frame-accurately in the export timeline (seek + draw per fixed timestep; Worker-offloaded if main-thread jank measured) | A design with a video element exports with the video content, not the poster; audio mux unchanged; CPU cost documented | **L** | R2 |
| **R4** | **Vector-text PDF** — text as real PDF text with font subsetting/embedding (via the SVG serializer's text model; dep decision documented) | PDF text selectable + searchable; fonts embedded or a documented system-stack fallback per family; file size sane vs raster | **M/L** | — |
| **R5** | **GIF export** — animated GIF via the fixed-timestep renderer (hand-rolled LZW encoder ~200 lines or documented dep) | Social-loop GIF from any page range; size cap + dithering options | **M** | — |
| **R6** | **Stock media depth (provider-gated)** — configurable stock *video* connectors (self-hoster keys, the photos-search pattern), license/attribution metadata surfaced | No provider = feature hidden, everything else works (the F2b pattern); attribution visible on insert | **M** | — |

### 5.5 Phase v0.16 — Mobile & collaboration scale (3 M + 2 S/M + 1 L)

**Goal:** close the README's second unchecked box and buy the collab
ceiling another two orders of magnitude. Estimated total: 8–14 weeks.

| ID | Epic | Acceptance criteria (abridged) | Effort | Depends |
|---|---|---|---|---|
| **M1** | **Touch-first editing** — larger selection handles in touch mode, one-finger element drag vs two-finger pan/zoom disambiguation, double-tap zoom, long-press context menu | Full editing flow passable on a 390 px phone (e2e at mobile widths extended); no modifier-key dependence | **M** | — |
| **M2** | **Bottom-sheet properties** — the contextual toolbar as a mobile bottom sheet (the v0.11.3 bottom action bar is the seam) | All per-type controls reachable on mobile; sheet dismiss/restore state-safe (the F2/F3 panel-state lessons) | **M** | M1 |
| **M3** | **Gesture polish** — pinch-rotate, momentum pan, edge-pinch zoom out | Feels native in a side-by-side with Canva mobile web | **S/M** | M1 |
| **M4** | **Collab fan-out** — Postgres LISTEN/NOTIFY → in-process hub → SSE subscribe (no polling); `?since=` replay unchanged; bench harness included | 500 concurrent viewers on one instance at < 10% DB CPU (bench documented); latency ≤ current; Workers compatibility verified (Hyperdrive notes) | **L** | H2 |
| **M5** | **Comment richness** — @mentions (accounts exist), reactions, comment deep links on canonical URLs | Mentioned user sees unread badge; deep link opens the thread anchored to the pin | **S/M** | — |
| **M6** | **Op-level undo broadcast** — undo/redo syncs as ops instead of `pages:replace` (the §7 deferral in the collab decision record) | Undo in a live two-session test no longer clobbers the remote session's concurrent edits | **M** | — |

### 5.6 Phase v1.0-rc — Stabilization (2 M + 1 S/M + 1 S)

**Goal:** the 1.0 bar is *“every README promise is shipped and
verified.”** Estimated total: 4–6 weeks.

| ID | Epic | Acceptance criteria (abridged) | Effort |
|---|---|---|---|
| **S1** | **Performance budgets in CI** — big-document benchmark (500 elements, 30 pages) with trace-based assertions; export memory ceiling test; startup budget | Budgets enforced in the H2 pipeline; regressions block merge |
| **S2** | **Accessibility audit** — keyboard-only editing story (tab-to-element, arrow nudge, enter-to-edit), focus management sweep, contrast sweep, honest scope note for canvas screen-reader semantics | axe-clean on shell + panels; keyboard e2e spec; a11y statement in README |
| **S3** | **Self-hoster & contributor handbook** — consolidate deploy/backup/upgrade/plugin docs; contributor guide with the repo's quality bar spelled out | A new self-hoster goes zero-to-instance using only the handbook |
| **S4** | **1.0 definition pass** — README/CHANGELOG audit, semantic-version commitment, n-1 minor migration support statement, tag `v1.0.0` | Every checked roadmap box verified by a test or doc link; release notes |

### 5.7 Sequencing notes

- **v0.12 is strictly first** — the P0 (H1) already landed as v0.11.8
  ahead of this document; H2 lands before any long-lived branch, H3
  before the plugin serve route.
- **v0.13 and v0.14 can interleave**: the plugin phases are mostly
  additive (new routes, new element type), while D-epics touch the
  editor core. A solo maintainer should still finish P1–P2 before
  starting D-items to avoid two long-lived mental contexts.
- **v0.15's R1 (rich text) is the only invasive change** — schedule it
  against a quiet period, behind a migration test suite, and expect a
  `0.15.0` minor of its own with no other riders.
- **The 1.0 label is earned, not scheduled**: if v0.15 slips, 1.0
  ships without R3 (moving video) rather than shipping it untested —
  the rc phase's job is to make that call explicit.

---

## 6. Risk register

| # | Risk | Likelihood | Impact | Mitigation (owner epic) |
|---|---|---|---|---|
| 1 | **Cloudflare 3 MB worker cap erosion** — at 2.13–2.14 MB gz today, every feature nibbles ~0.85 MB of headroom | Medium | High (deploys fail) | Size assertion in CI (H2 + P1's existing `verify-deploy-readiness`), dynamic-import every new subsystem, plugin runtime excluded from default bundle |
| 2 | **Bespoke portability patches rot** — `patch-prisma-wasm.mjs`, `WORKERS_CI`, trace excludes break on Prisma/Next/wrangler majors | High | Medium | CI matrix (H2) catches it same-day; pin majors; portability doc refreshed per upgrade |
| 3 | **Plugin iframe CPU abuse** — no browser cap exists | Medium | Medium | Watchdog + disable + consent gate; already honestly documented in the proposal §9 |
| 4 | **Media bytea bloat** — 32 MB files in Postgres rows; backups and memory grow | Medium | Medium | GC + delete API (H6/R6); object storage is a documented post-1.0 path, not a 1.0 dependency |
| 5 | **Rich-text merge coarseness** — two offline editors of one text box still whole-box LWW | Medium | Medium | Document at R1 ship; per-span stamps or Yjs sub-document evaluated post-1.0 on real usage |
| 6 | **`z-ai-web-dev-sdk@0.0.18` vendor churn** | Medium | Medium | `provider.ts` already centralizes; formal adapter interface scheduled v0.15 |
| 7 | **Single-maintainer bus factor / scope creep** | High | Medium | This document's S/M/L honesty; the 1.0 "promises = shipped" bar; contribution guide (S3) |
| 8 | **Workerd local-dev TLS blocker** (wrangler dev can't reach Postgres) | High | Low (dev-only) | Hyperdrive fallback documented; preview deploys as the verification path |
| 9 | **In-memory rate limits on multi-instance fleets** | Medium | Medium | Honest docs (H5); shared-store option is post-1.0 with its own dep decision |
| 10 | **Legal/licensing drift in stock content** | Low | Medium | Bundled library is AI-generated license-free; provider-gated search carries attribution (R6); no scraping of licensed catalogs, ever |

---

## 7. Post-1.0 outlook (deliberately unordered, deliberately short)

- **Teams & shared brand workspaces** — `Organization`/`Membership`
  models, shared brand kits, org-owned designs. The natural next
  structural extension; only after 1.0 because it touches auth,
  dashboard, and the design guard simultaneously.
- **Plugin phase 3 depth** — pointer tools, Worker-accelerated
  renderers, a self-hostable static plugin index (a JSON file, no
  central service), signed manifests, the MCP↔plugin bridge.
- **AI peers on the canvas** — the industry is converging on agents as
  first-class collaborators (§4.3). Canvix's MCP rail is the
  foundation; the interesting step is MCP-driven presence (the agent
  as a visible collaborator with a cursor and status) and
  streaming agent edits.
- **Object storage option** (S3/R2) for media, with lifecycle rules —
  as an *option*, keeping bytea the zero-config default.
- **Multi-region / read replicas** — only if real deployments ask.
- **Richer text merge** (per-span stamps or Yjs sub-documents for text
  elements only) — if and only if real usage demands it.
- **App-shell i18n** — the Translate feature is a design feature;
  localizing the editor UI itself is a community-shaped task.

## 8. What NOT to do (the discipline list)

1. **No paid tier, no metering, no watermark** — the README's founding
   promise; every "but we could monetize" idea is a fork, not a PR.
2. **No WebSocket infrastructure requirement** — SSE + Postgres stays
   the default transport; LISTEN/NOTIFY (M4) is still just Postgres.
3. **No wholesale Yjs migration** — the custom merge already provides
   the needed convergence properties for this document shape; revisit
   only per-span text merge, only with usage evidence (§4.3).
4. **No OAuth/email accounts** — username+password with zero moving
   parts is a feature for self-hosters, not a gap.
5. **No server-side render farm / export queue** — exports stay
   in-browser; MCP `export_design` stays the server-side exception.
6. **No plugin marketplace or monetization rail** — install-by-URL +
   a static index (someday) is the end state.
7. **No AI-washing** — features degrade honestly without a provider
   key, and nothing pretends otherwise in UI or docs.
8. **No unvetted dependencies** — every new dep needs a documented
   decision record; the current path to 1.0 adds **zero**.

---

## Appendix A — Internal evidence index

| Claim | Source |
|---|---|
| Collab rail lacked design-guard (P0) — **fixed in v0.11.8 (#8)** | pre-fix: `src/app/api/collab/[designId]/events/route.ts:62-69`, `presence/route.ts` (existence-only checks); `rg -l resolveDesignAccess` → 3 routes only. Fix: `design-guard.ts` `canEditDesign()`, both routes guarded; regression: `events/events.test.ts` (9), `presence/presence.test.ts` (5), `scripts/collab-guard-probe.sh` (8 live assertions) |
| Test counts (302 unit / 28 e2e at the studied revision; 316 unit after v0.11.8) & no CI automation | `src/**/*.test.ts` (18→20 specs), `tests/e2e/` (7 specs), `.github/workflows/` (2, both `workflow_dispatch`) |
| Whole-store subscriptions (5) | `PropertiesBar.tsx:47,690`, `ToolsPanel.tsx:152`, `BrandPanel.tsx:29`, `context-menu.tsx:49` |
| Collab cost model (0.31–1.25 q/s/client) | `stream/route.ts` pump + `db.ts` `max=1` pool; `research/V0110-SMOKE-TEST.md` |
| Element/model/template/font counts | `types.ts:5-21`, `templates/index.ts`, `editor-utils.ts:16-85`, `apps/registry.tsx` |
| Three-renderer constraint | `element-node.tsx:458`, `svg-export.ts:169`, `video-export.ts:124`; `PLUGIN-SYSTEM.md` §2.3 |
| God files & LOC census | `wc -l` sweep: `mcp/tools.ts` 1,316 · `editor-store.ts` 1,240 · `Dashboard.tsx` 992 · `CanvasStage.tsx` 981 · `PropertiesBar.tsx` 848; src ≈33k hand-written LOC |
| User-visible limits (60 undo, 30 versions, 25 MB images, 32 MB media, 500-event log, 240 s stream) | `editor-store.ts:266,809`, `add-element.ts:195-248`, `media/route.ts:18`, `stream/route.ts:20,189` |
| Offline merge properties & limits | `research/OFFLINE-MERGE.md`, `merge.ts`, `offline-store.ts:46-47` |
| Plugin proposal (all §4.4/§5.2 claims) | `research/PLUGIN-SYSTEM.md` (532 lines) |
| Security audit residuals | `research/V05-SECURITY-AUDIT.md`; current-code check §3.7 |
| Deployment matrix & sizes | `research/DEPLOYMENT-VERIFICATION.md`, `CLOUDFLARE-WORKERS-PORTABILITY.md` (2.13 MB gz / 3 MB cap) |
| Stale README claims | README "15 hand-picked Google Fonts" (tech-stack table) vs 63 actual; "no per-user ownership yet" (security notes) vs v0.9 |

## Appendix B — External sources (accessed 2026-11-01)

1. Canva product surface & AI tooling navigation — https://www.canva.com/canva-ai , https://www.canva.com/magic-design
2. Canva Magic Studio → Canva AI 2.0, free-tier AI allowance (~20 uses/month), feature availability — Moda, "Canva Magic Studio in 2026: What Each AI Tool Does" — https://moda.app/blog/canva-magic-studio
3. Canva AI feature table & workflow (Sep 30, 2026) — Coursiv, "How to Use Canva AI (2026)" — https://coursiv.io/blog/how-to-use-canva-ai
4. Yjs (CRDT library, benchmark & ecosystem context) — https://github.com/yjs/yjs
5. Electric's blog (electric.ax) — "AI agents as CRDT peers — building collaborative AI with Yjs" (Apr 8, 2026) — https://electric.ax/blog/2026/04/08/ai-agents-as-crdt-peers-with-yjs
6. tldraw SDK positioning ("Infinite Canvas SDK for React") — https://tldraw.dev ; https://flaviocopes.com/tldraw (Sep 12, 2026)
7. Penpot: open-source design platform & plugin system — Smashing Magazine (Nov 14, 2024) — https://www.smashingmagazine.com/2024/11/open-source-meets-design-tooling-penpot ; plugin gaps thread — https://community.penpot.app/t/what-s-working-and-what-s-missing-in-penpot-plugins/9785 ; 2026 initiatives — https://community.penpot.app/t/not-a-roadmap-but-whats-coming-in-penpot-june-2026/10628
8. Liveblocks review & collaboration-API landscape — https://aiforbusinessautomation.com/tools/liveblocks-review ; "The Rise of Live Collaboration APIs in 2025" — https://medium.com/@asierr/the-rise-of-live-collaboration-apis-in-2025-3258c58a6ed1
9. Figma plugin two-runtime architecture (iframe UI + sandboxed QuickJS-WASM background) — sam.today, "Bundling around the Figma Plugin Runtime Limits" — https://www.sam.today/blog/bumbling-the-figma-api ; UI-iframe postMessage model — https://alcohollick.com/writing/2020-02-11-figma-plugin-tutorial-5-6
10. Canva Developers Platform / Apps SDK (unified Developers SDK incl. MCP) — https://www.canva.dev/docs/apps/rest-apis/capabilities ; launch coverage — https://www.enterprisetimes.co.uk/2023/06/20/canva-launches-global-developers-platform-and-new-integration-capabilities
11. WebCodecs API (frame-level encode, latency characteristics) — https://www.toolsku.com/en/blog/web-codecs-api (Jun 13, 2026); https://2019.esg.kennedywilson.com/webcodecs-837547 ; HN discussion — https://news.ycombinator.com/item?id=40332579
