# Canvix v0.5.0 — Security Audit

> Full security review performed over the v0.5.0 feature surface: Magic Layers, collaboration (SSE + event log), comments, SVG/video export, AI routes and the provider abstraction. Each section lists the risk, the mitigation shipped in this release, and residual limitations.

## 1. Secrets & credential exposure

**Finding: no provider credentials can reach the browser.**

- All provider calls live in `/api/**` routes with `runtime = 'nodejs'`; the SDK is imported server-side only (grep-verified: no client component imports `z-ai-web-dev-sdk`).
- v0.5 centralizes configuration in `src/lib/ai/provider.ts`: `ZAI_BASE_URL`/`ZAI_API_KEY` env vars (deploy targets without a writable FS) → `.z-ai-config` file (cwd → `~` → `/etc`). The file is gitignored; git history contains no `apiKey` values (re-verified for v0.5: `git log --all -S 'apiKey'` shows no credential commits).
- `NEXT_PUBLIC_*` env vars: none exist (only Google Fonts links in `layout.tsx`).
- Error responses are structured `{ error, code? }` — never stack traces, never `err.message` passthrough (provider errors can embed URLs/keys, so they are logged server-side only).
- `/api/ai/capabilities` (public) exposes only booleans — which features exist, never config or keys.
- `.gitignore` covers: `.env*` (except `.env.example`), `.z-ai-config`, `/tools/`, `/scripts/`, `research/*` raw captures, `worklog.md`, `download/`, `db/`.

## 2. AI prompt injection & malicious input

- **Magic Layers** image input: dataURL-only (regex-validated `^data:image/(png|jpeg|webp);base64,`), ≤ 8 MB. The model's JSON reply passes through `validateAnalysis()` — every field is clamped/sanitized (bounds 0..1, hex colors, font classes whitelisted, text control-chars stripped, ≤ 40 regions, ≤ 400 chars). The model never dictates element creation directly; the client reconstructs from the validated schema.
- **Assistant 2.0**: user message ≤ 1500 chars, design context is server-side summarized (≤ 80 elements, text ≤ 60 chars each). Model actions pass `sanitizeActions()` — ids, patches, colors, sizes all validated/clamped; unknown action types are dropped. The client re-validates via `applyDesignAction` (`resolveIds` drops unknown ids; hex-validated colors; clamped numeric ranges). **AI output is never trusted raw.**
- **Translate / Write / Photo search**: bounded input sizes, whitelists for sizes/languages, JSON-parsed with bracket-walking parsers.
- Prompt-injection residuals: a malicious image/text can still *influence* model output (inherent), but the blast radius is a validated design mutation (undoable) — not code execution, not exfiltration (routes never return secrets or fetch URLs from model output except whitelisted image sizes).

## 3. Malicious uploaded files

- Client-side: file type sniff (`image/*`), 25 MB cap, canvas re-encode before embed (also strips any EXIF/metadata — the pixel data is re-drawn).
- Magic Layers: normalized to ≤ 1280px JPEG before transport; server re-validates the dataURL prefix and size.
- Image crops in reconstruction are canvas-generated JPEGs (never raw file bytes passthrough).
- Video export renders only from the in-memory document (no file input path).

## 4. SVG injection / XSS

`src/lib/svg-export.ts` treats all document data as hostile:

- **All text content is XML-escaped** (`& < > " '`).
- **Path data whitelisted** to path commands + numbers (`sanitizePathData` strips everything else).
- **Image hrefs**: only `data:image/*` and `https?://` survive (`safeHref`); `javascript:` and relative URLs are dropped.
- No `<script>`, no event handlers, no `foreignObject`, no external entity references are emitted anywhere in the serializer.
- Gradients/filters reference only locally-generated ids (`grad#`, `shadow#`, `clip#` counters).

## 5. Collaboration attack surface

- **Payload caps**: ops ≤ 256 KB (`validateOpPayload`), ≤ 20 events per flush, ≤ 500-array items, ≤ 12 object depth, finite-number checks on numeric keys — malformed events are **dropped and reported**, never crash the stream.
- **Event kinds are whitelisted** (`OP_KINDS`); `design:rename` names clamped to 80 chars.
- **Presence**: participant ids/names sanitized (`[a-zA-Z0-9_-]` ≤ 40 / Unicode letters+digits ≤ 40), colors hex-validated, cursors must be finite numbers with bounded selections; rows GC'd at 24 h + 30 s offline expiry.
- **Authorization model**: Canva-like "link = edit". Anyone with the design id can join and edit — a documented, deliberate choice for the account-less app (same as v0.4's open REST API). No privilege escalation exists beyond that (no accounts, no roles). Deep links (`/?design=`) validate the id shape server-side (fetch 404s → stays on landing).
- **Resource abuse**: SSE streams are bounded (`maxDuration = 300`, keepalive comments), event log pruned to 500 per design, presence rows deleted lazily.
- Residual: the SSE stream endpoint does not rate-limit *connection* count (per-IP event POSTs are unbounded too, but payload-capped); acceptable for self-hosted, flagged for a future reverse-proxy/limits pass.

## 6. Comments

- Body ≤ 2000 chars with control characters stripped; author identity sanitized (name Unicode letters/digits ≤ 40, color hex); pageId validated against the design's actual pages server-side; replies inherit the thread anchor (no arbitrary coordinates).
- **Resolve/reopen**: open to any participant (Canva parity). **Edit/delete**: author-only (`actorId` match, 403 otherwise). Thread delete cascades replies.
- Unread tracking is localStorage-only (client-side, no server trust).

## 7. SSRF

- Server-side fetches happen only inside the SDK (provider baseUrl — operator-controlled) and `photos/search` (SDK image search). No route accepts a client-supplied URL to fetch server-side. Image-edit routes accept `https?://` image URLs but pass them to the provider (not fetched by Canvix itself); no local-file or internal-network URL handling exists.

## 8. Rate limiting & API abuse

- AI routes: per-IP sliding windows via `withProvider` — write 20/min, image 12/min, image-edit 12/min, translate 15/min, assistant 20/min, magic-layers 10/min, search 30/min. 429s include `Retry-After`.
- `AIUsage` rows record every provider call (feature, provider, ok) for abuse telemetry.
- Collab POST/presence routes are unthrottled but payload-capped (above); design CRUD remains as open as v0.4 (documented).
- Oversized uploads: images 25 MB client-side + 8 MB analysis cap; event payloads 256 KB; comments 2 KB.

## 9. Generated content & ownership

- Designs have no owner column (account-less model, carried from v0.4) — any visitor can PUT/trash/restore any design. **Known limitation, documented in README and COLLABORATION-ARCHITECTURE.md §6**; the identity layer added in v0.5 (participant ids) is the migration path for per-user ownership in a future release.
- AI-generated images enter the document as ordinary elements; no watermarking or provenance beyond `magicLayer` metadata.

## 10. Verification checklist

| Check | Result |
|---|---|
| API keys in client bundles | none (server-only SDK imports; capabilities route is booleans) |
| `.env` / `.z-ai-config` tracked in git | no (gitignore + history scan) |
| SVG output escaping | escaped text, whitelisted paths, href allowlist |
| Collab payload validation | caps + type checks on every op, drops malformed |
| Comment authorization | author-only edit/delete enforced server-side |
| Rate limits | all AI routes, per-IP + Retry-After |
| Error hygiene | structured errors, no stack traces in responses |
| E2E console errors | 0 across landing/dashboard/editor/collab/comments/video QA passes |
