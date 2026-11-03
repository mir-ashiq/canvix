# Canvix plugins — author guide

Canvix plugins are **plain static files** that run inside a sandbox and talk to
the editor over a versioned postMessage RPC. No build step, no SDK npm
package, no marketplace — you host the files anywhere that serves bytes over
https, and a Canvix user installs them by URL.

> **There is no plugin marketplace, and there will never be one.** A
> marketplace makes the host the curator of what runs on your instance; in
> Canvix the person who installs the plugin is the trust decision, and the
> consent screen shows exactly what is being granted before anything runs.
> See [the FAQ](#faq).

This document is the complete author reference: [quickstart](#quickstart—hello-world-in-10-minutes),
[the manifest](#the-manifest), [permissions](#permissions), [the RPC
API](#the-rpc-api), [element renderers](#element-types--the-renderer-contract),
[packaging rules](#packaging-rules), [hosting](#hosting-your-plugin), and the
[Word Cloud walkthrough](#walkthrough--the-word-cloud-reference-plugin).
The normative source for every rule cited here is `research/PLUGIN-SYSTEM.md`
in this repository, and the enforcement code lives in `src/lib/plugins/`.

---

## The trust model in one paragraph

A plugin is untrusted code. It runs in an `<iframe sandbox="allow-scripts">`
— an opaque origin with no access to the host's cookies, DOM, or storage —
and every message it exchanges with the host passes a broker that enforces,
in order: **frame identity** (only the iframe we mounted is heard), a
**one-time handshake token** (rides the iframe URL fragment, never the
network), a **rate budget** (200 calls/minute), a **default-deny permission
check** (every method maps to a consented permission), and **payload caps**
(the same clone-safe caps collaboration ops obey). Files are fetched once at
install, validated, and sha256-pinned into the database; after install the
instance never contacts your server again. Install is per-user, and removing
the plugin never touches the designs that used it.

## Quickstart — hello world in 10 minutes

A plugin is a directory with a `manifest.json` and whatever files the
manifest lists. Three files total for a hello-world panel:

```
hello/
  manifest.json
  panel.html
  panel.js
```

**manifest.json**

```json
{
  "canvixPluginApi": "1.1",
  "id": "net.yourname.hello",
  "name": "Hello",
  "description": "Adds a greeting text box",
  "version": "1.0.0",
  "author": { "name": "Your Name" },
  "engines": { "canvix": ">=0.13.4 <0.14.0" },
  "entry": { "panel": "panel.html" },
  "permissions": ["design:write"],
  "files": ["manifest.json", "panel.html", "panel.js"],
  "elements": []
}
```

**panel.html**

```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Hello</title>
<style>
  body { font: 13px system-ui, sans-serif; color: #E7E8EE; background: #0F0F13; padding: 12px; }
  button { font: inherit; border: 0; border-radius: 8px; padding: 8px 12px; background: #7630D7; color: #fff; cursor: pointer; }
</style>
</head>
<body>
  <button id="go" type="button">Say hello on the canvas</button>
  <script src="panel.js"></script>
</body>
</html>
```

**panel.js** — the whole RPC client is ~30 lines; copy it from the
[Word Cloud plugin](../../public/plugins/wordcloud/wordcloud.js)
(`createRpc` / `handshakeFromLocation`) or inline this minimal version:

```js
;(function () {
  'use strict'
  var seq = 0, verified = false
  function call(method, params) {
    return new Promise(function (resolve, reject) {
      seq += 1
      var id = 'p_' + seq + '_' + Math.random().toString(36).slice(2, 10)
      var env = { v: 1, id: id, dir: 'call', method: method }
      if (params !== undefined) env.params = params
      if (!verified) { verified = true; env.handshake = decodeURIComponent(location.hash.slice(1)) }
      var timer = setTimeout(function () { reject(new Error(method + ' timed out')) }, 15000)
      window.addEventListener('message', function onMsg(ev) {
        if (ev.source !== parent || !ev.data || ev.data.id !== id) return
        window.removeEventListener('message', onMsg)
        clearTimeout(timer)
        ev.data.ok ? resolve(ev.data.result) : reject(new Error(ev.data.error.message))
      })
      parent.postMessage(env, '*')
    })
  }

  document.getElementById('go').addEventListener('click', function () {
    call('actions.apply', {
      action: { type: 'addText', text: 'Hello from a plugin! 👋', fontSize: 48 }
    }).catch(function (e) { console.error(e.message) })
  })
})()
```

Serve the `hello/` directory over https (or `http://127.0.0.1` for local
testing), then in Canvix: open a design → **Apps** → paste the manifest URL →
**Install** → review the consent screen → **Keep installed**. Click **Hello**
in the Installed list, press the button, and the text lands on the canvas —
undoable, collaborative, saved like any element.

> The instance you install on must have `CANVIX_PLUGINS=1` set — self-hosters
> opt into third-party code explicitly. On your own machine:
> `CANVIX_PLUGINS=1 npm run dev`.

---

## The manifest

`manifest.json` is the first gate of the trust chain: everything the consent
screen shows and the broker enforces originates here. The validator
(`src/lib/plugins/manifest.ts`) **collects every error** so authors fix
everything in one round-trip, and rejects anything not explicitly allowed.

| Field | Rules |
|---|---|
| `canvixPluginApi` | `"1"` or `"major.minor"` like `"1.1"`. The host speaks one major and every minor below its own. `1.1` = the renderer contract (service entries, `elements.render`). A mismatch blocks install with a plain-language message. |
| `id` | `^[a-z0-9][a-z0-9-]{1,62}(\.[a-z0-9-]+){0,3}$`, 2–80 chars. `com.canvix.*` is reserved — only bundles shipped in Canvix's own `public/plugins/` may carry it (see [bundled plugins](#bundled-plugins)). |
| `name` | 1–80 chars. Shown in the Apps panel and consent screen. |
| `description` | Optional, ≤ 280 chars. |
| `version` | Strict semver `"1.0.0"` — recorded on every element the plugin creates (`pluginVersion`) so a later version can migrate its own data. |
| `author` | `{ name: 1–80 chars, url?: https-only }`. |
| `engines.canvix` | A semver **range** over the host app, e.g. `">=0.13.4 <0.14.0"`. Supported: exact, comparators, `^`, `~`, hyphen ranges, partial versions, `\|\|`. Prerelease tags and loose forms are deliberately rejected (fail-closed). |
| `entry` | `{ panel?: "panel.html", service?: "service.html" }` — safe relative `.html` paths. You need `panel` and/or `elements`; a plugin with `elements` **must** declare `service` (its renderers' host). |
| `permissions` | Array — see [permissions](#permissions). Unknown entries block install. |
| `files` | Every file the bundle ships (≤ 50, ≤ 2 MB total) — the install route fetches **exactly** this list. Relative paths, safe extensions only (html/js/mjs/css/png/jpg/jpeg/gif/svg/json/txt/woff2/map/ico), no traversal. Must include both entry files. |
| `elements` | ≤ 20 element types — see [renderers](#element-types--the-renderer-contract). |

Unknown top-level keys are ignored on purpose — a future-minor manifest keeps
its v1 contract on this host.

## Permissions

Five static permissions plus repeatable `network:<origin>` grants. Declared
in the manifest, shown **verbatim on the consent screen**, enforced per-call
by the broker (default-deny):

| Permission | Plain-language consent line | Gates |
|---|---|---|
| `design:read` | "Read the design you have open — pages, elements and their properties" | `design.getSnapshot`, `subscribe` |
| `design:write` | "Add, edit and delete elements in this design (via Canvix's undoable actions)" | `actions.apply` — suspended in read-only designs |
| `element:plugin` | "Add its own element types to the canvas and draw them" | `addPluginElement` / `updatePluginElementData` / `elements.registerRenderer` |
| `storage` | "Remember its settings in this browser (namespaced, 256 KB cap)" | `storage.*` |
| `ui:notify` | "Show toast notifications and close its own panel" | `ui.notify`, `ui.closePanel` |
| `network:https://api.example.com` | "Send and receive data with https://api.example.com — the only server it may contact" | The iframe's CSP `connect-src` — nothing else is fetchable |

Rules worth knowing: at most 8 static permissions and 5 network origins;
origins are absolute **https** only (loopback http allowed for development);
no wildcards, credentials, or fragments; a permission added in a new version
requires fresh consent (the upgrade rule — an install is for exactly what
was shown, never more).

**Ask for nothing you don't need.** The reference Word Cloud plugin ships
with zero network permissions on purpose — the default-deny path is the
well-lit one.

## The RPC API

One JSON envelope, both directions:

```jsonc
// plugin → host (and host → plugin) call
{ "v": 1, "id": "p_1_x8f2", "dir": "call", "method": "actions.apply", "params": { },
  "handshake": "…first call only…" }

// the answer, same id
{ "v": 1, "id": "p_1_x8f2", "dir": "result", "ok": true, "result": { } }
{ "v": 1, "id": "p_1_x8f2", "dir": "result", "ok": false,
  "error": { "code": "E_PERMISSION", "message": "…" } }
```

- `v` is the protocol **major** (1 today). Additive changes bump the minor.
- The **first** call from a frame must echo the handshake token from its URL
  fragment (`location.hash`) or every later call fails `E_PERMISSION`.
- `id` is your correlation key — 1–64 chars of `[A-Za-z0-9_.:-]`.
- Error codes: `E_VERSION` `E_MALFORMED` `E_PAYLOAD` `E_PERMISSION` `E_METHOD`
  `E_THROTTLE` `E_NOT_FOUND` `E_TIMEOUT` `E_INTERNAL`.
- Every envelope passes the payload caps: 256 KB total, 500-item arrays,
  64-key objects, 13-deep nesting, 70 000-char strings (the collaboration
  caps, applied identically). The ONE exception: the **result** of an
  `elements.render` call may reach ~2 MB (a full SVG document).

### Methods a plugin may call

| Method | Permission | Returns |
|---|---|---|
| `info` | — | `{ api: { major, minor }, host, plugin: { id, version }, capabilities: { panel, renderer } }` |
| `ping` | — | `{ pong: true, t }` |
| `design.getSnapshot` | `design:read` | A **lossy, capped projection** of the current design: pages, element views (id/type/geometry/own small fields), background. Megabyte fields (image dataURLs) are omitted and named in `omitted`, internal bookkeeping never crosses. |
| `subscribe` | `design:read` | `{ subscribed: ["selection", "document"] }` — pushes arrive as host→plugin `event` calls (see below). |
| `actions.apply` | `design:write` | `{ message }` — applies one whitelisted design action (below). Refused in read-only designs. |
| `elements.registerRenderer` | `element:plugin` | `{ registered: ["cloud"] }` — service frames only. |
| `storage.get` / `set` / `remove` / `keys` | `storage` | 256 KB namespace per plugin id, JSON values, key grammar `[A-Za-z0-9_.:-]{1,64}`. |
| `ui.notify` | `ui:notify` | Toast (≤ 200 chars, control chars stripped). |
| `ui.closePanel` | `ui:notify` | Closes your panel. |

**Whitelisted actions for `actions.apply`** (all of them the ordinary
undoable, collaboration-safe store paths — a plugin can never mutate the
document model directly):

`addText` · `addImage` · `updateElements` · `deleteElements` ·
`setBackground` · `addPage` · `duplicatePage` · `alignElements` ·
`distributeElements` · `addPluginElement` · `updatePluginElementData`

The two plugin-element actions run with the **calling install's identity** —
you can only create elements for kinds your manifest declares, and only
patch elements your own plugin id owns. A plugin cannot forge another
plugin's namespace.

Example — add one of your own element types:

```js
rpc.call('actions.apply', {
  action: {
    type: 'addPluginElement',
    kind: 'cloud',              // a kind your manifest declares
    data: { words: [...], seed: 42, /* ≤ 64 KB, clone-safe */ },
    width: 480, height: 300,
    name: 'Word cloud',
  },
})
```

### Calls the host makes INTO your plugin

Handle these in the **service** frame (and ack `event` pushes anywhere):

| Method | Params | You answer |
|---|---|---|
| `elements.render` | `{ kind, data, width, height, mode }` | `{ svg: "<svg…>…</svg>" }` or `{ raster: "data:image/png;base64,…" }` — see the renderer contract |
| `event` | `{ topic: 'selection' \| 'document', payload }` | Ack with an ok result (a client library does this for you) |

## Element types — the renderer contract

A plugin element is a first-class canvas element whose **pixels are
delegated**. The manifest declares the types:

```json
"elements": [
  {
    "kind": "cloud",
    "label": "Word cloud",
    "initialData": { "words": [], "seed": 42, "density": 0.7, "mask": "rect", "palette": "canvix" },
    "schema": [
      { "key": "seed",     "type": "number", "label": "Seed", "min": 1, "max": 9999 },
      { "key": "density",  "type": "range",  "label": "Density", "min": 0.1, "max": 1, "step": 0.05 },
      { "key": "mask",     "type": "select", "label": "Shape",
        "options": [ { "value": "rect", "label": "Rectangle" }, { "value": "circle", "label": "Circle" } ] },
      { "key": "palette",  "type": "select", "label": "Palette", "options": [ … ] }
    ]
  }
]
```

- `kind` — a lowercase slug, unique per plugin. On the canvas the element is
  `(pluginId, kind, pluginVersion, data)`; selection, drag, transform, undo,
  layering, animations and Beat Sync apply through the ordinary paths.
- `schema` — the **host** renders these fields in the properties bar when
  the element is selected (`text` / `number` / `range` / `color` / `select`
  with min/max/step/maxLength/options). No plugin code runs in the
  properties bar — changes flow back as `updatePluginElementData` with the
  install's identity. Keep the panel for anything richer ("Open in app"
  is always one click away).
- `initialData` must satisfy the schema and the data caps, and becomes the
  element's `data` when created.

### The service frame and `elements.render`

When the open design contains your elements, the host mounts your
`entry.service` in a hidden sandboxed iframe (same boundary as panels) and
expects it to:

1. echo the handshake (first call — registering is a natural first call),
2. call `elements.registerRenderer` once per declared kind,
3. answer `elements.render` calls — `{ kind, data, width, height, mode }`
   where `mode` is `'canvas'` (editor/thumbnails) or `'export'`
   (SVG/PNG/PDF/video serialization) — within **10 seconds**,
4. return `{ svg }` or `{ raster }`.

The rules that make this contract safe and cacheable:

- **Deterministic.** Same `data` in, byte-identical output out — the host
  caches renders by `(pluginId, elementId, hash(data), size, mode)` and
  never re-asks for the same input. Put every random choice behind a seed
  that lives in `data` (Word Cloud uses mulberry32 seeded by `data.seed`).
  Never read `Date`, `Math.random`, the DOM, or the network in a render.
- **Bounded.** The svg must stay under 2 MB and 20 000 elements; a raster
  under 2 MB as a base64 png/jpeg/gif/webp data URL.
- **Accept-or-reject sanitized.** Output passes the host sanitizer or the
  element degrades to a placeholder — the host never rewrites your SVG, it
  only accepts it. Allowed: `svg g defs symbol use title desc path rect
  circle ellipse line polyline polygon text tspan textpath image
  lineargradient radialgradient stop pattern clippath mask filter fe*
  marker style switch a`. Forbidden, among others: `<script>`,
  `foreignObject`, doctype/entity/CDATA/processing instructions, `on*`
  event attributes, `javascript:` URIs, external `href`/`src` (only `data:`
  and internal `#ref`), `@import` and non-`data:` `url()` in CSS.
  **Emit from an allowlist, escape all text content, and test your output
  against the sanitizer in the repo's unit suite** — that is exactly what
  Word Cloud's `src/lib/plugins/wordcloud.test.ts` does.
- **Never throw on hostile data.** Your render will meet elements written by
  older/newer versions of yourself and by other clients. Clamp, default,
  skip — degrade, don't crash (the 10-second deadline and the error path
  both land on the placeholder, but a renderer that survives is a plugin
  that keeps working).
- Text width: if you measure text against local fonts your output differs
  per machine — Word Cloud estimates widths from character classes so the
  SVG is identical everywhere. Prefer estimation over measurement.

### Durability — the promise your users feel

Plugin elements are ordinary document data (`jsonb`). Uninstall, disable,
crash, flag-off: the element never disappears — it degrades to a neutral
placeholder card that names the element and tells the viewer why
("Install "com.canvix.wordcloud" to view this element"). Reinstall and it
renders again. A collaborator without your plugin edits the design freely
and loses nothing. Exports embed the rendered cloud when available and the
honest placeholder when not — never a silent omission.

## Packaging rules

- No inline `<script>` blocks, no `on*=` handlers, no `javascript:` URIs in
  any served HTML — enforced **at install**, so the serve route's strict CSP
  (`script-src 'self'`, no `unsafe-inline` for scripts) can never break a
  valid plugin silently. Use `<script src="your.js">`.
- Inline `<style>` and `style=` attributes are fine (`style-src
  'unsafe-inline'`); external stylesheets are not.
- Images/fonts your frames need must be `data:` URLs or bundled files; the
  CSP allows `img-src data: blob:` and `font-src data:` only.
- The bundle is plain files — **no zip** (that would be a new dependency for
  every self-hoster). The manifest lists its files; the installer fetches
  each through the SSRF guard (2 MB total, 50 files, 10 s per file) and
  sha256-pins every one.

## Hosting your plugin

Anywhere that serves static bytes over https: GitHub Pages, Netlify, S3, a
directory on your own server. The manifest URL is what users paste —
`https://example.com/hello/manifest.json` — and every `files[]` entry is
resolved relative to it. Version bumps: update `version`, keep the URL
stable; users reinstall to upgrade (the install row is replaced atomically,
and a permission set that grew requires fresh consent).

For local development, `http://127.0.0.1:8000/hello/manifest.json` is
accepted (loopback http is the one dev carve-out) — serve with any static
file server, e.g. `python3 -m http.server`.

**Bundled plugins.** Canvix itself ships reference plugins in
`public/plugins/` (currently: Word Cloud). They install through the same
rail from the strict relative URL `/plugins/<slug>/manifest.json` — the
server reads the files from its own disk, which is the only path that may
carry a `com.canvix.*` id. On runtimes without a filesystem (Cloudflare
Workers) bundled installs answer a clear error; third-party plugins by
absolute URL are unaffected. If you fork Canvix, drop your own first-party
plugins into `public/plugins/<slug>/` and add them to
`src/lib/plugins/firstparty.ts`.

## Walkthrough — the Word Cloud reference plugin

[`public/plugins/wordcloud/`](../../public/plugins/wordcloud) is the
canonical example, small enough to read in one sitting:

- **`wordcloud.js`** — one shared UMD script both frames load: the RPC
  client (`createRpc`), `tokenize`, and the seeded layout/SVG emitter. The
  panel's preview and the service's renders are the same code, so the
  preview never lies.
- **`panel.html` / `panel.js`** — the UX: pull this page's text
  (`design.getSnapshot`) or paste your own, stop-words, palettes, shape,
  density, seed; a live preview; settings persisted via `storage`;
  `addPluginElement` on Generate; `updatePluginElementData` when one of its
  clouds is selected.
- **`service.html` / `service.js`** — registers the `cloud` renderer and
  answers `elements.render` with `{ svg }`.
- **The tests that pin it**: `src/lib/plugins/wordcloud.test.ts`
  (determinism, sanitizer acceptance on hostile words, mask containment,
  caps) and `tests/e2e-plugins/wordcloud.spec.ts` (the full install →
  consent → generate → render → export → restyle → disable → uninstall
  acceptance, run flag-on via `playwright.plugins.config.ts`).

## FAQ

**Will there be a marketplace?** No — see the top of this document. Plugins
install by URL; discovery is word-of-mouth, your README, your site. This is
a deliberate product decision, not a missing feature.

**Can a plugin phone home?** Only to origins the user explicitly granted at
install (`network:https://…`), listed verbatim on the consent screen and
enforced by the iframe's CSP `connect-src`. Zero network permissions means
an exfiltration wall, not a speed bump.

**What happens when I uninstall a plugin that made elements?** The elements
stay — they are design data, not plugin data. They render as placeholder
cards until the plugin is reinstalled. Uninstalling deletes the install row
and its pinned files; nothing in any design is touched.

**How do I test my plugin?** The repo's own pyramid: run the layout/pure
parts under vitest (import your UMD file like `wordcloud.test.ts` does —
including sanitizer-acceptance assertions against
`sanitizePluginSvg`), then exercise the golden path in a browser with
`CANVIX_PLUGINS=1 npm run dev` and the Apps panel.

**Why is my element a placeholder?** One of, in order: the plugin system is
flagged off on the instance; you are signed out; the plugin is not
installed (or was uninstalled); it is disabled; its service frame has not
finished booting; it has not registered a renderer for that kind; a render
failed, timed out (10 s), or was rejected by the sanitizer. The card says
which — that honesty is the contract.

**How does versioning work?** `canvixPluginApi` major must match the host;
minor ≤ the host's. `engines.canvix` constrains the host app version.
`version` is yours, stamped on every element you create. Additive host
changes bump the minor; breaking changes bump the major and old plugins
fail at INSTALL with a plain message, never silently at runtime.
