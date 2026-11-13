# Security Policy

## Supported versions

Canvix moves fast, and security fixes land on `main` first. Only the latest
release line receives security patches — self-hosting is one `git pull` (or
one re-deploy) away from current.

| Version | Supported          |
| ------- | ------------------ |
| 0.22.x  | ✅ current `main`  |
| older   | ❌ upgrade first   |

## Reporting a vulnerability

**Do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.**

Instead, email the maintainer privately:

> **imsrenpsycho@gmail.com**

Please put `[security]` in the subject line. Include as much of the following
as you can:

- the affected component (API route, editor, plugin system, MCP endpoint,
  export pipeline, admin console, …)
- the exact Canvix version or commit SHA you tested against
- step-by-step reproduction, or a minimal proof of concept
- impact assessment — what an attacker gains and under what preconditions
- any mitigations you already checked for

### What to expect

Canvix is maintained by a single maintainer, so timelines are honest rather
than corporate:

- **Acknowledgement** — within 72 hours of the report
- **Triage + severity rating** — within 7 days
- **Fix** — critical issues are prioritized immediately; the aim is a patch
  release within 14 days for anything exploitable on a default deployment
- **Coordinated disclosure** — we ask for up to 90 days before public
  disclosure, and will negotiate an earlier joint announcement for anything
  already exploited in the wild. Credit is given in the changelog unless you
  prefer to stay anonymous.

### Safe harbor

Good-faith security research that respects the rules below is welcomed and
will not be met with legal action:

- no denial-of-service, spam, or brute force against live instances
- no social engineering, no exfiltration of other users' data
- test only against instances you own or have explicit permission to test
- stop and report immediately if you stumble onto real user data

## Scope

**In scope:** the application code in this repository — the Next.js app, API
routes, editor, collaboration/SSE layer, plugin manifest validation and
bundled-plugin pipeline, MCP server, export pipelines, admin console, the
per-user AI provider storage (BYOK, v0.23), and the default deployment
configurations documented in `README.md`.

Per-user API keys (v0.23 "bring your own key") are stored server-side,
masked on every read path, and never returned by any API — reports about
key exposure or cross-user leakage are treated as highest severity.

**Out of scope:**

- vulnerabilities in third-party AI/stock providers reached through a
  configured provider (report those to the provider)
- self-hoster misconfiguration — weak admin credentials, publicly exposed
  `.env`, missing TLS, disabled rate limiting
- instances clearly modified from this source tree
- volume-based attacks (DoS) against public deployments
- reports from automated scanners that have not been manually validated

## Hardening already in place (context for reporters)

These are documented for efficiency — a report that bypasses one of these
layers is especially interesting to us:

- **Security headers + CSP baseline** on every route class (`nosniff`,
  strict referrer policy, `SAMEORIGIN` framing, HSTS, locked-down
  `Permissions-Policy`), asserted by an e2e spec in CI
- **Rate limits** on every AI route, per IP, with usage recorded in the
  `AIUsage` table
- **Secrets never reach the browser** — provider credentials resolve
  server-side only; `/api/ai/capabilities` exposes booleans, never keys
- **Validated collaboration events** — type-checked, size-capped (256 KB),
  malformed events are dropped, never crashed on
- **Sanitized SVG export** — XML-escaped text, whitelisted path data,
  `data:`/`https:`-only image hrefs, no script or event-handler content
- **MCP endpoint hardening** — disabled until a token is set, Bearer auth
  with timing-safe comparison, DNS-rebinding guard, SSRF-guarded image
  fetches with size/time caps, per-tool argument clamping
- **Plugin sandbox boundary (v0.13+)** — first-party plugin manifests are
  validated against a strict schema, engine ranges are semver-checked
  against the host, and plugin bundles are sha256-pinned at build time;
  the fetcher refuses anything not in the manifest
- **SSRF guards** on all server-side URL fetches (private hosts denied,
  payload and time caps)

## Preferred languages

English is preferred for reports; plain, direct descriptions beat formal
prose.
