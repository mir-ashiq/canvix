# Canvix v0.10 — Offline Merge (the "Yjs-grade" convergence without Yjs)

Date: 2026-10-29 · Status: **implemented, unit-verified (267 tests), live-verified
against the production database.**

## The problem

v0.9 collaboration had three data-loss windows:

1. **Offline edits were dropped.** `flush()` re-queued 5 ops once on network
   failure, then discarded the rest; the working document lived only in
   memory, so a reload while offline lost everything since the last
   successful autosave.
2. **Autosave was last-write-wins on the whole document.** Two divergent
   tabs both PUT full `pages`; whichever saved last silently erased the
   other's work — exactly the collision an offline editor creates on
   reconnect.
3. **Fresh tabs replayed stale events.** `since=0` on first connect
   delivered the oldest retained events over a freshly loaded document
   (the log holds the last 500); applying them could move elements
   backwards.

## The design (one idea, four places)

Every element becomes an **LWW-register keyed by id, written with a hybrid
logical clock stamp (`_m`)**; deletes become **tombstones**
(`PageData.tombstones[id] = hlc`) that ride the saved document; pages
match by id and their set is a union. Because every replica — client or
server — applies the same total order to the same stamps, **content
converges no matter what order the writes arrive in**. That is the
property Yjs provides via CRDTs; obtained here without migrating the
document model off `PageData[]`.

### Pieces

| Piece | Where |
|---|---|
| Hybrid logical clock (`w:c:actor`, zero-padded so plain string compare works; persisted per browser in localStorage; absorbs remote stamps on observe) | `src/lib/collab/hlc.ts` |
| Pure merge (`mergeElements`, `mergePages`, stamping helpers) — used by BOTH the client and the server, so the rule is literally one function | `src/lib/collab/merge.ts` |
| IndexedDB offline store: working doc + pending op queue per design, restore arbitration (`decideRestore`) | `src/lib/collab/offline-store.ts` |
| Client session: queue persists (debounced), retained on network failure (bounded 500), restored + flushed on reconnect; replay cursor (`canvix-seq-<id>`) survives reloads | `src/lib/collab/client.ts` |
| Store: every mutation path stamps (`updateElementsLive` puts `_m` in the patch; adds stamp at creation; deletes tombstone; coarse ops — undo/resize/restore/template — broadcast fully-stamped copies so they win/lose deterministically instead of clobbering) | `src/store/editor-store.ts` |
| `applyRemoteOp` gates: stale updates/adds/deletes skip by stamp; `pages:replace` now MERGES per element instead of blind-replacing | `src/store/editor-store.ts` |
| Server stamps events lacking `hlc` (legacy clients) with a server clock at persist time (`payload._h`) | `events/route.ts` |
| `PUT /api/designs/[id]`: body carries `baseUpdatedAt`; mismatch → server-side `mergePages` instead of overwrite; response reports `merged:true` + the merged pages (client adopts via the same gate) | `designs/[id]/route.ts` |
| `GET /api/designs/[id]` returns `seq` — the event-log cursor at load time, so fresh tabs don't replay pre-load events (fix #3; the gates are the safety net) | `designs/[id]/route.ts` |
| Editor: offline mirror persisted (debounced 700 ms) on every mutation; autosave sends `baseUpdatedAt`; delete flows purge IndexedDB + cursor | `Editor.tsx`, `dashboard/hooks.ts` |
| UI: "Recovered" chip after offline-restore; "Offline · N" / "Syncing N" pending-op counts in the presence area | `PresenceAvatars.tsx` |

### What a user experiences

- **Network drops mid-editing:** the badge flips to "Offline · N" with a
  live count; editing continues completely unblocked. Every op is retained
  and persisted; nothing is dropped.
- **Reload (or crash) while offline:** the editor reopens with the
  locally persisted document ("Recovered" chip) and the pending queue;
  the replay cursor resumes where the last frame ended.
- **Reconnect:** the queued ops flush (server assigns seqs; live tabs
  apply them through the same stamps); remote events since the cursor
  replay back; the next autosave PUT carries the stale `baseUpdatedAt` →
  the server merges element-wise; both sides' work survives.
- **Two people edit the same element:** the causally-newer write wins on
  every replica — deterministically, independent of arrival order.
- **Delete races an edit:** the newer of the two wins; a re-add newer
  than the tombstone resurrects the element.

## Verification

- **Unit (267/267):** HLC monotonicity/restart/absorption/skew; merge
  matrix (disjoint union, LWW both directions, delete-vs-edit, re-add
  resurrection, pointwise tombstone max, legacy-epoch behaviour, group
  deep-stamping, defensive id-dedupe); `applyRemoteOp` order-independence
  (stale replay cannot clobber newer state; stale delete cannot kill a
  newer re-add; stamped `pages:replace` merges); restore arbitration
  (queue/newer-doc/jitter-grace/conservative-missing-timestamp).
- **Live (production standalone + real Supabase):** health green; created
  a stamped design; PUT with stale `baseUpdatedAt` → `merged:true` with
  the offline edit winning, the delete tombstoned, the offline addition
  kept; a newer live edit then beat the offline edit while the offline
  addition SURVIVED the subsequent save; SSE events carried `_h`
  (client-passed) through the stream; probe design deleted afterwards.
  The whole sequence is repeatable via `scripts/verify-offline-merge.ts`
  (15 checks — point it at any running deployment) — latest run:
  **15/15 green**.
- Cloudflare worker still 2.14 MB gzipped (< 3 MB free cap); Node build
  clean; tsc clean; eslint clean on all touched files.

## Honest limitations (documented, deliberate)

- **Z-order / page order** follows the merging "ours" side; the server is
  the canonical convergence point (its merge direction is fixed — the
  stored doc is always "ours"), so concurrent reorders of one page may
  differ transiently per replica until the next autosave. Content never
  diverges.
- **Offline page deletions** are coarse: the page set is a union, so a
  page deleted offline can re-appear when the other side held edits to it
  (element-level deletes inside pages are tombstone-exact). Element work
  is never lost; the page may need re-deleting.
- **`pages:replace` semantics:** undo/resize/restore/template are
  "redefine the document" actions — they stamp everything fresh and
  deterministically beat older concurrent edits (and lose to newer ones).
  That matches user intent for explicit overrides.
- **Legacy data:** pre-v0.10 documents/elements are unstamped (epoch) —
  any stamped write beats them, and two unstamped copies resolve
  ours-stable. Old clients (pre-v0.10) mixed with the new server get
  server-stamped events; their un-stamped PUTs fast-path (no
  `baseUpdatedAt`) exactly as before.
- The queue is capped at 500 ops / the offline doc at 200 pages — beyond
  that, oldest ops drop (the document itself is still persisted and
  merges wholesale via `baseUpdatedAt`).

## Why not just adopt Yjs?

Revisited the v0.5 decision with current code: converting the document
model to Y structures still means rewriting store persistence, undo/redo
(Y undo ≠ snapshot history), template seeding, autosave and version
snapshots — the entire 1000-line store plus every op emitter. The
stamp-and-merge layer achieves the convergence property users actually
notice (no lost work, deterministic conflicts) in ~700 focused lines that
reused every existing op path. If true character-level text merging (two
cursors in one text box) becomes a requirement, Yjs is the next step and
the HLC stamps here are the migration seam.
