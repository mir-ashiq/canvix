# DesignSpec Phase A — real-model + real-browser acceptance report

**Date:** 24 November 2026 · **Branch:** `feat/design-spec-foundation` (head 8b213bc + this report)
**Purpose:** the first end-to-end acceptance run of the DesignSpec v2 foundation — the
"browser-rendered visual acceptance test and real-model evaluation" gap named in the
funding review — executed with the repo's own deterministic engine, the app's own vector
export pipeline, a real LLM planner, and real Chromium.

## What ran

Two paths over the same canonical poster brief (1080×1350, three verbatim lines — one
carrying an em dash and middle dots, the NFC-exactness contract — and two required hexes):

```
Path D (deterministic): prompt → extractBrief() → specFromBrief() → compileSpec()
Path M (real model):    LLM planner (z-ai GLM via sandbox SDK) → parseSpecResponse()
                        → compileSpec()
Both:                   pages → exportPageToSVG() (src/lib/svg-export.ts — the code path
                        user downloads use) → embedded in Chromium (Playwright) →
                        screenshot + text/fill verification on the RENDERED SVG
```

Harness (re-runnable, committed on this branch): `scripts/designspec-compile.ts`,
`scripts/designspec-render.cjs`, `scripts/designspec-browser-entry.ts` (browser bundle).

```bash
bun scripts/designspec-compile.ts brief <outdir>
bun scripts/designspec-compile.ts model <outdir> planner-raw.txt
node scripts/designspec-render.cjs <outdir> <label>
```

## Results

| Check | Path D (deterministic) | Path M (real model) |
|---|---|---|
| Exact texts (char-for-char, NFC) — 3/3 | **PASS** | **PASS** |
| Required colors on page — 2/2 | **PASS** | **PASS** (after the fix below) |
| All elements in canvas | **PASS** | **PASS** |
| No unintended content overlap | **PASS** | **PASS** |
| Text fits box | **PASS** | **FAIL** — honest, see below |
| WCAG contrast ≥ 4.5 (all pairs) | **PASS** (5.28–9.43) | **PASS** (5.28–9.43) |
| Rendered SVG carries exact texts | **PASS** | **PASS** |
| Rendered SVG carries required fills | **PASS** | **PASS** |

Artifacts: `rendered.png` / `rendered.svg` for both paths (1080×1351 screenshots of the
real browser render), `spec.json`, `pages.json`, `checks.json`, `render-checks.json`,
and the raw planner output (`planner-raw.txt`). Determinism re-verified: the same spec
compiles byte-identical pages (test suite).

## A real bug, found by the real-model run, fixed and tested

**The finding.** Path M's planner emitted two seeds (`#1B5E20`, `#F9A825`) and a hero
with no CTA slot. The palette module assigned the amber to the `accent` role — but no
composition drew that role, so **a required color silently never reached the page**.
The compile check report caught it (color FAIL), which is exactly what it exists for.
The palette module's own contract ("required brief colors therefore always appear on
the page") was not actually guaranteed — only role assignment was.

**The fix.** `compileSpec()` now enforces the seed guarantee: any required hex carried
by neither the background nor an element fill gets a deterministic decorative band on
the bottom edge — a backdrop layer (behind content, so overlap semantics are
unaffected), disclosed in `warnings` as "seed guarantee". Deterministic, in-canvas,
overlap-safe.

**The tests.** Two new cases in `compile.test.ts` (seed-guarantee describe): both seeds
appear without accent-using compositions; the fallback band is a backdrop and the
compile stays byte-identical. Suite: **47/47 passing** (45 prior + 2 new).

## The honest failure: text fitting for long model copy

Path M's model-written body line ("Taste the finest apples from Kashmir's orchards…")
does not fit its box, and the engine correctly **refuses to truncate required copy** —
so `textFits` FAILS and `checks.passed` is false. This is the correct behavior, not a
harness error: Phase A's fitter is single-line (estimateTextWidth), and model slots
carry `maxWords` as a soft warning, not a cut. **Body-slot reflow/wrapping is exactly
M2 scope in the pending FOSS United application ("design-output correctness")** — this
run is the baseline measurement that milestone starts from, with a named, reproducible
failure: a real planner's body copy overflows a single-line box.

## What this run deliberately did NOT exercise (no claims beyond it)

- **No production AI provider.** The planner was z-ai GLM through the sandbox SDK —
  a real model, but not Canvix's BYOK production path (user keys, provider adapters).
  The spec-level contract it had to satisfy is the same one production providers face.
- **No database or editor persistence.** The sandbox has no Postgres, so the
  `/api/designs` route and the Konva editor stage were not driven; pages were rendered
  through the export pipeline (`exportPageToSVG`) in Chromium instead.
- **No wrapping/reflow, no vision-model review** (M2/M3 scope per the proposal).
- Fonts render with browser fallbacks (SVG export uses font-family references by
  design; viewers resolve them).

## Bottom line

The Phase A foundation compiles a real-model spec into real, editable, spec-conformant
pages rendered in a real browser — with the exact-text and color contracts verified at
the pixel level, one genuine contract hole found and closed with tests, and the next
milestone's work measured, named and reproducible rather than aspirational.
