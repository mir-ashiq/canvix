# Canvix — Deployment Verification Report (v0.9.4)

Date: 2026-10-29 · Scope: full-stack deploy readiness against the **live
Supabase database** on every supported platform, plus the Netlify port.

The database under test: Supabase transaction pooler
(`aws-0-ap-southeast-2.pooler.supabase.com:6543`, PostgreSQL 17.11) —
the same URL style every platform must use (serverless functions have no
IPv6 route to the direct endpoint).

## 1. Database — connects perfectly

`scripts/verify-deploy-readiness.ts` (new; reusable pre-deploy gate):

| Check | Result |
|---|---|
| Connect + server version | ✓ PostgreSQL 17.11 (aarch64) |
| Migrations | ✓ 0001_init, 0002_accounts, 0003_anon_attribution all applied |
| Tables | ✓ User, Session, Design, DesignEvent, Template |
| Columns | ✓ Design.ownerId, Design.anonKey, User.passwordHash, Session.expiresAt |
| Indexes | ✓ Design_pkey, Design_ownerId_idx, Design_anonKey_idx |
| Data | ✓ 110 templates · 1304 designs · 35 users · 6611 events |
| Parameterized queries | ✓ through the transaction pooler (pgbouncer discipline holds) |

Auto-normalization confirmed on every connection: Supabase-pooler URLs
get `sslmode=require` + `pgbouncer=true&connection_limit=1` injected
(`src/lib/db-url.ts`), and the pg layer translates `sslmode=require` →
`no-verify` (node-postgres treats `require` as verify-full, which rejects
Supabase's pooler CA chain).

One sandbox gotcha worth recording: a stale `DATABASE_URL` exported in
the shell (an SQLite `file:` path) silently overrides `.env` for the
Prisma CLI and the standalone server — when the CLI says "the URL must
start with the protocol postgresql://", check `echo $DATABASE_URL`
first. The app itself is unaffected when the URL is passed explicitly
or the variable is unset.

## 2. Production Node standalone (the self-host / Vercel-equivalent path)

`npm run build` → `PORT=3100 NODE_ENV=production node
.next/standalone/server.js` with the live `DATABASE_URL`:

| Route | Result |
|---|---|
| `/api/health` | `{"ok":true,…,"templates":110}` |
| `/` (landing) | 200 in ~18 ms |
| `/api/templates` | 200, full 110-template list |
| `/api/designs` | 200, list with thumbnails (1304 rows' DB) |
| `/api/auth/me` (anonymous) | `{"user":null}` |
| `POST /api/mcp` (no AI provider) | 503 — documented degradation, not a crash |
| SSE `/api/collab/<id>/stream` | events stream live from the event log |
| `POST /api/auth/register` + login | user created, session cookie set |
| Cross-origin `POST /api/designs` | 403 — CSRF same-origin enforcement works |

Probe rows (the `deployprobe` user) were deleted afterwards.

## 3. Cloudflare Workers

- `opennextjs-cloudflare build`: ✓
- `wrangler deploy --dry-run`: **2.13 MB gzipped** (free-plan limit 3 MB)
- `wrangler dev` (workerd) preview: landing 200, static assets served,
  `/api/auth/me` works, health returns the **structured** 503 with no
  uncaught exceptions in the log — exactly the documented local-dev TLS
  limitation (`research/CLOUDFLARE-WORKERS-PORTABILITY.md`); the real
  deployment remains the verification path for the DB leg:
  `npx wrangler secret put DATABASE_URL` → `npm run deploy` →
  `/api/health` on the workers.dev URL. Hyperdrive is the fallback if a
  real deployment ever shows the same connect failure.

## 4. Netlify (new in v0.9.4)

Adapter: Netlify's OpenNext-based Next.js runtime
(`@netlify/plugin-nextjs` 5.16.5, pinned in devDependencies + declared in
`netlify.toml`). Node 22 for builds; functions run on AWS Lambda with a
full Node API surface — scrypt auth, `pg` sockets and `sharp` all native.

`npx netlify-cli build --offline` (no account needed) runs the exact
pipeline: build command, functions bundling, edge-functions bundling, all
plugin lifecycle events — **completed clean**.

### The 50 MB problem and the fix

The first offline build produced a **70.4 MB zipped** server-handler
function (166.7 MB unzipped) — over Netlify's 50-MB-zipped limit.
Forensics on the zip: the traced `@prisma/client` shipped ~90 MB of wasm
the patched client provably never loads, **twice** (nft's copy under
`node_modules/` and Turbopack's hashed copy under
`.next/node_modules/@prisma/client-2c3a283f134fdcb6/`):

- `*wasm-base64*` — base64-embedded query compilers for postgresql,
  mysql, sqlite, sqlserver, cockroachdb (≈2.6 MB each, .js + .mjs)
- `query_engine_bg*` — the old library-engine wasm, dead with
  `engineType = "client"`
- `query_compiler_bg.{mysql,sqlite,sqlserver,cockroachdb}.*` — other
  dialects' JS wrappers (the datasource is postgresql, fixed at generate
  time)

Proof of safety: the patched loader
(`scripts/patch-prisma-wasm.mjs`) only ever ESM-imports the raw `.wasm`
(workerd branch) or reads it from disk (Node/Bun branch), and a repo-wide
grep shows **no file imports any `*wasm-base64*` module**.

`outputFileTracingExcludes` in `next.config.ts` now removes exactly the
dead files (plus sharp's darwin/win32 binaries), keeping the live ones
(postgresql wrappers, `raw.wasm`, `wasm-module.mjs`).

| Artifact | Before | After | Limit |
|---|---|---|---|
| Netlify function zip | 70.4 MB | **20.8 MB** | 50 MB zipped / 250 MB unzipped (52.0 MB now) |
| Cloudflare worker | 2.13 MB gz | **2.13 MB gz** | 3 MB |
| Node standalone | ~166 MB | ~52 MB | — |

Verified after the diet: standalone boots against the live DB (health,
designs, templates green); workerd preview unchanged; the Netlify zip
still contains the raw wasm + wasm-module loader in both traced copies;
full gate 232/232 tests, tsc clean, eslint clean.

### Deploying for real (free)

1. Push the repo to GitHub → Netlify UI → *Add new site → Import an
   existing project* (build settings come from `netlify.toml`).
2. *Site settings → Environment variables* → `DATABASE_URL` = the
   transaction-pooler URL (optionally `ZAI_BASE_URL` / `ZAI_API_KEY`).
3. Deploy → open `/api/health` — `{"ok":true}` = full stack green.

## 5. What still needs a real account (and is one command each)

This sandbox has no Cloudflare/Netlify/Vercel credentials, so the last
mile — hitting each platform's live infrastructure — is documented
instead of executed:

- **Cloudflare Workers**: `npx wrangler secret put DATABASE_URL` →
  `npm run deploy` → `/api/health` on `https://canvix.<you>.workers.dev`
- **Netlify**: UI import + one env var (above)
- **Vercel**: repo import + `DATABASE_URL` (already the documented
  default path; `postinstall` regenerates the Prisma client on every
  build — the v0.9.1 Vercel cache fix)

Everything below that last mile is verified green: same codebase, same
database, three platforms' build pipelines exercised end-to-end.
