# v0.11.5 — Presence join latency (F4) analysis & fix

Follow-up to `V0114-QA-PASS.md` finding **F4** (the one flagged "most
impactful"): *a newly joined participant takes ~60–90 s to appear for
clients that aren't editing.* Measured in the v0.11.4 QA pass at ~90 s.

## Root cause — two stacked delays

**Delay 1 — the row didn't exist (0–15 s).**
`CollabSession.start()` connects the SSE stream and schedules the presence
heartbeat at a **15 s interval — with no immediate beat**. The only other
thing that writes a presence row is a cursor move. A fresh collaborator
who joins and just *looks* at the design announces nothing until
`start() + 15 s`.

**Delay 2 — the frame didn't go out (~64–90 s).**
The stream pump (`src/app/api/collab/[designId]/stream/route.ts`) sends a
frame only when `events.length || tick % 20 === 0`. On a quiet design the
adaptive tick backs off 800 ms → 3.2 s (the v0.9.2 cost fix), so the
20-tick keepalive is ~64 s apart. Presence rides those frames — so an
idle client learns about the join only at the next keepalive, whenever
the row from delay 1 finally landed. Worst case ≈ 15 + 64 ≈ 90 s,
matching the measurement.

## Fix

1. **Per-tick presence diff** (new `src/lib/collab/presence-diff.ts`).
   The pump queries presence **every tick** (was every 2nd) and compares a
   stable key of the *visible* snapshot — `id`, `name`, `color`, `cursor` —
   against the last key it actually **sent**. Any change pushes a frame
   within one tick and counts as activity for the backoff (a collaborator
   joining or moving a cursor keeps the pump at 800 ms, exactly like edits;
   quiet rooms still back off to 3.2 s).
   Deliberately **not** in the key:
   - `lastSeen` — bumps on every 15 s heartbeat; keying on it would push a
     frame per heartbeat and defeat the idle backoff for zero visible effect
   - row order — the query orders by `lastSeen desc`, so heartbeats reorder
     rows constantly; the key sorts rows by identity first
2. **Announce on join** (`client.ts`). `start()` now fires one presence
   POST immediately alongside `connect()`, so the row exists from the
   first moment; the 15 s heartbeat keeps it fresh after that.

## Cost

The presence `findMany` doubles (every 2nd → every tick): idle
0.16 → 0.31 q/s per client, active 0.625 → 1.25 q/s — a tiny indexed
`take: 30` query, still ~3× below the pre-v0.9.2 constant 3.75 q/s that
the cost fix eliminated. Idle **frame** traffic is unchanged (the diff
only fires on real changes; heartbeats stay silent). The every-20th-tick
frame remains as a keepalive.

## Resulting latencies

| Scenario | Before | After |
| --- | --- | --- |
| Join visible to an idle client | 60–90 s | ≤ one idle tick (~3.2 s worst case) |
| Join visible to an active client | ≤ 1.6 s | ≤ one active tick (800 ms) |
| Fresh client sees current room | first frame (unchanged) | first frame, now guaranteed current |
| Remote cursor updates on an idle client | ~64 s | ≤ 3.2 s |

## Verification

- `presence-diff.test.ts` — 13 unit tests pinning the key contract (join /
  leave / name / color / cursor changes; silent on lastSeen, reorder,
  cursor key order, null-vs-undefined cursor; delimiter unambiguity).
- `tests/e2e/presence-latency.spec.ts` — two browser contexts; client A
  held idle 12 s (pump fully backed off), client B joins cold, A must see
  B's avatar within 15 s (CI headroom; observed ~1–4 s locally), and B
  must see A's avatar immediately. **Negative-tested**: with the fix
  stashed, the test fails against the v0.11.4 code exactly as the QA pass
  observed — it guards the regression, not the implementation.
- Full gates on the branch: vitest 298/298, Playwright 20/20 (incl. the
  new spec), `tsc --noEmit` clean, eslint clean.
- Human-like two-browser pass (screenshots 15/16 in the QA archive):
  A idle in the editor for 35+ s, B joins cold → **B's avatar visible to
  A in 1.9 s** end-to-end (v0.11.4 QA measured the same scenario at
  ~90 s); B's cursor arrow + name tag propagated to A's canvas in
  **2.0 s**; closing B fades the avatar out within the 30 s presence
  window; both sessions show both avatars, no console errors.
