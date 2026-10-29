# Canvix v0.12 — Plugin System: sandboxed third-party apps & elements

Date: 2026-10-30 · Status: **research proposal — nothing implemented. No
production data touched, no migrations applied, no editor behavior changed
in this phase.** Studied against `main` = `c99052b` (v0.11.1).

The README roadmap's only unchecked box is "[ ] Plugin system (external,
installable apps)" (README.md:730). This document is the decision record
for it: what exists, the options, the recommended MVP, and a phased plan
with acceptance criteria.

## 1. Goals & non-goals

**Goals.**

- Third parties can add **panel apps** (generators, importers, asset
  browsers) and **custom element types** (new visuals on the canvas) to
  any Canvix instance — including self-hosted ones — without touching
  Canvix's source.
- **Untrusted code runs in a real security boundary.** A plugin must not
  be able to read the session, the host DOM, other users' data, or
  mutate documents except through validated, undoable actions.
- **Free & MIT, self-hostable forever.** No marketplace service, no
  billing rail, no telemetry to anyone. Plugin distribution is plain
  HTTPS URLs; a self-hoster's instance is fully functional offline once
  a plugin is installed.
- **Zero new npm dependencies** (§4.10) and near-zero bundle cost for
  instances that don't use plugins (lazy-loaded runtime, Cloudflare
  Workers headroom is ~0.85 MB gz of a 3 MB cap).

**Non-goals (deliberate).**

- No server-side plugin execution. Third parties who want server code
  get the existing MCP rail (20 tools, JSON-RPC, bearer-token gated,
  `research/` has the audit) or — this being MIT — a fork.
- No monetization infrastructure. Plugin authors host their own
  distribution; Canvix takes no cut, adds no paid tier, tracks nothing.
- No custom canvas *interaction* tools in the MVP (pointer streams,
  like a lasso-filter brush) — poster-style elements and panel apps
  only. Documented in §9.

## 2. What exists today — the seams a plugin system must respect

### 2.1 Extension precedents already in the codebase

| Precedent | Where | What it proves |
|---|---|---|
| Apps registry | `src/components/editor/apps/registry.tsx:37–48` | metadata + `ComponentType<AppPanelProps>` panels behind the Apps grid; `AppPanelProps = { onClose }` (registry.tsx:21) — a compile-time plugin list, the direct ancestor of this proposal |
| Validated action layer | `src/lib/design-actions.ts:69` | AI Assistant mutations run through a whitelist switch with clamped values before touching the store — the pattern to reuse as the plugin mutation API |
| MCP tools | `src/lib/mcp/tools.ts` (`ToolDef`, per-type key whitelists in `sanitizePatch`) | server-side tool registry + input sanitization discipline |
| SSRF guard | `src/lib/mcp/ssrf-guard.ts` (`safeFetch`) | denylist + DNS pinning + per-hop redirect revalidation — reusable for install-time fetches |
| Design access guard | `src/lib/auth/design-guard.ts` | owner / link-edit / read-only enforcement — plugins must not widen it |
| Templates | `src/lib/templates/*.ts` | 110 templates as pure serializable data — the proof that content, at least, needs no code |
| Op validator | `src/lib/collab/protocol.ts:116` (`validateOpPayload`) | 256 KB cap, ≤500-array, ≤100 k-char strings, depth ≤12, ≤60 keys — plugin element data must fit the same caps |

### 2.2 The hardcoded seams (what a plugin *cannot* do today)

| "Add a…" | Files that must be edited |
|---|---|
| Left-panel entry | `editor-store.ts:26–38` (PanelId union) + `Editor.tsx:39–51` (PANEL_TITLES) + `Editor.tsx:397–412` (renderPanel switch) + `LeftRail.tsx:10` (PANELS) |
| Canvas tool | `editor-store.ts:107,189` (`'select' \| 'draw'` union) + CanvasStage handlers |
| Property UI | `PropertiesBar.tsx:46,57–67` — a ~850-line ternary chain, no per-type registry |
| Element type | `lib/types.ts:351–363` (closed 12-member union) + factory + **three renderers** (below) + PropertiesBar + LayersPanel + context-menu + `magic.ts` relayout + MCP allowlists |

### 2.3 The three-renderer problem (the deepest constraint)

The element model is rendered independently in three places:

1. `canvas/element-node.tsx:458` — the Konva switch (editor canvas,
   preview/present, live thumbnails; PNG/JPG/PDF/stored thumbnails
   piggyback on it via `captureStage`).
2. `lib/svg-export.ts:169` (`serializeElement`) — hand-written SVG
   strings.
3. `lib/video-export.ts:124` (`buildKonvaNode`) — an imperative Konva
   re-implementation for video export.

Unknown element types already degrade **silently** in all three
(`default → null` / `''` / empty Group). A naive "plugin element" design
that asks plugin authors to hook three switches is untenable; the MVP
solves this with a single declarative renderer (§4.5).

## 3. Options compared

| Approach | Verdict | Why |
|---|---|---|
| **A. In-process modules** — plugin = dynamically `import()`-ed ESM bound to host APIs | ✗ for third-party | No security boundary: JS offers no capability isolation without SES-style membranes (a heavy new dep). Plugins bind to host internals (React 19/Konva 10 types) → churn on every release. **Cloudflare Workers cannot `import()` remote modules at runtime** (no eval in workerd), so third-party code would have to be bundled — 0.85 MB of headroom does not fit an ecosystem. This *is* today's apps registry, and it stays the right answer for first-party apps. |
| **B. Sandboxed iframe + postMessage RPC** — plugin UI/logic in `<iframe sandbox>`, host exposes a capability API over structured-clone messages | ✓ **CHOSEN** | The only option that is a *real* boundary for untrusted code with zero dependencies: native `sandbox`, CSP headers on a host serve route, `postMessage`. Works identically on Vercel/Workers/Netlify (client-side only). Plugins never link against host internals — they target a versioned wire API. Costs: async-only API, UI confined to slots, canvas output is declarative. This is the proven Figma/Canva model, shrunk to Canvix scale. |
| **C. Web Worker plugins** — headless compute in a Worker | △ (phase 3) | Great CPU isolation for renderers/generators (terminable), but no DOM → no UI, and it doesn't solve the element/export story alone. Worth adding later as a *renderer accelerator* behind the same RPC broker. |
| **D. External HTTP services** (MCP-style) | △ (exists already) | Strongest isolation and zero bundle cost, but plugin authors must run a server (violates "free & easy" for authors), latency is high, and there is no canvas/UI integration. This is the MCP rail — kept orthogonal; §8 phase 3 proposes a bridge, not a replacement. |

**Why B over A (the two real finalists).** A is simpler and faster —
same-realm, synchronous, shares Konva/React. But every hard requirement
of this project breaks it: untrusted third-party code with full store
access can exfiltrate the design or hijack the session (same-origin
fetches are credentialed); workerd's eval ban makes runtime loading
impossible on Cloudflare; and every host release would break plugins
compiled against internals. B pays an async message tax (~sub-ms per
call in practice, batched where it matters) and buys a boundary that
holds on all three deploy targets with native browser primitives only.
The one thing A can do that B cannot — plugins drawing live, animated
Konva nodes — is exactly what the MVP defers (poster-style rendering,
§4.5), matching how v0.11 shipped video elements (poster on canvas,
life only in playback) until the v0.11.1 fixes landed.

## 4. The MVP design

### 4.1 Manifest, versioning & compatibility

A plugin is a directory of static files described by
`manifest.canvix.json`:

```json
{
  "canvixPluginApi": "1",
  "id": "com.canvix.wordcloud",
  "name": "Word Cloud",
  "description": "Turn page text into a word-cloud graphic",
  "version": "1.0.0",
  "author": { "name": "Canvix team" },
  "engines": { "canvix": ">=0.12.0 <0.13.0" },
  "entry": { "panel": "panel.html" },
  "permissions": ["design:read", "design:write", "element:plugin", "storage"],
  "elements": [
    {
      "kind": "cloud",
      "label": "Word cloud",
      "initialData": { "words": [], "palette": ["#7630D7", "#02C0CC"], "seed": 1 },
      "schema": [
        { "key": "seed", "type": "number", "label": "Random seed", "min": 1, "max": 9999 }
      ]
    }
  ]
}
```

Rules (enforced by the validator, `vitest`-covered):

- `canvixPluginApi` — **major.minor**: major = breaking wire changes,
  minor = additive. Host supports one major, all minors below it.
  Mismatch blocks install with a plain-language message, never a silent
  no-op.
- `engines.canvix` — semver **range** over the host app version, so a
  plugin can declare "needs ≥ 0.12". Range parsing is a ~40-line
  hand-rolled matcher (comparators + hyphen/OR ranges); **no `semver`
  dependency**.
- `id` — `^[a-z0-9][a-z0-9-]{1,62}(\.[a-z0-9-]+){0,3}$`; `com.canvix.*`
  reserved for first-party. The id namespaces element kinds, storage
  keys, and install records.
- `version` — the plugin's own semver, recorded on every element it
  creates (`pluginVersion`) so a later version can migrate its own data.
- Elements' `schema` — a tiny declarative field list (text, number,
  color, select, range) the **host** renders in the properties slot;
  no plugin code runs in the properties bar (§4.4).

### 4.2 Packaging & install

No zip format (would need fflate — a new dep). The manifest lists its
files and the host fetches them at install time:

| Step | Behavior |
|---|---|
| submit | User pastes a manifest URL (dashboard → Apps → "Install plugin"). `POST /api/plugins/install` with the URL. |
| fetch | Server fetches manifest + declared files through the **existing `safeFetch` SSRF guard**, 2 MB total, ≤ 50 files, 10 s per file, 413 on overrun — the MCP route's `readBodyCapped` discipline. |
| validate | Manifest schema, semver ranges, id reserved-words, entry exists, no inline `<script>` in served HTML (packaging rule — enables a strict CSP, §4.6), `initialData` passes the collab payload caps. |
| consent | The UI shows name, version, author, **file list, and every permission in plain language** ("read this design", "add and edit elements", …). Install is a user decision; it is the trust gate of the whole model. |
| store | Files snapshot into Postgres (`PluginAsset.bytes`, sha256 each), one `PluginInstall` row per `(userId, pluginId)`. After install the instance is **fully offline** — no runtime fetches, ever. |

Proposed schema (additive migration, ships only in the implementation
phase — nothing applied now):

```prisma
model PluginInstall {
  id        String        @id @default(cuid())
  userId    String
  pluginId  String
  version   String
  manifest  Json
  enabled   Boolean       @default(true)
  assets    PluginAsset[]
  createdAt DateTime      @default(now())
  @@unique([userId, pluginId])
}
model PluginAsset {
  id        String @id @default(cuid())
  installId String
  path      String
  mime      String
  bytes     Bytes
  sha256    String
  @@unique([installId, path])
}
```

Gated by `CANVIX_PLUGINS` (default off), the same opt-in pattern as
`CANVIX_MCP_TOKEN` and AI keys: self-hosters get plugins only when they
ask for them. Updates are **explicit reinstalls** — no auto-mutation of
running code; a version is pinned at install (integrity hash + consent
screen), the same pinning Figma and Canva apply.

### 4.3 Plugin API & lifecycle

One bidirectional postMessage channel, structured-clone payloads, one
envelope:

```json
{ "v": 1, "id": "rpc_7", "dir": "call", "method": "design.getSnapshot", "params": {} }
{ "v": 1, "id": "rpc_7", "dir": "result", "ok": true, "result": { … } }
{ "v": 1, "id": "rpc_7", "dir": "result", "ok": false,
  "error": { "code": "E_PERMISSION", "message": "design:read not granted" } }
```

Origin discipline (the sandboxed iframe is an **opaque origin**): the
host accepts a message only when `ev.source === iframeEl.contentWindow`;
the plugin accepts only messages whose `origin` is the host's. A
one-time handshake token rides the iframe URL fragment and is echoed on
the first call — belt and braces.

MVP method catalog (every call permission-checked at the broker;
undeclared → `E_PERMISSION`, oversized → `E_PAYLOAD`):

| Method | Permission | Notes |
|---|---|---|
| `info` / `ping` | — | api + host versions, capabilities |
| `design.getSnapshot()` | `design:read` | current design: pages, elements (ids/types/geometry/own data), background — capped, read-only view |
| `subscribe('selection' \| 'document')` | `design:read` | push events from host |
| `actions.apply(action)` | `design:write` | the `design-actions.ts` whitelist, extended (below) — every action lands as a normal store op: **undoable, HLC-stamped, collab-broadcast** for free |
| `elements.registerRenderer(kind, fn)` | `element:plugin` | host→plugin render invocations (§4.5) |
| `storage.get/set/remove/keys` | `storage` | namespaced KV (§4.8) |
| `ui.notify(text)` / `ui.closePanel()` | `ui:notify` | toast + panel close — the entire top-level DOM influence a plugin gets |

`actions.apply` accepts the existing validated set (`addText`,
`addImage` (dataURL ≤ 4 MB or `/api/media` id), `updateElements` with
the same clamped patch keys, `deleteElements`, `setBackground`,
`addPage`, `duplicatePage`, `alignElements`, `distributeElements`) plus
two plugin-specific ones: `addPluginElement` and
`updatePluginElementData` — the latter restricted to elements whose
`pluginId` matches the caller (enforced by the broker, not the plugin).

**Lifecycle.** `install → consent → snapshot`. At runtime the host
mounts a **hidden service iframe** per installed plugin that has
elements present in the design (renders, §4.5) and a **panel iframe**
when the user opens the app (lazy: the Apps grid gains an "Installed"
section; clicking mounts `<iframe sandbox="allow-scripts"
src="/api/plugins/<installId>/assets/panel.html">`). `deactivate` =
unmount; plugins are ephemeral and hold no long-lived state except
their storage. Uninstall removes the install row; **elements survive**
(§4.9). Read-only designs (view-only mode) deny `design:write` at the
broker — the editor's existing 403 semantics extended to plugins.

### 4.4 Extension points (MVP scope)

| Surface | Mechanism | Today's hardcoded site (for contrast) |
|---|---|---|
| **UI — panel app** | "Installed" section in the Apps grid; panel = sandboxed iframe inside the existing `PanelShell` chrome | `apps/registry.tsx:37` const array |
| **UI — properties slot** | when a plugin element is selected, the properties bar shows a host-rendered card from the manifest `schema` (native inputs — fast, no iframe in the toolbar) + an "Open in app" button | `PropertiesBar.tsx` ternary chain |
| **Elements** | one new native type `'plugin'` (§4.5) — a single union member, one case per renderer, all per-plugin variation in data | 12-member closed union + ~10-file blast radius |
| **Export** | the plugin's SVG renderer feeds **all three render paths** — svg-export embeds the sanitized string; canvas/video/thumbnails rasterize it (§4.5) — so PNG/JPG/PDF/MP4/WebM/SVG all include plugin elements with zero per-plugin code | three independent switches (§2.3) |
| **Tools** | MVP: a "tool" *is* a panel app (generator-style, like Charts). Pointer-capture canvas tools are phase 3 | `tool: 'select' \| 'draw'` union |
| **Server** | out of scope — MCP is the server rail (phase 3: a bridge that surfaces MCP tools inside plugin panels) | `mcp/tools.ts` |

Deliberately **not** extensible: auth, collab transport, AI provider
routing, and export destinations beyond the formats above (phase 3
lists custom export targets).

### 4.5 The plugin element & renderer contract

The union gains exactly **one** member:

```ts
export interface PluginElement extends BaseElement {
  type: 'plugin'
  pluginId: string    // 'com.canvix.wordcloud'
  kind: string        // 'cloud' — namespaced by pluginId
  pluginVersion: string
  data: Record<string, unknown>  // JSON — must pass validateOpPayload caps
}
```

Per-plugin variety lives entirely in `data` + a registered renderer.
This is the structural move that dodges the three-switch problem: the
host adds one `case 'plugin'` to each renderer (element-node, svg-export,
video-export), and that case delegates to the plugin's **declarative
renderer**:

```ts
// the plugin registers (inside its iframe):
canvix.elements.registerRenderer('cloud', async (el, box) => ({
  svg: buildWordCloudSVG(el.data, box.width, box.height)  // pure function
}))
```

Contract:

- **Input**: `{ data, width, height, mode: 'canvas' | 'export' }` —
  nothing ambient. Renderers must be **pure and deterministic** (the
  layout seed lives in `data`, exactly like beat-detect's seeded PRNG)
  or exports and replicas diverge.
- **Output**: `{ svg: string }` (preferred; host can rasterize and
  embed) or `{ raster: dataURL }`. Self-contained: `data:` refs only,
  no external hrefs, system font stack (no font loading in MVP). Capped
  at 2 MB; output passes the **same sanitizer** svg-export already
  applies (no `<script>`, no event handlers, no `foreignObject`, hrefs
  `data:`/`https:` only — the existing discipline, extended).
- **Host integration**: the service iframe's renderer result is cached
  per `(elementId, hash(data), size)`; the editor canvas renders it as
  a Konva `Image` (the `use-loaded-image` cache pattern); svg-export
  embeds it inside a `<g transform>`; video-export builds an Image
  node; the poster philosophy is identical to how v0.11 renders video
  elements. **Entry animations and Beat Sync apply to plugin elements
  for free** — they are generic per-element fields, not per-type code.
- **Failure**: render error, timeout (10 s deadline), or missing
  plugin → a neutral placeholder card (element name + plugin name +
  "install / enable" affordance). Data is never touched.

### 4.6 Security model

**Threat model: the plugin author is the adversary.**

| Threat | Vector | Mitigation |
|---|---|---|
| Steal the session | cookies, tokens | opaque-origin iframe (`sandbox="allow-scripts"`, no `allow-same-origin`) cannot read host cookies or DOM; httpOnly session cookie unreadable even same-origin; **no secrets ever cross the RPC boundary** — the broker only speaks design data |
| Wreck the document | wild writes | every mutation is a whitelisted, clamped action (`design-actions.ts` pattern); all of it undoable; read-only designs deny writes |
| XSS into the host | renderer SVG | strict sanitizer allowlist before any use (§4.5); served HTML forbids inline `<script>` at validation |
| Hijack host UI | top navigation, forms, popups | `sandbox` without `allow-top-navigation`/`allow-forms`/`allow-popups`; UI slots only |
| Data exfiltration | `fetch`/beacons/images | assets served by the host route with per-manifest **CSP**: `default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data: blob:; connect-src <granted origins or 'none'>`. CSP governs `fetch()` in all modes, including `no-cors`. **Residual, documented:** a script can still self-navigate the iframe to an attacker URL carrying query-string data — CSP cannot police navigation. This is why the consent screen, not the sandbox alone, is the trust gate. |
| Runaway CPU | renderer loop | 10 s deadline → placeholder + "plugin not responding" UI + offer to disable; no hard CPU cap exists for iframes in any browser (§9) |
| Supply-chain swap | asset tampering after install | files are DB-served and sha256-pinned at install; updates are explicit reinstalls |
| SSRF via the install route | server fetches an attacker URL | the existing `safeFetch` guard (DNS pinning, private-range denial, redirect revalidation) + size/time caps |
| CSRF on install | cross-site POST | same-origin + CSRF token, the existing auth discipline |

**Permissions** (manifest-declared, user-granted, broker-enforced,
default-deny): `design:read`, `design:write`, `element:plugin`,
`storage`, `ui:notify`, and repeatable `network:<origin>` (the only
origins that appear in `connect-src`). No permission can be escalated
after install; a new permission set = reinstall = new consent screen.

### 4.7 Isolation & resource limits

| Resource | Limit | Enforcement |
|---|---|---|
| RPC payload | 256 KB / call, structured-clone-safe only | broker rejects (`E_PAYLOAD`) — same cap as collab ops |
| RPC rate | 200 calls / min soft | warn → `E_THROTTLE` (in-memory bucket, the MCP rate-limit pattern) |
| Renderer output | 2 MB | reject → placeholder + toast |
| Install bundle | 2 MB, ≤ 50 files | install route |
| Plugin storage | 256 KB / browser (MVP) | quota error surfaced to the plugin |
| Element `data` | existing `validateOpPayload` caps (≤ 500-array, ≤ 100 k strings, depth ≤ 12, ≤ 60 keys) | already enforced on every collab op and autosave |
| Iframes alive | 1 service + 1 panel per plugin; service iframes unloaded after 5 min idle with no plugin elements present | host |
| CPU / memory | **not hard-cappable** | watchdog + disable — the honest answer (§9) |

Crash containment is structural: a plugin iframe is a separate
browsing context; its death degrades to placeholders, never the editor.

### 4.8 Storage & settings persistence

Three tiers, by who owns the data:

1. **Element data** — lives in the element, inside the document jsonb.
   Rides autosave, versions, collab replication, offline merge (LWW by
   element id — `merge.ts` is type-agnostic, verified against its
   tests). Cross-device by construction. Capped by the collab validator.
2. **Plugin settings** (palettes, defaults, per-user prefs) — MVP:
   `localStorage`, namespaced `canvix:plugin:<pluginId>:*`, 256 KB, the
   broker owns the prefix so plugins cannot read each other or the
   host's keys (brand kit precedent: same browser-local approach).
   Phase 3: an optional server-side `PluginStorage` table
   (per-user and per-design scopes) for cross-device sync — needs the
   migration that phase ships anyway.
3. **Install records** — Postgres (§4.2). Per-user; `enabled` flag is
   the admin/user kill switch; `CANVIX_PLUGINS=0` is the instance-wide
   one.

### 4.9 Backward compatibility

| Host opens a design containing plugin elements… | Behavior |
|---|---|
| ≤ v0.11.1 (today) | plugin element is **invisible but preserved** — all three renderers already default silently for unknown types; jsonb passes through autosave/merge untouched; the merge is LWW-by-id, type-agnostic (verified: `merge.ts` never switches on type) |
| v0.12, `CANVIX_PLUGINS=0` | placeholder card + "plugins are disabled on this instance" |
| v0.12, flag on, plugin not installed | placeholder + install hint (the element records only the `pluginId` — no manifest URL — so discovery stays the user's business, §10) |
| v0.12, plugin installed | full render; `pluginVersion` mismatch is surfaced to the plugin, which migrates its own `data` (host never rewrites plugin data) |

Also: existing designs are untouched (no backfill, no scan); the
`AnyElement` union gains a member without altering any existing type;
`renderPanel` and friends gain branches, never lose them; built-in
templates contain **zero** plugin elements by policy (templates are
pure data and must render on any host); version snapshots/restore work
on plugin elements because they are plain elements. Uninstall never
deletes elements — worst case is a placeholder, never data loss.

### 4.10 Zero-dependency & bundle accounting

Everything uses native platform APIs: `<iframe sandbox>`, `postMessage`,
structured clone, CSP response headers, `crypto.subtle` (sha256),
`localStorage`. The semver range matcher is hand-rolled. **No new npm
dependencies.**

Host-side additions — manifest validator, permission broker, RPC
bridge, consent/install UI, serve route, plugin element render case —
estimate **15–25 KB gzipped**, all behind one dynamic `import()` that
fires only when the flag is on *and* installs exist. The Cloudflare
worker sits at 2.14 MB gz against a 3 MB cap (~0.85 MB headroom); the
plugin runtime consumes ≤ 3 % of that headroom, and nothing at all for
instances that don't opt in. The `verify-deploy-readiness.ts` script
gains a size assertion so this stays true (§6).

## 5. The first-party validation plugin: Word Cloud

`com.canvix.wordcloud` v1.0.0 — chosen because it exercises **every**
MVP surface with no host-side bespoke code, and it's genuinely useful:

- **Panel app** (sandboxed iframe): source picker (current page's text
  elements — `design:read` — or pasted text), stop-word list, palette
  chooser, mask (rect/circle), density slider. Generate →
  `actions.apply({ type: 'addPluginElement', kind: 'cloud', data: {…} })`.
- **Element + renderer** (`element:plugin`): seeded spiral layout
  (deterministic — the seed lives in `data`), emits self-contained SVG
  `<text>` runs on the system font stack, well under the 2 MB cap.
- **Properties slot**: the manifest `schema` renders host-side inputs
  (seed, density, mask) → `updatePluginElementData`; "Open in app" for
  the full panel.
- **Export**: word clouds appear in SVG/PNG/JPG/PDF/video exports via
  the renderer contract, with zero export code in the plugin.
- **Storage**: remembers last palette/stop-words (`storage`).
- **Permissions**: `design:read`, `design:write`, `element:plugin`,
  `storage` — and **no network permission**, proving the default-deny
  path.

Word Cloud end-to-end (install → generate → restyle → export →
collaborate → uninstall-with-placeholder) **is** the MVP acceptance
test. If it can't be built cleanly on the API, the API is wrong.

## 6. Testing strategy

Mirrors the existing pyramid (vitest unit → Playwright e2e → live
probe scripts):

- **Unit (vitest, node):** manifest validator (malformed fields,
  reserved ids, semver ranges incl. the hand-rolled matcher), permission
  broker (default-deny, escalation attempts, `network:` origin
  parsing), RPC envelope caps, SVG renderer sanitizer (script/
  foreignObject/external-href/oversize rejection), plugin element
  factories, `validateOpPayload` against plugin element shapes,
  offline-merge of plugin elements (added to the existing merge suite —
  LWW by id should need no new code, and the tests prove it).
- **E2E (Playwright, chromium):** install from a fixture URL → consent
  screen shows every permission → Word Cloud appears in Apps → panel
  round-trip over postMessage → element on canvas → placeholder when
  the plugin is disabled → export SVG/PNG contain the cloud → reload
  persists → **two browser contexts**: plugin element added by
  collaborator A renders in B's session; B without the plugin sees the
  placeholder and loses no data → read-only design blocks
  `design:write` → uninstall leaves placeholders.
- **Security cases (Playwright + unit):** CSP headers on the serve
  route match the manifest exactly; sandbox attribute lacks
  `allow-same-origin`; an in-iframe `fetch('https://example.com')`
  without the permission is blocked by `connect-src 'none'`;
  cross-plugin storage access denied; CSRF'd install POST rejected.
- **Fuzz corpus:** 10+ malformed manifests, oversized/deeply nested
  `data`, hostile SVG strings, replayed RPC envelopes.
- **Live probe (`scripts/verify-plugins.ts`, the `verify-media.ts`
  pattern):** against a real deployment — install probe plugin,
  exercise storage quota and permission denials, uninstall, assert
  cleanup. Plus the deploy-readiness size assertion (§4.10).

## 7. Migration path

1. **v0.11.1 → v0.12.0**: normal deploy. `CANVIX_PLUGINS` defaults off;
   with the flag off, behavior is byte-identical to v0.11.1 (the
   runtime is behind a dynamic import that never fires).
2. One **additive** migration (`CREATE TABLE PluginInstall,
   PluginAsset` — no backfill, no column changes to existing tables;
   the 0005 Media migration is the precedent for a safe additive
   ship).
3. Existing designs need nothing — plugin elements simply don't exist
   in them yet; when they appear later, §4.9's matrix governs.
4. **Rollback** = flag off (or `enabled=false` per install). Installs
   go dormant; documents degrade to placeholders; no data is removed.
5. API evolution: `canvixPluginApi` minors are additive only; a new
   major (v2, someday) means the host runs v1 plugins alongside v2 —
   the version is in every envelope and every install row.

## 8. Phased plan & acceptance criteria

| Phase | Scope | Acceptance criteria (all must pass) |
|---|---|---|
| **1 — Runtime core** (panel apps) | manifest + validator, install/consent/uninstall UI, serve route with CSP, sandboxed panel iframe, RPC broker + permissions, feature flag, storage | install route rejects all fuzz corpus manifests; consent screen lists permissions verbatim; serve route CSP matches manifest in Playwright; sandbox attribute verified; Word Cloud *panel* works (generate a cloud **as native text elements** — a valid fallback proving actions alone); RPC cap + rate-limit unit tests; 0 new deps; deploy-readiness size check green on all 3 targets |
| **2 — Elements & export** | `plugin` element type + factory, renderer contract + sanitizer + cache, service iframe, properties slot, placeholder states, three-renderer integration | Word Cloud full e2e of §5 incl. SVG/PNG/video export inclusion; placeholder in all four host states (§4.9 matrix); two-browser collab test; merge tests pass with plugin elements; read-only denies writes; beat pulse + entry animation visibly apply to a plugin element (they're generic — prove it) |
| **3 — Depth** (post-MVP, unordered backlog) | pointer tools; modal/menu UI slots; live overlay rendering in preview; `network:` proxying review; server-side storage table; worker-based renderer acceleration; MCP↔plugin bridge; self-hostable static plugin index (a JSON file, no central service); signed manifests | scoped per feature when scheduled |

## 9. Honest limitations (documented, deliberate)

- **No hard CPU/memory cap on plugin iframes** — browsers don't offer
  one. Watchdog + disable + crash containment is the real offer.
- **CSP cannot block iframe self-navigation** — a malicious plugin can
  attempt a query-string exfil by navigating itself. The boundary that
  actually matters: the plugin realm holds **no secrets and no
  cross-user data** — only the current design's content the user
  consented to expose. The consent screen is the trust gate, not the
  sandbox.
- **Canvas output is poster-style** — static SVG per element; no
  plugin-driven animation or live DOM over the canvas in MVP (host
  animations/beat pulses do apply). Pointer tools deferred. This
  mirrors how v0.11 shipped video (poster first, playback later).
- **Renderer fonts are the system stack** — no webfont loading in
  plugin renderers in MVP (a font-in-SVG spec is an open question,
  §10).
- **Storage is per-browser in MVP** — plugin settings don't sync across
  devices until phase 3's table.
- **No discovery/marketplace** — install-by-URL only; a self-hostable
  static index is a phase-3 non-feature (deliberately no central
  service, ever).
- **Panel API is async and message-batched** — plugins that want
  60 fps interactive UI must stay in their own iframe canvas, which is
  fine, because that's exactly what the sandbox gives them.
- **One service iframe per plugin with elements present** — a design
  using five different plugins keeps five lightweight iframes alive;
  the idle-unload rule bounds this, but it is a real cost.

## 10. Open questions

1. **Element→plugin discovery**: should a placeholder offer "search for
   this plugin" against a self-hostable index, or stay silent until
   phase 3?
2. **Fonts in renderer SVG** — allow embedded woff2 as `data:` (size
   cost) or stay system-stack forever?
3. **Per-design plugin pinning**: record `pluginVersion` per element
   (proposed) *and* per design? Probably overkill — decide when a real
   plugin needs it.
4. **Worker-accelerated renderers** (option C): adopt when a first-party
   plugin's rasterization measurably janks the main thread.
5. **MCP bridge semantics**: do MCP server tools appear as plugin panel
   actions, or stay a separate dashboard surface?
