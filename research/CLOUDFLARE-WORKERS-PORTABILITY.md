# Canvix on Cloudflare Workers — Portability Report (v0.9.3)

Status: **implemented and locally verified to the extent this environment
allows.** One item — live Postgres connectivity inside `wrangler dev` — is
blocked by a workerd runtime issue that is documented in full below, with
the verification path for a real deployment.

## What shipped

| Concern | Decision | Where |
|---|---|---|
| Next.js on Workers | `@opennextjs/cloudflare` 1.x adapter | `open-next.config.ts`, `wrangler.jsonc` |
| Prisma client | rust-free generator (`prisma-client`, `engineType="client"`) — no native engine binary, runs on workerd | `prisma/schema.prisma` |
| Postgres driver | `@prisma/adapter-pg` → `pg`; on workerd, pg auto-switches to `pg-cloudflare`'s socket layer | `src/lib/db.ts`, `package.json` |
| WASM query compiler | Node: read from disk + `WebAssembly.compile`; workerd: ESM-imported `.wasm` (wrangler compiles at deploy) | `scripts/patch-prisma-wasm.mjs` |
| Auth | unchanged — workerd implements `node:crypto` scrypt / `timingSafeEqual` / `createHash` | `src/lib/auth/*` |
| SSE collaboration | unchanged — pure web streams + timers | `src/app/api/collab/[designId]/stream/route.ts` |
| MCP SSRF guard | `node:net` isIP replaced by a local strict implementation (verified against `node:net` over a 60-case corpus); Node keeps the lookup-pinned `node:http(s)` transport; workerd resolves via DNS-over-HTTPS + `global_fetch_strictly_public` | `src/lib/mcp/ssrf-guard.ts` |
| sharp (PNG export) | runtime-guarded loader; Node keeps it (trace-pinned), workerd degrades to a clear "use SVG" error | `src/lib/mcp/tools.ts`, `next.config.ts` |
| Bundle size | **2.13 MB gzipped** (free plan limit 3 MB) | measured via `wrangler deploy --dry-run` |

Scripts: `npm run preview` (local workerd), `npm run deploy`, `npm run
upload`, `npm run cf-typegen`. Secrets via `.dev.vars` locally and
`npx wrangler secret put DATABASE_URL` (plus optional `ZAI_BASE_URL` /
`ZAI_API_KEY`) in production. The database must be the Supabase
**transaction pooler** URL (port 6543) — the direct endpoint is IPv6-only.

## Why Prisma needed surgery

Three problems, each found empirically, each fixed in
`scripts/patch-prisma-wasm.mjs` (runs from `postinstall`, idempotent,
fails loudly when Prisma's generator template changes):

1. **`prisma-client-js` + `queryCompiler` silently generates the classic
   library-engine client.** The preview flag exists on that generator but
   does not switch the engine — `config.engineWasm` stays `undefined` and
   a 17 MB `.so.node` lands in the output. The new `prisma-client`
   generator with `engineType = "client"` is what actually produces the
   WASM query-compiler client.
2. **The generated client compiles WASM synchronously**
   (`new WebAssembly.Module`). workerd forbids *all* runtime wasm
   compilation — sync and async ("Wasm code generation disallowed by
   embedder"). The patch rewrites it to `WebAssembly.compile` (portable)
   and adds a workerd branch that ESM-imports the raw `.wasm`, which
   wrangler compiles and validates at deploy time. OpenNext's
   `wrangler-external` esbuild plugin externalizes the relative `.wasm`
   import for exactly this purpose.
3. **The wasm would ship twice.** The Node branch's stock import of the
   2.6 MB `wasm-base64.mjs` is traced into the worker bundle by
   Turbopack + esbuild no matter how the dynamic import is obfuscated —
   Turbopack resolves even `process.env`-conditional specifiers and folds
   const strings through `turbopackIgnore` comments (all measured). The
   final answer removes the import entirely: on Node the client reads
   `query_compiler_bg.postgresql.raw.wasm` from disk (located by walking
   up from the module — `createRequire.resolve` is unusable because
   Turbopack rewrites it to numeric module ids). Result: 3.11 MB →
   2.13 MB gzipped.

The patch also injects an ambient type declaration for the workerd loader
and extracts the raw wasm next to `@prisma/client/runtime/` on every
install. `next.config.ts` pins the raw wasm + `pg-cloudflare` into the
Node standalone trace (Turbopack cannot see runtime-conditional or
non-literal dependencies).

## The workerd TLS-upgrade finding (local dev)

**Symptom.** In `wrangler dev` (workerd), every database connection fails.
`/api/health` reports `Cannot connect to the database`. Everything else —
static assets, the landing page, all no-DB routes — works, and the same
build on Node/Bun queries the same database perfectly.

**Isolation work** (scratch worker, since removed):

- Plain TCP from workerd to Supabase: works (SSLRequest sent, `S` read).
- TLS from the first byte (`secureTransport: "on"`, or `startTls()` called
  before any stream is touched): works — full HTTPS exchanges verified.
- `startTls()` **after** the PG-mandated SSLRequest/read dance: fails.
  Reproduced with a raw hand-rolled socket (no libraries) against both
  Supabase and a local Node lab server, on wrangler 4.100 (June 2026),
  4.145 and 4.155 (October 2026). Symptoms vary by version (opaque
  `internal error; reference = …`, or `Network connection lost`).
- Merely acquiring and releasing the WHATWG reader/writer locks — with
  zero I/O — before `startTls()` is enough to break it.
- `node:net` + `node:tls` (pg's other transport path): also broken —
  workerd's own `TLSSocket._start` throws `Cannot call releaseLock() on a
  reader with outstanding read promises` because `node:net` keeps a read
  pending permanently; `pause()` does not cancel it.
- The identical dance from a plain Node client against the same lab
  server: works end to end (TLS handshake, echo).
- PG17-style direct TLS negotiation (ClientHello as the first bytes,
  skipping the dance): Supabase's pooler does not support it — it answers
  non-TLS bytes (verified with `openssl s_client`).

**Interpretation.** PostgreSQL's SSL upgrade requires reading exactly one
plaintext byte through a stream reader before upgrading the socket — and
in the workerd builds available in this environment, any stream-reader
use poisons the socket for `startTls()`. Since `pg-cloudflare` (actively
maintained, Sept 2026) implements precisely this pattern, and Prisma's
official Cloudflare guide documents `pg` over TCP as the standard Workers
path, the most plausible reading is that local `wrangler dev` in this
sandbox cannot exercise this code path, while real Cloudflare can.

**What this means for you:**

- `npm run preview` is useful for UI/no-DB verification only.
- To verify the database path, deploy for real (it is free):
  `npx wrangler secret put DATABASE_URL` → `npm run deploy` → open
  `https://canvix.<you>.workers.dev/api/health`. A green
  `{"ok":true,…}` confirms the full stack; the error body is structured
  and names the failing step otherwise.
- If a real deployment ever shows the same connect failure, the fallback
  is **Hyperdrive** (Cloudflare's connection pooler — it terminates
  Postgres itself and hands the Worker a pooled endpoint), which bypasses
  the direct TLS upgrade entirely.

## Verified in this environment

- `npm test` — 231/231 (new suite `src/lib/cross-runtime.test.ts`:
  isIP-parity corpus vs `node:net`, driver-connection-string matrix,
  runtime detection)
- `tsc --noEmit`, `eslint .` — clean (two pre-existing
  `react-hooks/set-state-in-effect` errors fixed as a bonus:
  `AuthDialog` now resets via Radix unmount instead of an effect,
  `useAuth` sets state only from async continuations)
- Node production build + standalone server: live-verified against the
  real Supabase (`/api/health` ok, designs list, templates with CDN
  headers, MCP 401/503 paths, auth/me)
- `opennextjs-cloudflare build` + `wrangler deploy --dry-run`:
  2.13 MB gzipped worker; wasm ESM-wired; sharp absent from the bundle
- workerd preview: landing 200, static assets served, health returns a
  structured 503 (no crashes), graceful degradation everywhere

## Raw-query compatibility notes

The rust-free client is stricter than the classic engine: Postgres
catalog `name`-type columns in `$queryRaw` results throw
`UnsupportedNativeDataType`. Fixed by casting (`table_name::text`,
`relname::text`) in `/api/health` and `scripts/usage-forensics.ts`. The
driver connection string also translates `sslmode=require` →
`sslmode=no-verify` for the `pg` layer (node-postgres currently treats
`require` as `verify-full`, which rejects Supabase/Neon pooler CA
chains; `no-verify` restores the classic engine's encrypt-without-verify
behaviour). User-pinned `verify-ca`/`verify-full` values pass through
untouched.
