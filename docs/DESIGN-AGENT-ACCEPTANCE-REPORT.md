# DesignAgent — autonomous design pipeline acceptance report (24 Nov 2026)

**Branch:** `feat/design-agent` · **Research:** `research/AUTONOMOUS-AGENT-RESEARCH.md`
**What this is:** the Phase B design agent — a code-orchestrated autonomous
pipeline over the DesignSpec engine, built from the patterns that production
agent systems actually use (ReAct tool-registry discipline, the OpenAI Agents
SDK "code orchestration + evaluator loop" guidance, and PosterGen's staged
specialists with embedded design principles). The model plans and critiques;
deterministic code runs everything else and judges the result.

## The run (real planner model, real VLM, real renderer)

Brief: a 1080×1350 race poster — three verbatim lines (one with middle dots),
two required hexes (#0D47A1, #FF6F00), a stats band and a framed photo area.

```
extract-brief (deterministic)        PASS — 3 required texts, 2 required colors
plan (GLM via z-ai chat)   round 1 →  brief-conformance FAIL: the model dropped
                                       "12km · Dachigam Road · 26 Jan" (the
                                       engine's own checks were GREEN — this
                                       failure is only visible at the agent
                                       layer, which is why it exists)
feedback → revise          round 2 →  still imperfect
feedback → revise          round 3 →  every required text/color/dimension carried;
                                       compile checks all PASS
render (exportPageToSVG in Chromium)  all texts + both fills verified in the
                                       RENDERED SVG; balance 82% coverage
VLM critique (z-ai vision on the PNG) P1s and P2s listed below — advisory,
                                       never overriding the checks
```

3 model calls · 2 revision rounds · 15 s wall · outcome **passed**, honestly.

## What the evaluator loop caught

The round-1 spec **passed every engine check** — the compiler validates
spec→page fidelity, and the spec's own slots were internally consistent. What
was wrong was brief→spec fidelity: the model had dropped a user-required line.
The pipeline's `briefConformance()` check (required texts verbatim in slots,
required hexes in seeds, exact dimensions) is the evaluator the engine cannot
be, and the revision loop fixed it in one feedback round. This is the exact
Reflexion/evaluator-loop pattern from the research, with real stakes.

## What the VLM critique caught (and what it changed)

The first critique found, among other issues: *"Stat row baseline
misalignment: 'Dachigam Road' wraps to two lines and its underline/label sit
visibly lower than '12km'"* — a genuine **engine defect**. Fixed the same hour
(`buildStatRow` now places every cell on a uniform value block: shared
baseline for underlines and captions). Recompiled the SAME spec (deterministic,
zero model calls), re-rendered, re-critiqued: the issue drops out of the P1
class. The critique is advisory — it can drive engine and prompt improvements,
but it can never mark a run passed; only the deterministic checks can.

**Still open from the critique (the honest next-round list):** band rhythm
(~200px dead zones between blocks — stackInRect gap tuning), inkSoft at the
WCAG floor reads dim on saturated backgrounds (raise the contrast bar above
4.5 for poster distance), footer/stat duplication (planner prompt rule),
typographic pairing beyond the mood default, and a margins/frame system.

## The toolbox (every function the agent can use)

`extract-brief`, `parse-spec`, `compile-spec` (the engine: palette expansion,
type scale, band/grid layout, wrap-aware text, seed-guarantee colors,
contrast), `wrap-estimate`, `balance-report` — a typed registry
(`src/lib/design-agent/tools.ts`) that doubles as the planner's capability
catalog. The model seams (`plan`, `revise`, `critique`) run through the
`DesignAgentModel` interface — the same seam a BYOK production adapter or the
CLI adapter in `scripts/designspec-agent-run.ts` implements. The engine's
composition vocabulary grew to match: `stat-row` (big numbers + captions,
uniform baselines, accent underlines) and `mockup` (4:3 visual frame with
accent border) now have dedicated deterministic builders; `timeline`,
`gallery`, `footer` still compile via the generic stack with a pending-builder
warning.

## Guards and honesty (tested, not claimed)

- **bounded revisions** (default 3) — then the run fails honestly with all
  failures visible
- **cycle guard** — a model repeating its spec verbatim stops the loop
- **parse failures** are recoverable against the prior spec, or fail honestly
- 8 pipeline tests with a scripted model prove all of this deterministically
  (self-correction, recovery, guards, toolbox, critique parsing fail-closed)
- **1,639/1,639** branch suite · tsc clean · eslint clean

## Not exercised (no claims beyond it)

- No production BYOK provider adapter yet (the seam is built and the CLI
  adapter proves it end-to-end; wiring it into the app's agent route is the
  next integration step, alongside the chat loop that already exists).
- No auto-revision on critique findings (critique output is advisory and
  reported; feeding P1/P2 items back into one more revision round is
  designed-for but not yet automatic).
- Multi-script (Devanagari) corpus, human study — M-scope per the proposal.

## Reproduce

```
bun scripts/designspec-agent-run.ts run <promptFile> <outDir>
node scripts/designspec-render.cjs <outDir> "agent-run"
bun scripts/designspec-agent-run.ts critique <outDir>
```

Artifacts in `download/designspec-agent/`: the rendered poster (PNG/SVG), the
final spec, compile + render checks, and the full run report (stages, model
calls, revisions, elapsed, VLM critique).
