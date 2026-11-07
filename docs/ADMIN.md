# Admin console (v0.16 A1)

> **TL;DR** — set `CANVIX_ADMIN_USERS="your-username"`, restart, sign in:
> the shield icon on the dashboard opens `/admin`. Everything below is
> operable from those four pages; this document is the operator guide and
> the decision record.

The admin console is the operator surface for a Canvix instance:

| Page | What it shows / does |
| --- | --- |
| **Overview** (`/admin`) | totals (users, designs, media, sessions, comments), 14-day traffic / daily-active / signup / AI-call charts, top routes, AI usage by feature, newest accounts, DB latency, provider status |
| **Users** (`/admin/users`) | searchable directory with per-user design counts, active sessions, last activity; grant/revoke admin rights; force sign-out |
| **AI & models** (`/admin/ai`) | provider override (base URL + write-only API key), model ids (text / vision / image), per-feature kill switches, live connection test |
| **Settings** (`/admin/settings`) | allow new sign-ups, anonymous editing, instance facts, privacy posture |

---

## 1. Turning it on — the first administrator

Admin access is **fail-closed**. Two paths, no others:

1. **Env bootstrap** — `CANVIX_ADMIN_USERS` is a comma-separated username
   list that is admin on every request:

   ```bash
   CANVIX_ADMIN_USERS="alice,bob"   # lowercase; case-insensitive match
   ```

   No DB write needed — set it, restart, sign in as one of those users.
   This is also the recovery path if console-managed admins are ever
   locked out.

2. **DB role** — `User.role = 'admin'`, granted by another administrator
   from the Users page. This is what the console itself manages.

There is deliberately **no "first registered user is admin"** rule: on a
public instance that would silently hand the keys to whoever happens to
register first. No config-table flag, no secret URL — if neither path
grants admin, `/admin` and every `/api/admin/*` route refuse everyone.

The Users page shows where each admin's rights come from (`admin`,
`admin · env`) — an env-blessed username stays admin even if its DB role
is changed; the env always wins, and the badge says so.

## 2. The pages in detail

### Overview

- **API requests** counts every request through the `withLogging`
  wrapper all API routes already use — per UTC day, so "24h" means
  "today (UTC) so far". See §3 for what is and isn't recorded.
- **Daily active users** = distinct actors (userIds for accounts, the
  *hashed* anonymous cookie key for anonymous browsers) that opened the
  dashboard or the editor that day.
- **AI calls** are split teal (succeeded) / red (failed) from the
  `AIUsage` accounting that has existed since v0.5.
- **Top routes / usage by feature** cover the last 7 days.

### Users

- Search is a username substring (usernames are stored lowercase).
- **make admin / revoke** uses a two-step inline confirm. The route
  refuses self-modification (`SELF_ROLE_CHANGE`) — an admin can never
  lock themselves out of the only page that undoes role changes.
- **sign out** revokes every session of that user (a single bounded
  `DELETE` on `Session`; designs and uploads are untouched). Works on
  your own rows too — it just signs you out.

### AI & models

**Provider precedence** (highest wins):

1. the **console override** stored in `AppConfig` (`ai.provider`),
2. `ZAI_BASE_URL` + `ZAI_API_KEY` environment variables,
3. the `.z-ai-config` file (local development convenience),
4. unconfigured — local-only features keep working (the F2b pattern).

The override needs **both** fields; sending `provider: null` clears it
and restores the env/file fallback. The page always shows which layer is
currently answering (`console / environment / config file`) and the
effective base URL — but **never the key**: it is stored once and echoed
back only as a mask (`sk-1…wxyz`). Same posture as the env var it
overrides.

**Models** — `text` (Magic Write, Translate, Assistant), `vision`
(Magic Layers, default `glm-4.5v`) and `image` ids. Empty = the SDK
default, exactly the pre-console behaviour. Ids are validated
(`[A-Za-z0-9._:+-]{1,120}`) before they can reach the provider.

**Feature switches** — seven kill switches (Magic Write, image
generation, image editing, Magic Layers, translation, Assistant, photo
search). A switched-off feature:

- reports `false` in the public `/api/ai/capabilities` (panels grey out),
- answers `503 FEATURE_DISABLED` from its route — before rate limiting
  or any provider work,
- local features (background removal, colour palette, layout
  suggestions) are never affected.

**Test connection** — one minimal chat completion (thinking disabled,
one-word reply, 15 s circuit breaker), rate-limited to one probe per
10 s. It is the only console action that spends provider quota.

### Settings

- **Allow new sign-ups** — off means `POST /api/auth/register` answers
  `503 SIGNUPS_CLOSED`. The check runs *before* the 5/hour rate limiter,
  so a closed instance burns none of an honest visitor's attempt budget.
  Existing accounts sign in as usual.
- **Anonymous editing** — off means only signed-in accounts can create
  or save designs. Reading, sharing and exporting existing designs
  (including the anonymous commons) is untouched — the switch gates
  writes, not reads.

## 3. Traffic & activity recording — the model

- One `TrafficStat` row per **(UTC day, route template, method,
  status)**, incremented fire-and-forget by the `withLogging` wrapper.
  **Counts only** — no ids, no IPs, no query strings (the same stance as
  `/api/health?v=2`). Cardinality is bounded by the route table × days
  × status codes.
- One `DailyActive` row per (UTC day, actor) — actor = userId or the
  sha256 anonymous-cookie hash (already a hash when it arrives).
- Retention: rows older than **90 days** are swept lazily
  (~1 % of writes trigger the bounded delete).
- Opt-out: `CANVIX_TRAFFIC=0` disables recording entirely (the console
  then shows zeros).
- **Cloudflare caveat** — counters are written fire-and-forget after the
  response; on workerd a cancelled evicted request can drop the write,
  so counts may under-report there. Self-hosted Node (the primary
  target) is exact. Improving this needs `waitUntil` plumbing through
  every route — deliberately out of scope for A1.

Config reads (feature switches, settings, provider) are cached
in-process for **10 s** and invalidated on write — one tiny indexed
`findMany` per window per instance. A failed config read falls back to
defaults (= pre-A1 behaviour): these toggles are additive restrictions
and a flapping read must not brick design autosave.

## 4. API surface (for scripts)

All `/api/admin/*` routes re-check the session independently of the UI
(401 unsigned, 403 non-admin) and mutations enforce same-origin:

```
GET  /api/admin/overview                     — everything the Overview page shows
GET  /api/admin/users?q=&page=               — directory + per-user aggregates
POST /api/admin/users/<id>/role              — { role: "admin" | "user" }
POST /api/admin/users/<id>/sessions          — revoke all sessions of one user
GET  /api/admin/config                       — sanitized config (masked key)
PUT  /api/admin/config                       — { provider?|models?|features?|settings? }
POST /api/admin/config/ai-test               — live provider probe (1 / 10 s)
```

`PUT` accepts any subset of the four sections; `features` and `settings`
merge over current values, `models` replaces, `provider` follows §2.

## 5. Dependency & design decisions — on record

- **D1 — zero new dependencies.** Prisma models for storage
  (`AppConfig`, `TrafficStat`, `DailyActive` + `User.role`), hand-rolled
  SVG charts (the same discipline as the GIF LZW encoder and the WebM
  muxer), the existing `pg` driver only inside the e2e seed. No
  analytics SDK, no charting library, no admin framework.
- **D2 — admin resolution is DB role OR env list.** Fail-closed both
  ways; no implicit first-user admin; the env list doubles as the
  lockout recovery path.
- **D3 — provider injection via `process.env`.** `ZAI.create()` takes
  no arguments and resolves its own config from env/file (verified
  against the SDK typings). A console-set provider is therefore
  injected into `process.env.ZAI_BASE_URL`/`ZAI_API_KEY` before
  instantiation — server-side, in-memory, the exact variables the
  documented env setup uses.
- **D4 — API keys are write-only.** Stored in `AppConfig`, returned
  only as `maskApiKey()` output; GET responses never contain a full
  key (unit-tested).
- **D5 — traffic is aggregate-only and opt-out-able.** Counts, never
  identities; `CANVIX_TRAFFIC=0` for instances that want none of it;
  90-day retention; the workerd under-count caveat documented above.
- **D6 — config reads are cached, failures fall back to defaults.**
  Availability trumps restriction-consistency here; the DB being truly
  down breaks the app elsewhere anyway.
- **D7 — the sign-ups gate runs before the rate limiter.** A closed
  instance consumes none of a visitor's registration budget.
- **D8 — the migration is purely additive.** `User.role` defaults to
  `'user'`; no config rows exist until an admin writes them; an
  instance that never opens `/admin` behaves exactly as before.
- **D9 — the e2e suite spends zero registrations.** Fixture users and
  sessions are seeded straight into the database (the app's own Postgres
  via the `pg` driver), keeping the suite inside the 5/h/IP budget the
  other specs honor.
- **D10 — self-role-change is refused** (`SELF_ROLE_CHANGE`), so the
  console cannot be used to lock out its only operator.

## 6. Database changes (migration `0009_admin_console`)

```sql
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';
CREATE TABLE "AppConfig"    (key TEXT PRIMARY KEY, value JSONB NOT NULL, …);
CREATE TABLE "TrafficStat"  (…  UNIQUE(day, route, method, status));
CREATE TABLE "DailyActive"  (…  UNIQUE(day, actor));
```

`npm run db:setup` applies it; nothing else changes.
