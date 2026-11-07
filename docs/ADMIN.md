# Admin console (v0.16 A1 · v0.16.2 A2 · v0.16.3 A3)

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

**Providers (the multi-provider table, v0.16.2 A2).** Add up to
8 providers — any OpenAI-compatible endpoint works (NVIDIA NIM,
OpenRouter, Z.ai, Groq, OpenAI…): a label, a base URL and a
write-only API key each. Every capability **slot** can then be pinned
to a different provider + model:

| Slot | What answers through it |
| --- | --- |
| `text` | Magic Write · Translate · Assistant (chat completions) |
| `vision` | Magic Layers (image understanding) |
| `image` | text-to-image |
| `imageEdit` | Magic Eraser / Enhance |
| `imageSearch` | stock photo search |

A slot left on “— fall back —” ignores the table and walks the legacy
chain below. `/api/ai/capabilities` now probes **per slot**, so wiring
text to NVIDIA and images to Z.ai reports exactly those features as
available. Editing a provider (label/URL) never demands the key again:
an empty key field keeps the stored credential (matched by id);
deleting the row and re-adding needs it. One click imports the old
single-provider override into the table and clears the legacy row.

**Fallback chain** for unpinned slots (highest wins):

1. the **console override** stored in `AppConfig` (`ai.provider`),
2. `ZAI_BASE_URL` + `ZAI_API_KEY` environment variables,
3. the `.z-ai-config` file (local development convenience),
4. unconfigured — local-only features keep working (the F2b pattern).

The override needs **both** fields; sending `provider: null` clears it
and restores the env/file fallback. The page always shows which layer is
currently answering per slot (`providers table / legacy override /
environment / config file`) and the effective base URLs — but **never a
key**: keys are stored once and echoed back only as masks
(`sk-1…wxyz`). Same posture as the env vars they override.

**Models** — per-slot model ids in the providers table; the fallback
chain still reads the legacy `text` / `vision` / `image` ids (`vision`
defaults to `glm-4.5v`). Empty = the provider's default, exactly the
pre-console behaviour. Ids are validated (`[A-Za-z0-9._:+/@-]{1,120}` — `/`
for NVIDIA NIM namespaces, `@` for OpenRouter prefixes)
before they can reach a provider.

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
10 s. It is the only console action that spends provider quota. Each
provider row has its own Test button; the fallback card tests the
resolved text slot. The probe goes through the SDK constructor with the
resolved `{ baseUrl, apiKey }` — never `ZAI.create()`, whose file-only
lookup ignored env vars and broke every test since A1 (see D3).

### Logs

`/admin/logs` (v0.16.3 A3) answers "why isn't the AI feature working"
without an SSH session. Two surfaces:

- **AI slot status** — what each of the five capability slots (`text`,
  `vision`, `image`, `imageEdit`, `imageSearch`) resolves to right now:
  provider label, base URL, model id and which config layer answered
  (providers table / legacy override / env / file). Never the key. A
  slot wired to a chat-only provider is the classic silent breakage —
  text features work, image generation 404s on the same key — and the
  strip makes the wiring visible before anything is even tried.
- **AI request log** — one row per AI request (the AIUsage table, see
  §3): feature, provider · model, outcome chip (200-299 green;
  403 rejected · 429 rate-limited · 503 unconfigured · provider HTTP
  code red), round-trip duration and the scrubbed failure reason — the
  same string the client's 502 body carries (one truth, two audiences).
  Live tail (5 s poll, pauses when the tab is hidden), window (15 m …
  7 d), feature and outcome filters, per-feature call/error counters.

The per-slot **Test** buttons on the AI & models page probe the real
endpoint each slot uses (chat completion for text/vision, a real
minimal generation for image, a deliberately image-less probe for
imageEdit — a 400-class rejection proves the endpoint exists — and a
one-result search for imageSearch). A 404 verdict states the fix:
chat-only providers cannot run image slots; pin them to a provider
that serves image endpoints.

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

**Durable** (the charts):

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

Config reads (feature switches, settings, provider table) are cached
in-process for **10 s** and invalidated on write — one tiny indexed
`findMany` per window per instance. A failed config read falls back to
defaults (= pre-A1 behaviour): these toggles are additive restrictions
and a flapping read must not brick design autosave.

**Live** (v0.16.2 A2, the “Live traffic” panel): an in-memory rolling
window recorded by the same `withLogging` wrapper — per-second
request/error buckets (last 60 s shown), per-route per-minute hits,
hashed visitor keys and a latency ring, all capped and swept (see
`src/lib/admin/realtime.ts`). Semantics worth knowing:

- **process-local** — counters reset on restart; TrafficStat/AIUsage
  remain the durable record,
- **single process** — each Node process counts its own requests (the
  self-hosted standalone deploy is one process),
- the panel polls `GET /api/admin/realtime` every 2 s and **that poll
  is excluded** from the live counters (the dashboard must not become
  its own top route); it is still counted in the durable tables,
- visitors are counted through a per-boot salted hash of the client IP
  — a count key, not an identity; raw IPs are never stored anywhere,
- `CANVIX_TRAFFIC=0` disables live recording together with the durable
  counters.

## 4. API surface (for scripts)

All `/api/admin/*` routes re-check the session independently of the UI
(401 unsigned, 403 non-admin) and mutations enforce same-origin:

```
GET  /api/admin/overview                     — everything the Overview page shows
GET  /api/admin/realtime                     — live counters (polled every 2 s)
GET  /api/admin/users?q=&page=               — directory + per-user aggregates
POST /api/admin/users/<id>/role              — { role: "admin" | "user" }
POST /api/admin/users/<id>/sessions          — revoke all sessions of one user
GET  /api/admin/config                       — sanitized config (masked keys)
PUT  /api/admin/config                       — { provider? | providers? | models? | features? | settings? | importLegacyProvider? }
POST /api/admin/config/ai-test               — live provider probe (1 / 10 s)
```

`PUT` accepts any subset of the sections; `features` and `settings`
merge over current values, `models` replaces, `provider` follows §2,
`providers` full-replaces the table:

```jsonc
{
  "providers": {
    "list": [
      { "id": "pnvidia", "label": "NVIDIA NIM", "baseUrl": "https://integrate.api.nvidia.com/v1" },
      { "label": "Z.ai", "baseUrl": "https://api.z.ai/v1", "apiKey": "sk-…" }
    ],
    "slots": { "text": { "providerId": "pnvidia", "model": "meta/llama-3.1-70b-instruct" }, "image": null }
  }
}
```

Ids are optional on input (generated server-side); an omitted `apiKey`
keeps the stored key for that id; `providers: null` clears the table.
`importLegacyProvider: true` folds the A1 single override into the table.

`ai-test` body: `{}` probes the resolved text slot; `{ providerId }`
probes that provider; `model` overrides the model for the probe.

## 5. Dependency & design decisions — on record

- **D1 — zero new dependencies.** Prisma models for storage
  (`AppConfig`, `TrafficStat`, `DailyActive` + `User.role`), hand-rolled
  SVG charts (the same discipline as the GIF LZW encoder and the WebM
  muxer), the existing `pg` driver only inside the e2e seed. No
  analytics SDK, no charting library, no admin framework.
- **D2 — admin resolution is DB role OR env list.** Fail-closed both
  ways; no implicit first-user admin; the env list doubles as the
  lockout recovery path.
- **D3 — provider clients are constructed directly (A2 correction).**
  A1 injected console providers into `process.env.ZAI_*` before
  `ZAI.create()`, believing the SDK resolved env vars. It does not —
  `loadConfig()` only reads `.z-ai-config` files, so every
  console/env-configured provider failed instantiation with
  "Configuration file not found or invalid" (the root cause behind
  every failed Test connection on canvix.app). The SDK class
  constructor takes exactly `{ baseUrl, apiKey }`; `makeClient()`
  (src/lib/ai/provider.ts) now constructs it directly with the resolved
  config. The env-injection path is gone.
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
- **D11 — per-slot provider resolution (A2).** The multi-provider
  table lives in the existing `AppConfig` JSON store (`ai.providers`) —
  **no schema change, no new migration**. Slots that reference a
  deleted provider fall through to the legacy chain instead of failing
  the feature (fail-open, the same stance as D6).
- **D12 — real-time counters are a zero-import in-memory module (A2).**
  `src/lib/admin/realtime.ts` imports nothing — so linking it statically
  into the stdlib-only observability module cannot repeat the v0.16.1
  edge-bundle regression — and every structure is hard-capped and
  swept (bounded memory by construction).
- **D13 — the live panel's own poll is not counted live (A2).** The
  2-second `/api/admin/realtime` poll is excluded from the in-memory
  counters so the dashboard's refresh never dominates the “top routes”
  view; it is still recorded in the durable tables.


- **D14 (A3) — the AI request log lives IN AIUsage, not a new table.**
  One row per AI request was already being written; the Logs view only
  needed the columns (model/status/durationMs/error, all nullable,
  migration `0010_ai_request_log`). No second write path, no join, no
  new retention policy — 90 days, swept lazily like TrafficStat.
- **D15 (A3) — provider error text is scrubbed, capped and shared.**
  `describeProviderError()` extracts the HTTP status, masks
  credential-shaped tokens (nvapi-/sk-/Bearer…), collapses whitespace
  and caps at 240 chars. The same string flows to AIUsage (`error`),
  the client 502 body (`detail`) and the console — no place shows a
  raw provider body, and no place shows different truths.
- **D16 (A3) — slot tests probe real endpoints, classified by verdict.**
  A chat-only provider passing the old test while image generation
  404'd was the diagnostic gap; now a 404/405 verdict says "not
  served — pin image slots to a provider that serves image endpoints",
  a 401/403 says "check the key", and a 400-class answer to the
  deliberately-empty imageEdit probe says "reachable". The image slot
  does a REAL minimal generation — the only full proof; on providers
  without the endpoint it 404s instantly and costs nothing.

## 6. Database changes (migration `0009_admin_console`, extended by `0010_ai_request_log`)

```sql
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';
CREATE TABLE "AppConfig"    (key TEXT PRIMARY KEY, value JSONB NOT NULL, …);
CREATE TABLE "TrafficStat"  (…  UNIQUE(day, route, method, status));
CREATE TABLE "DailyActive"  (…  UNIQUE(day, actor));
```

`npm run db:setup` applies it; nothing else changes. **A2 adds no
migration** — the multi-provider table is one more `AppConfig` row
(`ai.providers`), and live traffic keeps no database state at all.

### `0010_ai_request_log` (v0.16.3 A3)

Four nullable columns on `AIUsage` — `model`, `status`, `durationMs`,
`error` — written by `withProvider` for every outcome. Existing rows
stay valid (nulls read as "not recorded"); rows are swept after 90
days. Instances that never open `/admin/logs` accumulate exactly what
they always did.
