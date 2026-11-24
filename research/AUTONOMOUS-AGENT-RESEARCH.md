# Autonomous agent research → Canvix DesignAgent (24 Nov 2026)

**Question:** how do production autonomous agents actually work, and which of
those mechanics should Canvix adopt so its AI can produce professional designs
by itself?

Three sources were read in full (not search-snippet level):

1. **IBM, "What is a ReAct Agent?"** — the canonical thought→action→observation loop.
2. **OpenAI Agents SDK docs, "Agent orchestration"** — production orchestration patterns (LLM-orchestrated vs code-orchestrated, agents-as-tools, handoffs, guardrails, evaluator loops).
3. **PosterGen: Aesthetic-Aware Multi-Modal Paper-to-Poster Generation (CVPR 2026, arXiv 2508.17188)** — a multi-agent LLM design pipeline scored 4.43/5 aesthetics vs human-designed 4.27, with ablations isolating what each stage contributes.

Plus secondary leads (search level only, not read in depth): Reflexion
(self-critique memory), LangGraph, tldraw's repeat-pattern cycle detection
(which this repo's `agent/protocol.ts` already credits for its cycle guard).

## The patterns that matter, and what Canvix does with each

### P1 — The agent loop (ReAct): think → act → observe → repeat

Mechanics: a tool registry (name + description + input schema), a scratchpad
the model appends to, observations fed back after every action, and hard
termination guards (iteration cap; a "no progress" stop). The loop's power is
that each action's result reshapes the next step.

**Canvix already has this** — `src/lib/agent/loop.ts` is a ReAct-style chat
loop over `AGENT_TOOLS` with resource guards (strikes / cycle-repeat / idle),
risk-tiered tools and fail-closed acks. That loop is for interactive editing.

**Adoption for design generation:** the generation pipeline keeps the loop's
*discipline* (registry, observations, guards, bounded termination) but is
CODE-orchestrated (P2) rather than free-form.

### P2 — Orchestrate in code around the LLM seams (OpenAI Agents SDK)

The SDK's own guidance: LLM-orchestrated agents (the model routes itself) are
for open-ended tasks; **code orchestration** — your code decides what runs,
in what order — is "more deterministic and predictable" on speed, cost and
performance. The two mix. The concrete code-orchestration patterns it lists:
chaining (research → outline → write → critique → refine), the **evaluator
loop** (a producer agent + an evaluator agent; stop when criteria are met),
structured-output routing, and parallel fan-out.

**Canvix adoption:** the DesignAgent pipeline is deterministic TypeScript that
calls the model only at the decision seams — plan, revise, critique. Stages,
order, retries and termination are code, not model whims. This also matches
Canvix's funding thesis (determinism and verifiability over vibes) and keeps
the exact-text/color contract enforceable at every seam.

### P3 — Specialist stages with the design principles EMBEDDED (PosterGen)

PosterGen does not ask one model to "make a poster." It runs a chain of
single-purpose agents — Parser → Curator → Layout → Color → Font — where
design principles (narrative roles, column rules, WCAG contrast, 3-tier
emphasis) are **built into each stage's logic**, then a deterministic renderer
emits the file. Its ablation is the argument: curation alone scores 3.57/5;
adding the layout stage lifts it to 4.03; adding styling to 4.53.

**Canvix adoption:** this is exactly the DesignSpec split — the model chooses
semantics (blocks, copy, seeds), the deterministic engine owns geometry, color
math and type scale. The engine's composition builders ARE the embedded
principles. This turn extends that vocabulary (stat-row, mockup builders) so
"professional" components exist to compose.

### P4 — The evaluator loop / Reflexion: fail → feedback → revise, bounded

Mechanics: a deterministic evaluator produces structured failures; the
failures are fed back to the producer as observations; the producer revises;
repeat up to a bound; if still failing, report honestly instead of
hallucinating success. PosterGen's variant: the Balancer reads utilization
analysis and conservatively adjusts; pure text-to-image approaches score 2.41
(content hallucination) — the loop is what separates 2.41 from 4.4.

**Canvix adoption:** `compileSpec` checks (exact texts, colors, wrap-aware
fit, overlap, contrast) are the evaluator. The pipeline feeds `failures[]`
back to the planner as a revision prompt, bounded (default 3 revisions), with
cycle detection (an unchanged spec is not progress) and an honest
`failed-honestly` outcome instead of a fake pass.

### P5 — Grounded critique on the REAL render (VLM-as-judge), not the model's imagination

Mechanics: render first, screenshot, THEN have a vision model critique the
pixels; calibrate the rubric with positive examples at 4-5 and defect examples
at 1-3 (VLM judges are generous); two independent judges; strict anchors.
Humans judge ~15% harder than VLM judges — never let the VLM score be the
whole claim.

**Canvix adoption:** the shipped agent already has grounded vision critique
(the `capture` event, fail-closed when unavailable). The pipeline adds the
same stage for generation: render → screenshot → VLM critique → optional
revision. The acceptance run in this sandbox exercises it with a real VLM
(z-ai `vision`); production runs BYOK. Critique output is advisory — it can
trigger one more revision round but can never override the deterministic
checks.

### P6 — Estimate-vs-renderer gap: measure, don't guess (PosterGen Alg. 1)

PosterGen binary-searches the text-box height the real renderer will not
auto-shrink — the data model and the renderer disagree, and the pipeline must
measure the boundary. **Canvix already lives this:** `textFits` is
wrap-aware at the plan-route estimate, and the acceptance harness verifies
presence against the RENDERED SVG (tspan-aware), not the model's claim.

## What Canvix deliberately does NOT adopt

- **Handoffs / multi-agent conversations for generation** — one planner seam
  with a fixed stage order is cheaper, deterministic and debuggable. The SDK
  docs themselves recommend specialists as *tools*, not as free conversational
  peers, for predictable pipelines.
- **Unbounded autonomy** — the repo's own guard philosophy (machine
  protection, not product caps) is kept: revision rounds are bounded, cycles
  are detected, failures are honest.
- **Pure text-to-image generation** — PosterGen measured it at 2.41/5 with
  garbled text; Canvix's exact-text contract exists precisely to avoid that
  failure class.

## The DesignAgent architecture that follows

```
prompt ──► extract-brief (deterministic)
        ─► plan-spec (MODEL seam 1: brief + toolbox catalog → DesignSpec JSON)
        ─► parse-spec (deterministic, honest failure object)
        ─► compile-spec (deterministic engine: palette, type, layout, checks)
        ─► [checks.failed → feedback → revise-spec (MODEL seam 2)] × ≤3, cycle-guarded
        ─► render (exportPageToSVG) → VLM critique (MODEL seam 3, optional,
           advisory) → optional final revision
        ─► run report: stages, model calls, revisions, outcome, honest gaps
```

The model can choose ANY semantic the toolbox vocabulary expresses; it cannot
choose geometry, cannot touch required copy, cannot mark itself done. Every
function the agent "has" is in the registry (`src/lib/design-agent/tools.ts`)
— the registry is the capability surface, the pipeline is the discipline.

## Source list

- https://www.ibm.com/think/topics/react-agent — ReAct pattern, loop mechanics
- https://openai.github.io/openai-agents-python/multi_agent/ — orchestration styles, evaluator loop, guardrails
- https://arxiv.org/html/2508.17188v2 — PosterGen (CVPR 2026): staged agents, embedded principles, ablations, VLM-judge calibration
- Search-level leads (not read in full): Reflexion (Shinn et al.), LangGraph docs, tldraw agent repeat-pattern writeup
