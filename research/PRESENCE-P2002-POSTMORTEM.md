# Postmortem — presence P2002 storm + 30 s function hangs

Date: 2026-10-29 · Status: **fixed in v0.10.1, verified live (18/18 probe
checks) against the production database.**

## Symptoms (from Vercel logs)

1. `prisma.presence.upsert()` failing repeatedly with
   `P2002: Unique constraint failed on the fields: (id)`, logged under
   `[collab/presence]`.
2. Numerous serverless functions running to **exactly 30,000 ms** —
   requests timing out / hanging until the platform killed them at the
   `maxDuration` ceiling.
3. Pooler detection working as designed (`sslmode=require`,
   `pgbouncer=true`, `connection_limit=1` notes in logs).

## Root cause 1 — the P2002 (primary bug)

`Presence` had a **single-column primary key on `id`** — the participant
id — plus a composite unique index `(designId, id)` that the upsert
matched. But participant identity is **per browser**
(`src/lib/collab/identity.ts`, localStorage) and is reused across every
design that browser opens.

So the moment one browser had presence in a second design (two tabs, or
any second design within the 24 h presence window):

```
upsert where (designId=B, id=P)   → no row (the row is (A, P))
             → INSERT (B, P)       → PK violation on id   → P2002
```

Every heartbeat (15 s) and every cursor update for the second design
failed — 502 responses and log spam, forever. Production forensics
before the fix: 808 presence rows, all 808 ids globally distinct — the
PK had been silently enforcing "one design per browser" by *failing*.

## Root cause 2 — the 30 s hangs (amplifier)

The pg pool (`src/lib/db.ts`) ran `max: 1` with **no
`connectionTimeoutMillis`** (node-postgres default: wait forever). One
stale pooled connection — Supabase's transaction pooler drops idle
server connections, and without a clean FIN the client pool never learns
— wedged the instance's only connection:

- in-flight queries on the dead peer never resolve (no keepAlive either)
- every other request on that instance (fluid compute shares the
  instance) queues on the pool **forever**
- the platform kills each at its `maxDuration` → the exactly-30,000 ms
  signature (events/comments routes run `maxDuration = 30`)

The P2002 storm amplified exposure: every failing heartbeat + cursor
flush kept churning connections and pooler round-trips.

## Root cause 3 — duplicate events on retry (latent data bug)

The v0.10 offline client **retains** failed flush batches and retries
them. A flush killed at 30 s mid-batch could have persisted a prefix of
its ops (up to 20 sequential `designEvent.create` calls); the retry then
re-inserted that prefix — duplicated ops in the replication log. The
LWW stamps made duplicates harmless *no-ops* for state, but the log
bloat and noise were real.

## The fix (v0.10.1) — four layers, no behaviour change for healthy paths

| Layer | Change |
|---|---|
| **Data model** (migration `0004_presence_scope_event_dedup`, applied to prod) | `Presence` PK → `(designId, id)` (presence is per-design by nature; the redundant composite unique index from 0001 dropped). `DesignEvent.eventId` column + unique `(designId, eventId)` — legacy NULL rows never conflict. |
| **Events route** | one `createMany({ skipDuplicates: true })` per flush (was N sequential creates — also ~20× fewer pooler round-trips) → **idempotent retries**; the presence touch is P2002-safe and bounded by a 3 s race (best-effort, never holds the flush). |
| **Presence route** | P2002 (concurrent-create race) falls back to a plain `update` — heartbeats never 502 on a benign race; genuinely unexpected errors still surface honestly. |
| **Pool + stream lifecycle** (`db.ts`, `stream/route.ts`) | pool: `connectionTimeoutMillis 10 s` (fail fast → 502 → client retries, now idempotent), `idleTimeoutMillis 30 s`, TCP keepAlive. Stream: a tick wedging >8 s ends the invocation **cleanly** (client reconnects in ~1.5 s via the `retry:` hint, replays gap-free via `?since`); streams self-recycle at 240 s < the 300 s ceiling (`CANVIX_STREAM_TTL_MS` to tune). |

## Verification

- 267/267 unit tests, tsc + eslint clean, Node build clean.
- `scripts/verify-offline-merge.ts` extended to **18 checks** against the
  live database, including the incident regressions:
  - **cross-design presence**: one pid heartbeating into two designs —
    all 200, no P2002 (the exact production repro)
  - **idempotent flush**: the same batch POSTed twice → `accepted: 0`
    the second time; SSE shows each op **exactly once**
  - SSE `retry:` reconnect hint present
  - Run: **18/18 green**, zero `[collab/presence]` errors in the server log.
- Migration 0004 applied via `scripts/apply-migration.ts` (WASM client;
  the classic engine hangs in some sandboxed environments) with a
  checksum-correct `_prisma_migrations` row — later
  `prisma migrate deploy` runs see it as applied.
- Deploy matrix intact: Cloudflare 2.14 MB gz (limit 3), Netlify
  19.6 MB zip (limit 50).

## Operator notes

- Deployments that already ran 0004 (production) need nothing; new
  self-hosters get it from `prisma migrate deploy` as usual.
- `CANVIX_STREAM_TTL_MS` (default 240,000) tunes the SSE self-recycle
  interval; keep it comfortably under the platform's function-duration
  ceiling.
- The 30 s `maxDuration` values are now ceilings that should never be
  reached: pool waits fail at 10 s, wedged stream ticks close at 8 s.
