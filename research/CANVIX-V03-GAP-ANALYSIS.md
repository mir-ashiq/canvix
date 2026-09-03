# Canvix v0.3.0 Gap Analysis — Canvix v0.2.0 vs live Canva (2026-09-03 audit)

> Source: `research/CANVA-V03-RESEARCH.md` (fresh audit) + code inspection of `src/`.
> Ranked by visual-parity impact. Each gap lists the exact Canva reference values and
> the Canvix change required. Status column = implemented in v0.3.0.

## Tier 1 — Selection & interaction (highest visibility)

| # | Gap | Canva (measured) | Canvix v0.2 | v0.3 action | Status |
|---|---|---|---|---|---|
| 1 | Selection transformer colors | border `#7630D7` 2px solid; white circle handles ~10px | cyan `#00C4CC`, generic anchors | re-skin Transformer: purple border, circle anchors, rotation snapping | ✅ |
| 2 | Alignment guides | `#9954FF` 2px lines | guides pink `#FF33AA` 1px | recolor + 2px + snap thresholds | ✅ |
| 3 | Contextual toolbar placement | replaces TOPBAR contents when selected (885×40, 32px buttons r10) | floating centered pill | move toolbar INTO topbar row | ✅ |
| 4 | Right-click context menu | 244px, items 232×32, fs 13.33, r10, shortcuts right-aligned | none | element + page variants | ✅ |
| 5 | Group / ungroup | Ctrl+G / Ctrl+Shift+G | none | `group` element type + ops | ✅ |
| 6 | Multi-select | shift-click, marquee, unified purple box | shift-click only | marquee drag-select on empty canvas | ✅ |
| 7 | Zoom menu | 128px listbox, 40px items + Fit/Fill | +/- only | dropdown + Fit + Fill + presets | ✅ |

## Tier 2 — Panels & popovers

| # | Gap | Canva | v0.3 action | Status |
|---|---|---|---|---|
| 8 | Color menu | search, spectrum + eyedropper + current, Brand Kit, 4×7 solids, gradients | Canva-style ColorMenu component | ✅ |
| 9 | Text effects panel | 10 effects 3-col grid | restructured grid + Glow/Outline/Background/Splice added | ✅ |
| 10 | Position popover | 2×2 arrange + 6 align + W/H/Ratio/X/Y/Rotate | exact layout | ✅ |
| 11 | Spacing popover | letter/line spacing sliders + inputs | popover with styled sliders | ✅ |
| 12 | Transparency popover | purple slider, white handle | popover slider | ✅ |
| 13 | Font dropdown | search + pills + preview rows | custom FontDropdown | ✅ |
| 14 | Dialog radius | 32px | 28px on all dialogs | ✅ |

## Tier 3 — Editor capabilities

| # | Gap | v0.3 action | Status |
|---|---|---|---|
| 15 | Text toolbar completeness | full set: B/I/U/S/Aa/align/spacing/transparency/effects/position | ✅ |
| 16 | Lock/hide interactions | context menu + Ctrl+L + lock skips selection | ✅ |
| 17 | Layer ordering UI | position tiles + ]/[ shortcuts | ✅ |
| 18 | Shape library | polygons, 11 new graphics, search | ✅ |
| 19 | Image handling | adjustments (brightness/contrast/saturation), flips, replace, set-as-background, drag-drop | ✅ |
| 20 | Templates browsing | search, category chips, recommended, preview modal, apply | ✅ |
| 21 | Brand kit | palettes, logos, apply-brand-style | ✅ |
| 22 | Apps | registry + charts/QR/icons/palette/lorem/stickers | ✅ |
| 23 | Dashboard | account menu, help modal, skeletons | ✅ |
| 24 | Toasts/tooltips | toast on key actions, rail tooltips | ✅ |
| 25 | Mobile contextual bar | bottom action bar on selection | ✅ |

## Remaining gaps (accepted for v0.3.x)
- Layer-name editing & layer drag in a full Layers panel (current: Tools ▸ Layers list, reorder via drag works, no rename)
- Justify alignment renders as left in Konva (Konva limitation) — kept in the UI for parity
- Rulers & manual guides (Canva has them; Canvix has snap guides only)
- Real-time collaboration, comments, version history (need a backend presence channel)
- Image crop UI (adjustments + flips + replace cover the common cases)
- Group transform is bake-on-commit (children move/scale correctly, but rotation of nested children is approximate)

## Risk register (respected)
- v0.2 features verified post-upgrade: text effects, freehand draw, charts, autosave, export, preview/share, mobile sheets — all E2E-green.
- Text double-click editing overlay still aligns (verified in E2E 06/25).
- Mobile layout keeps sheet panels + gains the contextual bottom bar.
- Custom font dropdown performs fine with 15 fonts + category filter.
