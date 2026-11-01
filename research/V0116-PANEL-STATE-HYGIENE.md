# v0.11.6 — Panel state hygiene (F2 + F3) analysis & fix

Follow-up to `V0114-QA-PASS.md` §5.2 — the two "panel state hygiene"
findings, both reproduced on the v0.11.5 code before fixing.

## F2 — Photos panel search state sticks

**Reproduced** (two real browsers + scripted): search "food" → the bundled
grid narrows to the 6 food photos and the web-results section appears;
click "All photos" → the chip is pressed but the grid STAYS at 6 tiles and
the search box still reads "food". Only closing and reopening the panel
restores the 42-photo library.

**Root cause.** `PhotosPanel` holds `query` (the filter) and `cat` (the
category) as independent states, and `PanelShell`'s search input keeps
its own *local* text state. A category click only set `cat` — the query
kept filtering the grid (`photos` memo applies `cat` AND `query`), and
nothing could clear the visible input from outside the shell.

**Fix.**
- A category click now **exits results mode**: `pickCategory()` sets the
  category, clears the query, and drops the web results + any error.
- `PanelShell` accepts optional `searchValue` / `onSearchValueChange`
  (controlled input, backward compatible — ProjectsPanel keeps local
  state), so clearing the query clears the visible box too.
- Leaving results mode (query < 2 chars) resets the web results AND the
  error state — a stale hint beside the full library would be the same
  bug one frame later.

## F2b — web search on a provider-less server reads as broken

`withProvider` answers 503 `{code: 'NO_PROVIDER'}` when no AI provider is
configured (`ZAI_BASE_URL` / `ZAI_API_KEY` env or a `.z-ai-config` file).
The panel mapped every non-OK response to `[]` and rendered "No web
photos matched — try other keywords" — the exact "search is broken"
impression the QA pass warned about.

**Fix.** The fetch handler classifies the response: 503 `NO_PROVIDER` →
a configuration hint naming both env vars and noting the free library
still works; other errors → the API's own message; otherwise results as
before. The e2e spec mocks the 503 with `page.route`, so the branch is
pinned deterministically even on machines that DO have a provider.

## F3 — editing-mode toggles can disagree

**Reproduced** (v0.11.5): Tools-panel "Draw" pressed + crosshair cursor
while the top bar read just "Editing"; and after switching the top bar to
Viewing, the panel's Draw button stayed pressed over a read-only canvas.
Per the QA pass: "the top-bar control and the Tools-panel toggle hold
separate state; driving both from a single store field resolves it."

**Root cause.** `editingMode` ('editing' | 'viewing') and `tool`
('select' | 'draw') are two orthogonal store fields rendered by two
different controls, each telling half the truth.

**Fix — one derivation, three writes:**
- `interactionMode(editingMode, tool)` (`src/lib/editor-utils.ts`) —
  viewing wins, then the active tool → 'viewing' | 'draw' | 'editing'.
  The top-bar trigger labels and icons that derivation; 4 unit tests pin
  the truth table.
- The top-bar menu now offers **Draw — freehand brush** (and Editing
  resets to the select tool), so drawing is reliably activatable from the
  top bar — previously "only the panel toggle reliably starts drawing".
- `setTool` also leaves read-only viewing (`editingMode: 'editing'` in
  the same store write): the panel toggle can never again show Draw
  pressed over a read-only canvas, because pressing it resumes editing.
- The Tools panel explains the remaining honest edge case: in viewing
  mode it shows "Viewing mode is read-only — picking a tool resumes
  editing." (the pressed tool indicates what resumes, the mode says
  whether the canvas is editable).

`CanvasStage` needed no change — its handlers already key off both
fields (`editingMode !== 'editing'` gates everything; draw paths check
`tool === 'draw'`), which is why the mismatch was purely a display/
control problem.

## Verification

- Reproduced both findings on the pre-fix code in a real browser
  (screenshots `f2-repro-*` in the QA archive).
- Post-fix human pass: search "food" → 6 tiles → "All photos" → 42 tiles,
  box cleared, web section gone; "Textures" → 6 texture photos; top bar
  reads Draw/Editing/Viewing in lockstep with the panel and the canvas
  cursor; a real stroke drawn after activating Draw from the TOP BAR
  (Konva `Line` node verified); zero console errors (the remaining
  setstate-in-render warning is F5, pre-existing, out of scope here).
- Gates: `tsc --noEmit` clean · eslint clean · vitest **302/302**
  (4 new) · Playwright **23/23** (3 new, `panel-state.spec.ts`).
