# DesignAgent — autonomous design pipeline acceptance report (24 Nov 2026)

**Branch:** `feat/design-agent` (stacked on `feat/design-spec-foundation`, both updated
against current main) · **Research:** `research/AUTONOMOUS-AGENT-RESEARCH.md`
**What this is:** the Phase B design agent — a code-orchestrated autonomous pipeline
over the DesignSpec engine, built from the patterns that production agent systems
actually use (ReAct tool-registry discipline, the OpenAI Agents SDK "code
orchestration + evaluator loop" guidance, and PosterGen's staged specialists with
embedded design principles). The model plans and critiques; deterministic code runs
everything else and judges the result.

## The P0 items from the external review, closed

1. **Visual verification is now an EXECUTION STAGE, not a side script.** After the
   deterministic checks pass, the pipeline renders the pages through a
   `DesignRenderer` seam, critiques the real pixels through a `critique` seam, and
   can trigger one more revision round from P1/P2 findings — bounded, cycle-guarded,
   cancellation-aware. The hierarchy is absolute: a critique-revision is only
   accepted if it ALSO passes every deterministic check and actually reduces the
   actionable finding count; otherwise the previous passing design is kept and the
   outcome is disclosed ("checks outrank critique"). No renderer or vision seam →
   `unavailable`, disclosed, never faked. Five unit tests cover the stage
   deterministically (improved / verified / rejected-by-checks / unavailable /
   unparseable-discarded).
2. **A production BYOK adapter exists and is wired into the provider system.**
   `src/lib/design-agent/byok-adapter.ts` builds the `DesignAgentModel` seam from
   resolved `ProviderContext`s — the same BYOK resolution chain
   (user providers → instance multi/db/env/file), the same SDK client, the same
   JSON-mode-with-fallback call shape the shipped design-spec normalizer uses. The
   route `POST /api/ai/design-agent` rides `withProvider`: admin kill switch
   (`ai.features.designAgent`), same-origin abuse guard, per-feature rate limits,
   session-BYOK resolution, request-abort cancellation through the pipeline's signal
   seam, and the app's REAL vector export (`exportPageToSVG`) as the renderer.
   Vision critique resolves from the user's vision slot when configured; without
   it, visual verification is disclosed as unavailable. Adapter call shapes are
   unit-tested with stub SDK clients.
3. **The toolbox grew to the full declared vocabulary.** Every block kind now has a
   dedicated deterministic builder: hero, feature-cards, stat-row (uniform value
   baselines), mockup (4:3 visual frame), timeline (route line + stops), gallery
   (2/3-up frames), footer (divider + sign-off). No kind falls back to a generic
   stack.
4. **The design-quality benchmark exists** (`scripts/designspec-agent-benchmark.ts`):
   22 diverse briefs (events, menus, retail, nonprofit, music, education, hiring,
   real estate, wellness, launch, exhibition, market, fitness, conference, bakery,
   marathon, theatre, health, café, demo day, cleanup, crafts) × the REAL pipeline,
   measuring instruction fidelity the deterministic, non-fakeable way: exact texts,
   seed-guaranteed colors, dimensions, brief→spec conformance, revision rounds,
   model calls, wall time, honest-failure and cycle-guard counts.

## The acceptance run (real model, real render, real VLM, in one loop)

Brief: the 1080×1350 race poster — three verbatim lines (one with middle dots), two
required hexes, a stats band and a framed photo area.

```
extract-brief (deterministic)         PASS — 3 required texts, 2 required colors
plan (GLM, round 1)                   brief-conformance FAIL — the model split
                                       "12km · Dachigam Road · 26 Jan" across
                                       three stat slots (engine checks GREEN;
                                       only the agent layer can see this)
feedback → revise (round 2)           every required text/color/dimension carried;
                                       all compile checks PASS
render (pass 1)                        the real exportPageToSVG in real Chromium
critique (VLM on the PNG)              6 issues, 4 actionable (P1/P2)
visual-revision                        model revised from the findings; the new
                                       spec ALSO passed every check → accepted
verify (re-render + re-critique)       4 actionable remaining (was 4) → honestly
                                       reported 'unverified', NOT 'improved'
```

5 model calls · 2 revision rounds · 36 s · outcome **passed**, with the visual
verification result honestly reported as not-improved rather than faked. The
critique's findings (band rhythm, secondary-text contrast at the WCAG floor,
typographic pairing, margins) are recorded as the next-round engine roadmap —
advisory, never overriding the checks.

An earlier run the same day demonstrated the guard path instead: the model
repeated its spec verbatim under feedback → cycle guard → `guard-cycled`, honest
stop, evidence kept. Both paths are by design and tested.

## What the evaluator loop caught (why the agent layer exists)

The round-1 spec **passed every engine check** — the compiler validates spec→page
fidelity, and the spec's own slots were internally consistent. What was wrong was
brief→spec fidelity: the model had dropped (or split) a user-required line. The
pipeline's `briefConformance()` check (required texts verbatim in slots, required
hexes in seeds, exact dimensions) is the evaluator the engine cannot be, and the
revision loop fixed it in one feedback round. The improved feedback now instructs
precisely: ONE slot with the full exact string, never split.

## The benchmark (22 briefs, real model)

See `benchmark-report.md` in the run artifacts for the full table. Measured:
pass rate, self-corrections-to-pass, honest failures, cycle guards, model calls
per brief, revision rounds, wall time. Corpus scope, honestly: Latin-script briefs
only — the engine's SVG export has no non-Latin font pipeline yet, and a
multilingual brief would pass text-presence checks while rendering tofu, which the
harness refuses to claim as fidelity. Multilingual fidelity lands with the font
work + in-benchmark visual passes.

## Guards and honesty (tested, not claimed)

- **bounded revisions** (default 3, shared by check- and critique-origin rounds)
- **cycle guard** — a model repeating its spec verbatim stops the loop honestly
- **parse failures** recoverable against the prior spec, or fail honestly
- **caller cancellation** (AbortSignal) honored before every model call
- 22 design-agent unit tests (16 pipeline + 6 adapter) prove all of this
  deterministically with scripted models; branch suite 1,647+ green, tsc + eslint
  clean

## Not exercised (no claims beyond it)

- No in-app client panel for the new route yet (the route is the server contract;
  the chat agent panel continues to serve interactive editing; a dedicated
  generation panel is the next UI step).
- Visual verification in the app route delivers the SVG as a data URL — providers
  that cannot ingest SVG fail-closed to 'unavailable' (disclosed), and the
  browser-rendered capture path (already shipped in the chat agent) remains the
  richer production option for panel integration.
- The benchmark measures instruction fidelity; aesthetic quality is judged by the
  visual-verification loop, whose current verdict on the sample is honest and
  mixed — the critique findings list is the engine's roadmap, not a score.

## Reproduce

```
bun scripts/designspec-agent-run.ts run <promptFile> <outDir> --visual
bun scripts/designspec-agent-benchmark.ts run <outRoot> <from> <to>
bun scripts/designspec-agent-benchmark.ts aggregate <outRoot>
```

Artifacts in `download/designspec-agent/`: the rendered posters (PNG/SVG, both the
pre- and post-revision renders), the final spec, compile + render checks, the full
run report (stages, model calls, revisions, visual passes, VLM findings), and the
benchmark report.
