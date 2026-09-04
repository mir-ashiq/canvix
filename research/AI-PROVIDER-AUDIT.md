# Canvix v0.5.0 — AI Provider Audit

> Every AI capability traced UI → API route → SDK → provider, with the credential source for each. Audited at `bc78723` (v0.4.0). **Bottom line: no provider API key ever reaches the browser. All provider calls happen server-side in Next.js API routes (`runtime = 'nodejs'`) via `z-ai-web-dev-sdk`, whose credentials come from a server-side `.z-ai-config` file.**

## 1. Credential mechanism (the single source of truth)

`z-ai-web-dev-sdk` v0.0.18 `ZAI.create()` → `loadConfig()` reads a **JSON config file**, in priority order:

1. `<cwd>/.z-ai-config`
2. `~/.z-ai-config`
3. `/etc/.z-ai-config`

Required keys: `baseUrl`, `apiKey` (optional: `chatId`, `userId`, `token`). Every SDK call sends `Authorization: Bearer <apiKey>` + `X-Z-AI-From: Z` to `<baseUrl>/…`.

- **No environment variables are used by the SDK.** There is no `ZAI_API_KEY` anywhere in the repo (grep-verified, case-insensitive, all file types).
- `.z-ai-config` is gitignored (`.gitignore` line `.z-ai-config` + `.z-ai-config/`), and git history contains no `apiKey` string (verified: `git log --all -p -S '.z-ai-config'` shows only the ignore rule being added; the file itself was never tracked).
- The config file exists **only on the server** (sandbox/dev machine and, in production, whatever host the user runs the standalone server on). On Vercel, the user must place credentials via a mounted file or project-local file outside git; this is documented in the README as the provider setup step. v0.5 additionally lets routes read `ZAI_BASE_URL` / `ZAI_API_KEY` env vars as an override (falls back to the config file) — giving deploy targets without a writable FS a path, while keeping the same server-only guarantee.

## 2. Feature-by-feature trace

### 2.1 Magic Write — server/provider
```
MagicWriteApp.tsx (panel) → POST /api/ai/write
  → dynamic import z-ai-web-dev-sdk → ZAI.create() (.z-ai-config)
  → zai.chat.completions.create (LLM text) → 3 copy variants → JSON to client
```
Auth source: `.z-ai-config` (server FS). Model: provider chat completions. Fallback today: 502 `{ error }` + toast.

### 2.2 AI Image Generator — server/provider
```
AIImageApp.tsx (panel) → POST /api/ai/image { prompt, size∈7 presets }
  → zai.images.generations.create → base64 PNG → dataURL → client adds ImageElement
```
Auth source: `.z-ai-config`. Model: provider image generation (sizes 1024², 1344×768, 768×1344, 1152×864, 864×1152, 1440×720, 720×1440).

### 2.3 AI Assistant — server/provider
```
AssistantApp.tsx (chat UI) → POST /api/ai/assistant { message, history, design summary }
  → zai.chat.completions.create (system prompt + design context + history)
  → robust JSON parser → { reply, actions[] } — actions: addText | generateImage | suggestPalette | translate
  → client applies actions via editor store (addText→addElement, palette→brand, …)
```
Auth source: `.z-ai-config`. v0.5 upgrades this to the design-aware DesignActions protocol (Phase 10).

### 2.4 Translate (Magic Translate) — server/provider
```
TranslateDialog.tsx → collects texts from ALL pages → POST /api/ai/translate { texts[], language }
  → zai.chat.completions.create → numbered-list translation → trailing-junk-tolerant JSON array parser
  → store.translateTexts() (group-aware, undoable)
```
Auth source: `.z-ai-config`. 24 languages.

### 2.5 Magic Eraser — server/provider
```
ImageAI.tsx MagicEraserPopover → POST /api/ai/image-edit { imageUrl(dataURL), mask, op:'erase' }
  → zai.images.generations.edit { images:[{url}] (runtime quirk), prompt } → edited PNG → replaces element src
```
Auth source: `.z-ai-config`.

### 2.6 Enhance — server/provider
```
ImageAI.tsx EnhanceButton → POST /api/ai/image-edit { op:'enhance' } → images.generations.edit → replaced src
```
Auth source: `.z-ai-config`.

### 2.7 Photo Search — server/provider
```
PhotosPanel.tsx (debounced) → POST /api/photos/search { q }
  → zai.images.search.create → results [{ url, title? }] → hot-linked thumbnails, drag-to-canvas
```
Auth source: `.z-ai-config`. Client receives only public image URLs — not credentials.

### 2.8 Background Remover — LOCAL (hybrid app, local op)
```
ImageAI.tsx BgRemoverButton → dynamic import @imgly/background-removal (ONNX, WASM)
  → runs in-browser, model fetched & cached → true alpha PNG → replaces element src
```
**No server, no credential.** Works offline. This is the template for v0.5 local-capability fallbacks.

### 2.9 New in v0.5 (added by this audit's plan)
- **Magic Layers** → new `POST /api/ai/magic-layers` → `zai.chat.completions.createVision` (vision) → region JSON → client reconstruction. Server/provider.
- **AI Assistant 2.0** → same route, richer context + DesignActions. Server/provider with deterministic local fallbacks for palette/layout suggestions.

## 3. Classification matrix

| Capability | Class | Credential | Graceful behavior when unavailable |
|---|---|---|---|
| Magic Write | server/provider | `.z-ai-config` | 502 JSON + toast "AI unavailable" (route catches, never crashes) |
| AI Image Gen | server/provider | `.z-ai-config` | same |
| Magic Eraser | server/provider | `.z-ai-config` | same |
| Enhance | server/provider | `.z-ai-config` | same |
| Translate | server/provider | `.z-ai-config` | same |
| Photo Search | server/provider | `.z-ai-config` | empty results + inline notice |
| AI Assistant | server/provider | `.z-ai-config` | 502 + toast; v0.5: deterministic fallback answers |
| Background Remover | **local** | none | already fully local (ONNX) |
| Color palette | **local** (v0.5) | none | deterministic harmony generation from current colors |
| Layout suggestions | **local** (v0.5) | none | deterministic heuristics (safe margins, grid, alignment) |
| Magic Layers | hybrid | `.z-ai-config` (vision) | v0.5: clear "requires AI provider" + local-only fallback = full-image background layer with honest labeling |

## 4. Client-exposure verification (grep results, whole repo)

- `ZAI_API_KEY` / `API_KEY` / `NEXT_PUBLIC_`: **0 hits** outside `node_modules` (only `.z-ai-config` reads inside the SDK, server-side).
- `ZAI.create` / `z-ai-web-dev-sdk`: 6 hits, **all inside `src/app/api/**`** (server). No client component imports the SDK.
- `process.env` in client components: only `NODE_ENV` checks. No secrets.
- Build output: Next.js server bundles the SDK server-side only; client chunks contain no `baseUrl`/`apiKey` (spot-checked `.next/static` chunks for `apiKey` — 0 hits).
- `.gitignore` covers: `.env*` (except `.env.example`), `.z-ai-config`, `/tools/`, `/scripts/` (contains session creds), `research/*` raw captures, `tests/`, `worklog.md`, `download/`.
- Git history scan for accidental secret commits: `git log --all --diff-filter=A --name-only` shows no `.z-ai-config`, no `.env`, no `cookies/`, no browser-profile files ever added.

## 5. Rules carried into v0.5 implementation

1. **Never import the SDK (or provider config) in a client component.** All provider calls stay in `/api/**` routes with `runtime = 'nodejs'`.
2. **Every AI route keeps the try/catch → `{ error }` 502 pattern** — no stack traces in responses, no `err.message` passthrough (provider errors can embed the URL/key material), no server crash.
3. **v0.5 provider abstraction (`src/lib/ai/`)** centralizes: config resolution (`ZAI_BASE_URL`/`ZAI_API_KEY` env override → `.z-ai-config` file → null = provider absent), capability probing (`hasText()`, `hasImage()`, `hasVision()`, …), and a single place to add rate limits + AIUsage accounting. Routes ask for a provider; if absent → structured `{ error: 'AI provider not configured', code: 'NO_PROVIDER' }` that the UI turns into an actionable message.
4. Client-side feature detection: `GET /api/ai/capabilities` (public, no secrets — just boolean flags) so panels can show "requires server AI provider" states before the user tries.
5. Deterministic local fallbacks (palette, layout, basic assistant replies) keep the editor useful with zero provider config.
