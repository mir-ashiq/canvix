# Docker self-hosting (WP1: deployment & API trust)

> **TL;DR** — `cp .env.docker.example .env`, set `POSTGRES_PASSWORD`,
> `docker compose up -d` → **http://localhost:3000**. Migrations apply
> automatically on boot; the 366-template library syncs itself from
> code. There is no seed step, no Node toolchain, no build on the host.
>
> ```bash
> git clone https://github.com/mir-ashiq/canvix.git
> cd canvix
> cp .env.docker.example .env
> # edit .env: POSTGRES_PASSWORD=$(openssl rand -hex 24)
> docker compose up -d
> curl http://localhost:3000/api/health   # {"ok":true,...}
> ```

This is the single most-requested self-hoster path made one command:
a multi-stage image built from the same standalone artifact every
self-hosted Node deploy already uses, wired to a Postgres 17
container. The CI wall includes a **docker job on every PR** that
builds the image, brings the stack up, and asserts health +
registration through the real routes — the promise in this document
is enforced, not aspirational.

## What the two containers do

| Container | Image | Role |
|---|---|---|
| `db` | `postgres:17` | The only state — designs, versions, accounts, sessions, media (bytea columns; Canvix stores no files, so there is **no app volume**) |
| `app` | built from `./Dockerfile` | The Next.js standalone server + the migrate-on-boot entrypoint |

Only `db` has a volume (`canvix-db`). Losing and recreating the `app`
container loses nothing; upgrade = `git pull && docker compose up -d
--build`, and the entrypoint applies pending migrations before the
server starts (idempotent — "No pending migrations" on an up-to-date
database).

## The boot sequence (what you'll see in `docker compose logs app`)

```
[entrypoint] applying database migrations…
[entrypoint] migrations: ok
[entrypoint] starting canvix on 0.0.0.0:3000
▲ Next.js 16.4.6 …
```

1. **Wait for the database** (up to 60 s; `docker compose up --wait`
   normally makes this a no-op via the `db` healthcheck).
2. **`prisma migrate deploy`** — migrations baked into the image. A
   database with tables but no migration history (pre-migration
   databases) is auto-baselined against `0001_init`, the same
   recovery `npm run db:setup` has used since v0.8.
3. **The standalone server** starts as the entrypoint's exec'd child
   (PID 1 via dumb-init, so `docker stop` drains in-flight requests).
   Its instrumentation hook syncs the built-in template library from
   code — new templates appear on every version upgrade, idempotent
   forever, nothing is ever deleted.

`/api/health` reports the whole story with exact fixes when something
is wrong: env → connect → migrate → seed, each step with its own
error and remedy. Point a browser there first whenever anything
misbehaves.

## Configuration

Everything is environment-driven; compose reads `.env` next to it
(`.env.docker.example` documents every variable). The app **degrades
honestly** without optional keys — no AI keys means the AI features
hide, no stock keys means those rails hide, everything else works.

| Variable | Required | What it does |
|---|---|---|
| `POSTGRES_PASSWORD` | **yes** (compose refuses without it) | Password for the compose Postgres |
| `DATABASE_URL` | no | Override to point at your own Postgres/Supabase/Neon — comment out the `db` service and the app's `depends_on` in `docker-compose.yml`. Hosted URLs work as-is (TLS/pooler flags auto-applied by `src/lib/db-url.ts`) |
| `CANVIX_PORT` | no (3000) | Host port for the app |
| `ZAI_BASE_URL` / `ZAI_API_KEY` | no | AI provider — Magic Layers, Assistant, image gen… |
| `PEXELS_API_KEY` / `PIXABAY_API_KEY` | no | Stock-video search |
| `FREESOUND_API_KEY` | no | Freesound search |
| `CANVIX_MCP_TOKEN` | no | Enables the `/api/mcp` AI-agent endpoint |
| `CANVIX_PLUGINS` | no (`1` to enable) | Third-party sandboxed plugins |
| `CANVIX_ADMIN_USERS` | no | Bootstrap admins (see [`docs/ADMIN.md`](ADMIN.md)) |
| `CANVIX_RATE_LIMITS` | no | `off` when a proxy in front already throttles |
| `CANVIX_RUN_MIGRATIONS` | no (`0` to skip) | Multi-replica deploys where a separate job owns migrations |
| `CANVIX_TEMPLATE_SYNC` | no (`0` to skip) | Operators who curate the template library by hand |

Full variable reference with defaults and interplay:
[`.env.example`](../.env.example) (the non-Docker path's annotated
reference — same variables).

### Using your own database

Compose-internal Postgres is the default; bring your own in three
edits:

```yaml
# docker-compose.yml
# 1. delete/comment the db: service
# 2. delete the app's depends_on: block
# 3. set DATABASE_URL in .env:
#    DATABASE_URL=postgresql://user:pass@host:5432/canvix
```

Supabase **transaction pooler** URLs (port 6543) work for the app,
but `migrate deploy` needs the session pooler — `scripts/db-setup.sh`
rewrites the URL for migrations on the Node path. Inside Docker, set
`DATABASE_URL` to the **session/direct** URL (port 5432 style) so both
the migrations and the app run against the same database; Supabase's
IPv4-friendly pooler on 5432 is the practical choice.

### Behind a reverse proxy

Set `PORT`/`CANVIX_PORT` as needed and terminate TLS in your proxy.
The security headers (CSP, HSTS, X-Frame-Options…) ship from
`next.config.ts` on every route. HSTS only starts counting once the
host is served over TLS. Nothing Canvix-side needs changing.

**Streaming endpoints (real-time collaboration, the AI agent):** the
collab SSE stream and the agent run stream already send
`X-Accel-Buffering: no`, which disables response buffering on nginx
and most nginx-based proxies (Caddy, Traefik and plain `proxy_pass`
setups do not buffer by default). If you use a custom nginx config
with `proxy_buffering on` forced globally, live agent steps and
collaboration cursors will arrive in one lump when the request
finishes — either honor `X-Accel-Buffering` (the default) or add
`proxy_buffering off` for `/api/ai/agent` and `/api/collab/`. If you
clamp proxy timeouts, keep the agent's read timeout at **120 s or
more** (its runs are capped at 90 s server-side).

**Existing databases / migration errors:** migrations apply
automatically on boot (see `docker-entrypoint.sh`). A database that
predates the migration system (created via the old `prisma db push`
flow) is detected and baselined automatically. If boot logs show
`migrate deploy failed`, open `/api/health` — it names the exact
missing tables and the fix. To run migrations as a separate job
instead of on boot (multi-replica setups), set `CANVIX_RUN_MIGRATIONS=0`
and run `docker compose exec app /opt/migrate/node_modules/.bin/prisma
migrate deploy --schema /app/prisma/schema.prisma` once per upgrade.

## Operations

- **Backup / restore** — the one-command `pg_dump` story, restore
  drill, and media GC: [`docs/BACKUP-AND-RESTORE.md`](BACKUP-AND-RESTORE.md).
  Docker equivalent: `docker compose exec db pg_dump -U canvix canvix > backup.sql`
- **Upgrades** — `git pull && docker compose up -d --build`. The
  entrypoint's migrate-on-boot makes every upgrade a rolling one; the
  honest rollback caveat (forward-only migrations) is in
  [`docs/UPGRADING.md`](UPGRADING.md).
- **Logs** — `docker compose logs -f app`. `CANVIX_LOG=requests`
  adds one JSON line per API request; everything is off by default
  (a design tool's logs are the self-hoster's to read).
- **Health** — `curl http://localhost:3000/api/health` (liveness) or
  `?v=2` (aggregate counts + DB latency probe). The container
  healthcheck uses the same route.

## Image architecture (for contributors)

Three stages, no build toolchain in the final image (~350 MB):

```
deps    npm ci → prisma generate + patch-prisma-wasm (postinstall,
        exactly like a contributor machine); fails LOUDLY if the
        generated client or the wasm patch did not land
builder `npm run build` → .next/standalone (the same artifact every
        self-hosted Node deploy uses — build.mjs already places
        .next/static + public/ inside it)
runner  node:22-slim + the standalone tree + prisma/ (schema +
        migrations) + /opt/migrate (the prisma CLI for the
        entrypoint) — non-root (uid 1001), dumb-init PID 1
```

The Prisma split is the interesting part. The app is rust-free
(`engineType="client"`: the generated client compiles queries to WASM
at runtime — see `prisma/schema.prisma`), so the request path carries
no native binaries at all. Only `prisma migrate deploy` runs one (the
schema-engine, ~40 MB, prebuilt for debian-openssl-3.0.x), and only
at boot — which is why it lives in `/opt/migrate`, isolated from the
app's traced `node_modules`.

The migrate toolchain carries the same `effect` override as the app
(`^3.22.1`, Dependabot #9 / GHSA-7589-6fvf-x4pw): `@prisma/config`
pins `effect` exactly, and the image's install-time assertion makes a
regression a **build error**, not a silently vulnerable container.

Two Docker-specific traps the entrypoint handles, for the record:

- **`HOSTNAME`**: Docker injects `HOSTNAME=<container-id>` into every
  container, and the standalone `server.js` binds
  `process.env.HOSTNAME || '0.0.0.0'` — un-overridden, the server
  would try to bind the container id as a hostname and die. The
  entrypoint (and the image `ENV`) pin it to `0.0.0.0`.
- **TLS-forcing**: `src/lib/db-url.ts` forces `sslmode=require` for
  any non-localhost host — including the compose-internal `db`
  hostname, which speaks plaintext. The compose default URL pins
  `?sslmode=disable` (user-pinned values pass through untouched).

**Local verification without a daemon** (the sandbox has no Docker):
`scripts/test-migrate-toolchain.sh` replays the `/opt/migrate` install
and its assertions; the full container proof is the CI `docker` job.
