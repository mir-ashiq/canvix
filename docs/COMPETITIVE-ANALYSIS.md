# Canvix Competitive Analysis & Feature Gap Report — Wave 1

> Date: 2026-11-09 · Baseline: v0.16.5 · Scope: 10 repositories × 120 features × 8 categories
> Method: code-level evidence from shallow clones (every score traces to code, not marketing claims)

This is the Wave 1 research foundation of the consolidation programme. It quantifies where Canvix
stands against the nine closest open-source design tools and defines the feature waves that follow.
The full 26-page report (`Canvix-Competitive-Analysis-Wave1.docx`) and the 120-feature scoring
matrix (`Canvix-Feature-Gap-Matrix.xlsx`) were produced alongside this document.

## The competitive set

| Product | Repository | Stars | License | Engine | Position |
|---|---|---|---|---|---|
| Doory | shaongitbd/doory | ~2.6k | AAL (non-OSI) | Fabric.js 7 | Full suite; print-grade export; 39-tool MCP |
| HyCanvas | hyscaler/HyCanvas | ~276 | AGPL-3.0 | Custom Canvas2D | Suite of suites: slides, video, whiteboard, docs, sheets |
| OpenDesign | clawnify/OpenDesign | ~126 | MIT | Fabric.js 6 | Single-tenant LinkedIn carousels + agent fill API |
| canva-clone | sanidhyy/canva-clone | ~106 | MIT | Fabric.js 7 | SaaS shell: auth, paywall, BYO-key AI |
| Orcanva | TheOrcDev/orcanva | ~75 | MIT | Konva + WebGL | Collab + local WebGPU AI + 8k graphics |
| Loomic | fancyboi999/Loomic | ~310 | MIT | Excalidraw 0.18 | Agent canvas: 44 gen models, skills, billing |
| Jaaz | 11cafe/jaaz | ~6.7k | Custom non-OSI | Excalidraw 0.18 | Desktop agent; ComfyUI/Ollama; stale since 2026-03 |
| BurnGuard | ashmoonori-afk/BurnGuard | ~34 | Apache-2.0 | Sandboxed iframe DOM | Desktop AI workspace driving Claude Code/Codex CLIs |
| Avnac-Studio | striker561/Avnac-Studio | ~78 | GPL | Custom Saraswati | Native desktop canvas + 27-tool MCP server |

## Headline results

Scoring: 2 = fully shipped, 1 = partial, 0 = absent, across 120 features (max 240).

| Product | Points | Coverage | Canvix covers | Behind vs Canvix | Ahead vs Canvix |
|---|---|---|---|---|---|
| **HyCanvas** | 199 | **82.9%** | 60.8% | — | 48 features (30 strict) |
| **Doory** | 163 | **67.9%** | 68.1% | — | 35 features (17 strict) |
| **Canvix** | **139** | **57.9%** | — | 3rd of 10 | — |
| Orcanva | 108 | 45.0% | 78.7% | 18 (5 strict) | — |
| BurnGuard | 64 | 26.7% | 67.2% | 13 (8 strict) | — |
| Avnac | 61 | 25.4% | 83.6% | 7 (3 strict) | — |
| Loomic | 55 | 22.9% | 74.5% | 10 (4 strict) | — |
| Jaaz | 45 | 18.8% | 73.3% | 9 (3 strict) | — |
| canva-clone | 40 | 16.7% | 82.5% | 4 (3 strict) | — |
| OpenDesign | 32 | 13.3% | 78.1% | 5 (2 strict) | — |

**Canvix ranks 3rd of 10 and covers 57.4% of the best-in-class union.** Against every competitor
except HyCanvas, Canvix is ahead on more features than it is behind.

## Category coverage

| Category | Canvix | Best competitor | Deficit |
|---|---|---|---|
| Editor core (27) | 74.1% | HyCanvas 90.7% | 16.6 pts |
| Design modes (13) | 34.6% | HyCanvas 80.8% | 46.2 pts |
| Templates & branding (7) | 35.7% | HyCanvas 92.9% | 57.2 pts |
| Assets & content (13) | 76.9% | HyCanvas 92.3% | 15.4 pts |
| AI features (16) | 65.6% | HyCanvas 68.8% | 3.2 pts |
| Export & sharing (14) | 46.4% | HyCanvas 82.1% | 35.7 pts |
| Collaboration (10) | 50.0% | HyCanvas 100.0% | 50.0 pts |
| Accounts & platform (20) | 52.5% | Doory 67.5% | 15.0 pts |

Canvix is **unevenly strong**: near the top in assets, editor core and AI; far behind in templates,
design modes, export options and team-grade collaboration.

## The moat (protect these)

1. **Sandboxed plugin system** with plugin-owned canvas element renderers — unique in the set.
2. **MCP server (20 tools)** whose agent edits stream live into open editor sessions.
3. **Multi-provider AI console** — 8 providers × 4 capability slots, kill switches, live tests, request logs.
4. **Offline-tolerant, serverless-friendly realtime collaboration** (SSE + event log + HLC merge).
5. Deepest export stack (vector-text PDF, hand-rolled WebM/GIF encoders), Magic Layers, 24-language
   translation, stock video, beat sync, and the largest template library after HyCanvas.

## Consolidation roadmap

### Wave 2 — Asset & Template Ecosystem ✅ SHIPPED (v0.17.0, 2026-11-09)
Icon library (Iconify-style proxy + 562-icon offline pack) · 48-illustration packs ·
font catalog 63 → 369 (on-demand loading) · custom font upload · save-as-template ·
template fields + CSV bulk fill (+ REST fill API) · server-side brand kits ·
preset catalog 8 → 60 · template library 110 → 366 (12 smart + 244 computed variants).
Details: docs/ASSETS-AND-TEMPLATES.md · acceptance: 1187 unit tests, 11/11 e2e,
migration 0011 upgrade-safe. Matrix re-score pending (Wave 3 kickoff).

### Wave 3 — Editor Depth Parity ✅ SHIPPED (v0.18.0, 2026-11-09)
Image masks (10 shapes + custom) · text auto-fit · bullet/numbered lists · RTL & complex scripts ·
parametric polygons/stars · grid overlay · per-page sizes · presenter view with speaker notes ·
(bezier pen, boolean ops as stretch goals).
No migration (additive nullable fields only; pre-v0.18 documents unchanged). One shared
geometry/layout module per concern (lib/shapes.ts, lib/text-fit.ts, lib/list-text.ts) drives the
canvas, SVG, vector-PDF and video renderers in lockstep; PDF list/RTL text rides the documented
raster-strip approximation for v1. Acceptance: 1304 unit tests (+65), wave3 e2e suite
(tests/e2e/wave3-editor-depth.spec.ts), scripts/verify-wave3.sh. Also shipped: boot-time template
top-up (lib/templates/sync.ts — auto-deployed instances no longer serve a stale library).
Stretch goals deferred with the roadmap; matrix re-score pending (Wave 4 kickoff).

### Wave 4 — AI Power-Up
Local upscaling (Real-ESRGAN/Lanczos) · brush magic eraser (LaMa) · agentic planning with editable
review gate · canvas-screenshot vision grounding (MCP tool) · AI theme generation · speaker-notes
generation · video-generation capability slot · alt-text generation.

### Wave 5 — Export & Sharing Professionalisation
Share links with view/comment/edit roles + password + expiry · ZIP batch export · WebP · PPTX ·
print production marks (bleed/crop/300 DPI) · server-side rendering · portable `.canvix` project
file · optional public gallery.

### Wave 6 — Collaboration & Platform Trust
Email + password reset · OAuth + OIDC SSO · comment @mentions with email notifications · per-user
undo in shared sessions · object edit locks · Docker/compose self-hosting · i18n framework ·
light/dark themes · PWA/mobile groundwork · REST API + scoped API keys · (teams as stretch).

**Deferred by design** (revisit after Wave 6): multi-track video timeline editor, document mode,
spreadsheet mode, live-audience presenting. These are HyCanvas-scale product surfaces; Canvix
would already lead the set on coverage without them.

## License warnings

HyCanvas (AGPL-3.0 + CLA), Doory (non-OSI AAL), Jaaz (custom, forbids derivative/competing use)
and Avnac (GPL) code **must not be copied** into Canvix. The "source pattern" references above are
for behavioural study only — all implementations must be clean-room. OpenDesign, canva-clone,
Orcanva, Loomic (MIT) and BurnGuard (Apache-2.0) are safer to read closely.

## Acceptance bar for every wave

Each feature lands with: unit tests + one e2e spec, documentation, admin kill-switch coverage
(where AI or third-party calls are involved), schema migration with upgrade test from v0.16.5
documents, export-parity checks (PNG/SVG/PDF/video), and zero regressions in the existing suite.
Re-score this matrix after each wave — the xlsx workbook is the instrument.
