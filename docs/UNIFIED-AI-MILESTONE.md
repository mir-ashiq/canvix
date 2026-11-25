# Unified Canvix AI — the create → verify → refine milestone (v0.32)

**Date:** 25 November 2026 · **Base:** v0.31.0 (`5f39489`)
**Scope:** one engineering upgrade, four unifications — shared provider
resolution, shared rendering, shared validation, shared editing
workflow — proven by a single acceptance test.

## The acceptance test (as specified, then implemented)

> A user requests an entire design. Canvix creates and verifies it.
> The user continues refining that same design through natural-language
> instructions — without losing required text, colors, editability or
> context.

Implemented as `src/lib/design-agent/continuation.test.ts` (7 tests, no
network, deterministic): the autonomous pipeline runs with a scripted
model seam, its compiled pages are applied to the REAL editor store
(`appendPages`), and the refinement runs through the REAL chat agent
loop whose `awaitApply` executes through `applyDesignAction` — the same
validated, undoable executor user edits ride. The gate behavior is
asserted both ways:

- **happy path** — "make the headline bigger": the system prompt
  carries the stored brief's exact requirements (context), the
  executor really changes the applied element (editability), and
  every required text and color is still present, validated against
  the live store (no loss);
- **enforcement** — a "refinement" that rewrites a required headline is
  REJECTED by the done-gate in edit mode ("NOT DONE — brief validation
  against the real canvas found unmet requirements"), bounces back with
  the unmet list, and the run only finishes once the exact string is
  restored. The contract is enforced, not hoped for.

## What shipped

### 1. Shared provider resolution (the BYOK vision asymmetry, closed)

`getClientForSlotForUser` existed for the MCP rail but the two agent
vision paths resolved the instance-only `getClientForSlot`. Both call
sites — `/api/ai/agent/vision` (the shared verification endpoint both
panels' post-apply critique lands on) and the agent route's in-run
`critiqueRoute` — now resolve the session user first, matching how the
text slot and the design-agent route already resolved. A signed-in user
with their own vision provider critiques with their keys on every AI
surface; anonymous requests are unchanged.

### 2. Shared validation (the brief contract flows across systems)

- `mergeBriefs` (`src/lib/agent/brief.ts`): the design's stored brief
  and the freshly extracted one merge by UNION — requirements survive
  refinement, new explicit requirements join the contract, the live
  message's explicit dimensions win, same-kind composite features take
  the newest count. A merge can only add or sharpen, never drop.
- `normalizeStoredBrief` (same module, pure): every stored brief — from
  the provenance JSON column or the client's context post — is
  normalized before it can reach a prompt or a gate: tiers forced
  mandatory, hexes lowercased, arrays capped (24 texts / 12 colors /
  8 features), dimensions dropped (the design owns its geometry after
  fit-pages; a stored size would fail every legitimately resized
  refinement).
- The agent loop's done-gate now fires for **edit runs that carry a
  brief** in addition to create/improve — that is precisely the
  continuation case. The audit and vision rounds stay scoped to
  create/improve (full builds); the brief gate is what protects
  refinement.

### 3. Design provenance (the context that persists)

- `DesignProvenance` Prisma model (migration `0013_design_ai_provenance`,
  unique per design, cascade delete): `brief` JSON, `prompt`,
  `outcome`, timestamps.
- `src/lib/design-provenance.ts` — `saveDesignProvenance` /
  `getDesignProvenance` (server-only; normalization shared with the
  agent route through the pure module).
- `PUT|GET /api/designs/[id]/ai-provenance` — PUT needs edit rights
  (404 absent, 403 foreign, same-origin, its own rate budget — never
  the autosave path's); GET is link-open like the design itself.
- `GET /api/designs/[id]` (the editor's load path) now returns
  `aiProvenance`, which `loadDesign` hydrates into the editor store
  (`aiBrief`). DesignAgentApp Apply sets the store brief AND persists
  it (best-effort after the pages landed — a persistence hiccup never
  rolls the apply back; the session brief still guards).

### 4. Shared editing workflow (one document, two agents)

After Apply, the design is ordinary editable state: the chat agent's
tools, the `applyDesignAction` executor, undo, collaboration and
autosave all operate on the same elements the pipeline compiled — and
now the CONTRACT travels with them. The chat panel posts the stored
brief in its design context (`AgentDesignCtx.aiBrief`); the route
merges it into the run's brief; the client's `validate_brief` answers
(the panel already validates whatever brief the run event carries, so
the enforcement needed no new client-side gate code).

## Evidence

- Unit: 1,700 / 1,700 pass (1,693 prior + 7 new; no regressions).
  New: `continuation.test.ts` (the acceptance, mergeBriefs,
  normalizeStoredBrief). `tsc --noEmit` clean, eslint clean.
- Live-DB e2e: `tests/e2e/unified-ai-provenance.spec.ts` — the
  provenance PUT/GET round trip through the real API against real
  Postgres, normalization asserted, junk/dimension-only briefs 422,
  foreign designs follow the designs family (GET link-view 200 with
  null provenance — that viewer can already GET the design itself;
  PUT answers NOT_YOUR_DESIGN 403), missing ids a flat 404, and the
  design GET carrying `aiProvenance` back (the hydration path).

## Decisions and disclosed limits

- **Edit-mode gates:** the brief gate fires in edit mode when a brief
  exists; the quality-audit and vision rounds do not (they are
  full-build machinery; a per-keystroke refine should not pay for a
  canvas re-critique). The `validate_brief` tool remains available to
  the model in every mode.
- **Provenance is one row per design:** a new applied generation
  overwrites it — the contract describes the design's CURRENT
  verified requirements, not its history (versions already keep
  history).
- **Unsaved designs:** a design without an id keeps the session brief
  (the store) but skips persistence; saving later does not retro-store
  it. The next applied generation on a saved design persists.
- **Dimensions in provenance are dropped by design** — after
  fit-pages the design's own canvas is the truth; resize is a
  legitimate refinement, not a contract violation.

## What this does NOT change

The two model seams (chat loop, pipeline plan/critique), the honesty
contracts, the review gates and the checks-outrank-critique hierarchy
are untouched. This milestone wires the systems together around the
document; it does not alter how either agent thinks.
