# Canvix Roadmap — where we are, what's next

> **Status date:** 2026-11-13 · **Current release:** [v0.23.1](https://github.com/mir-ashiq/canvix/releases/tag/v0.23.1) · **Test posture:** 1402 unit tests (108 files) · 32 e2e specs · CI gates every PR (`lint-unit` incl. production build + `e2e`) · `npm audit` **0 vulnerabilities**.
>
> This is the living map of the project: the two planning eras (the original **v0.11.8 → v1.0 roadmap** and the **consolidation programme** that overtook it), exactly what shipped under each, what remains open, and the recommended order for finishing the job. The full research it synthesizes: `research/V0118-ROADMAP-RESEARCH.md` (the original decision record) and `docs/COMPETITIVE-ANALYSIS.md` (the wave plan + five-cluster reanalysis).

---

## 1. The two planning eras

Canvix has been driven by **two consecutive roadmaps**, and understanding both is the key to reading the version history:

1. **The original roadmap** (2026-11-01, `research/V0118-ROADMAP-RESEARCH.md`) — a phased arc from v0.11.7 to v1.0: **v0.12** Trust & Rails → **v0.13** Plugin System → **v0.14** Daily-Driver Depth → **v0.15** Rich Content & Export → **v0.16** Mobile & Collab Scale → **v1.0-rc** Stabilization.
2. **The consolidation programme** (2026-11-09+, `docs/COMPETITIVE-ANALYSIS.md`) — a code-level audit of 9 competitor repos × 120 features that re-prioritized the remaining work into **Waves 2–6** aimed at closing the measured gap profile. This programme **overtook the original roadmap after v0.16**: the version slots v0.17 → v0.23 carry wave work, not the original phase plan.

The original plan's **v0.12, v0.13, v0.14 and v0.15 shipped in full and on plan** (v0.12.0–v0.16.5 in the changelog, 2026-11-02 → 11-08). At the point where the original plan called for "v0.16 — mobile & collaboration scale", the competitive audit landed and showed higher-value targets (assets, editor depth, AI, sound, export); the project pivoted to waves. **The original v0.16 mobile/collab-scale epics were never cancelled — they were displaced, and are now the single largest open block** (see §4).

---

## 2. What has shipped (the completed map)

### 2.1 The original roadmap — completed phases

#### ✅ v0.12 "Trust & Rails" (shipped as v0.12.0–v0.12.5, 2026-11-02) — 100% of planned scope

| Epic | Status | Shipped as |
|---|---|---|
| H1 — Collab-rail access enforcement (the P0) | ✅ | v0.11.8 (PR #8) — pulled forward |
| H2 — PR CI gate (`tsc` + eslint + vitest + Playwright, branch protection, badge) | ✅ | v0.12.0 |
| H3 — Security headers + CSP baseline | ✅ | v0.12.1 |
| H4 — Error boundaries (a crash is never a white screen) | ✅ | v0.12.2 |
| H5 — Rate limits & connection caps | ✅ | v0.12.3 |
| H6 — Docs & ops runbook (backup/restore, upgrade, rollback, media GC) | ✅ | v0.12.4 (`docs/BACKUP-AND-RESTORE.md`, `docs/UPGRADING.md`) |
| H7 — Observability floor (opt-in logging, health v2, error webhook) | ✅ | v0.12.5 |

*Hardening that arrived later on top:* deployer hardening on the VPS (standalone snapshot + restore on build failure, 2026-11-07), the CI production-build guard (v0.16.1), weekly Dependabot grouping + the 8-alert cleanup (2026-11-13), and the grant-application trust layer — SECURITY.md, GOVERNANCE.md, CODE_OF_CONDUCT.md, funding.json (v0.22.1).

#### ✅ v0.13 "Plugin System MVP" (shipped as v0.13.0–v0.13.4, 2026-11-02/03) — 100% of planned scope

| Epic | Status | Shipped as |
|---|---|---|
| P1 — Runtime core (manifest + validator, install/consent, serve route w/ per-manifest CSP, sandboxed iframes, RPC broker, `CANVIX_PLUGINS` flag) | ✅ | v0.13.0 |
| P2 — Install rail (URL install, sha256-pinned asset snapshot, offline-forever installs) | ✅ | v0.13.1 |
| P3 — Panel runtime (apps-in-iframe with brokered permissions) | ✅ | v0.13.2 |
| P4 — The `plugin` element + deterministic SVG renderer contract (three-renderer integration, placeholder states) | ✅ | v0.13.3 |
| P5 — Reference plugin + security suite + docs | ✅ | v0.13.4 — Word Cloud first-party plugin + `docs/PLUGINS.md` |

*The one deviation:* the plugin-phase ceiling incident (twice — v0.22.0 and v0.23.0 bumped the host version and forgot the shipped plugin's `engines` ceiling; both fixed same-day) exposed a small process gap — now documented as a release-checklist item.

#### ✅ v0.14 "Daily-Driver Depth" (shipped as v0.14.0–v0.14.5, 2026-11-04/05) — 6 of 10 epics, then the audit pivoted

| Epic | Status | Shipped as |
|---|---|---|
| D1 — Persistent uploads library (DB-backed, dedupe, cross-device) | ✅ | v0.14.0 |
| D2 — System clipboard & cross-tab copy/paste | ✅ | v0.14.1 |
| D6 — Dashboard folders | ✅ | v0.14.2 |
| D4 — Image filter gallery | ✅ | v0.14.3 |
| D7 — Data-bound native chart element | ✅ | v0.14.4 |
| D3 — Even distribution | ✅ | v0.14.5 |
| D5 — Auto version snapshots before destructive ops | ❌ **open** | — (see §4) |
| D8 — Tables depth (per-cell fonts, header styling) | 🟡 **partial** | base tables shipped v0.6; depth unstarted |
| D9 — Brand kit server sync | ✅ | v0.17.0 (server-side brand kits, Wave 2) |
| D10 — Spellcheck | ❌ **open** | — (see §4) |

#### ✅ v0.15 "Rich Content & Export" (shipped as v0.15.0–v0.15.5, 2026-11-05/06/07) — 100% of planned scope, the roadmap's heaviest phase

| Epic | Status | Shipped as |
|---|---|---|
| R1 — Rich text (per-span styling, lossless migration, box-level LWW documented) | ✅ | v0.15.0 |
| R2 — WebCodecs export pipeline (hand-rolled WebM muxer, zero new deps) | ✅ | v0.15.1 |
| R3 — Moving video in exports (frame-accurate, both engines) | ✅ | v0.15.2 |
| R4 — Vector-text PDF (real selectable text, subset fonts, jsPDF removed) | ✅ | v0.15.3 (`docs/PDF-VECTOR-EXPORT.md`) |
| R5 — GIF export (hand-rolled GIF89a + LZW, zero new deps) | ✅ | v0.15.4 (`docs/GIF-EXPORT.md`) |
| R6 — Stock video depth (Pexels/Pixabay connectors, durable attribution) | ✅ | v0.15.5 (`docs/STOCK-VIDEO.md`) |

#### ✅ The "v0.16" slot — spent on the admin arc instead of mobile (2026-11-07/08)

Not in the original plan, forced by operating canvix.app in production:

| Epic | Status | Shipped as |
|---|---|---|
| A1 — Admin console part 1 (fail-closed admin, traffic analytics, user directory, AI config, instance settings) | ✅ | v0.16.0 (`docs/ADMIN.md`) |
| A1-fix — self-hosted build regression (edge-instrumentation Prisma excision + CI build gate) | ✅ | v0.16.1 (PR #39) |
| A2 — Multi-provider AI table (8 providers × 5 capability slots incl. video, write-only keys) | ✅ | v0.16.2 |
| A3 — Per-slot "Test" buttons + failure verdicts | ✅ | v0.16.3 |
| A4 — Stock-key Test buttons | ✅ | v0.16.5 |
| A5 — The stock-key layer itself (Pexels/Pixabay/Freesound keys, masks, env fallback) | ✅ | v0.16.4/v0.16.5 |

### 2.2 The consolidation programme — waves shipped

| Wave | Theme | Status | Shipped as |
|---|---|---|---|
| **Wave 1** | The audit itself (10 repos × 120 features, the gap matrix, the wave plan) | ✅ | `docs/COMPETITIVE-ANALYSIS.md` (2026-11-09) |
| **Wave 2** | Asset & template ecosystem — 562 offline icons + Iconify proxy, 48 illustrations, fonts 63→369 (on-demand), custom font upload, save-as-template, template fields + CSV bulk fill + REST fill API, server-side brand kits, presets 8→60, templates 110→366 | ✅ | v0.17.0 (`docs/ASSETS-AND-TEMPLATES.md`) |
| **Wave 3** | Editor depth parity — image masks (10 shapes + custom), text auto-fit, bullet/numbered lists, RTL & complex scripts, parametric polygons/stars, grid overlay, per-page sizes, presenter view + speaker notes | ✅ | v0.18.0 |
| **Wave 4** | AI Power-Up — local upscaling (Lanczos-3), brush magic eraser (clean-room inpainting), agentic planning w/ review gate, vision grounding (the 21st+ MCP tool), AI theme generation, speaker-notes generation, video-generation slot (Sora-style async), alt-text generation | ✅ | v0.19.0 (`docs/AI-POWER-UP.md`) |
| **Sound** | The beat-sync moat gets a source — 16-sound CC0 library, Freesound connector, voiceover recording, animation/transition SFX | ✅ | v0.20.0 (`docs/SOUND.md`) |
| **Wave 5 (slice 1)** | PPTX export (native editable slides + notes, zero deps, LibreOffice-verified) | ✅ | v0.21.0 (`docs/PPTX-EXPORT.md`) |
| — | The real sticker library (126 authored vector stickers, 11 packs, full export parity) | ✅ | v0.22.0 |
| — | Grant-application trust layer (SECURITY / GOVERNANCE / CONDUCT / funding.json) | ✅ | v0.22.1 |
| — | **Bring your own key** — profile page, per-user AI providers (`UserAIProvider`, migration 0012), user-aware capabilities, key-before-instance resolution | ✅ | v0.23.0 |
| — | v0.23.1 patch: admin video-slot save fix (the `SLOT_ORDER` omission), BYOK failure hints on all five AI surfaces, the missing `/test` route shipped (a `.gitignore` casualty) | ✅ | v0.23.1 |

### 2.3 Where that leaves the numbers

| Metric | v0.11.7 (roadmap baseline) | **Now (v0.23.1)** |
|---|---|---|
| Element types | 16 | **19** (+ polygon, plugin, chart) |
| Templates | 110 | **366** |
| Fonts | 63 | **369** + custom upload |
| First-party apps | 9 | 14 (icons, illustrations, charts native, planner, theme…) |
| MCP agent tools | 20 | **22** (+ `vision_ground`, `generate_design`) |
| Export formats | PNG/JPG/PDF-raster/SVG/MP4-WebM | + **vector-text PDF, GIF, WebCodecs WebM, PPTX** (11 formats total) |
| Stock content | 42 bundled photos | + Pexels/Pixabay video, Freesound, 562 icons, 48 illustrations, 126 stickers, 16 sounds |
| Unit / e2e tests | 302 / 28 | **1402 / 32** |
| CI | none | PR-gated, build + e2e, branch protection |
| Security posture | P0 open | headers/CSP, rate limits, SSRF corpus, plugin sandbox, 0 audit vulns, disclosure policy |
| Hand-written LOC | ≈33,000 | ≈91,000 |

**Competitive standing** (Wave 1 audit + reanalysis): 3rd of 10 on the 120-feature matrix; ahead of every competitor except HyCanvas on more features than behind. Gap clusters: content libraries ~98% closed, presentation story ~90% closed, sound **closed**, enterprise wall ~25% closed, AI video slot closed in code (provider is config, not code).

---

## 3. In flight / recently landed (watch these)

- **v0.23.x BYOK polish** — the feature works end-to-end (verified live on canvix.app: save → mask echo → capabilities → test route → per-slot precedence), and v0.23.1 hardened the console round-trip. Optional next polish: usage accounting per user (`AIUsage` rows already carry the actor), and an admin-visible "N users have BYOK providers" stat.
- **Dependency freshness** — the 2026-11-13 sweep merged 9 Dependabot PRs (Next 16.4.6, babel, Actions bumps, the 79-update dev group); lucide-react 1.x and Prisma 7 were deliberately declined with reasons on the PRs (lucide 1.0 drops brand icons the code imports; Prisma 7 breaks the patched-wasm generation flow). Both need real migration PRs, not bot bumps.
- **Release hygiene** — the plugin-ceiling incident (×2) and the `.gitignore`-ate-my-route incident both argue for a small **release checklist** doc: bump host → check plugin `engines` ceiling → `git status` for untracked route files → cut tag + release notes. (Enhancement E9 below.)

---

## 4. What's missing — the open map, ranked

### 4.1 The displaced v0.16 block: mobile & collaboration scale (the biggest open item)

The entire original phase was displaced by the consolidation programme. Nothing in it has shipped; the README's only unchecked feature box is this block. All six epics remain valid — the audit's "Collaboration 50% vs HyCanvas 100%" and "Design modes" deficits overlap heavily with it:

| Epic | What | Why it matters now | Effort |
|---|---|---|---|
| **M1** | Touch-first editing (large handles, 1-finger drag vs 2-finger pan, double-tap zoom, long-press menu) | The only README promise left unchecked; mobile sessions are real traffic | M |
| **M2** | Bottom-sheet properties on mobile | Companion to M1; the v0.11.3 responsive groundwork is the seam | M |
| **M3** | Gesture polish (pinch-rotate, momentum pan, edge-pinch) | "Feels native" parity pass with Canva mobile web | S/M |
| **M4** | Collab fan-out — Postgres LISTEN/NOTIFY → in-process hub → SSE (kill the per-connection poll loop) | The scaling wall: ~0.31–1.25 q/s per client through a `max=1` pool; fine at tens of editors, a wall at hundreds of viewers. The `?since=` replay cursor already makes the migration safe | L |
| **M5** | Comment richness — @mentions, reactions, deep links | Audit's collaboration deficit; accounts exist, comment store is separate — the seam is there | S/M |
| **M6** | Op-level undo broadcast (undo syncs as ops, not `pages:replace`) | Live-session correctness: today undo clobbers a concurrent remote edit | M |

### 4.2 Leftover D-epics (small, independent, any order)

| Epic | What | Notes | Effort |
|---|---|---|---|
| **D5** | Auto version snapshots before destructive ops (template apply, Magic Resize, Translate, Magic Layers, page delete) with "auto" chips + preferential pruning | `saveVersion(label?)` exists; the triggers are the work | S |
| **D8** | Tables depth — per-cell font family/size, header styling presets, drag row/col resize | `TableCell` today: `text/fill/bold` only; geometry is pure (`lib/v06-geometry.ts`) | M |
| **D10** | Spellcheck in the text-editing overlay | The textarea overlay exists; browser spellcheck is nearly free; "Check spelling" pass is the S/M part | S–M |
| — | Wave-3 stretch goals: bezier pen tool, boolean shape ops | Deferred explicitly in v0.18 notes; still wanted | M each |

### 4.3 Wave 5 remainder — export & sharing professionalisation (the named next wave)

Only the PPTX slice shipped. Remaining scope, in recommended order:

| Item | What | Notes | Effort |
|---|---|---|---|
| **Share links with roles** | view/comment/edit roles + password + expiry on public share URLs | The current share model is owner/read-only; the collab guard gives the enforcement seam | M |
| **ZIP batch export** | Export a folder / multi-page ranges in one download | Rides the existing encoders; the container work is standard | S/M |
| **WebP export** | Ninth raster format | Encoder is in-platform (`Image.encode`); dialog + plumbing only | S |
| **Print production marks** | Bleed/crop marks, 300 DPI target | PDF path already vector; marks are geometry | S/M |
| **`.canvix` portable project file** | Single-file design bundle (design JSON + embedded media) | Backup/portability story; the media store already chunks | M |
| **Server-side rendering** | Headless export (the MCP `export_design` path extended) | Careful scope: no render farm (the discipline list) — one-shot, capped | M/L |
| ~~Public gallery~~ | optional community gallery | **Recommend deferring** — moderation burden; against the "no cloud gatekeeping" grain unless opt-in per instance | — |

### 4.4 Wave 6 — collaboration & platform trust (the enterprise wall, ~25% → closed)

This is the largest *new* surface, and the audit's biggest measured deficit (Accounts & platform, Collaboration). Suggested cuts:

- **Core (do these):** email + password reset · comment @mentions (overlaps M5) · per-user undo in shared sessions (overlaps M6) · object edit locks · Docker/compose self-hosting (the single most-asked self-hoster item) · REST API + scoped API keys (the MCP rail proves the model).
- **Choose deliberately:** OAuth + OIDC SSO (enterprise ask; the original roadmap's discipline list said "no OAuth" — the audit reopened it; decide once, document it) · i18n framework · light/dark theme toggle · PWA install.
- **Stretch (post-1.0):** teams/workspaces, shared brand kits (the `Organization`/`Membership` models from the original §7).
- **2FA** — mentioned in the enterprise-wall cluster; TOTP is small and self-contained.

### 4.5 The v1.0-rc stabilization phase (original S1–S4 — none started)

| Epic | What | Effort |
|---|---|---|
| **S1** | Performance budgets in CI (500-element × 30-page benchmark, startup + export memory ceilings) | M |
| **S2** | Accessibility audit (keyboard-only editing story, focus sweep, contrast sweep, canvas a11y statement) | S/M |
| **S3** | Self-hoster & contributor handbook (consolidate the 13 docs/ guides into one arc) | S/M |
| **S4** | 1.0 definition pass — "every README promise shipped and verified", version commitment, tag v1.0.0 | S |

**Where that puts v1.0:** the honest distance is **M-block (6 epics) + Wave-5 remainder + Wave-6 core + S1–S4** ≈ 25–40 contributor-weeks for one experienced contributor. With the wave-based execution rate this project has shown (11 shipped feature releases in 12 days), v1.0 is reachable without heroics — but it is *earned*, not scheduled (the original sequencing rule stands: if a phase slips, 1.0 ships without the slipped item rather than untested).

---

## 5. What needs enhancement (shipped, but with known ceilings)

1. **AI provider portability (debt #9, scheduled "v0.15" in the original plan, never done).** `z-ai-web-dev-sdk` remains the only pre-1.0 dependency and is vendor-locked. The admin table + BYOK now wrap it on both sides; the remaining step is the **adapter interface** so any OpenAI-compatible provider is first-class. This is also the prerequisite for a real BYOK model catalog.
2. **eslint posture (debt #11).** ~25 rules disabled incl. `react-hooks/exhaustive-deps`. The whole-store subscriptions (debt #3) were never fixed either — `PropertiesBar` ×2, `ToolsPanel`, `BrandPanel`, `context-menu` still re-render on every mutation. Both are perf/quality multipliers; both are "real refactor" sized.
3. **God files (debt #6).** `mcp/tools.ts` (1,316 → now larger), `editor-store.ts` (1,240), `Dashboard.tsx` (992), `CanvasStage`/`PropertiesBar` — the change-velocity tax compounds; each split is M-sized and safe to do opportunistically.
4. **Media lifecycle (debt #4/H6 residue).** bytea-in-Postgres works (32 MB cap) but there is no user-facing media delete/GC; orphans accumulate. An S-sized "delete on element delete + GC sweep" closes the loop; object storage (S3/R2) stays the documented post-1.0 option.
5. **In-memory rate limits (debt #12).** Per-instance only — honest docs shipped; the shared-store option is post-1.0. Docker/compose (Wave 6) makes single-instance the norm, which mostly defuses this.
6. **Rich-text merge coarseness (risk #5).** Two offline editors of one text box still whole-box LWW — documented at R1 ship. Per-span stamps or a Yjs sub-document are the post-1.0 evaluation, only if real usage demands.
7. **Video slot is code-complete but provider-dependent.** `videoGeneration: false` on canvix.app is a *configuration* state (no live video provider key), not missing code — worth an admin-console callout so operators don't misread it.
8. **Workers bundle headroom (risk #1).** Still the standing constraint at ~2.1–2.9 MB gz vs the 3 MB cap — every wave re-verifies via `verify-deploy-readiness`; keep dynamic-importing new subsystems.
9. **Release checklist** (new, from the two plugin-ceiling incidents + the gitignore casualty): host bump → plugin `engines` ceiling → untracked-file sweep → tag + release notes. S, and prevents repeat incidents.
10. **Template/plugin ecosystem depth.** One first-party plugin (Word Cloud) proves the rail; the ecosystem wants 2–3 more reference plugins exercising different permission sets (the original P3 ask, partially met) — good first-contributor work.

---

## 6. Recommended order (the "what next" verdict)

If only three things happen next, in order:

1. **Wave 6 core slice — Docker/compose + email/password reset + scoped API keys.** The enterprise wall is the biggest measured deficit and Docker is the highest-frequency self-hoster ask. (M-sized each, independent.)
2. **The M-block, led by M4 (collab fan-out).** LISTEN/NOTIFY removes the scaling wall while staying Postgres-only; M1–M3 close the last README promise; M5/M6 double as Wave-6 items.
3. **Wave 5 remainder (share roles first).** Roles+password+expiry sharing is the feature the competitive matrix scores hardest against Canva.

Then S1–S4 as the gate to v1.0. The enhancement list (§5) runs opportunistically alongside — items 1 (AI adapter), 4 (media GC) and 9 (release checklist) are the ones with disproportionate leverage.

---

## 7. Post-1.0 outlook (unchanged from the original §7)

Teams & shared workspaces · plugin phase-3 depth (pointer tools, worker renderers, a static self-hostable plugin index, signed manifests, the MCP↔plugin bridge) · AI peers on the canvas (MCP-driven presence, streaming agent edits — the industry direction the project already has the rails for) · object storage option for media · multi-region/read replicas if deployments ask · richer text merge if usage demands · app-shell i18n.

## 8. The discipline list (what NOT to do — reaffirmed)

No paid tier, metering or watermarks · no WebSocket infrastructure requirement (SSE + Postgres stays; LISTEN/NOTIFY is still just Postgres) · no wholesale Yjs migration · no email/OAuth *unless* the Wave-6 SSO decision deliberately reopens it (one decision, on record) · no server-side render farm · no plugin marketplace or monetization rail · no AI-washing (features degrade honestly without keys — the v0.23.1 BYOK hints extend this) · no unvetted dependencies (the current path to 1.0 still adds **zero**; jsPDF was removed in v0.15.3).

---

*Update this file with every release: move §3 items into §2, re-rank §4, and re-run the acceptance bar (unit + e2e + docs + export parity + upgrade test) for each wave. The roadmap is the contract; the changelog is the receipt.*
