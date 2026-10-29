# Changelog

All notable changes to Canvix will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.10.1] — 2026-10-29

Production hotfix: the presence P2002 storm + 30-second function hangs.
Full analysis: `research/PRESENCE-P2002-POSTMORTEM.md`.

### Fixed
- **Presence P2002 on every heartbeat** — `Presence` had a primary key
  on the participant id alone, but identity is per-browser and shared
  across designs; a second open design collided with the first on every
  heartbeat (~15 s) and cursor update. Migration `0004` makes the PK
  `(designId, id)` — one browser can now be present in many designs —
  and the heartbeat route falls back to a plain update on a
  concurrent-create P2002 instead of 502ing.
- **Functions running to exactly 30,000 ms** — the pg pool had no
  acquisition timeout and no keepAlive, so one stale pooled connection
  (pooler idle-drop without FIN) hung every request sharing the instance
  until the platform killed it at `maxDuration`. The pool now fails fast
  (`connectionTimeoutMillis 10 s`, `idleTimeoutMillis 30 s`, TCP
  keepAlive); the SSE stream closes cleanly when a tick wedges >8 s and
  self-recycles at 240 s (< the 300 s ceiling); a `retry: 1500` hint
  makes the client's reconnect invisible.
- **Duplicate events on retried flushes** (latent) — the v0.10 client
  retains and retries failed batches; a flush killed mid-batch could
  re-insert its persisted prefix. `DesignEvent.eventId` is now stored
  with a unique `(designId, eventId)` index and flushes insert via one
  idempotent `createMany({ skipDuplicates: true })` — retries are exact
  no-ops, and a flush costs one pooler round-trip instead of up to
  twenty.

### Verification
- Migration 0004 applied to production (composite PK + eventId dedupe
  verified in `information_schema`); 267/267 tests; tsc + eslint clean.
- Live probe extended to **18 checks** — all green against the real
  database, including the incident regressions (one pid heartbeating
  into two designs; a replayed batch inserting zero duplicates; each
  op streaming exactly once). Zero `[collab/presence]` errors in the
  server log afterwards.
- Cloudflare 2.14 MB gz / Netlify 19.6 MB zip — unchanged, within all
  free-tier limits.

## [0.10.0] — 2026-10-29

The "no lost work, ever" release: offline and concurrent edits merge
deterministically — Yjs-grade convergence without leaving the existing
document model. Full design rationale: `research/OFFLINE-MERGE.md`.

### Offline editing that survives reloads
- Every collab op is stamped with a **hybrid logical clock**
  (`w:counter:actor` — `src/lib/collab/hlc.ts`) persisted per browser;
  causality-aware ordering even with skewed clocks or hours-long offline
  sessions.
- The working document **and** the pending op queue persist to IndexedDB
  (debounced; capped 200 pages / 500 ops) — a crash, reload or offline
  spell loses nothing. On reopen, local work is restored when it is
  newer than the server's ("Recovered" chip) and its queue flushes on
  reconnect.
- v0.9's three data-loss windows are closed: offline edits are never
  dropped (the queue persists and retries instead of discarding),
  autosave no longer clobbers whole documents (see merge below), and
  fresh tabs no longer replay stale events over a fresh document
  (`GET /api/designs/[id]` returns the event-log `seq`; the replay
  cursor survives reloads).

### Deterministic merging (client AND server, one pure function)
- Elements are last-write-wins registers keyed by id, arbitrated by HLC
  stamps (`_m`); deletes are **tombstones** that ride the saved document;
  pages match by id (union). `src/lib/collab/merge.ts` — one rule,
  applied identically by every replica, so content converges regardless
  of arrival order.
- `PUT /api/designs/[id]` carries `baseUpdatedAt`; on divergence (the
  tab was offline while others saved) the server merges element-wise
  instead of overwriting and returns `merged:true` + the merged pages.
- `applyRemoteOp` gates stale updates/adds/deletes by stamp; coarse
  replace ops (undo, resize, restore, template) broadcast fully-stamped
  copies so they win/lose deterministically instead of clobbering.
- Legacy clients/documents: unstamped data reads as epoch (any stamped
  write beats it); legacy events get a server stamp at persist time.

### Verification
- 267 unit tests (35 new: HLC monotonicity/absorption/skew, merge
  matrix incl. delete-vs-edit and re-add resurrection, order-independent
  `applyRemoteOp`, restore arbitration); tsc + eslint clean.
- `scripts/verify-offline-merge.ts` — reusable live probe (15 checks)
  against the production database: fast-path save, divergent-PUT merge
  (offline edit wins, addition kept, delete tombstoned), converging
  re-save, SSE stamps (client hlc verbatim, legacy server-stamped).
  **15/15 green.**
- Deploy matrix intact: Cloudflare worker 2.14 MB gz (limit 3), Netlify
  function zip 19.6 MB (limit 50), Node standalone live-verified.
- **No migration required** — stamps and tombstones ride the existing
  `pages` jsonb; v0.9.x databases work untouched.

### Honest limitations
- Element z-order / page order follows the merging side's array; the
  server is the canonical convergence point (transient divergence in
  order only, never in content).
- A page deleted offline can re-appear when the other side held edits
  to it (the page set is a union; element deletes are exact). Element
  work is never lost — the page may need re-deleting.
- Two cursors in one text box still don't merge character-level (that
  is the Yjs upgrade path; the HLC stamps here are the migration seam).

## [0.9.4] — 2026-10-29

The "third platform + leaner artifact" release: **Netlify** joins Vercel
and Cloudflare Workers as a first-class deploy target, and every platform's
bundle gets ~70 % smaller.

### Netlify, zero-config
- `netlify.toml` + pinned `@netlify/plugin-nextjs` 5.16.5 (Netlify's
  OpenNext-based Next.js runtime — officially supports Next.js 16).
  Connect the repo in the Netlify UI, set `DATABASE_URL`, done.
- Functions run on AWS Lambda: full Node API surface, so scrypt auth,
  `pg` sockets and `sharp` PNG export are all native — no runtime
  guards ever trip.
- The exact Netlify build pipeline runs locally without an account:
  `npx netlify-cli build --offline`.

### The 70 MB → 20.8 MB function bundle (why it was 70 MB)
- Netlify's 50-MB-zipped function limit exposed that the traced
  `@prisma/client` shipped **~90 MB of wasm the patched client provably
  never loads** — in BOTH copies Next traces (nft's `node_modules/…` and
  Turbopack's hashed `.next/node_modules/…`):
  `*wasm-base64*` compilers for all five dialects, the old
  `query_engine_bg*` library-engine wasm (dead with `engineType="client"`),
  and the other dialects' `query_compiler_bg.{mysql,sqlite,…}` wrappers.
- New `outputFileTracingExcludes` in `next.config.ts` remove exactly
  those (+ sharp's darwin/win32 binaries), keeping the live files
  (postgresql wrappers, `raw.wasm`, `wasm-module.mjs`) — verified by
  booting the rebuilt standalone against the real database: health,
  designs and templates all green.
- Netlify function zip: **70.4 → 20.8 MB zipped** (52 MB unzipped, limit
  250). Cloudflare worker: unchanged **2.13 MB gzipped** (limit 3).
  Node standalone: proportionally smaller for every self-hoster.

### Deployment verification (all against the live database)
- `scripts/verify-deploy-readiness.ts` — one command proving migrations
  applied, schema complete (tables/columns/indexes), data present
  (110 templates), and parameterized queries through the transaction
  pooler. Reusable before any deploy, on any host.
- Production Node standalone: `/api/health` `{"ok":true}`, landing,
  templates, designs, auth register/login, anonymous `/api/auth/me`,
  SSE stream sample, MCP 503 (no AI provider configured), cross-origin
  CSRF rejection — all verified live; probe rows cleaned up.
- Cloudflare: OpenNext build + `wrangler deploy --dry-run` +
  workerd preview (landing 200, auth/me works, health degrades to the
  documented structured 503 — no crashes).
- Full gate: **232/232 vitest**, `tsc --noEmit` clean, eslint clean.

## [0.9.3] — 2026-10-29

The "run it anywhere" release: Canvix now deploys to **Cloudflare
Workers** (free tier) with the exact same codebase that runs on
Vercel/self-hosted Node — one database, zero behavioural divergence.

### Prisma without native binaries (the foundation)
- Migrated to the **rust-free Prisma client** (dependency floor 6.11 →
  6.16+; installed 6.19): no Rust query-engine binary, and it executes
  on any JS runtime including workerd. The switch is
  `generator client { provider = "prisma-client"; engineType = "client" }`
  — `prisma-client-js` + the queryCompiler flag silently keeps the
  library engine (found the hard way; documented in the patch script).
- Postgres access now goes through **`@prisma/adapter-pg`** (the real
  `pg` driver). On Cloudflare Workers pg auto-switches to
  `pg-cloudflare`'s socket layer and rides workerd's `nodejs_compat`
  straight into Supabase's transaction pooler — the same URL Vercel
  uses.
- **`scripts/patch-prisma-wasm.mjs`** (runs from postinstall, idempotent,
  fails loudly on template drift) makes the generated client
  runtime-portable: the sync `new WebAssembly.Module` becomes async
  `WebAssembly.compile`; workerd gets an ESM-imported `.wasm` (wrangler
  compiles it at deploy — runtime compilation is forbidden there); Node
  reads the raw wasm from disk. The Node import of the 2.6 MB base64
  module is gone entirely (bundler tracing is relentless — Turbopack
  resolves even env-conditional specifiers), so the wasm ships exactly
  once: **worker 2.13 MB gzipped vs the 3 MB free-plan cap** (3.11 MB
  before the deduplication).
- The client generates to `src/generated/prisma` (gitignored,
  postinstall regenerates); imports are `@/generated/prisma/client` in
  app code, relative paths in scripts.
- `src/lib/db-url.ts` grows `driverConnectionString()` — the pg driver
  gets TLS defaults translated to its semantics (`sslmode=require` →
  `no-verify`: node-postgres currently treats `require` as `verify-full`,
  which rejects hosted-pooler CA chains; user-pinned verify levels pass
  through) but not Prisma-engine-only params (`pgbouncer`,
  `connection_limit`); pool sizing is set in code (`max: 1` per
  process/isolate). The env-var normalization for `prisma migrate` is
  unchanged.
- New script-side factory `src/lib/db-script.ts` (alias-free so plain
  `tsx` runs it) used by seed, db-check, usage-forensics and the
  auth-e2e probes — `datasources` overrides (unsupported by the
  rust-free client) are gone everywhere.
- Raw-query compatibility: the rust-free client refuses Postgres catalog
  `name` columns — `/api/health` and the forensics script now cast to
  `::text`.

### Cloudflare Workers deployment
- `@opennextjs/cloudflare` + `wrangler` wired in: `wrangler.jsonc`
  (nodejs_compat + `global_fetch_strictly_public`, Workers assets,
  self-reference service binding, observability) and a dependency-free
  `open-next.config.ts` (no R2/KV/Images bindings needed — every Canvix
  route is dynamic and no `next/image` is used).
- `npm run preview` (local workerd), `npm run deploy`, `npm run upload`,
  `npm run cf-typegen`; `.dev.vars.example` documents the secrets;
  `.open-next`, `.dev.vars`, `src/generated/` are gitignored.
- Database on Workers = the Supabase **transaction pooler** URL (6543) —
  the direct endpoint is IPv6-only and workers cannot reach it.

### Runtime-portable internals
- **SSRF guard** (`src/lib/mcp/ssrf-guard.ts`): `node:net`'s `isIP` is
  replaced by a strict local implementation (verified against
  `node:net` as an oracle across a 60-case corpus, including v4-mapped
  v6, NAT64, compressed/full forms and malformed literals) — and
  `node:dns`/`node:http(s)`/`node:stream` are now lazily imported.
  Node/Bun behaviour is byte-identical (lookup-pinned transport). On
  workerd the guard resolves via **DNS-over-HTTPS** (Cloudflare's JSON
  API) and validates every A/AAAA record before `fetch()` runs; the
  wrangler `global_fetch_strictly_public` flag backstops it. The
  theoretical DoH→fetch rebinding window (unpinnable on workerd) is
  documented in the file header.
- **sharp rasterizer** (`src/lib/mcp/tools.ts`): loaded through a
  non-literal specifier guarded by a loader — Node keeps it (and
  `outputFileTracingIncludes` pins it into the standalone trace for
  self-hosters), workerd never tries to load it. MCP PNG export
  degrades to a clear "use SVG" error; fetched images fall back to
  default dimensions.
- **AI provider**: the `.z-ai-config` file fallback is Node-only (on
  workerd the unenv fs stub is swallowed by the existing try/catch —
  env vars via wrangler secrets are the provider source there).
- Auth needed no changes: workerd implements `node:crypto` scrypt,
  `timingSafeEqual`, `createHash`; SSE collab is pure web streams.

### Verification
- New suite `src/lib/cross-runtime.test.ts`: isIP parity corpus,
  driverConnectionString matrix, runtime detection.
- Full vitest run, `tsc --noEmit`, eslint and the production Node build
  stay green; the Node standalone server was live-verified against the
  real Supabase (health, designs, templates, MCP guards). The worker
  builds at 2.13 MB gzipped, boots in workerd and serves the app.
- **Known limitation (documented):** local `wrangler dev` in some
  environments (including the development sandbox this was built in)
  cannot complete the Postgres TLS upgrade — workerd's `startTls()`
  breaks after any stream-reader use (isolated with raw-socket tests
  across wrangler 4.100/4.145/4.155; the same dance works from Node
  against the same servers; `node:net`+`node:tls` upgrade is likewise
  blocked by a permanently-pending internal read). Real deployments run
  the documented pg/pg-cloudflare path — verify with
  `npm run deploy` + `/api/health`; Hyperdrive is the documented
  fallback. Full audit: research/CLOUDFLARE-WORKERS-PORTABILITY.md.
- Bonus: two pre-existing `react-hooks/set-state-in-effect` lint errors
  fixed (AuthDialog resets via Radix unmount; useAuth sets state from
  async continuations only).

## [0.9.2] — 2026-10-28

The "stop the bleeding" release — evidence-based fixes for the Vercel
usage spike (5h05m Fluid CPU / 29.08 GB Fast Origin Transfer over two
days), each traced to a measurable driver before a line was changed:

- `GET /api/designs` returned every ownerless row with base64 thumbnails
  (~7 MB/response) → keyset-paginated (60/page + Load more), ownership
  scoping AND-composed with the cursor (regression-tested).
- `GET /api/templates` (~0.7 MB, public, uncached) → CDN cache headers
  (`s-maxage=86400`, SWR 604800).
- SSE collab stream fired 3 Postgres queries every 800 ms per client →
  adaptive pump (presence every 2nd tick, MAX(id) every 5th, idle
  backoff 800 ms → 3.2 s, instant snap-back on activity; ~10× cheaper
  idle streams, unchanged editing latency).
- Presence writes throttled (cursor 120 ms → 300 ms, heartbeat 5 s →
  15 s; 48.5k slow upserts/day measured on the live DB).
- AI routes: strict same-origin guard (Origin-less/foreign POSTs get
  403 before any provider work) and tightened generation limits.
- `robots.txt` disallows `/api/`; `/api/health` is no-store + noindex.
- Infra: `scripts/usage-forensics.ts` + workflow — pg_stat_statements
  and table stats on demand for the next spike.
- 168/168 tests green (13 new regression tests).

## [0.9.1] — 2026-10-28

The "never claim someone else's work" release: claim eligibility is now
enforced, CSRF is closed out, and the verification report the roadmap
called for exists as executable tests.

### Claim eligibility (adopt-all made safe)
- **Anonymous attribution** — the first anonymous design creation sets a
  `canvix_anon` cookie (256-bit, HttpOnly, 1 year); the design row stores
  sha256(token) in the new indexed `Design.anonKey` (migration
  `0003_anon_attribution`, purely additive). A database leak never
  contains usable attribution tokens.
- **adopt-all is scoped** — `POST /api/designs/adopt-all` now claims only
  ownerless designs whose `anonKey` matches the caller's own browser.
  Another person's anonymous work and legacy (pre-attribution) rows are
  structurally outside the UPDATE. A browser with no attribution cookie
  claims nothing.
- **Per-design adoption** — new `POST /api/designs/[id]/adopt` claims ONE
  ownerless design deliberately: your own browser's designs and legacy
  rows are claimable; a foreign browser's design answers
  `403 NOT_ELIGIBLE`; races between two claimants are resolved atomically
  by a conditional `updateMany` (`409` on loss).
- **Dashboard** shows the honest claimable count ("Save my designs to
  this account (N)" counts only browser-attributed designs), a per-design
  "Save to my account" action, and — for self-hosters — a separate,
  confirmation-guarded "Adopt legacy (pre-accounts) designs" bulk item
  (`adopt-all { includeLegacy: true }`; foreign attributions remain
  excluded even then). The list API exposes boolean `claimable` and
  `mine` flags per design (never the hash). Dialog-driven sign-in/up now
  refreshes the dashboard's auth state immediately (the account chip no
  longer waits for a reload).

### CSRF protection for cookie-authenticated writes
- Every mutating API route (`POST /api/designs`, `PUT`/`DELETE` on a
  design, restore, adopt, adopt-all, register, login, logout) now
  enforces same-origin: browsers always attach `Origin` (or `Referer`)
  to cross-site requests; when present it must match the request's host
  (`x-forwarded-host` honoured behind proxies). Non-browser clients
  (curl, MCP, health probes) send neither header and pass — they carry
  no ambient cookie authority. This is defence-in-depth on top of the
  existing `SameSite=Lax` session cookie.

### Verification (the pre-Phase-4 gate)
- `scripts/auth-e2e.sh` now proves, against a real database: register →
  me → owned create → owner save → anonymous 403 → logout → **revoked
  token replay is dead** → wrong-password 401 → login → **cross-origin
  PUT/POST rejected (CSRF)** → same-origin unaffected → **two anonymous
  browsers: adopt-all claims only the caller's own design** → foreign
  per-design adopt refused, legacy allowed → **cross-account isolation
  (B cannot modify/delete/adopt C's design, opens it view-only)**.
  All probe rows are removed afterwards.
- New unit suites: session expiry/revocation/cookie hardening (mocked
  DB), CSRF guard matrix, adopt-all eligibility (the WHERE-clause
  invariant), per-design adopt matrix. SSRF suite extended with
  DNS-flip regressions (between requests and mid-redirect-chain).
  **152/152 tests green.**
- `package-lock.json` version resynced with `package.json` (skew since
  0.8.1 — tolerated by npm but confusing for tooling).
- **Vercel deployment fix** — v0.9.0/v0.9.1 pushes failed on Vercel
  (~35s, "Deployment has failed") while building clean everywhere else.
  Root cause (reproduced locally): Vercel restores a cached
  `node_modules` between builds; with no `postinstall` hook the
  Prisma client generated against the pre-v0.9 schema stayed cached,
  so `next build` typechecked the new `db.user`/`db.session`/
  `Design.ownerId` code against a client that lacked them and failed.
  Fresh installs (CI, local) regenerate the client and never see it.
  Fix: `"postinstall": "prisma generate"` (root lifecycle scripts run
  on every install, cached or not — Prisma's documented Vercel setup)
  and removal of the v0.4-era stale `bun.lock` (the repo is
  npm-first; a second, stale lockfile invites package-manager
  ambiguity on PaaS detection).

## [0.9.0] — 2026-10-28

The "Your designs, yours" release: free accounts, per-design ownership,
and the SSRF DNS-pinning close-out promised in the Phase 3 plan.

### Accounts — free forever, zero dependencies
- **Username + password accounts** with scrypt hashing straight from
  `node:crypto` (N=16384, r=8, p=1, per-hash random salt, parameters
  stored alongside the hash for future cost upgrades) — no bcrypt/argon2
  native builds, no external provider, no email. A self-hoster runs the
  whole account system for $0.
- **Opaque DB-backed sessions** — the cookie carries a 256-bit random
  token; the `Session` row id is sha256(token), so a database leak never
  contains usable session tokens. 30-day expiry, HttpOnly + SameSite=Lax
  (+ Secure in production), server-side revocation on logout, and a
  best-effort expiry sweep on every new session.
- **Input rules** (NIST SP 800-63B-flavoured): usernames 3–32 chars of
  `[a-z0-9_-]` canonicalised to lowercase; passwords 8–200 with a tiny
  top-password blocklist. Login answers one generic error (no account
  enumeration) and is rate-limited (10/10min/IP); register 5/hour/IP —
  reusing the existing sliding-window limiter.

### Per-design ownership
- `Design.ownerId` (nullable FK → `User`, `SetNull` on user deletion,
  indexed). Migration `0002_accounts` is purely additive.
- **Three access cases, one helper** (`src/lib/auth/design-guard.ts`):
  ownerless designs stay link-editable (the exact pre-v0.9 behaviour —
  existing setups and intentionally shared designs keep working); the
  owner has full edit; everyone else gets view-only.
- Enforced at every mutating API — save (PUT), delete (DELETE), restore,
  version snapshots — with a structured `403 READ_ONLY_DESIGN` body.
  `GET /api/designs/[id]` still serves share links but now carries a
  `readOnly` flag.
- **Dashboard scoping** — signed-in users see their designs plus shared
  (ownerless) ones; anonymous visitors see ownerless designs only.
  New designs created while signed in are automatically owned.
- **One-click migration** — "Save all designs to my account" adopts every
  ownerless design into the signed-in account (`POST /api/designs/adopt-all`,
  idempotent, never touches already-owned designs).
- **Editor view-only mode** — autosave is disabled and an amber banner
  explains why, instead of silently failing saves.

### Collab identity
- Signed-in users automatically appear under their real username in
  presence, cursors and comments (the local participant identity is
  upgraded on login; anonymous users keep the generated names).

### Security — SSRF DNS-rebinding pinning (the v0.6.1 residual, closed)
- `safeFetch` no longer uses `fetch()` for the exchange: it connects via
  `node:http(s)` with a **custom DNS lookup pinned to the validated
  address**. The guard resolves and range-checks every address, hands the
  connection exactly that IP, and there is no second resolution — a
  rebinding attack between validation and connect is now impossible.
  TLS keeps the real hostname for SNI/Host, so certificate validation is
  unaffected. The transport is injectable for tests; the suite now asserts
  the pinned IP on every hop (including the rebinding scenario) and
  exercises the real transport end-to-end against a local server.

### Verification
- 115 unit tests (10 new: scrypt round-trip/salting/tamper-resistance,
  username/password rules, token derivation; SSRF suite upgraded to
  assert pinning). `tsc --noEmit` clean, production build clean.
- **`scripts/auth-e2e.sh`** — boots the built standalone server against a
  real database and drives the whole flow with curl: register → me →
  owned create → owner save → anonymous `403 READ_ONLY_DESIGN` → logout →
  me(null) → wrong-password `401` → login → cleanup. Wired into the
  "Canvix Database Setup" workflow, so every re-run of the workflow now
  proves accounts + ownership against *your* live database before it
  reports success.
- `/api/health` now also checks for the `User` and `Session` tables and
  tells you to re-run `npm run db:setup` after upgrading.

### Upgrade notes
- Run `npm run db:setup` once after pulling (applies `0002_accounts`).
  Existing designs are untouched: they stay link-editable until you
  choose "Save all designs to my account" while signed in.
- Nothing else changes — anonymous/local editing works exactly as before
  for anyone who never creates an account.

## [0.8.0] — 2026-10-28

The "Supabase-ready & 110 Templates" release: switching your database to
Supabase (or any Postgres host) is now a one-command, self-diagnosing
operation, and the template library grows from 60 to **110** — still
100% free forever, no subscriptions, no paywalls.

### Database: Supabase-first infrastructure
- **Real migrations ship in the repo** (`prisma/migrations/0001_init`) —
  `npm run db:setup` applies them plus the template seed against any
  Postgres host: brand-new Supabase project, Neon, RDS, Docker or local.
  The SQL is idempotent (`IF NOT EXISTS` + guarded constraints), and the
  setup wrapper self-heals the "old database provisioned via `db push`"
  case by baselining the migration history (Prisma's documented path)
  instead of failing with P3005.
- **Smart connection handling** (`src/lib/db-url.ts`) — copy-pasting a
  Supabase URI just works: TLS is auto-required for remote hosts, and the
  transaction pooler (`…pooler.supabase.com:6543`) automatically receives
  `pgbouncer=true&connection_limit=1` so Prisma's prepared statements
  survive. Every auto-fix is logged so nothing is silent magic.
- **`GET /api/health`** — one-page diagnosis: env → connectivity →
  migration → seed, with the exact fix printed per step (including the
  Supabase IPv6/pooler hint when a direct connection can't route).
- **Template-opening failures now explain themselves** — the reported
  "could not open template" dead end is gone. API errors are classified
  (`DB_NOT_MIGRATED`, `DB_UNREACHABLE`, `DB_TIMEOUT`), the dashboard
  shows a persistent setup banner with the command to run, and toasts
  carry the fix text.
- **Quieter production Prisma logs** — query logging is dev-only now.
- `.env.example` rewritten Supabase-first; README quick start covers both
  pooler and direct connection styles.

### Template library: 60 → 110, all free
- **50 new original premium-grade templates** (designed in-house, styled
  after 2026 template-platform trends — nothing copied), organized as
  collections in the new `src/lib/templates/` module:
  - **social +14** — podcast quote card, real-estate new listing, bootcamp,
    restaurant daily special, quiet-luxury lookbook, webinar announcement,
    LinkedIn banner, recipe pin, birthday story, Black Friday, playlist
    cover, Monday motivation, flash-sale countdown story, grand opening
  - **presentation +8** — investor pitch (4-page system), marketing plan,
    course intro, agency portfolio, quarterly review, demo day, nonprofit
    impact, product launch keynote
  - **print +9** — wedding invitation, gym flyer, cafe menu, concert
    poster, yoga flyer, gift certificate, business card, open mic, moving
    sale
  - **documents +9** — executive & creative resumes, matching cover letter,
    project proposal, invoice, school newsletter, whitepaper, meeting
    agenda, press release
  - **thumbnails +7** — gaming, tech review, vlog, tutorial, podcast,
    fitness, cooking
  - **logos +3** — roastery badge, geometric tech mark, salon monogram
- `scripts/validate-templates.ts` — structural validator (unique slugs,
  pages/backgrounds/element geometry) wired for CI-style checks.
- Category totals now: social 33 · presentation 17 · print 19 ·
  documents 22 · thumbnails 12 · logos 7.

## [0.7.0] — 2026-10-28

The "Fast & Free Forever" release: the canvas rendering hot path is rebuilt
(structural sharing, memoized nodes, O(1) history), the template library
nearly triples to 60 — and the project formally commits to staying
**100% free forever**: no subscriptions, no paywalls, no locked features.

### Rendering performance
- **Structural sharing in the editor store** (`src/store/editor-store.ts`) —
  every mutation (typing, slider drags, align/flip, group/ungroup, remote
  `applyRemoteOp`, MCP live edits) now performs immutable updates that give
  new identities *only* to the touched page/elements; untouched objects keep
  their references. The old code deep-cloned the whole `pages` tree via
  `structuredClone` on every keystroke. Result: a live edit re-renders exactly
  one `ElementNode` instead of every node on the canvas.
- **O(1) undo/redo history** — since pages are never mutated in place any
  more, history snapshots are plain references (Immer-style structural
  sharing, zero dependencies). `pushHistory` no longer clones the document;
  a 60-entry history of a large design costs a fraction of the old memory.
- **Memoized canvas nodes** (`element-node.tsx`) — `ElementNode` no longer
  subscribes to the entire editor store (it reads actions at event time via
  `getState()`), is wrapped in `React.memo`, gets a stable node-ref callback,
  and `CanvasStage` passes stable handler props — selection changes, panel
  toggles, collaborator cursors and remote typing no longer re-render any
  shape they don't affect.
- **Split Konva layers** (`CanvasStage.tsx`) — interaction chrome (transformer,
  snap guides, manual ruler guides, marquee, freehand draft) moved to a second
  `<Layer>`: dragging with snapping active repaints only the overlay canvas,
  and content edits never repaint the chrome.
- **Snap-guide equality guard** — `handleDragMoveNode` compares guide sets by
  value and skips `setGuides` when nothing visibly changed (previously every
  mousemove created a fresh array and re-rendered the tree).
- **Shared image cache** (`use-loaded-image.ts`) — module-level cache keyed by
  URL with in-flight dedup, negative caching of failures and a bounded
  ~300-entry eviction. Images decode once per URL instead of once per mount.
- **`perfectDrawEnabled: false`** on element nodes — skips Konva's hit-canvas
  "perfect draw" pass during drag/transform.
- **Lazy template thumbnails** (`TemplatesPanel.tsx`) — preview stages mount
  via `IntersectionObserver` with a 300 px pre-roll; cards are memoized. The
  60-template panel only pays canvas cost for visible cards.
- **Regression-locked** — new `src/store/editor-store.test.ts` (5 tests)
  asserts the identity invariants: patched-only new identities, untouched
  pages/elements keep references, history shares structure, snapshots never
  mutate in place, remote ops preserve untouched pages.

### Premium template collection — all free (21 → 60)
- 39 new templates across every category, each with real copy, considered
  typography and Canva-grade layouts: **social** (flash-sale story, minimal
  quote, trattoria special, open house, bootcamp, webinar announcement,
  podcast cover, birthday story, wanderlust story, LinkedIn banner),
  **presentation** (pitch deck noir 2-pager, quarterly report, webinar 101,
  course welcome, product roadmap timeline, meet the team),
  **print** (neon gig poster, charity gala flyer, artisan cafe menu, spa
  voucher, open-house yard sign, luxe dark card, wedding thank-you, tear-off
  coupon), **document** (project proposal, community newsletter, ebook cover,
  tech whitepaper, press release, meeting agenda, studio invoice, case
  study), **thumbnail** (gaming, tutorial, podcast episode, unboxing) and
  **logo** (orbit tech, bloom cafe, apex fitness).
- `TemplateDef.badge` ('premium' | 'new') is a **quality label only** — the
  templates panel shows a "Premium collection · free forever" section and
  premium chips on cards; nothing is ever gated.
- DB re-seeded (60 templates upserted by slug).

### Free forever — formalized
- README gains a "Free forever — the promise" section: every feature, every
  template, every export is free; no Pro tier, no trials, no watermarks,
  ever. This is a project principle, not a launch promotion.

## [0.6.1] — 2026-10-28

Hardening & hygiene release: closes a real SSRF bypass in the MCP image
fetch, fixes JSON-RPC spec violations, ships the test infrastructure the
0.6.0 notes promised, and deletes ~24% of dead weight from the tree.

### Security
- **SSRF: redirect bypass fixed** (`src/lib/mcp/ssrf-guard.ts`) — the old
  private-host check ran on the *initial* URL only while `fetch()` followed
  redirects automatically, so any public URL that 302'd to
  `http://169.254.169.254/…` (cloud metadata) or an internal host bypassed
  it. `safeFetch()` now follows redirects **manually** and re-validates every
  hop: protocol allow-list (no `file:`/`data:`/…), full IPv4/IPv6
  private/reserved-range checks (incl. CGNAT, link-local, v4-mapped, NAT64),
  intranet-name blocklist (bare dot-less hosts, `.local`/`.internal`/…), and
  DNS resolution where **every** resolved address must be public. Decimal/
  octal/hex IP encodings (`http://2130706433/`) are normalized by the
  resolver and caught. Max 5 redirect hops. Known residual: DNS-rebinding
  TOCTOU (guard resolves, then fetch re-resolves) — documented in the source,
  full pinning planned with the Phase 3 auth work.
- **JSON-RPC `id` echo fixed** — `tools/list` answered with `id: null`
  instead of echoing the request id (spec violation that breaks strict
  client request/response correlation). Every method now echoes correctly,
  covered by regression tests.
- **Request body cap** — `/api/mcp` reads bodies through a capped stream
  reader (1 MB, works for chunked requests too) and answers `413` with a
  JSON-RPC error (`-32002`) instead of buffering unbounded payloads.
- **Image fetch size guard** — content-length is checked *before* the body
  is streamed (the old code capped only after reading the full response).

### Tests — the infrastructure 0.6.0 claimed, now real
- **Vitest** (`npm test`) — 97 unit tests: SSRF guard (range tables, DNS
  resolution, redirect pinning — including the exact v0.6 bypass scenario),
  JSON-RPC conformance (id echo, error codes, batches, notifications).
- **`scripts/mcp-e2e.sh`** (`npm run test:mcp`) — 38 live assertions over
  the HTTP transport: auth, initialize negotiation, tool catalogue, a full
  create→edit→export workflow against the database, **live SSRF-guard
  rejections**, transport hardening (invalid JSON, unknown methods,
  batches, the 413 cap). *(0.6.0's changelog referenced this script before
  it existed — mea culpa.)*
- **Playwright** (`npm run test:ui`) — browser smoke suite (landing →
  dashboard → editor canvas with react-konva mounted) plus config with
  auto-booted dev server; `BASE_URL` reuses a running instance.
- `npm run typecheck` — fast `tsc --noEmit` gate.

### Cleanup — −45 dependencies, −40 dead files (~24% of the tree)
- Removed **39 unused shadcn/ui components** (import-graph verified; the 9
  actually used — button, dialog, dropdown-menu, input, popover, progress,
  tabs, toast, toaster — remain; `npx shadcn add <x>` restores any other).
- Removed **45 unused dependencies** incl. `next-auth`, `framer-motion`,
  `zod`, `@dnd-kit/*`, `@tanstack/react-query`, `react-table`, `recharts`,
  `date-fns`, `next-intl`, `next-themes`, `sonner`, `uuid`, 19 unused
  Radix packages and more (dependency count 70 → 25).
- Removed the vestigial Tailwind v3 `tailwind.config.ts` (v4 uses the
  CSS-first config in `globals.css`; `tailwindcss-animate` → already
  replaced by `tw-animate-css`).
- **`ignoreBuildErrors: false`** — the production build typechecks strictly
  again (the codebase was already clean; now it stays that way).
- Fixed the 3 `react-hooks/set-state-in-effect` violations surfaced by the
  current eslint-config-next (`useSyncExternalStore` for `useIsMobile`,
  render-time prop mirroring in `ColorMenu`, microtask-deferred fetch in
  the dashboard hook) — `npm run lint` is fully green (0 errors, 0 warnings).
- Committed `package-lock.json` for reproducible installs.

## [0.6.0] — 2026-09-04

The Agent Edition: Canvix speaks the Model Context Protocol, so AI assistants
(Claude Desktop, Cursor, ChatGPT, any MCP client) can create and edit real
designs on your server — and the editor closes the remaining Canva-parity gaps
with native tables, image frames, curved text and embed cards.

### MCP server — AI agents drive Canvix
- **`POST /api/mcp`** implements MCP 2025-03-26 *Streamable HTTP* (stateless
  profile): JSON-RPC 2.0 requests answered with one JSON object, notifications
  with `202 Accepted`, `GET` → `405` (no server-initiated stream — spec-compliant),
  full lifecycle (`initialize` → `notifications/initialized` → `tools/list` /
  `tools/call`), `ping`, empty `resources/list` / `prompts/list`, batches ≤ 32.
- **20 tools, all backed by real subsystems** — discover (`get_capabilities`,
  `list_templates`, `search_designs`, `get_design`, `get_design_content`),
  create (`create_design` blank-or-template — id *or* slug accepted, first page
  auto-created), edit (`add_text`, `add_shape`, `add_image`, `add_table`,
  `add_embed`, `set_background`, `update_element`, `delete_element`,
  `animate_page` — the same Magic Animate engine), export (`export_design`:
  true-vector SVG server-side, PNG via sharp, JSON), collaborate
  (`comment_on_design`, `list_comments`) and `list_fonts`.
- **`generate_design`** — AI-generated designs as *native editable elements*:
  the provider is asked for a structured page spec (strict JSON mode with
  repair + one retry), then every field is normalized/clamped (coords, hex
  colors, whitelisted fonts, ≤ 25 elements) before a real Design row is
  created. Without a provider the tool errors honestly and points at
  template-based creation.
- **Live propagation**: every MCP write appends a `pages:replace` event to the
  design's collab log (actor `agent:mcp`) — open editor sessions replay agent
  edits in real time; comments emit `comment:activity` markers.
- **Hardening** — disabled until `CANVIX_MCP_TOKEN` is set (503 with setup
  instructions otherwise); Bearer auth with timing-safe comparison; Origin
  validation (DNS-rebinding guard); 120 req/min/IP; SSRF-guarded image fetch
  (private hosts denied, 8 MB / 10 s caps, content-type allow-list) → dataURL;
  per-type patch whitelists with clamps; no stack traces on the wire.
- **Dashboard "AI agents (MCP)" card** — live status probe (`OPTIONS /api/mcp`),
  copyable endpoint + client config JSON for Claude Desktop / Cursor / any
  remote MCP client. `.env.example` documents the token.
- **Protocol E2E** (`scripts/mcp-e2e.sh`): 38 assertions — initialize handshake,
  202 notifications, tools/list (20), auth (401), GET 405, unknown method/tool,
  full create → style → add (text/shape/table/embed) → update (curve) →
  animate → get → comment → export (svg/png/json) → delete flow, batch, parse
  errors, AI generation — **38/38 passing**.

### Tables (native, editable)
- New `table` element: rows × cols with per-cell text/fill/bold, proportional
  column widths, header band, border color/width, text style — four starter
  styles (classic / minimal / bold / soft).
- **Click any cell to edit it in place** (cell-scoped textarea overlay), add /
  remove rows & columns from the context toolbar, restyle via the Style popover.
- Renders in editor, previews, thumbnails, PNG/PDF/video exports; SVG export
  serializes per-cell rects + text; **AI Translate now walks table cells too**.

### Frames (image-in-shape)
- New `frame` element: rect (with corner radius), ellipse, circle, triangle,
  hexagon — images clip to the shape with cover-fit (Konva `clipFunc`).
- **Drop an upload or photo onto a frame to fill it** (drop-to-fill), or use
  the Fill button / shape switcher in the context toolbar. Empty frames show a
  dashed placeholder. SVG export uses true vector `<clipPath>`.

### Curved text
- `TextElement.curve` (−180…180°): arch up or valley down, rendered as real
  text-on-path (Konva `TextPath`) — editable, transformable, exports to
  SVG `<textPath>` and rides PNG/PDF/video export unchanged. Curve slider in
  the text toolbar with live reset.

### Embed cards
- New `embed` element for YouTube / Google Maps / generic links — a native
  vector card (tinted media band, play / pin / link glyph, host + title) that
  opens the URL when clicked in Preview or shared views. YouTube pulls the
  public thumbnail (CORS-safe, graceful fallback). Honest scope: a styled
  card, not an iframe.

### Infrastructure
- **`src/lib/v06-geometry.ts`** — pure shared geometry (arc math, table
  layout, frame clip paths, embed card metrics) used by BOTH the Konva
  renderers and the server-side SVG exporter (server-safe, no DOM imports).
- SVG exporter gained table / frame (clipPath) / embed (band + glyphs) /
  curved-text (defs path + textPath) serializers, all escaped and
  `data:`/`https:`-only hrefs.
- MCP tool schema definitions double as living API documentation for agents.

## [0.5.0] — 2026-09-04

The AI-native collaborative release: Magic Layers turns flat images into editable
designs, real-time multiplayer arrives with comments, designs learn to move with
animations and export as SVG and video, and the AI stack gets a production-grade
provider abstraction.

### Magic Layers — image → editable design
- Upload (or select) a flat design and a **vision model decomposes it into real,
  editable Canvix layers**: text regions become live text elements (color, weight,
  approximate font size and class recovered), photo regions become cropped image
  elements, shapes become native shapes, and the background becomes a page
  background/gradient.
- The analysis returns a **validated region schema** (bounds, confidence 0–1,
  layer order) — the client reconstructs native elements, never a raster. Each
  element carries `magicLayer` provenance metadata (source region, confidence,
  original bounds) for future tooling.
- Honest-by-design review UX: region overlays with confidence colors, per-region
  keep/discard toggles, low-confidence flags, model limitations surfaced in the
  dialog ("illustrations become image regions", "fonts matched by class").
- Server route `POST /api/ai/magic-layers`: dataURL-only input, 8 MB cap,
  `validateAnalysis()` clamps every field (bounds 0..1, hex colors, whitelisted
  font classes, text ≤ 400 chars, ≤ 40 regions, deduped overlapping text).

### Real-time collaboration
- **Multiplayer editing on Postgres + SSE** — an append-only `DesignEvent` log
  (global monotonic seq) is the replication stream; clients subscribe via
  server-sent events (~800 ms ticks) and push ops via batched POSTs (400 ms flush,
  coalesced `elements:update` patches). Deployable on Vercel serverless *and*
  self-hosted Node — no WebSocket server.
- **Presence**: colored cursors with name tags, remote selection outlines,
  stacked avatars + connection status (Live/Syncing/Offline) in the top bar,
  collaborator list popover with per-user page/selection state, editable display
  name (persisted anonymous identity — no account required).
- **Gap-free reconnection**: clients track `lastSeq`; on stream drop they
  reconnect with `?since=<seq>` and replay missed events; offline edits queue and
  flush on recovery. Local input is never blocked (optimistic, sync in background).
- Ops are small and explicit (`elements:update`, `element:add`, `page:replace`,
  `pages:replace`, …) and apply through the existing store actions, so undo stays
  local and Konva rendering stays fast. Share links now deep-link
  (`/?design=<id>`); unknown ids stay on the landing page.
- Abuse hardening: payloads ≤ 256 KB with recursive type/size/depth validation,
  ≤ 20 events/flush, whitelisted op kinds, presence GC (30 s offline / 24 h rows),
  event log pruned to 500 per design, malformed events dropped (never crash).

### Comments & annotations
- First-class **comments mode**: click the canvas to drop a pin (clicking an
  element anchors the thread to it — the pin follows the element), type and post.
- Threads with **replies, resolve/reopen, delete-own**, collaborator
  avatars/colors, relative timestamps; pins keep their anchor when pages resize
  (coordinates stored as page fractions).
- **Unread badges** on the topbar icon + open/resolved/all filters in the panel.
- Live propagation rides the collab event log (`comment:activity` markers →
  refetch), with optimistic local updates for the author.

### Animations — Magic Animate
- Animation model on the document (`element.animation`, `page.transition`) that
  is **independent from Konva** — pure functions of time
  (`src/lib/animations.ts`), shared by preview playback and video export.
- 9 element animations — fade, rise, pan, pop, wipe, zoom, rotate, breathe —
  with duration, delay, easing (linear/ease/spring), direction and speed presets
  (slow/medium/fast); page transitions none/fade/slide/morph with 0.1–2.5 s
  durations.
- **Magic Animate** — one-click deterministic pass: headings rise, body text
  fades, images pan from their nearest edge, shapes pop, separators wipe,
  transition fades.
- Preview gains animated playback, autoplay presentation mode and a
  reduce-motion accessibility toggle. Static exports (PNG/JPG/PDF/SVG) ignore
  animations entirely.

### SVG export
- True vector serialization of every element type: text (word-wrap measured via
  canvas 2D, per-line tspans, align/letterSpacing/decorations), shapes with
  gradients + rounded corners, paths (scaled from the 100×100 authoring box),
  lines with arrowheads, freehand strokes, images (href allowlist, rounded-clip,
  flips), stickers, groups, shadows (feDropShadow) and page backgrounds.
- **Sanitized by construction**: all text XML-escaped, path data whitelisted,
  image hrefs only `data:`/`https:`, no scripts/events/foreignObject. Multi-page
  exports as one file per page.

### Video export (MP4/WebM)
- A real, fully-local rendering pipeline: design timeline → headless Konva frame
  renderer (element animations + page transitions composited per frame) →
  `canvas.captureStream(0)` + manual `requestFrame()` → **MediaRecorder**.
- **Honest format detection**: MP4 (H.264) where the browser supports encoding
  it, WebM (VP9/VP8) otherwise — the export dialog tells you which and why
  before you start. Real-time pacing keeps duration exact (frames drop to stay
  on schedule); progress bar with frame counter; nothing leaves the browser.
- Verified end-to-end: an ffprobe-clean 1080×1080 H.264 MP4 (2.8 s, ~100 KB).

### AI Assistant 2.0
- The assistant now sees the **live design context** — elements with ids/types/
  positions/styles, selection, colors and fonts in use, page dimensions.
- It answers with **structured `DesignAction`s** (addText, updateElements,
  moveElements, scaleElements, setHeadingsColor, setFont, setBackground,
  align/distribute, addPage, duplicatePage, generateImage, suggestPalette,
  translate, magicAnimate, balanceLayout) instead of just chat.
- **Double validation**: the server clamps every field (hex colors, numeric
  ranges, id existence) and the client re-validates + resolves ids against the
  page before executing. Every action applies as a normal undoable edit, with an
  inline "Undo last change" affordance. Deterministic local fallbacks
  (balanceLayout, palettes) work without any provider.

### AI provider abstraction & fallbacks
- `src/lib/ai/provider.ts` centralizes: config resolution (`ZAI_BASE_URL`/
  `ZAI_API_KEY` env → `.z-ai-config` file → absent), capability probing,
  per-IP sliding-window rate limits on every AI route (429 + Retry-After) and
  `AIUsage` accounting.
- `/api/ai/capabilities` — public, secret-free feature detection; panels show
  "AI provider not configured" states *before* you try a feature, with local
  alternatives (background removal ONNX, deterministic palettes/layout) still
  working. No provider key ever reaches the browser (audited + grep-verified).
- All five v0.4 AI routes refactored onto the abstraction; no behavioral change
  when a provider is present.

### Performance
- **Image downscaling on embed** — uploads > 2048 px longest edge are re-encoded
  (alpha-preserving PNG / JPEG q0.9) before entering the document; 25 MB input
  cap; Magic Layers crops capped at 1024 px.
- Collaboration updates coalesce (consecutive same-id `elements:update` patches
  merge in the queue), remote batches apply as single store writes, presence
  rows and the event log are garbage-collected, and collab cursors render in a
  DOM overlay that never enters Konva's pipeline.
- Fixed an uncached zustand selector that caused an infinite re-render loop in
  the editor (Magic Layers dialog).

### Infrastructure
- Prisma schema gains `DesignEvent`, `Presence`, `Comment` and `AIUsage` models
  (backward compatible — `prisma db push`, no destructive migrations).
- Deep links `/?design=<id>` / `?d=<id>` open the editor directly (invalid ids
  fall back to the landing page).
- Research docs shipped: current-state audit, AI provider audit, fresh Canva
  research, collaboration architecture decision record and a full security
  audit (`research/V05-SECURITY-AUDIT.md`).

## [0.4.0] — 2026-09-03

The Magic Suite release: AI image editing (BG remover, Magic Eraser, Enhance),
Magic Resize with smart re-layout, design translation, live photo search,
PostgreSQL migration and server-side version history. (Full notes in the v0.4
commit message; the feature list also lives in README.md.)

## [0.3.2] — 2026-09-03

Fresh canva.com research pass (fonts, design trends 2026, feature taxonomy) plus the
next tier of editor features: gradient fills, PDF export, a Photos library and AI apps.

### Fonts — 15 → 63 families
- Font library expanded to **63 families** across five categories with Canva-style
  pills + search in the font dropdown: 18 sans, 14 serif, 14 display, 14 handwriting
  and a new **Mono** category (DM Mono, JetBrains Mono, Space Mono).
- New arrivals include Raleway, Lato, Open Sans, Nunito, Quicksand, Rubik, Work Sans,
  DM Sans, Josefin Sans, Barlow, Manrope, Outfit, Figtree, Lora, Merriweather, Libre
  Baskerville, EB Garamond, Cormorant Garamond, DM Serif Display, Prata, Bitter,
  Fraunces, Bodoni Moda, Cinzel, Alfa Slab One, Bungee, Righteous, Ultra, Passion One,
  Monoton, Rye, Titan One, Luckiest Guy, Permanent Marker, Great Vibes, Sacramento,
  Satisfy, Kaushan Script, Alex Brush, Allura, Parisienne, Amatic SC, Shadows Into
  Light, Indie Flower and Kalam.
- All fonts load through one consolidated Google-Fonts stylesheet with subset weights.

### Gradient fills (shapes & text)
- **Linear and radial gradients** on rectangles, ellipses, triangles, stars, paths and
  text — `fillGradient` on `ShapeElement`/`TextElement`, rendered via Konva
  `fillLinearGradient*`/`fillRadialGradient*` with per-shape local coordinate frames.
- The colour menu gains a full **gradient editor**: 12 preset swatches + radial chip,
  Linear/Radial type toggle, 0-360° angle slider, from/to colour pickers, and
  *Remove gradient*. The toolbar swatch previews the live gradient.
- Text effects that own the fill (Hollow, Outline, Neon…) intentionally skip the
  gradient so the effect stays intact; picking any solid colour clears the gradient.

### PDF export
- **Multi-page PDF download** in the export dialog (jsPDF, client-side, no watermark):
  print-ready page-sized PDF, per-page capture at the selected quality, all-pages
  option, automatic landscape/portrait orientation.

### Photos (new side-panel tab)
- **Photos rail tab** with Canva-style panel: search + category chips (Nature,
  Business, People, Food, Travel, Textures, Abstract), hover-to-add grid, broken tiles
  self-hide. Clicking places a 900×514 image element on the canvas.
- Bundled **42-photo stock library** (7 categories × 6) — AI-generated for Canvix,
  license-free, served locally from `public/photos/` (no external requests).

### AI apps (Canva AI parity)
- **Magic Write** app — prompt + copy kind (headline/tagline/body/caption) + tone;
  generates 3 options server-side (`/api/ai/write`, z-ai SDK) and adds any option to
  the canvas as a styled text element.
- **AI image generator** app — prompt + style chips + size (1:1/16:9/9:16/4:3);
  server-side generation (`/api/ai/image`) with preview, *Generate another*, and
  add-to-canvas as an image element.
- Both apps lead the Apps grid, mirroring Canva's AI-first 2026 navigation.

### Templates — Design Trends 2026
- Five new templates from Canva's official 2026 trends (research doc): **Prompt
  Playground** (playful productivity), **Notes App Chic** (raw handwritten notes),
  **Texture Check** (tactile warm gradients), **Opt Out Era** (structured minimalism),
  **Granny Wave** (maximalist heritage remix) — several showcase the new gradient
  fills and new fonts (Fraunces, Cinzel, Kalam, Manrope, Bodoni Moda).

### Guides
- Manual guides are now **per-page** (`ManualGuide.pageId`): each page owns its own
  set, snapping only considers the current page's guides, and *Clear guides* clears
  just the current page.

## [0.3.1] — 2026-09-03

Editor-completeness release: the remaining gap-analysis features — rulers & guides,
image crop, layer renaming, version history — plus correctness fixes found by E2E.

### Rulers & guides
- **Rulers** along the top/left of the workspace (22px strips, DPR-aware canvas ticks,
  adaptive major/minor ladder, pointer-tracking triangles). Toggle via File menu or
  **Shift+R**; fit-to-screen accounts for the ruler inset.
- **Manual guides**: drag out of either ruler to create a `#9954FF` guide; drag a guide
  to reposition, drag it off-page (or double-click) to delete; guides act as snap
  targets for element edges. Right-click the page → **Clear guides (n)**.

### Image crop
- **Crop dialog** (toolbar button, right-click → Crop image): drag handles or draw a
  brand-new region anywhere outside the current one, aspect presets (Free/Original/
  1:1/4:3/3:4/16:9/9:16/3:2/2:3) with locked-ratio drawing, rule-of-thirds overlay,
  live px readout, baked-in flips, `displayScale`-preserving apply via canvas
  re-encoding; JPEG/PNG-aware output.

### Layers
- **Rename layers**: double-click a row (or press Enter on it) — inline edit with the
  purple focus ring; empty name falls back to the auto label. `name` persisted on
  `BaseElement`; groups get a dedicated icon + label.

### Version history
- **File → Version history**: labelled snapshots per design (max 30, ~4.5MB
  localStorage budget with automatic pruning), restore (undo-able — current state is
  pushed to history first), delete, relative timestamps, pages × dimensions meta.
- **Ctrl+Alt+S** saves an instant snapshot.

### Groups (rotation correctness)
- Fixed double-rotation on group transform (children no longer get the group's angle
  baked on top of the group's own rotation).
- Ungrouping a rotated group now **orbits children around the group origin** and
  transfers the rotation, so nothing jumps.

### Apps & panels polish
- App cards and chart rows are now fully clickable tiles (role=button, keyboard
  support) — matching Canva's tile behaviour, not just the inner button.
- Tools → Layers tab reachable via role-based selectors (a11y names verified by E2E).

### Editor
- New shortcuts: **Shift+R** (rulers), **V** (select tool), **Ctrl+Alt+S** (version
  snapshot); shortcut lists in the editor modal and dashboard help modal synced.

### Design system
- Topbar gradient re-weighted purple→magenta dominant (`#02c0cc → #6425f0 → #9333ea →
  #b04fd7`) per VLM visual-QA feedback.

### Technical
- Type-check, ESLint, production build clean.
- E2E suite extended to **40 checkpoints** (rulers, guide pull, clear-guides menu,
  layers panel, version history save, QR→crop pipeline) — zero console errors.
- VLM visual QA: **8.5/10 average** across 13 key surfaces
  (`research/canvix-v03-qa-scores.md`).
- `.gitignore`: root `research/*.md` curated docs are now committed by exception.

## [0.3.0] — 2026-09-03

Deep visual-parity release informed by a fresh live audit of canva.com (logged-in,
stealth browser, computed-style + pixel-sampling extraction). Research artifacts:
`research/CANVA-V03-RESEARCH.md`, `research/CANVIX-V03-GAP-ANALYSIS.md`.

### Editor
- **Selection chrome re-skinned to measured values**: border + anchors now `#7630D7`
  with white circular handles, 2px border, 45° rotation snapping.
- **Alignment guides**: `#9954FF`, 2px.
- **Groups**: new `group` element type; Ctrl+G / Ctrl+Shift+G; children move/scale
  together and ungroup restores page positions.
- **Marquee (box) selection** on empty canvas; space+drag / middle-mouse panning;
  Ctrl+A select all.
- **Right-click context menus** (element & page): copy/cut/paste/duplicate, layer
  ordering, group, lock, hide, delete, page ops — 244px menu, 32px items, r10.
- **Context toolbar moved into the topbar** (Canva behaviour) with 32px / r10 buttons;
  mobile gets a bottom contextual action bar.
- **Zoom dropdown**: 300%→10% presets + Fit + Fill (128px listbox, 40px items),
  plus store-level `fitToScreen()`.
- New shortcuts: Ctrl+G/Shift+G (group), Ctrl+A, Ctrl+L (lock), `]`/`[` (layers).

### Text
- **10 text effects** (Drop, Lift, Glow, Hollow, Outline, Background, Splice, Neon,
  Echo, None) in a 3-column grid with live "Ag" previews.
- **FontDropdown**: search, category pills, live font previews, favourites star.
- Full toolbar: size stepper, colour, B/I/U/S, Uppercase, alignment, spacing
  (letter/line sliders), transparency slider.
- `uppercase` + `justify` model fields.

### Colour
- **Canva-style ColorMenu**: header + hex search, spectrum/eyedropper/current quick row,
  Brand Kit swatches, 4×7 default solids, gradient rows (background context).

### Panels
- **Position popover**: 2×2 arrange tiles, 6 align-to-page tiles, W/H/X/Y/Rotate with
  ratio lock.
- **Templates panel**: search, category chips, recommended section, skeletons, preview
  modal, one-click apply.
- **Brand kit 2.0**: palettes, logo uploads, “apply brand style to page”
  (nearest-colour remap + brand font swap).
- **Elements panel**: search, polygons, 11 new graphics, grouped categories.
- **Uploads panel**: replace-mode when an image is selected, set-image-as-background,
  empty state; drag-and-drop images onto canvas.

### Apps
- **Registry-driven apps ecosystem** (`apps/registry.tsx`): Charts (bar/line/donut),
  QR generator (colour + size + add to canvas), Icons (colourable), Colour palette
  generator (analogous/complementary/triad/monochrome), Placeholder text
  (lorem/real-feel), Stickers.

### Dashboard
- Account avatar menu, Help & shortcuts modal (via Get-help FAB), skeleton loading
  for recent designs, toast notifications.

### Design system
- New tokens: `--cv-selection #7630D7`, `--cv-guide #9954FF`, `--cv-menu`, slider fill.
- New shared classes: `cv-menu`, `cv-menu-item`, `cv-tbtn`, `cv-pop`, `cv-slider`,
  `cv-tip`, `cv-swatch`, `cv-skeleton`, `cv-toast`.
- Dialogs: 28px radius. Rail tooltips with 600ms delay. Focus-visible rings.

### Media
- Image adjustments (brightness/contrast/saturation via Konva filters), horizontal &
  vertical flips, `replaceSelectedImage`, `addImageAt`, `readImageFile` helpers.

### Technical
- `qrcode` dependency added.
- Type-check, ESLint and production build clean; full E2E pass (29 checkpoints,
  zero console errors); VLM visual parity 8.5–9/10 across key surfaces.

## [0.2.0] — 2026-08-31

Canva-accurate dark re-skin from live-site research: gradient topbar, 8-tab rail,
text effects (5), freehand draw, brand kit, charts, preview, share, resize,
Canva-style dashboard & mobile polish.

## [0.1.0] — 2026-08-30

Initial release: Konva.js editor (text/shapes/lines/graphics/stickers/images),
smart snapping, layers, templates, dashboard, autosave, PNG/JPG export,
responsive mobile/tablet/desktop UI.
