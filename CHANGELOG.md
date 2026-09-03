# Changelog

All notable changes to Canvix will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.1] — 2026-09-03

Editor-completeness release: the remaining gap-analysis features — rulers & guides,
image crop, layer renaming, version history — plus correctness fixes found by E2E.

### Rulers & guides
- **Rulers** along the top/left of the workspace (22px strips, DPR-aware canvas ticks,
  adaptive major/minor ladder, pointer-tracking triangles). Toggle via File menu or
  **Shift+R**; fit-to-screen accounts for the ruler inset.
- **Manual guides**: drag out of either ruler to create a `#9954FF` guide; drag a guide
  to reposition, drag it off-page (or double-click) to delete; guides act as snap
  targets for element edges. Right-click the page → **Clear guides (n)**.

### Image crop
- **Crop dialog** (toolbar button, right-click → Crop image): drag handles or draw a
  brand-new region anywhere outside the current one, aspect presets (Free/Original/
  1:1/4:3/3:4/16:9/9:16/3:2/2:3) with locked-ratio drawing, rule-of-thirds overlay,
  live px readout, baked-in flips, `displayScale`-preserving apply via canvas
  re-encoding; JPEG/PNG-aware output.

### Layers
- **Rename layers**: double-click a row (or press Enter on it) — inline edit with the
  purple focus ring; empty name falls back to the auto label. `name` persisted on
  `BaseElement`; groups get a dedicated icon + label.

### Version history
- **File → Version history**: labelled snapshots per design (max 30, ~4.5MB
  localStorage budget with automatic pruning), restore (undo-able — current state is
  pushed to history first), delete, relative timestamps, pages × dimensions meta.
- **Ctrl+Alt+S** saves an instant snapshot.

### Groups (rotation correctness)
- Fixed double-rotation on group transform (children no longer get the group's angle
  baked on top of the group's own rotation).
- Ungrouping a rotated group now **orbits children around the group origin** and
  transfers the rotation, so nothing jumps.

### Apps & panels polish
- App cards and chart rows are now fully clickable tiles (role=button, keyboard
  support) — matching Canva's tile behaviour, not just the inner button.
- Tools → Layers tab reachable via role-based selectors (a11y names verified by E2E).

### Editor
- New shortcuts: **Shift+R** (rulers), **V** (select tool), **Ctrl+Alt+S** (version
  snapshot); shortcut lists in the editor modal and dashboard help modal synced.

### Design system
- Topbar gradient re-weighted purple→magenta dominant (`#02c0cc → #6425f0 → #9333ea →
  #b04fd7`) per VLM visual-QA feedback.

### Technical
- Type-check, ESLint, production build clean.
- E2E suite extended to **40 checkpoints** (rulers, guide pull, clear-guides menu,
  layers panel, version history save, QR→crop pipeline) — zero console errors.
- VLM visual QA: **8.5/10 average** across 13 key surfaces
  (`research/canvix-v03-qa-scores.md`).
- `.gitignore`: root `research/*.md` curated docs are now committed by exception.

## [0.3.0] — 2026-09-03

Deep visual-parity release informed by a fresh live audit of canva.com (logged-in,
stealth browser, computed-style + pixel-sampling extraction). Research artifacts:
`research/CANVA-V03-RESEARCH.md`, `research/CANVIX-V03-GAP-ANALYSIS.md`.

### Editor
- **Selection chrome re-skinned to measured values**: border + anchors now `#7630D7`
  with white circular handles, 2px border, 45° rotation snapping.
- **Alignment guides**: `#9954FF`, 2px.
- **Groups**: new `group` element type; Ctrl+G / Ctrl+Shift+G; children move/scale
  together and ungroup restores page positions.
- **Marquee (box) selection** on empty canvas; space+drag / middle-mouse panning;
  Ctrl+A select all.
- **Right-click context menus** (element & page): copy/cut/paste/duplicate, layer
  ordering, group, lock, hide, delete, page ops — 244px menu, 32px items, r10.
- **Context toolbar moved into the topbar** (Canva behaviour) with 32px / r10 buttons;
  mobile gets a bottom contextual action bar.
- **Zoom dropdown**: 300%→10% presets + Fit + Fill (128px listbox, 40px items),
  plus store-level `fitToScreen()`.
- New shortcuts: Ctrl+G/Shift+G (group), Ctrl+A, Ctrl+L (lock), `]`/`[` (layers).

### Text
- **10 text effects** (Drop, Lift, Glow, Hollow, Outline, Background, Splice, Neon,
  Echo, None) in a 3-column grid with live "Ag" previews.
- **FontDropdown**: search, category pills, live font previews, favourites star.
- Full toolbar: size stepper, colour, B/I/U/S, Uppercase, alignment, spacing
  (letter/line sliders), transparency slider.
- `uppercase` + `justify` model fields.

### Colour
- **Canva-style ColorMenu**: header + hex search, spectrum/eyedropper/current quick row,
  Brand Kit swatches, 4×7 default solids, gradient rows (background context).

### Panels
- **Position popover**: 2×2 arrange tiles, 6 align-to-page tiles, W/H/X/Y/Rotate with
  ratio lock.
- **Templates panel**: search, category chips, recommended section, skeletons, preview
  modal, one-click apply.
- **Brand kit 2.0**: palettes, logo uploads, “apply brand style to page”
  (nearest-colour remap + brand font swap).
- **Elements panel**: search, polygons, 11 new graphics, grouped categories.
- **Uploads panel**: replace-mode when an image is selected, set-image-as-background,
  empty state; drag-and-drop images onto canvas.

### Apps
- **Registry-driven apps ecosystem** (`apps/registry.tsx`): Charts (bar/line/donut),
  QR generator (colour + size + add to canvas), Icons (colourable), Colour palette
  generator (analogous/complementary/triad/monochrome), Placeholder text
  (lorem/real-feel), Stickers.

### Dashboard
- Account avatar menu, Help & shortcuts modal (via Get-help FAB), skeleton loading
  for recent designs, toast notifications.

### Design system
- New tokens: `--cv-selection #7630D7`, `--cv-guide #9954FF`, `--cv-menu`, slider fill.
- New shared classes: `cv-menu`, `cv-menu-item`, `cv-tbtn`, `cv-pop`, `cv-slider`,
  `cv-tip`, `cv-swatch`, `cv-skeleton`, `cv-toast`.
- Dialogs: 28px radius. Rail tooltips with 600ms delay. Focus-visible rings.

### Media
- Image adjustments (brightness/contrast/saturation via Konva filters), horizontal &
  vertical flips, `replaceSelectedImage`, `addImageAt`, `readImageFile` helpers.

### Technical
- `qrcode` dependency added.
- Type-check, ESLint and production build clean; full E2E pass (29 checkpoints,
  zero console errors); VLM visual parity 8.5–9/10 across key surfaces.

## [0.2.0] — 2026-08-31

Canva-accurate dark re-skin from live-site research: gradient topbar, 8-tab rail,
text effects (5), freehand draw, brand kit, charts, preview, share, resize,
Canva-style dashboard & mobile polish.

## [0.1.0] — 2026-08-30

Initial release: Konva.js editor (text/shapes/lines/graphics/stickers/images),
smart snapping, layers, templates, dashboard, autosave, PNG/JPG export,
responsive mobile/tablet/desktop UI.
