# Canva + MCP Research — v0.6.0 ("The Agent Edition")

Date: 2026-09-04 · Baseline: v0.5.0 @ `4139ffc` · Focus: MCP (Model Context Protocol)
integration, remaining Canva feature gaps.

---

## 1. Fresh Canva research (canva.com, Sept 2026)

### 1.1 What Canva markets today

- **Canva AI 2.0 / "design through conversation"** — AI generates *editable* layouts,
  not flat images; "Turn AI designs into editable layouts".
- **Magic Studio suite** — Magic Write, Magic Media (image/video via Veo 3), Magic
  Edit/Erase/Expand/Grab, Magic Switch, Magic Animate, Magic Resize, Translate.
- **Visual Suite 2.0 (Canva Create 2025)** — docs, decks, whiteboards, sheets, videos.
- **The AI Connector** — *"Bring editable design to your AI assistant chats. Generate
  content, repurpose assets, and more in flow. Powered by the Canva MCP Server."*
- **Editor staples** — curved text, frames, tables, charts, embeds (YouTube/Maps),
  smart snapping guides, brand kits, comments, version history.

### 1.2 Canvix v0.5 parity check

| Canva capability | Canvix v0.5 | Verdict |
|---|---|---|
| Curved text (arc) | ❌ | **gap → v0.6** |
| Frames (image clipped in shape) | ❌ (only corner radius) | **gap → v0.6** |
| Tables (native, editable cells) | ❌ | **gap → v0.6** |
| Embeds (YouTube/Maps/link cards) | ❌ | **gap → v0.6 (card form)** |
| Charts | ✅ native elements (v0.3) | ok |
| Smart snapping guides | ✅ #9954FF guides + manual ruler guides | ok |
| Magic Animate | ✅ 9 anims + transitions (v0.5) | ok |
| Magic Grab / Layers | ✅ Magic Layers (v0.5) | ok |
| Magic Resize | ✅ (v0.4) | ok |
| Magic Switch (format swap) | partial (resize only) | roadmap |
| Real-time collaboration | ✅ SSE + event log (v0.5) | ok |
| Comments | ✅ (v0.5) | ok |
| Audio/video elements + Beat Sync | ❌ | roadmap (needs timeline work) |
| MCP / AI agents | ❌ | **headline → v0.6** |

---

## 2. MCP research

### 2.1 Canva's official MCP server (`mcp.canva.com/mcp`)

Remote MCP server, OAuth, 22 tools (catalog via Speakeasy + canva.dev docs):

- **Generate**: `generate-design` (returns *candidates* w/ preview thumbnails →
  `create-design-from-candidate` materializes one), `search-brand-templates`,
  `autofill`-style editing via `start-editing-transaction`.
- **Discover**: `search-designs`, `get-design`, `get-design-pages`,
  `get-design-content`, `get-presenter-notes`, `resolve-shortlink`.
- **Edit**: `start-editing-transaction` (targeted text edits, autocomplete-magic).
- **Assets**: `upload-asset-from-url`, `import-design-from-url` (PDF/PPTX/HTML→design).
- **Organize**: `create-folder`, `search-folders`, `list-folder-items`,
  `move-item-to-folder`.
- **Export**: `get-export-formats`, `export-design` (PDF/JPG/PNG/PPTX/GIF/MP4,
  returns a download URL).
- **Collaborate**: `comment-on-design`, `list-comments`, `reply-to-comment`,
  `list-replies`.

Design principles worth copying: candidates-then-materialize for AI generation,
explicit format probing before export, comments as first-class agent tools,
rich prompting guidance embedded in tool descriptions.

### 2.2 MCP Streamable HTTP transport (spec 2025-03-26)

- **One endpoint** (`/api/mcp`), POST + GET.
- POST body = single JSON-RPC 2.0 request/notification/response **or batch array**.
- Input = only notifications/responses → **202 Accepted**, no body.
- Input contains requests → respond `Content-Type: application/json` (single JSON
  object) **or** `text/event-stream`. Client must support both — a plain-JSON
  server is fully spec-compliant (no SSE needed).
- GET → server MAY stream SSE or return **405**.
- Lifecycle: `initialize` (protocolVersion, capabilities, serverInfo) →
  `notifications/initialized` → `tools/list` / `tools/call`.
- `tools/call` result: `{ content: [{type:'text', text}], isError? }`.
- JSON-RPC error object: `{ code, message, data? }` (-32700 parse, -32600 invalid
  request, -32601 method not found, -32602 invalid params, -32603 internal).
- Security: validate `Origin`, require auth, rate limit.

### 2.3 Canvix MCP design decisions

- **Transport**: stateless Streamable HTTP, POST → JSON, GET → 405, no sessions
  (works on Vercel serverless; no state to manage).
- **Auth**: `Authorization: Bearer <CANVIX_MCP_TOKEN>` (env var). If unset, the
  server responds with a JSON-RPC error saying MCP is not configured (no
  capability leak). Per-IP rate limit reuses `rateLimit()`.
- **Tool surface (18 tools)** — every tool maps to a real, existing Canvix
  subsystem (no vaporware):

  | Tool | Backing |
  |---|---|
  | `list_templates` | Template table |
  | `search_designs` / `get_design` / `get_design_pages` / `get_design_content` | Design table |
  | `create_design` (blank or `template_id`) | Design table |
  | `add_text` / `add_shape` / `add_image` / `set_background` | element factories + SSRF-guarded fetch |
  | `update_element` / `delete_element` | validated patches (design-action style) |
  | `animate_page` | `src/lib/animations.ts` (pure, runs server-side) |
  | `export_design` (svg / png / json) | `svg-export.ts` server-side + sharp → PNG |
  | `comment_on_design` / `list_comments` | Comment table |
  | `list_fonts` | 63 font registry |
  | `generate_design` | AI provider → validated structured design → real Design row |
  | `get_capabilities` | provider probe + build info |

- **generate-design honesty**: with a provider, an LLM emits a full page spec
  (validated: sizes, hex colors, clamped coords/fonts, element caps); without a
  provider the tool errors with "requires an AI provider" (same contract as the
  rest of the app). No candidate indirection — Canvix materializes one editable
  design directly and returns its edit URL.
- **Live propagation**: MCP writes append `DesignEvent` rows (same op schema the
  collab client already replays), so an agent editing a design is visible to
  humans in the editor *live*.
- **Export honesty**: SVG is true vector (font-family references — viewers fall
  back); PNG is rasterized server-side via sharp using system fonts (documented
  caveat); the tool description states both.

---

## 3. v0.6 feature design

### 3.1 Curved text
`TextElement.curve?: number` (−180…180°, 0 = straight). Konva `TextPath` along a
computed arc; slider in the text toolbar (0–±180). SVG export → `<textPath>` on
the same arc. Interop: video/PNG/PDF export already render through Konva → free.

### 3.2 Tables
`TableElement { rows, cols, cells: {text, fill?}[], colWidths, rowHeight,
borderColor, borderWidth, headerFill }`. Rendered natively (rect + text per
cell in a Konva Group — every cell editable via double-click). Add/remove
row/column from PropertiesBar; four starter styles in Elements panel.

### 3.3 Frames
`FrameElement { frameShape: 'rect'|'ellipse'|'triangle'|'hexagon'|'circle', src,
naturalWidth/Height, fill }` — image clipped inside the shape (Konva group
clipFunc). Dropping an upload/photo on a frame fills it. SVG export via
`<clipPath>`. Empty frame renders the shape with a dashed hint.

### 3.4 Embed cards
`EmbedElement { url, title?, kind: 'youtube'|'map'|'link' }`. Native vector card
(link icon, hostname, title; YouTube shows the video thumbnail). Click in
Preview/Share opens the URL. Honest scope: a *card*, not an iframe.

### 3.5 DB
**No schema changes.** MCP reuses Design/Template/Comment/DesignEvent/AIUsage.
