# Canvix v0.5.0 — Collaboration Architecture

> Decision record for real-time collaboration on the existing Next.js 16 + Zustand + Prisma/Postgres + Konva stack. Constraint that dominated every option: **the production target (Vercel serverless, or any standalone Node host via `output: "standalone"`) cannot hold persistent WebSocket connections**, and v0.5 must not regress the single-user editor's local performance.

## 1. Options compared

| Approach | Verdict | Why |
|---|---|---|
| **WebSocket server (ws / y-websocket)** | ✗ | Needs a long-lived process + connection registry. Not deployable on Vercel serverless; would split "dev works, prod doesn't". Rejecting the two-tier deployment split is a v0.5 goal. |
| **Yjs CRDT (client-embedded, any transport)** | ✗ (for v0.5) | Best-in-class offline merge, but requires converting the document model to Y structures (Y.Map/Y.Array) — a rewrite of `editor-store` persistence, undo/redo (Y undo stack ≠ our snapshot history), template seed, autosave and version snapshots. ~All 695 store lines + all element ops would need a second implementation path. Too invasive for one release. |
| **Liveblocks-style SaaS** | ✗ | External service + credential; violates self-hostable/open-source positioning. |
| **Pure polling (client asks "what changed?")** | △ | Works everywhere, but ≥1.5–2 s effective latency and constant DB load per client; poor cursor feel. |
| **SSE down + POST up, Postgres event log as source of truth (server-authoritative)** | ✓ **CHOSEN** | Deployable on Vercel (Node runtime streaming) *and* standalone; sub-second fan-out; single source of truth in Postgres (already required infra); no store rewrite — remote ops are applied through the **existing store actions**; clean reconnection semantics (`?since=<seq>`); graceful degradation to polling if a proxy kills streams. |

### Why this is still a CRDT-flavored, robust design
- The unit of replication is an **operation log** (append-only `DesignEvent` rows with a global monotonic `seq`), not whole-document PUTs. Event log = CRDT-lite: commutative per-element patches, idempotent by `eventId`, replayable from any offset.
- Element-level ops (not document-level) mean **two people editing different elements never clobber each other**. Same-element conflicts resolve last-write-wins — acceptable for v0.5, documented.
- IDs: session emitter prefixes locally-generated `uid()` ids with the actor's participant id when broadcasting, keeping cross-session ids collision-free.

## 2. Data model (Prisma, appended in v0.5)

```prisma
model DesignEvent {
  id        BigInt   @id @default(autoincrement())   // global seq — clients track lastSeq
  designId  String
  actorId   String                                   // participant id
  kind      String                                   // op name (see §3)
  payload   Json
  createdAt DateTime @default(now())
  @@index([designId, id(sort: Desc)])                // replay + tail queries
}

model Presence {
  id        String   @id                             // = participantId (client-generated)
  designId  String
  name      String
  color     String
  cursor    Json?                                   // {page, x, y, selection?: string[]}
  lastSeen  DateTime @default(now()) @updatedAt
  @@unique([designId, id])                           // one live presence row per participant per design
  @@index([designId, lastSeen])
}

model Comment {
  id         String    @id @default(cuid())
  designId   String
  pageId     String
  x          Float
  y          Float
  elementId  String?                                  // optional element anchor
  authorId   String                                    // participant id
  authorName String
  authorColor String
  body       String
  parentId   String?                                  // reply threading
  resolved   Boolean   @default(false)
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  @@index([designId, createdAt])                      // panel listing
  @@index([designId, resolved])
}

model AIUsage {                                       // provider accounting + abuse telemetry
  id        String   @id @default(cuid())
  feature   String
  provider  String
  ok        Boolean  @default(true)
  createdAt DateTime @default(now())
  @@index([createdAt])
}
```

## 3. Operation protocol (`DesignEvent.kind`)

Ops are small, explicit, and applied through existing store actions:

| kind | payload | applied via |
|---|---|---|
| `elements:update` | `{ pageId, ids, patch, eventId }` | `updateElementsLive` |
| `element:add` | `{ pageId, element }` | store batch insert (no history push for remote) |
| `element:delete` | `{ pageId, ids }` | store filter |
| `elements:reorder` | `{ pageId, orderedIds }` | store reorder |
| `page:add` / `page:delete` / `page:dup` | `{ pageId, afterId? }` | store page ops |
| `page:background` | `{ pageId, background }` | `setPageBackground` |
| `pages:replace` | `{ pages }` | full-document reconciliation (resize/translate/undo-broadcast — rare, coarse) |
| `cursor` | handled by Presence table, not the event log (high frequency, no history value) |

Emission policy (Phase 13 performance): local mutations **queue** events and flush every 400 ms batched; live drags emit throttled `elements:update` (position only) at ~120 ms; undo/redo emit `pages:replace` for correctness (undo restores snapshots — op-level undo replay is out of scope). Text typing emits debounced (600 ms) `elements:update` with the final text.

## 4. Transport

```
Client                                    Server (Node runtime)
  │  GET /api/collab/[designId]/stream?since=0&pid=…        │
  │────────────────────────────────────────────────────────▶│
  │  SSE: `data: {events:[{seq,kind,payload}…], presence:[…]}`│
  │◀────────────────── every ~800 ms poll tick ─────────────│
  │                                                          │
  │  POST /api/collab/[designId]/events   (batched ops)      │
  │────────────────────────────────────────────────────────▶│
  │  POST /api/collab/[designId]/presence (heartbeat/cursor) │
  │────────────────────────────────────────────────────────▶│  every 5 s (cursor: throttled)
```

- **SSE stream** = server holds the response open; each 800 ms tick it queries events `id > lastSeq` + live presence (lastSeen < 30 s) and writes one SSE frame (only when something changed, plus a 15 s keep-alive comment). `X-Accel-Buffering: no` for proxies.
- **Reconnect**: client keeps `lastSeq`; on stream error/close → exponential backoff (0.5 s → 8 s cap) → `GET stream?since=lastSeq` → gap-free replay. Connection state surfaced in the UI (Live / Connecting / Offline badge). This also degrades to polling transparently — each reconnect is a poll.
- **Vercel**: Node runtime SSE works (streaming allowed, `maxDuration` bounded); when the function recycles the client reconnects and replays from `lastSeq` — no data loss because Postgres is the log.
- **Bun dev / standalone Node**: identical path, no special server needed.

## 5. Client architecture

```
src/lib/collab/
  identity.ts     participant id/name/color (localStorage, Phase 6)
  protocol.ts     TS types for ops + wire frames (shared by server & client)
  client.ts       CollabSession class: SSE subscribe, emitter queue (400 ms batch),
                  cursor throttle, reconnect/backoff, callback fan-out
  use-collab.ts   React hook wiring CollabSession ⇄ useEditorStore:
                  local store mutations → emit; remote ops → apply (suppressed re-emit)
```

- Zustand stays the **local-first** source of rendering truth; collab never blocks input (optimistic updates, sync in background).
- **Re-entry guard**: applying remote ops uses a module flag `applyingRemote` so the emitter hook doesn't echo ops back (feedback loop).
- Presence rendering: avatars stack (TopBar), colored cursors + name tags (canvas overlay layer in Konva, non-interactive), collaborator selection outlines, "edited by X" element halo (subtle, 1.2 s decay).
- A large collaborative doc cannot flood Zustand: remote `elements:update` applies as a **single** store `set` per batch (already the case — patch-based, no per-element sets).

## 6. Authorization & abuse (details in V05-SECURITY-AUDIT.md)

- Anyone with the design id can join as viewer/editor (Canva "link = edit" model, matching the account-less app). No privilege escalation surface exists beyond that (no accounts yet).
- Hard caps: event payload ≤ 256 KB (reject bigger), ≤ 20 events per flush, presence rows GC'd (lastSeen > 30 s = offline; rows > 24 h deleted lazily), DesignEvent log pruned to the last 500 per design (background on stream tick), participant name ≤ 40 chars, comments ≤ 2000 chars.
- All op payloads are **validated and clamped server-side** before persisting (ids exist? page belongs to design? numbers finite? colors sanitized?). Malformed events are dropped, never crash the stream.

## 7. What we consciously defer (v0.6+)

- Yjs-grade offline merge & conflict resolution (needs document-model migration).
- Element-level undo broadcast (currently undo syncs via `pages:replace`).
- @-mentions, comment reactions, per-comment deep links (needs stable share URLs + accounts).
- WebSocket transport for sub-100 ms latency (only worth it with a persistent host).
- Server-side video rendering farm; FFmpeg worker queue.
