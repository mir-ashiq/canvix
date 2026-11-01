# v0.11.4 QA pass — full-app human walkthrough

Date: 2026-11-01 · Environment: local dev (Next.js 16.4.3 / Turbopack),
PostgreSQL 17 (embedded), seeded 110 templates, Chromium 156 headless at
1440×900 and 390×844, two parallel browser sessions for collaboration.

Scope: every user-facing surface exercised like a normal human —
landing → dashboard → editor (text, shapes, images, draw) → export →
share → auth → collaboration → comments → versions → mobile.

## Result matrix

| Area | Case | Result |
| --- | --- | --- |
| Landing | hero, CTAs, template showcase, open-source section, GitHub links | ✅ |
| Dashboard | quick-create presets, template browsing, categories, search, Projects | ✅ |
| Editor · text | add box, double-click edit overlay, commit on Escape, font size, bold | ✅ |
| Editor · history | undo/redo granular (bold → size → text), disabled states honest | ✅ |
| Editor · shapes | add circle/square, drag, resize 320→506px, rotate to 81°, z-order (To front) | ✅ |
| Editor · colour | Fill menu: brand palette, gradients picker opens, fill applied (#7630D7) | ✅ |
| Photos | 42 bundled photos render, add to canvas (756×432) | ✅ |
| Photos | web search without an AI provider key | ⚠️ see F2 |
| Uploads | file input → data-URL image lands on canvas | ✅ |
| Draw | brush colour + stroke created (12-pt line) | ✅ |
| Export | PNG 2160×2160 RGBA, SVG true vector (clipPaths), PDF 1 page 1440×1440pt | ✅ |
| Preview | fullscreen overlay, reduced-motion toggle, Close | ✅ |
| Autosave | design persisted to Postgres without explicit save | ✅ |
| Versions | labelled snapshot (“QA test v1”), Restore + Delete actions, DB row | ✅ |
| Auth | register (scrypt, DB row), adopt-all claim, sign out, sign in, wrong-password inline error | ✅ |
| Ownership | adopted design attributed to the account; dashboard scopes to owned | ✅ |
| Share | dialog generates canonical `/design/<id>` link | ✅ |
| Deep links | `/?design=`, `/?d=`, `/design/<id>` all open the editor | ✅ |
| Collab · stream | SSE replay from `?since=0` (21 events, HLC-stamped), keepalives, presence snapshot | ✅ |
| Collab · presence | second session joins, both eventually see 2 | ⚠️ see F4 |
| Comments | canvas pin drop, post with author identity, DB row, cross-session sync | ✅ |
| MCP | disabled without `CANVIX_MCP_TOKEN` — clear JSON-RPC error, no auth bypass | ✅ |
| Health | `/api/health` → ok, db kind/host, template count | ✅ |
| Mobile | editor + dashboard at 390px: no horizontal overflow, panels adapt | ✅ |
| Tests | vitest 285/285, Playwright 19/19 (incl. 5 new design-URL tests) | ✅ |

## Findings (fix candidates)

- **F1 — no deselect on empty-canvas click.** Clicking empty canvas keeps
  the current selection; only Escape deselects. Canva deselects on empty
  click. One-line fix in `CanvasStage.handleStageMouseDown` (stage-level
  click that hits no element → clear `selectedIds`).
- **F2 — Photos panel search state sticks.** After a web search returns
  “Web results (0)”, the “All photos” tab shows only the last category’s
  photos (6 of 42) instead of the full grid; the panel must be closed and
  reopened to recover. The category switch after a search doesn’t reset
  the results-mode flag. Also: no hint that web results need an AI
  provider key — a one-line “configure an AI provider to search the web”
  note would prevent the “search is broken” impression.
- **F3 — editing-mode toggles can disagree.** The top-bar “Editing mode”
  control and the Tools-panel Select/Draw toggle are separate states:
  the top bar can read “Draw” while the canvas behaves as Select. Only
  the Tools-panel toggle reliably activates drawing. Either drive both
  from one store field or make the top-bar control the single source.
- **F4 — presence latency for idle clients (most impactful).** The
  stream pump sends a frame only when events exist or every 20th tick;
  with the quiet-mode backoff (800ms → 3.2s) a newly joined participant
  takes ~60–90s to appear for clients that aren’t editing. Measured: join
  visible to the idle session only after ~90s. Fix: diff the presence
  list per tick and send a presence-only frame when it changes (or cap
  the presence cadence at ~5s). Cursor moves already ride heartbeats —
  it’s joins/leaves that stall.
  **→ FIXED in v0.11.5** (per-tick presence diff + announce-on-join;
  `research/V0115-PRESENCE-JOIN-LATENCY.md` — the same scenario now
  measures **1.9 s**).
- **F5 — React anti-pattern warning.** Console: “Cannot update a
  component (`MagicLayersDialog`) while rendering a different component
  (`CanvasStage`)”. A setState-during-render in the MagicLayers flow —
  harmless today but a future-interaction landmine.
- **F6 — share of signed-out ownerless designs.** The share URL works
  for anyone (by design, v0.5 note in README §collab). The editor shows
  an honest view-only banner for other accounts’ designs — correct; just
  worth documenting on the Share dialog for self-hosters.

## Enhancement candidates (beyond fixes)

- Browser Back/Forward: the shell uses `replaceState` (popstate unrouted);
  wiring popstate → view store would give natural history navigation now
  that URLs are canonical.
- Photos search: fall back to filtering the bundled library when no AI
  provider is configured (search “mountain” → nature pack).
- Presence avatar tooltips could show the “last seen” age for stale
  collaborators before the 30s GC window drops them.
