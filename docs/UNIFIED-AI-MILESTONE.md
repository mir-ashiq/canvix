# Unified Canvix AI — the create → verify → refine milestone (v0.32)

**Date:** 25 November 2026 · **Base:** v0.31.0 (`5f39489`)
**Scope:** one engineering upgrade, four unifications — shared provider
resolution, shared rendering, shared validation, shared editing
workflow — proven by a single acceptance test.
**Hardened same day (v0.32.1):** the external review's four findings
(3×P0, 1×P1) + the one-AI-surface consolidation — see the last
section; it supersedes the persistence/PUT details below.

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

---

# v0.32.1 — the hardening pass (external review, 25 Nov 2026)

An independent review of the merged milestone confirmed the
architecture and CI, then sent back four findings (3×P0, 1×P1) and a
consolidation request ("I don't want multiple AI apps in canvix, just
keep it few"). All five are closed in this pass; the v0.32 statements
about the client PUT and best-effort persistence above are SUPERSEDED
by this section.

## P0 — exact-text preservation is now exact

`validateBrief` used case-insensitive SUBSTRING matching: a required
`"Run Dal Lake 2026"` passed when the canvas held `"Run Dal Lake 2026
— Special Offer"`. It now enforces strict normalized equality
(whitespace collapsed, everything else character-for-character).
Regression tests cover exactly the review's list — appended words,
capitalization changes, punctuation edits, missing spaces — at three
levels: unit (`continuation.test.ts`, `harness.test.ts`), the
acceptance gate (a refinement that appends words is rejected and
bounced back), and the server-side save verification (the e2e flips
`verified` to false on an appended-words save).

## P0 — no requirement is silently weakened anymore

`normalizeStoredBrief` discarded `restrictions` and `notes`, silently
truncated texts at 200 chars and capped at 24 entries. Now:
restrictions and notes SURVIVE persistence (a "no stock photos" rides
every refinement prompt); texts are never sliced mid-string; caps are
generous (64 texts / 32 colors / 16 features); and overflow is
EXPLICIT — the persistence path runs in **reject** mode (an over-limit
brief is refused with a reason, never stored weakened), read paths run
clamp mode and count what they dropped.

## P0 — the original AI prompt is private

The provenance row stores the generation prompt; both GETs used to
ship it to anyone who could open the link — including read-only
viewers — while the prompt can hold information not present in the
finished design. Now `prompt` ships ONLY to callers who may edit the
design (owner/anon attribution); link viewers receive the shareable
contract — brief, verification state, timestamps — never the prompt.
The e2e proves it with a real viewer against a design that HAS
provenance.

## P1 — stored provenance now carries proof, not claims

The client-supplied `PUT /api/designs/[id]/ai-provenance` is GONE (an
authorized editor could store any brief with `outcome: "passed"`).
Contracts now enter the store only through the **design save itself**:
the apply flow queues a pending contract in the editor store, the next
`PUT /api/designs/[id]` carries it alongside the pages, the server
normalizes it in reject mode and **verifies it against the final saved
pages** (`verified`, `verifiedAt` — migration 0014). Every later save
re-validates and keeps the verdict true to the current document —
drift flips it false, restoration flips it back. The chat agent reads
the AUTHORITATIVE database brief (the design context now carries
`designId`), so a client post cannot tamper with what a run is gated
on. Side effect: the "failed provenance save then reload" hazard is
gone structurally — persistence rides the same save as the pages, so
an unsaved apply loses pages and contract together, consistently.

Also fixed here: the reload hydration bug — the design GET's
`aiProvenance` payload object was stored as the brief itself, so
reload continuation silently did nothing. The store now hydrates the
payload's `brief` (regression-tested).

## The consolidation — ONE AI surface

Six AI-branded apps in the registry (chat copilot, design agent,
Magic Write, AI image generator, AI design plan, AI theme) became one
**Canvix AI** app with five mode tabs — Chat / Generate / Write /
Image / Theme — each rendering the original, unchanged app component
(`UnifiedAIApp.tsx`). The AI design plan panel is retired: its
describe → review → apply flow IS the Generate tab, with the stronger
DesignAgent engine behind it (`/api/ai/plan` remains available as an
API). The wave-4 e2e now opens the unified app and switches tabs; the
plan panel's UI test was retired with the panel.

## Evidence (v0.32.1)

- Unit: 1,709/1,709 (16 in the acceptance file — strict-equality
  regressions, restriction preservation, reject-mode refusals, the
  reload-hydration regression, and the appended-words gate).
- tsc, eslint, production build clean locally.
- Live-DB e2e (`unified-ai-provenance.spec.ts`, rewritten): the
  apply→save flow with server verification, the appended-words flip,
  viewer privacy (no prompt, writes refused, PUT 405), junk and
  over-limit refusals with explicit reasons, flat 404 on missing ids.
- Migration `0014` validated offline against Prisma's own schema
  derivation (statement-equal) and applied by CI's db:setup.

---

# v0.32.2 — the production reproduction fix (26 Nov 2026)

**Report:** "Canvix AI → Chat → Auto, empty 1080×1920 canvas, the
suggested prompt 'Design a bold Instagram post for a coffee launch' —
mode `edit`, repeated `get_page_state`, the model claims no design
brief was provided, nothing created, cycle guard ends the run."

Both confirmed code defects are fixed, plus the honesty requirements.

## Defect A — intent classification (router.ts)

The artifact vocabulary missed the entire social-media family, so the
prompt had no create signal; the styling adjective "bold" sat in BOTH
edit-evidence lists and flipped it to edit. Fixes: platform
posts/stories/reels and platform names are first-class artifact
nouns; **styling adjectives are no longer edit evidence in any list**
(an adjective describes the requested design — "Design a bold
Instagram post" is create; the VERB carries edit intent, so "Make the
existing title bold" still routes to edit); "What is wrong …" (and
its curly-apostrophe form) joins the review guard; an artifact noun
inside an existing-element reference ("make the poster title bold")
is exempted from the create-first guards. The classifier prompt
teaches the same rule.

## Defect B — the request never reached the model (loop.ts)

The loop's conversation opened with the synthetic
`User request mode: edit. Begin.` — the user's actual request existed
only in the route, and `runAgentLoop()` had no request parameter.
`request: string` is now a MANDATORY loop input and becomes the first
user message, verbatim. `compactMessages` keeps `messages[1]` by
construction, so it survives compaction (regression-tested through a
70-turn run that compacts mid-run); tool observations and gate
feedback append after it. The route passes the original message.

## The honesty requirements

- **Progress gate:** a create/improve run that applied ZERO
  write/destructive tools cannot claim completion — the first such
  done is bounced with explicit build guidance; the second ends the
  run as `INCOMPLETE — no design changes were made` with
  verification `NOT completed …` (never reported as a created
  design). The strikes / idle / cycle / provider guards report the
  same honest framing for empty create runs. Guards are UNCHANGED
  (no limit raised, no bypass).
- **Pinned modes are respected, not converted:** an explicitly pinned
  edit run on an empty canvas keeps edit mode; the edit-mode prompt
  now instructs the model to say so honestly and ask what to create,
  instead of inventing elements or re-reading the page forever.

## Should the Chat tab delegate full creation to DesignAgent?

Investigated — recommendation: **not yet, and not silently.** The
DesignAgent pipeline (plan → compile → deterministic checks → visual
verify → user review gate) is the stronger engine for COMPLETE
multi-block designs, but delegating chat create-runs to it would
change the response contract mid-conversation (the pipeline returns
pages + a review gate, not the streaming action protocol the chat
panel renders) and would take the design decisions away from the
conversation the user is in. The right evolution, as a follow-up with
its own acceptance: offer the hand-off EXPLICITLY — when a chat
create run completes, the panel suggests "want the full pipeline? Run
Generate" (a one-click jump to the Generate tab, already in the
unified Canvix AI app); and/or an explicit "use the design agent"
phrase in Auto mode that routes to the pipeline with the same
request. The fixed chat loop is honest and capable for first drafts
(as the reproduction proves); the pipeline stays the premium path.
This PR keeps the chat loop's behavior otherwise untouched — BYOK,
rate limits, cancellation, brief contracts, ownership checks, tool
validation, undo and autosave all ride the unchanged bridge.

## Evidence (v0.32.2)

- Unit: 1,718/1,718 (9 new regressions in `harness.test.ts`: the
  five mandatory mode cases, adjective-vs-verb routing, the
  request-as-first-message check, compaction survival, the scripted
  reproduction creation with no `get_page_state` loop, the
  bounced-then-honest empty done, the pure-cycle honest end, and the
  brief-gate-before-done case).
- Browser (new `tests/e2e/unified-ai-reproduction.spec.ts`, the exact
  reproduction through the real editor): Auto mode sends the verbatim
  request unpinned; the create run's streamed actions land as native
  editable elements; autosave persists them; the design reopens; the
  user edits the AI-created headline through the real properties UI
  (font size 132→96, unlocked) and it saves. Screenshots captured.
- Real-provider evaluation: NOT RUN — no provider credentials exist
  in this sandbox (checked `.z-ai-config*`, provider env vars). The
  browser regression runs with the agent route mocked to the exact
  stream the fixed loop emits; the live canvix.app run after deploy
  is the real-provider check.
