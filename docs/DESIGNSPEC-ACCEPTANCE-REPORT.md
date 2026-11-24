# DesignSpec Phase A — real-model + real-browser acceptance report (v2)

**Date:** 24 November 2026 (v2 same day) · **Branch:** `feat/design-spec-foundation`
**Purpose:** the end-to-end acceptance run of the DesignSpec v2 foundation — now
closing the three gaps the first run (v1) surfaced honestly: no real-editor
exercise, a text-fitting failure, and a mechanical (band) color fallback.

## What ran

Two paths over the same canonical poster brief (1080×1350, three verbatim lines —
one carrying an em dash and middle dots — and two required hexes):

```
Path D (deterministic): prompt → extractBrief() → specFromBrief() → compileSpec()
Path M (real model):    LLM planner (z-ai GLM via sandbox SDK) → parseSpecResponse()
                        → compileSpec()
Render proof:           pages → exportPageToSVG() (the code path user downloads
                        use) → embedded in Chromium → screenshot + text/fill
                        verification on the RENDERED SVG
Editor proof (NEW):     pages → POST /api/designs (real API, real Postgres) →
                        /design/{id} in the real editor → zoom-exact double-click
                        opens the text overlay → edit → Escape commit → debounced
                        autosave → reload → persistence verified
```

Harness (re-runnable, committed): `scripts/designspec-compile.ts`,
`scripts/designspec-render.cjs`, `scripts/designspec-browser-entry.ts`, and
`tests/e2e/design-spec-editor.spec.ts` (runs against a live app + database —
the same pattern the 39-file e2e suite uses).

## Results — all green at both levels

| Check | Path D | Path M |
|---|---|---|
| Exact texts (char-for-character, NFC) — 3/3 | **PASS** | **PASS** |
| Required colors on page — 2/2 | **PASS** | **PASS** |
| All elements in canvas | **PASS** | **PASS** |
| No unintended content overlap | **PASS** | **PASS** |
| Text fits box (**wrap-aware**, was FAIL on M in v1) | **PASS** | **PASS** |
| WCAG contrast ≥ 4.5 (all pairs) | **PASS** | **PASS** |
| Rendered SVG carries required texts | **PASS** | **PASS** |
| Rendered SVG carries required fills | **PASS** | **PASS** |

**Editor proof (new):** the compiled poster was created as a real design through
`/api/designs`, opened in the real editor (Konva canvas at 42% fit), the text
overlay opened by double-clicking the subline (zoom-exact coordinate mapping
from the compiled element geometry), the text edited, committed with Escape,
and the debounced autosave persisted it to Postgres. After a reload the edit
survived and the two untouched required lines were still present
**character-for-character**. Screenshots: `test-results/designspec/`
(loaded / editing / reloaded).

Unit suite: **50/50 design tests** (v1: 45), **1,631/1,631 full branch suite**,
`tsc --noEmit` clean, eslint clean.

## Improvement 1 — text reflow (the v1 honest failure, now fixed properly)

v1's model path failed `textFits`: a long model-written body line could not fit
its box, and the engine correctly refused to truncate it. Phase A's fitter was
single-line. The fix is wrap-aware composition:

- `wrapLines()` — greedy word-wrap under the plan-route width estimate; the
  text itself is NEVER altered (the element keeps the full string — the
  exact-text contract — and the renderer wraps it).
- Compositions wrap-to-fit: font shrinks until the wrapped line count fits the
  band; the element's box grows to the wrapped height, capped at the band.
- The `textFits` check is wrap-aware too: no wrapped line wider than the box,
  wrapped line count within the box height. A genuinely unfixable case (tiny
  canvas, text too long even wrapped at floor size) still FAILS honestly with
  the text intact — tested.

The SVG render check was also upgraded honestly: SVG wrapping splits lines into
`<tspan>`s and consumes break spaces, so render-level presence compares
non-space characters in order; the strict whitespace-exact contract stays at
compile level (single element, NFC equality).

## Improvement 2 — semantic color placement (the band demoted to last resort)

v1's seed guarantee emitted a decorative bottom-edge band when a required color
wasn't drawn — mechanically correct, visually blunt. The placement is now
semantic first:

1. **Headline emphasis:** the hero's accent underline (a real design device)
   is recolored to the missing seed. In the model path the amber `#F9A825`
   now lands as the emphasis bar under the headline (pixel-verified: the only
   amber on the rendered model poster, a 6px bar at y≈308).
2. **Fallback band** only when no underline exists (e.g. a hero with a single
   slot).

Both placements are disclosed in `warnings`. Deterministic, in-canvas,
overlap-safe, tested (underline case + band case + byte-identical recompiles).

## What this run deliberately did NOT exercise (no claims beyond it)

- **No production AI provider.** The planner was z-ai GLM through the sandbox
  SDK — a real model, but not Canvix's BYOK production path (user keys,
  provider adapters). The spec-level contract it had to satisfy is the same one
  production providers face.
- **No Konva-stage pixel diff of the editor** (the editor proof verifies
  document truth through the API + UI behavior; the render proof covers
  pixels through the SVG pipeline).
- **No vision-model review, no Devanagari/multi-script corpus** (M3 scope per
  the proposal).
- The editor e2e ran against a local Postgres 17 + `next dev` in this sandbox;
  CI runs the same suite on every PR.

## Bottom line

The Phase A foundation now compiles a real-model spec into real, editable,
spec-conformant pages — verified in a real browser AND created, edited, saved
and reloaded through the real product with the exact-text contract intact
across the roundtrip. Both v1 weaknesses that mattered (text fitting, band-only
color fallback) are fixed with tests, and the third (no real-editor exercise)
is closed with a persistent e2e spec. Remaining scope is exactly what the
funding milestones fund: the production provider path, the multi-script brief
corpus, and grounded visual review.
