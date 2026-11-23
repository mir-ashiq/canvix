# The Canvix Design Agent (v0.27) — architecture

Research-informed rebuild of the Canvix AI assistant as a real multi-step
design agent. Sources: a survey of 10 open-source agent projects (tldraw
agent-template, OpenPencil, Loomic, jaaz, langchain-ai/design-agent,
GhostCanvas, HyCanvas, OpenDesign, ComfyArt, kyh/ai-canvas) and 6
commercial products (Canva AI 2.0, Figma Design Agent/Make, Adobe Express
AI Assistant / Firefly Creative Agent, Gamma, Microsoft Designer, Wix /
Framer / Relume). Full notes: `research/AGENT-RESEARCH-2026-11.md`.

## The ten principles this build follows

1. **Do-bot, not chatbot** (Adobe). The agent completes work; conversation
   is the entry point, not the product. Empty-input anxiety is handled by
   suggestion chips and one-click presets.
2. **Single-shot fast path + agentic loop** (tldraw `request()` vs
   `prompt()`; ComfyArt's task routing; Anthropic's "don't default to
   agents"). Simple edits ("make the title bold") must NOT pay the agent
   loop's latency: the router classifies the message, cheap intents get
   one completion call, complex briefs get the loop.
3. **Bounded loop with explicit budget.** Max steps per run (default 8),
   max tool calls (default 12), wall-clock cap. The failure modes named by
   Loomic — over-ambition and false completion — are countered by budgets
   plus a mandatory verify step before "done".
4. **Tiered state serialization — never the whole scene graph** (tldraw).
   Selection = full properties. Current page = {id, type, bbox, text,
   fill}. Other pages = one-line summaries. Plus the computed spatial
   analysis (overlaps, off-canvas, alignment) from v0.26.
5. **Verb-level tools, JSON protocol.** The z-ai SDK (and the BYOK
   endpoints most self-hosters use) does not expose native function
   calling, so the loop speaks a strict JSON protocol:
   `{"thought": "...", "tool": "name", "args": {...}}` per step, and
   `{"done": true, "summary": "..."}` to finish. Tool list is in the
   system prompt; results come back as user-role observation messages.
   This is provider-agnostic — works with any OpenAI-compatible BYOK key.
6. **Sanitize every tool call at the boundary** (tldraw `sanitizeAction`).
   Unknown ids rejected, enums checked, numbers clamped, text length
   capped — BEFORE anything touches the document. Tool errors are
   actionable ("fontSize must be 6–400; you sent 1200"), so the model can
   correct itself on the next step.
7. **Client-executed actions = editor-parity + free undo/collab.**
   Following ComfyArt's browser-tab-as-executor pattern, the SERVER plans
   and the CLIENT executes through the same `applyDesignAction` path a
   user action rides: every agent action is an undo step, emits collab
   ops, and can never desync from the editor's validation. The server
   never mutates the design directly during a chat run.
8. **Streaming, narrated progress** (Gamma). The route streams SSE events:
   `step` (thought + tool), `action` (validated, ready to apply),
   `applied` (client ack), `done`/`error`. The UI shows the live plan and
   each tool result as it lands; canvas changes appear incrementally.
9. **Plan for big work, act for small.** The router tags intents: `act`
   (one-shot actions), `plan` (multi-step brief → the agent first emits a
   short numbered plan the user sees streaming, then executes), `ask`
   (question about the design → answer only). Destructive tools
   (deleteElements, clearPage) require `confirm: true` in auto-apply mode;
   in manual mode every action waits for the user.
10. **Session memory + goal persistence** (Canva Memory Library, Gamma).
    The client keeps the conversation and the run's goal in the panel; the
    server receives (and re-sends) compacted history so refinements stay
    scoped — "tighter, not different."

## Components

```
src/lib/agent/
  protocol.ts     AgentEvent union + wire types (SSE), step budget consts
  tools.ts        AGENT_TOOLS registry: name, schema description, kind,
                  risk (read|write|destructive), arg sanitizer, and the
                  DesignAction(s) it compiles to. PURE — no fetch, no store.
  context.ts      tiered design-context serializer (selection full → page
                  summary → other pages one-liners) + spatial analysis
  router.ts       intent classifier (act | plan | ask) — one cheap LLM
                  call with JSON output; falls back to `plan` on doubt
  loop.ts         the agent loop: messages in, SSE events out, budget
                  enforcement, retry-on-parse-failure, verify step
  loop.test.ts    unit tests: budget stops, sanitizer rejections, protocol
  router.test.ts  intent classification tests
  tools.test.ts   tool schema/sanitizer tests

src/app/api/ai/agent/route.ts   POST — SSE stream (withProvider + rate
                                limit, same auth/CSRF posture as every
                                other AI route)

src/components/editor/apps/AssistantApp.tsx   rebuilt: streaming steps,
  plan view, auto-apply toggle (kept), manual approve, Stop button,
  session history, suggestion chips, brand-context note
```

## Tool registry (v0.27.3 — 24 tools)

read-only: `get_page_state` (re-serialized state after edits),
`goto_page` (switch pages — element ids are per-page)
write: `add_text`, `add_shape`, `add_image` (AI generation),
`add_stock_photo` (licensed Pexels/Pixabay search via the existing
client rail — real photos with attribution), `add_sticker`,
`add_table`, `update_elements`, `set_text_style`,
`move_elements`, `align_elements`, `distribute_elements`,
`set_background`, `set_font`, `recolor`, `add_page`,
`duplicate_page`, `fix_overlaps`, `balance_layout`,
`animate_page`, `translate_texts`
destructive (confirm): `delete_elements`, `clear_page`

Every tool compiles to one or more `DesignAction`s (the existing,
double-validated client executor) — the agent never emits raw patches.

## Flow

```
client ──POST /api/ai/agent {message, history, design, mode, confirmMap}
  │
  ├─ router: classify (act|plan|ask)        [1 cheap LLM call]
  ├─ ask  → one completion → {done, summary}                       (SSE)
  ├─ act  → one completion with the tools spec → up to 3 actions    (SSE)
  └─ plan → agent loop:
        step i: model → {thought, tool, args}
                sanitize → (invalid? observation with the exact fix)
                risk=destructive && !confirmed → ask user (pause)
                else → emit `action` event → client applies → ack
                observation: compact result (ids, geometry)
        budget exhausted or model says done → verify step:
          re-read state, check goal, emit {done, summary}
```

## Budgets & failure discipline (v0.27.3)

- **Progress budget** (`maxSteps: 8`) counts only turns that led
  somewhere — a sanitized tool call or a done. Sanitize rejections,
  unknown tools and the one JSON-repair retry are FREE, so a run
  that stumbles twice still gets its full productive budget.
- **Strike rule**: rejections are free of the tool budget, but three
  CONSECUTIVE invalid calls end the run with an actionable error —
  without this, a model that never produces a valid call loops on
  wall-clock alone while the message list grows unboundedly (found
  by the harness: it OOM'd the worker). A successful call resets
  the strike count.
- **Approved destructive calls also await the client's apply ack** —
  a failed apply feeds the error back to the model instead of being
  counted as done. The panel only persists a tool approval after a
  SUCCESSFUL apply.

## What deliberately stays out (scope discipline)

- No sub-agents / parallel variations in v0.27 (SuperDesign-style 3-way
  exploration is a v0.28 candidate; the event protocol already has a
  `variant` field reserved).
- No server-side design mutation: the editor stays the single writer.
- No scheduled/background runs (Canva 2.0 has them; needs a job queue).
- No new MCP tools in this wave — the in-app agent comes first; the same
  tool registry can back an MCP surface later (HyCanvas pattern).

## Undo & safety

- Every applied action = one editor undo step (existing store behavior).
- The panel shows "Undo agent work" = N undo steps back to the session
  baseline (snapshot of history length at run start).
- Destructive tools need explicit user confirmation (jaaz
  tool_confirmation_manager pattern) unless the user flipped
  "auto-confirm destructive" off — default remains ask.
- Budgets + wall clock cap make runaway loops impossible; the client can
  abort the stream at any time (Stop button) and keeps completed work.
