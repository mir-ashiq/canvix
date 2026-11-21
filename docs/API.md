# The Canvix REST API (v1)

v0.24 (Wave 6 core) — scoped API keys and the first versioned REST
surface. The MCP endpoint (`/api/mcp`) remains the other machine
rail; this one is for people: scripts, CI, integrations.

## Quick start

1. Sign in, open the dashboard → **Account menu → Profile & AI keys →
   API keys → Create key**. Give it a label ("CI export script") and
   pick scopes (`designs:read` to start).
2. Copy the key when it is shown — **it is displayed exactly once**.
   Only its SHA-256 is stored; nothing can show it again.
3. Send it as a bearer token:

```bash
curl -H "Authorization: Bearer cvx_…" https://your-instance/api/v1/designs
```

## Scopes

| Scope | Grants |
|---|---|
| `designs:read` | List and read **your own** designs |
| `designs:write` | Reserved — no v1 endpoint enforces it yet; keys carrying it simply work when one ships |

`all` is accepted at creation as sugar for "every current scope": a
long-lived automation key keeps working as new scopes ship, which is
the usual operator expectation. Unknown scopes are rejected — never
silently widened.

## Endpoints

### `GET /api/v1/designs`

Lists the key owner's designs, newest first. Deliberately narrower
than the browser dashboard: **ownerless shared designs are not
included** — a machine credential reading a shared workspace by
default would be a data-exfiltration footgun.

- Query: `?cursor=<updatedAt ISO>&id=<designId>` — keyset pagination,
  60 rows per page; the response's `nextCursor` is `null` on the last
  page.
- 200 → `{ designs: [{ id, name, width, height, source, folderId, createdAt, updatedAt }], nextCursor }`
- 401 `unauthorized` — no key; the body says where to make one
- 401 `invalid_key` / `revoked_key` / `expired_key` — rotate the key
- 403 `insufficient_scope` — key valid, scope missing: re-issue with more scopes

### `GET /api/v1/designs/[id]`

The full design (metadata + `pages`). Only designs the key owner owns;
a foreign id is a **flat 404** — the existence of someone else's
design is not API business.

## Key management (browser session, not the REST surface)

| Endpoint | What |
|---|---|
| `GET /api/keys` | List your keys — label, scopes, created/last-used/revoked (no secrets; the raw value never exists after creation) |
| `POST /api/keys` | Create: `{ label, scopes: string[] }` → `{ …, key: "cvx_…" }` (the one-time raw value). Same-origin + rate-limited (10/h/IP); max 20 active keys |
| `DELETE /api/keys/[id]` | Revoke. Revocation is a timestamp, not a delete — 401s say `revoked_key` and the audit trail survives |

## Storage & security model

- The `ApiKey` row id is `sha256(raw token)` — the same shape as
  sessions: **a database leak never yields usable keys.**
- Revocation takes effect on the next request; there is no token
  cache to flush.
- `lastUsedAt` is updated best-effort on each authenticated call.
- Key creation is rate-limited (`keys:create`, 10/hour/IP) and capped
  at 20 active keys per account.
- Key-authenticated calls count toward the owner's daily-activity
  metric (admin console → Overview).

## Errors are the contract

Automation must be able to tell "rotate the key" (401) from
"re-issue with more scopes" (403) from "wrong id" (404) from "slow
down" (429). The `error` field carries exactly those codes.
