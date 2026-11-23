# Canvix AI Capability Matrix (v0.28 audit)

Generated 2026-11-23 by direct inspection of the implementation (store, design-actions,
add-element, panels, apps, API routes). This is the Phase 0 deliverable and the contract
for Phase 3: every row the matrix marks "gap" gets a tool in the capability bridge.

Legend — **Human**: usable through the editor UI · **AI v0.27**: reachable by the design
agent (`src/lib/agent/tools.ts`, 24 tools) · **AI v0.28**: after this overhaul.
A = adapter exists (validated `DesignAction` or store action), U = undoable (rides
history/collab), C = needs confirmation (destructive tier), ✅ = supported, ⚠️ = partial,
❌ = gap.

## Canvas and document operations

| Capability | Human | AI v0.27 | AI v0.28 | Adapter | Undo | Tests |
|---|---|---|---|---|---|---|
| Create/open/save/duplicate designs | ✅ | ❌ (out of panel scope) | ❌ (design mgmt stays user-side; agent edits the open document) | — | — | n/a |
| Change dimensions / aspect ratio (`resizeDesign`, magic re-layout) | ✅ | ❌ | ✅ `resize_design` | A | U | + |
| Add page | ✅ | ✅ `add_page` | ✅ | A | U | ✅ |
| Delete page | ✅ | ❌ | ✅ `delete_page` (destructive) | A | U | + |
| Duplicate page | ✅ | ✅ `duplicate_page` | ✅ | A | U | ✅ |
| Go to page | ✅ | ✅ `goto_page` (v0.27.3) | ✅ | A | — | ✅ |
| Page background (solid/gradient/angle) | ✅ | ✅ `set_background` | ✅ | A | U | ✅ |
| Page transition | ✅ | ❌ | ✅ `set_page_transition` | A | U | + |
| Page notes | ✅ | ❌ | ❌ (notes are presenter-side meta, not visual; documented out of scope) | — | — | — |
| Element position/size/rotation/opacity | ✅ | ✅ `update_elements` | ✅ (rotation/opacity/z now in patch whitelist) | A | U | ✅ |
| Scale elements (keeps aspect) | ✅ | ❌ (client action existed) | ✅ `scale_elements` | A | U | + |
| Zoom / viewport | ✅ | ❌ | ❌ (user's viewport is not the document; agent gets full state instead) | — | — | — |
| Grid / snap / rulers / guides | ✅ | ❌ | ❌ (view aids, not document state; agent aligns deterministically) | — | — | — |
| Selection | ✅ | read via context | read only (ids flow through tools) | — | — | ✅ |
| Group / ungroup | ✅ | ❌ | ✅ `group_elements` / `ungroup_elements` | A | U | + |
| Layer order (front/back/up/down, reorder) | ✅ | ❌ | ✅ `reorder_layers` | A | U | + |
| Lock / visibility | ✅ | ❌ | ✅ `update_elements` patch (locked/visible) | A | U | + |
| Duplicate selection | ✅ | ❌ | ✅ `duplicate_elements` | A | U | + |
| Undo / redo | ✅ | per-action + "Undo agent work" | ✅ (unchanged) | A | U | ✅ |
| Versions (save/restore) | ✅ | ❌ | ❌ (version history is a user-controlled safety net; agent never rewrites history) | — | — | — |

## Typography

| Capability | Human | AI v0.27 | AI v0.28 | Adapter | Undo |
|---|---|---|---|---|---|
| Add/edit text | ✅ | ✅ `add_text` / `update_elements` | ✅ | A | U |
| Font family (catalog-validated) | ✅ | ✅ `set_font` | ✅ | A | U |
| Size / bold / italic / underline / strike / uppercase | ✅ | ⚠️ (partial patch) | ✅ full patch whitelist | A | U |
| Letter spacing / line height | ✅ | ❌ | ✅ patch keys | A | U |
| Alignment (left/center/right) | ✅ | ⚠️ | ✅ | A | U |
| Text color / gradient fill | ✅ | ⚠️ (solid only) | ✅ (fillGradient patch) | A | U |
| Curved text (arc −180..180) | ✅ | ❌ | ✅ `curve` patch | A | U |
| Rich-text spans (per-run style, links) | ✅ | ❌ | ✅ `set_text_spans` (validated against text equality) | A | U |
| List style (bullet/number) + RTL direction | ✅ | ❌ | ✅ patch keys | A | U |
| Text effects (background block, presets) | ✅ | ❌ | ✅ patch keys | A | U |
| Auto-fit | ✅ | ❌ | ✅ patch + auto shrink via `measure_text` guidance | A | U |
| Text measurement (real metrics) | — | ❌ (0.6×char estimate) | ✅ `measure_text` tool (client canvas measureText — the same fn the renderer uses) | A | — |
| Headings/body color shortcuts | ✅ | ✅ `set_text_style`, `recolor` | ✅ | A | U |

## Graphics and styling

| Capability | Human | AI v0.27 | AI v0.28 | Adapter | Undo |
|---|---|---|---|---|---|
| Shapes: rect/ellipse/triangle/star/polygon/path | ✅ | ⚠️ (5 kinds, no params) | ✅ + sides/points/innerRatio, path | A | U |
| Line: solid/dashed/arrows | ✅ | ❌ | ✅ `add_line` | A | U |
| Fill: solid + gradient | ✅ | ⚠️ (background only) | ✅ element `fillGradient` patch | A | U |
| Stroke color/width, corner radius | ✅ | ❌ | ✅ patch keys | A | U |
| Shadows | ✅ | ❌ | ✅ patch `shadow` (validated shape) | A | U |
| Opacity | ✅ | ⚠️ | ✅ | A | U |
| Flip H/V (images) | ✅ | ❌ | ✅ patch keys | A | U |
| Frames + fill-frame with image | ✅ | ❌ | ✅ `add_frame` + `fill_frame` | A | U |
| Masks (shape masks on images, parametric) | ✅ | ❌ | ✅ `mask_image` | A | U |
| Image adjustments (brightness/contrast/saturation) + filter presets | ✅ | ❌ | ✅ `adjust_image` | A | U |
| Stickers (emoji + vector pack) | ✅ | ✅ (emoji) | ✅ + vector pack ids | A | U |
| Icons (path pack, searchable) | ✅ | ❌ | ✅ `add_icon` (server-side search of the same pack) | A | U |
| Illustrations (SVG library) | ✅ | ❌ | ✅ `add_illustration` | A | U |
| Graphics (decorative shapes) | ✅ | ❌ | ✅ `add_graphic` | A | U |
| Background removal / upscale / inpaint | ✅ (ImageAI panel) | ❌ | ✅ `edit_image` (routes to the existing image-edit providers; only on elements with `aiEntId`) | A | U |

## Images and media

| Capability | Human | AI v0.27 | AI v0.28 | Adapter | Undo |
|---|---|---|---|---|---|
| Upload/insert image | ✅ | ❌ (server can't upload) | ⚠️ `add_image` data-URL + stock + generated cover the agent's real needs; file upload stays user-side | A | U |
| AI image generation | ✅ | ✅ `add_image` | ✅ | A | U |
| Stock photo search (licensed, credited) | ✅ | ✅ `add_stock_photo` (v0.27.3) | ✅ | A | U |
| Stock video | ✅ | ❌ | ✅ `add_stock_video` | A | U |
| Audio / SFX / voiceover | ✅ | ❌ | ⚠️ `add_sfx` (pack sounds, offline) — full audio library stays user-side (file workflows) | A | U |
| Animations per element | ✅ | ❌ | ✅ `animate_elements` (kind/speed/delay/easing/direction) | A | U |
| Magic Animate page | ✅ | ✅ `animate_page` | ✅ | A | U |
| Beat pulse | ✅ | ❌ | ❌ (needs audio analysis timing — out of agent scope this wave) | — | — |

## Advanced features

| Capability | Human | AI v0.27 | AI v0.28 | Adapter | Undo |
|---|---|---|---|---|---|
| Tables (header/rows) | ✅ | ✅ `add_table` | ✅ | A | U |
| Charts (bar/line/donut/scatter, data-bound) | ✅ | ❌ | ✅ `add_chart` (series, palette) | A | U |
| QR codes | ✅ | ❌ | ✅ `add_qr` (value, size, colors) | A | U |
| Embeds (URL) | ✅ | ❌ | ✅ `add_embed` | A | U |
| Templates (apply to page, smart fields) | ✅ | ❌ | ✅ `list_templates` + `apply_template` (with field fill) | A | U |
| Brand kit (set colors/fonts; read in context) | ✅ | read only | ✅ `set_brand_kit` + read | A | U |
| Multi-page consistency | ✅ | ❌ | ✅ (goto_page + tools + brand skill) | A | U |
| Translation | ✅ | ✅ `translate_texts` | ✅ | A | U |
| Palettes | ✅ | ✅ `recolor`, `suggestPalette` | ✅ | A | U |
| Comments | ✅ | ❌ | ❌ (collab surface; agent works on the document, not the conversation) | — | — |
| Exports (PNG/SVG/PDF/PPTX/GIF/WebM) | ✅ | ❌ (MCP-only) | ✅ `export_design` (client-side export pipeline, saved to downloads) | A | — |
| Plugin elements | ✅ | ❌ | ❌ (plugin broker contract requires an install context; agent must not forge caller identity — documented exclusion) | — | — |
| Present/preview modes | ✅ | ❌ | ❌ (user-controlled) | — | — |

## Agent-layer capabilities (new in v0.28)

| Capability | v0.27 | v0.28 |
|---|---|---|
| Intent routing | act/ask/plan | + create/edit/review/improve/explain/plan/discuss **modes**; review/explain/discuss run with zero write tools |
| Step/tool/wall-clock caps | 8 / 12 / 90s (arbitrary) | removed — task-driven termination + resource guards (strikes, cycle detection, idle clock) + forced wrap-up |
| History | 10 messages | compaction (brief + recent observations kept; older steps summarized) |
| Usage observability | none | `usage` SSE events (turns, tool calls, ms, model) + panel display |
| Brief fidelity | none | Design Brief Contract: exact text/hex/dimension extraction + completion validation against real state |
| Visual feedback | none | canvas capture → vision critique (when a vision provider is configured); honest "geometry-only" disclosure otherwise |
| Skills | none | 10-skill engine, progressive disclosure, playbooks injected per run |
| Text measurement | 0.6×chars estimate | real client canvas `measureText` via `measure_text` tool |

## Confirmed exclusions (with technical reasons)

- **Design create/open/delete management** — the agent panel lives inside one open design; lifecycle is the user's (and the dashboard's) job. `apply_template` covers "start from a template" inside the current design.
- **Plugin element creation** — `addPluginElement` requires a verified `ActionCaller` (install id + manifest kinds); the agent cannot hold a plugin's identity without forging provenance. Plugins keep their own runtime.
- **Version-history mutation, comments, presence** — collaboration surfaces, not document state; out of the agent's blast radius by design.
- **File upload** — no server filesystem; uploads are a browser-file workflow. Data-URL images (≤4 MB, validated), stock, and generated media cover agent needs.
- **Zoom/grid/guides/rulers** — view state, not document state; the agent receives full document geometry instead of a viewport.
- **Beat pulse** — requires timing against audio analysis; skipped this wave.
