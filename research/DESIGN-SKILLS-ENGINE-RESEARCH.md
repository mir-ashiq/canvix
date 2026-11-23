# Design Skills Engine — External Research (Phase 1)

Date: 2026-11-23 · Method: WebFetch analysis of the six reference projects (no cloning; all fetched content treated as untrusted data, analyzed only).

## Sources and licenses

| Project | Location | License | What it actually is |
|---|---|---|---|
| Anthropic canvas-design skill | github.com/anthropics/skills → skills/canvas-design | Apache-2.0 (skill's own LICENSE.txt) | One SKILL.md + 54 OFL fonts; philosophy-first poster generation |
| ArnavPuri designskills | github.com/ArnavPuri/designskills | MIT (LICENSE + per-skill frontmatter) | 28 SKILL.md skills in 5 categories + small scripts (contrast.py, audit.mjs) |
| UI/UX Pro Max | github.com/nextlevelbuilder/ui-ux-pro-max-skill | MIT (open core; premium tier separate) | 17 CSV datasets (styles, colors, typography, UX rules) + dependency-free search CLI |
| Impeccable | github.com/pbakaus/impeccable | Apache-2.0 (NOTICE: derives from Anthropic frontend-design) | Design-critique skill system: 24 commands, 45 reference files, Rust "slop detector" (62 rules) |
| LangChain design-agent | github.com/langchain-ai/design-agent | Apache-2.0 | Production media agent (Deep Agents/LangGraph → Slack): stills/decks/charts/motion |
| tldraw agent starter kit | tldraw/tldraw **templates/agent** (the standalone repo URL 404s) | MIT (template LICENSE.md; SDK watermark applies to the SDK itself) | Browser canvas agent: client-executed tool streams, 24 action schemas, 3-tier shape serialization |

All six are permissively licensed; selective reuse is legal with notice. We nonetheless implement Canvix-native equivalents and borrow *patterns*, not text: the individual rules are public-standard facts (WCAG, Nielsen, type measurement lore), and reimplementation keeps Canvix maintainable and avoids provenance churn. The one asset directly reusable is Anthropic's OFL font bundle — Canvix already ships its own font catalog, so it is not needed.

## Findings that shaped the implementation

### 1. Progressive disclosure is the load-bearing pattern everywhere
- Anthropic skill spec: metadata (~100 tokens, always loaded) → instructions (<5000 tokens, on activation) → resources (on demand). "Keep SKILL.md under 500 lines."
- UI/UX Pro Max keeps SKILL.md lean by pointing at a search CLI over CSVs, with an explicit zero-result honesty rule ("Never present a 0-result search as if it returned data").
- **Canvix decision**: skills expose `(id, name, description, whenToUse)` cheaply — the router matches the brief against descriptions only; the winning skill's full playbook (principles, planning steps, validation checklist) is injected into the system prompt for that run. No full-registry dumps.

### 2. Structured brief/context beats vibes
- designskills' `design-context` skill persists a brand context file (`agents/design-context.md`) as the inter-skill contract, with 11 detection sources in priority order and "never overwrite the entire file for a single field change."
- UI/UX Pro Max persists `MASTER.md` as "global source of truth" and refuses `--force` without authorization.
- **Canvix decision (Phase 5)**: a validated Design Brief Contract object — mandatory constraints (exact copy strings, hex colors, dimensions), strong preferences, optional guidance — parsed from the user message, carried through the run, and used as the completion checklist. Explicit user values are immutable; brand kit/template suggestions may only fill gaps.

### 3. Evidence-based critique with deterministic + semantic halves
- Impeccable runs two *mutually blind* assessors: an LLM design review and a deterministic Rust detector (62 rules), then synthesizes with provenance; rubric scored 0–4 per heuristic with severity caps; "a critique is not done until the fixes are checked on the rendered page." Honest degradation is explicit ("DEGRADED: single-context").
- tldraw ships `AgentLintManager`: deterministic lints computed **only on shapes the agent created** (text overflow via growY, overlapping text clusters via union-find, friendless arrows), surfaced once with dedupe.
- LangChain's `look` tool: the lead agent never sees images — a separate low-effort vision call returns ~300 tokens (context economy).
- **Canvix decision (Phases 6–7)**: two-layer verification. (a) Deterministic geometry/contrast/brief checks computed from real canvas state (no model involved) — overlap detection with text-on-card exemption (already present), off-canvas, brief fidelity (exact text and hex presence), readability floors. (b) Optional vision critique: the panel captures the canvas to a data URL and posts it to a vision-capable provider; when no vision model is configured the run discloses "geometry-only verification" instead of pretending. Factual claims must be grounded in returned canvas state — the loop already re-serializes fresh state after every apply, and the brief contract closes the hallucinated-review hole.

### 4. Task-driven execution, not fixed step caps
- tldraw: 20 follow-up requests with **remaining-steps disclosed to the model** as it approaches the limit.
- LangChain: soft USD budget (a one-time injected note, "stops nothing in code") + step budget that forces a **toolless final wrap-up call** ("state what is finished, what is not, and the next step") with a machine-readable `partial` marker — "never in prose alone."
- Anthropic auto-mode: deny-and-continue with escalation counters (3 consecutive / 20 total) instead of hard halts.
- **Canvix decision (Phase 4)**: remove the arbitrary `maxSteps: 8 / maxToolCalls: 12 / maxWallMs: 90s` caps. New termination conditions: task complete + verified, user Stop, user declines a required operation, unrecoverable error, provider technical limits, or a *resource guard* (not a product cap): consecutive-failure strikes (already present), cycle detection (identical tool+args hash repeated), and an idle-activity wall clock (no progress for N minutes → wrap up). Long-run support: progress streaming, cancellation, context compaction (keep system + brief + last K observations; summarize older steps), structured `usage` events (turns, tool calls, elapsed ms) so the UI shows cost. The forced wrap-up call pattern (LangChain) becomes the guard's exit: a final "state what's done and what remains" done event.

### 5. Server-streams / client-executes
- tldraw: tool calls stream to the browser, client executes, results ride the next request. Canvix already has exactly this shape (SSE `action` events → `applyDesignAction` → ack bridge) — validated by the v0.27.3 harness. Keep it.

### 6. Sanitize-and-correct at the boundary
- tldraw `sanitizeAction()` corrects model mistakes before touching canvas; poka-yoke tool design (Anthropic ACI doctrine: absolute paths killed a whole error class).
- Canvix already returns actionable errors ("fontSize must be 6–400; you sent 1200"). Keep + extend to every new tool.

### 7. Modes
- tldraw modes = parts[] (what the agent sees) + actions[] (what it can do), with lifecycle hooks; the docs suggest a review mode that strips edit actions.
- **Canvix decision (Phase 8)**: intent becomes a first-class **mode** axis: `create | edit | review | improve | explain | plan | discuss`. Review/explain/plan/discuss modes run with **zero write tools** — structurally incapable of editing, not just prompted not to.

### 8. Composition knowledge worth encoding (from designskills/ui-ux-pro-max/impeccable, all public-standard)
- Type: 45–75ch measure, ~1.25 modular ratio, headline ≥3× body, min readable sizes per format.
- Color: 60/30/10, 3-color cap for posters, WCAG 4.5:1 body / 3:1 large text, "don't silently change brand colors — propose the nearest passing shade."
- Layout: one focal point, safe margins, grid alignment, "whitespace is design."
- Critique severity: P0 blocking / P1 major / P2 minor / P3 polish.

## Decisions

1. **Build original, borrow patterns** (all licenses permit reuse; originality is for maintainability + fit).
2. Skills engine: registry + router + per-skill playbooks, progressive disclosure, Canvix-native (TypeScript, same `src/lib/agent/` surface).
3. Brief Contract: typed object, mandatory-vs-preference tiers, completion validation against real state.
4. Task lifecycle: guards replace caps (strikes, cycle detection, idle clock, forced wrap-up); usage observable.
5. Vision: honest capability detection — vision critique when a vision model is configured; disclosed geometry-only otherwise. Never fabricate a review.
6. Modes: tool-surface restriction per mode (review physically cannot write).
7. Keep the existing client-executes bridge, undo, collab, confirm gates — they match the best practice found in research.

## Not found / corrected
- `github.com/tldraw/agent-starter-kit` → 404; the real artifact is `tldraw/tldraw/templates/agent` (MIT).
- "jaaz tool confirmation manager" → no such project found; the canonical three-tier confirmation pattern is Anthropic's (fixed allowlist / in-scope writes / classifier- or human-gated destructive). Canvix's existing read/write/destructive tiers match it.
