# Canva.com Deep Research — v0.3 Audit (2026-09-03)

> Method: fresh stealth-Playwright pass (4 editor runs + 1 shell run) on the live
> canva.com editor, logged in with the user's session. Extracted via real mouse
> interaction, `getComputedStyle`, DOM scans, pixel sampling (exact rgb matching),
> and VLM analysis of 30+ screenshots. Raw artifacts (screenshots, HTML, style
> dumps) were kept out of Git — this document contains only design facts, no
> credentials or PII.

## 1. New tokens extracted this pass (exact values)

### Selection & alignment system
| Token | Value | Method |
|---|---|---|
| Selection border color | `#7630D7` rgb(118,48,215) — identical to CTA purple | exact pixel match (736 px rgb(118,48,215)) |
| Selection border style | solid, ~2px | pixel sampling |
| Corner + edge handles | white circles, ~10px, at 4 corners + edge midpoints (text width) | VLM + DOM |
| Rotation handle | circular handle with rotate icon, connected by a stem below-center | interaction hover |
| Alignment guide color | `#9954FF` rgb(153,84,255) | exact pixel match during drag |
| Alignment guide size | 2px wide lines (vertical/horizontal), center + page-edge + element-edge guides | pixel scan mid-drag |
| Spacing badges | dark pill between elements showing px distance | VLM |
| Multi-select box | same solid purple border, wraps all elements | VLM |

### Menus, popovers, dialogs
| Component | Geometry | Notes |
|---|---|---|
| Right-click context menu | 244px wide, items 232×32, fs 13.33px, item radius 10px | `[role=menu]` UL, opens at cursor |
| Context menu item set (page) | Add page title · Copy `Ctrl+C` · Paste `Ctrl+V` · Duplicate `Ctrl+D` · Delete page `DELETE` · Comment `Ctrl+Alt+N` · Download page · Copy link to this page · Notes | shortcuts right-aligned, icons left |
| Zoom dropdown | 128px wide listbox, items 128×40, fs 13.33px | 300/200/125/100/75/50/25/10% + Fit (✓) + Fill |
| Dialogs | radius **32px** (938×592 upgrade dialog measured) | overlay rgba(19,22,32,0.6) |
| Tooltip | 49×28 (Zoom), 45×28 ("16.7s") | dark bg, delayed ~1s+ |
| Transparency popover | ~240-280px wide, ~80-100px tall, r12-16 | label 13-14px grey, purple track fill, white circular handle |
| Spacing (Advanced settings) popover | dark #1E1E1E-ish, r12-16, shadow | letter spacing slider+input, line spacing (default 1.4), anchor buttons |
| Cookie banner (shell) | rgb(29,59,124) #1D3B7C, r4 | — |

### Text context toolbar (element selected)
- Container: 885×40 at y=121 (overlays topbar zone), transparent bg.
- All buttons: **32px height, radius 10px, 14px/600 text, transparent bg**.
- Full order (text selected): `Font selector 120×32 ("Canva Sans")` · `Decrease font size 32` · `Font size input 32×31` · `Increase font size 32` · `Text colour 32` · `Bold` · `Italics` · `Underline` · `Strikethrough` · `Uppercase` · `Alignment (Left/Center/Right/Justify/Stretch)` · `List` · `Advanced settings (spacing)` · `Transparency` · `Effects 64×32` · `Animate 73×32` · `Position 72×32`.
- Page/multi-selection toolbar variant: `Split 32×32 (dimmed rgba(255,255,255,0.5))` · `Position 72×32 (white)` · `Comment 32` · `Delete 32`.
- Font-size stepper buttons have asymmetric radii: decrease `10px 0 0 10px`, increase `0 10px 10px 0`.

### Colour menu (text colour)
Structure top→bottom: header "Text colour" + X · search `Try "blue" or "#00c4cc"` ·
quick row: spectrum circle (rainbow + white "+"), eyedropper circle, current-color circle ·
**Brand Kit** section (palettes) · **Default solid colours** 4×7 grid of circular swatches
(~32-40px) + "See all" · **Default gradient colours** 3+ rows of circular gradient swatches.
Menu bg ≈ #121212-ish dark, swatches perfectly circular, selected swatch has light ring.

### Effects panel (text effects)
3-column thumbnail grid, each shows "Ag" in purple:
**Drop · Glow · Echo · Outline · Background · Splice · Hollow · Neon · Glitch**,
then a **Shape** section (Curve), then **Advanced**. Below selection: per-effect sliders.

### Position panel
1. **2×2 arrange grid**: Forward · Backward · To front · To back (icon+label tiles).
2. **Alignment 2-col×3-row**: Top/Left · Middle/Centre · Bottom/Right ("align to page").
3. **Advanced**: numeric row `W 430.7px | H 53.9px | Ratio 🔒` and `X 744.6px | Y 513px | Rotate 0°`.

### Font dropdown
Search input `Try "Calligraphy" or "Open Sans"` + filter icon · category pills
(Handwriting, Corporate, DISPLAY ›) · font rows (name + alphabet preview) with
star/favorite icons, thin scrollbar, dark panel.

### Editor bottom bar
40×40 icon buttons, radius 12, bg `rgba(255,255,255,0.15)`; one 40×40 pill (r9999) with
inset+outer multi-shadow. Zoom % label + zoom menu. Page indicator bottom-left.

### Rail (confirmed)
Tabs 72×72 with 10px labels; aria-labels: Templates, Elements, Text, Brand, Uploads,
Tools, Projects, Apps. Active tab = white/100%.

### Shell (home/projects/templates)
- Home search input: 732×40, placeholder "Search anything", 14px, transparent input (wrapper carries chrome).
- Search with no matches → **no hard empty state**: falls back to recents / popular templates (graceful degradation).
- Projects: filters row (Type, Category, Owner, Date modified); gibberish search still lists "Recents".
- Templates: filter pills (Category, Style, Language); no-results → popular fallback.
- "Get help" FAB: 48×48 at (1353,836) — bottom-right, purple circle.
- Cards hover: transform/box-shadow transitions on card wrappers, scale+shadow lift.
- Default font: **Canva Sans**.
- Tools floating toolbar: vertical stack — cursor (active = purple bg), draw (pencil), eraser, line, shape…

### Mobile editor (390px)
Top: search-style header ("Describe your ideal design" + mic) with **Generate ▾ + Search (purple)** row.
Bottom: dark tab bar (#121212-ish) with 6 icon+label items (Templates active, Elements, …).
Selected element → contextual bottom action bar replaces nav bar (Position, Animation, Edit image…).

## 2. Behavioural findings
- Context toolbar appears in the TOPBAR area (replaces topbar controls) while an element is selected — not a floating bar.
- Canva auto-selects newly added elements; the toolbar swaps instantly (no animation observed).
- Escape closes any open menu/popover reliably; clicking empty canvas deselects → page-level toolbar (Split/Position/Comment/Delete).
- Alignment guides appear mid-drag at page center/edges and element edges, 2px #9954FF, with px spacing pills.
- Zoom menu is a listbox (not menu role) — items 40px tall, checkmark on active zoom level.
- Right-click always opens a cursor-anchored menu; items include shortcuts right-aligned in 13.33px.
- Toasts/overlays: "All changes saved" pill in topbar; cookie banner is a bottom sheet (r4, #1D3B7C).

## 3. Consolidated token sheet (v0.2 + v0.3, authoritative)
```
bg-app             #1F142E      (home)
bg-editor          #0F1015
bg-rail            #1D1F26      (editor)  /  #1C1229 (home)
bg-card            #16171D
bg-menu            #121212..#1E1E24 (menus/popovers)
purple-cta         #7630D7      (buttons, selection border, slider fill)
guide              #9954FF      (2px alignment guides)
gradient-topbar    #02C0CC → #7B2FF7 (90deg)
text-primary       rgba(255,255,255,0.9)
text-secondary     rgba(255,255,255,0.7)
text-dimmed        rgba(255,255,255,0.5)
overlay            rgba(19,22,32,0.6)
radius-button      12px        radius-toolbar-btn 10px
radius-dialog      32px        radius-popover     12-16px
radius-menu        10px        radius-pill        9999px
font-ui            14px/600 (buttons), 13.33px (menu items), 10px (rail labels)
topbar             56px        rail 72px          panel ~320px
icon-btn           32×32 (r10) toolbar / 40×40 (r12) bottom bar
context-menu       w244, item 232×32, fs13.33, r10
zoom-menu          w128, item 128×40
tooltip            ~45-49×28, delayed ~1s
handles            white circles ~10px on #7630D7 2px solid box
```

## v0.3.1 verification addendum (2026-09-03)

Fresh E2E pass (40 checkpoints) + VLM visual QA after implementing the remaining
gap-analysis features:

- **Rulers & guides** — E2E-verified: Shift+R toggle, guide pulled from the top ruler
  (drag gesture), `Clear guides (1)` page context-menu entry. Rulers render with
  adaptive tick ladders and pointer triangles; guides snap elements.
- **Image crop** — QR-code → select → Crop image → 1:1 → Apply crop pipeline green
  end-to-end (dialog, aspect lock, px readout, cropped result re-selected on canvas).
- **Version history** — File → Version history opens, label fills, snapshot saves and
  lists with Restore/Delete. Note: with a toast visible, the first Escape dismisses
  the toast (topmost-layer semantics); the dialog's Close button or a second Escape
  closes it — standard Radix layering, not a defect.
- **Layers rename** — role-based selectors confirm the panel + rows are a11y-named.
- **QA score**: 8.5/10 average across 13 key surfaces (see
  `research/canvix-v03-qa-scores.md`). Remaining VLM deductions are dominated by
  pixel-estimation noise (it reports the 72px rail as 56-64px and requests context
  toolbars in selection-free screenshots) and self-contradictory gradient direction
  notes across runs — the gradient was re-weighted purple→magenta dominant in
  response to the first run's "too blue" consensus.
- **Known dev-only artifact**: the Next.js 16 dev overlay badge shows "1 Issue" in
  `next dev` (its panel lists only Route/Bundler build info; zero page errors across
  every E2E run and the production build is clean) — not present in production.
