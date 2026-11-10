# PPTX export — operator guide & decision record (Wave 5 + the v0.22 limits wave)

The Export dialog's **PPTX** format turns a Canvix design into a real
PowerPoint file: an OOXML package (a zip) written entirely in the
browser, dependency-free, with native editable objects wherever the
format can express them.

This is the first slice of the audit's Wave 5 ("Export & Sharing
Professionalisation") and closes the presentation-story gap that was
left after speaker notes and presenter view shipped in v0.18/v0.19:
the deck you present in Canvix can now be handed to PowerPoint,
Keynote or Google Slides — speaker notes included.

**v0.22** closes the three honest-limits gaps this guide used to
carry: fonts now **embed** as `fntdata`, page **transitions** and
entrance **animations** ride the file's own timing model, and the
page's **SFX** wire into the transition sound slot. The remaining
limits are re-listed below.

## What exports natively (editable in PowerPoint)

| Canvix element | PPTX mapping |
|---|---|
| Text (headings, body, rich-text runs) | `p:sp` with `txBody` — paragraphs, bold/italic/underline/strike, colours, alignment, line height, letter spacing, bullet/numbered lists, RTL direction, auto-fit shrink (`normAutofit`) |
| Rect / rounded rect / ellipse / triangle | preset geometry (`rect`, `roundRect` with adj, `ellipse`, `triangle`) |
| Star / polygon | `custGeom` built from the **same `lib/shapes.ts` geometry** the canvas, SVG, PDF and video renderers use |
| Lines | `line` preset with dash + arrowheads (`headEnd`/`tailEnd`) |
| Images | embedded PNG (JPEG passes through byte-identical), corner radius, flips, opacity (`alphaModFix`) |
| Emoji stickers | text runs (Segoe UI Emoji) |
| Fills & effects | solid + linear/radial gradients, strokes, element opacity, soft outer shadows |
| Page background | solid / gradient `p:bg` |
| **Speaker notes** | native notes slides (+ the notes master) — the presenter story continues in the file |
| **Transitions** (v0.22) | `p:transition` — fade native, slide directional `p:push`, morph → fade (below) |
| **Entrance animations** (v0.22) | `p:timing` tree — one click group, first element `clickEffect`, the rest `withEffect` at their delays |
| **Transition SFX** (v0.22) | the page's SFX embedded as `media/sfxN.wav`, wired via `p:sndAc`/`p:stSnd` |
| **Fonts** (v0.22) | document text faces resolved through the PDF exporter's font ladder, embedded as `fonts/fontN.fntdata` + `embeddedFontLst` |

Rotation is mapped with an origin re-base: Canvix rotates most
element types around the box **top-left** (Konva semantics) while
OOXML always rotates around the **centre** — the mapper computes
where the centre lands and places the shape accordingly, so rotated
boxes land pixel-identically. Ellipse/star/polygon already rotate
around their centre in Canvix and map directly.

Per-page size overrides (v0.18) letterbox onto the deck size — the
same fit-and-centre treatment the video export applies, with font
sizes, strokes, radii and shadows scaled to match.

## What exports as a snapshot (the honest limits)

These ride the per-element raster fallback (the PDF vector export's
`rasterStrip` pattern — offscreen Konva render at the chosen detail
level, embedded as PNG):

- charts, tables, embeds (YouTube/map/link), frames, plugin elements
- audio waveform cards and video poster cards
- freehand strokes and authored `path` shapes
- curved text, text with effects/backgrounds, shadowed text
- masked or filtered images

**Text re-wrap safety**: PowerPoint's line engine wraps slightly
differently than the browser's, so line breaks can differ (the box,
size, alignment and spacing carry over exactly). Every text body now
carries a bare `normAutofit` — when PowerPoint's re-wrap overflows
the shape it **shrinks the text** instead of spilling it out; when
our engine already auto-fit the text, the measured `fontScale` rides
along so PowerPoint starts where we left off.

**Fonts** embed through the same ladder the PDF exporter uses
(`resolveFontFaces`): embedded fonts ride as `fntdata` parts listed in
`embeddedFontLst`. The ladder can fail (offline, std-14 fallbacks,
hostile documents) — then the file still references the typefaces by
family and the viewer substitutes, the pre-v0.22 behaviour. A
`fontsEmbedded: 0` in the export result is the honest signal.

### Animations & transitions — the honest mapping (v0.22)

Our present-mode semantics (one advance, then the sequence plays
itself) maps to **one click group**: the first animated element is
the `clickEffect`, the rest fire `withEffect` at their own delays.

| Canvix | PPTX | Notes |
|---|---|---|
| fade / rise entrance | Fade entrance (`presetID 10`) | native |
| pan / wipe entrance | Wipe entrance (`presetID 22`), directional filter | native |
| zoom / pop entrance | Fade entrance | approximation — hand-built Zoom (`anim-scale`) trees make PowerPoint repair-prompt |
| rotate / breathe (emphasis/loops) | **dropped** | PowerPoint emphasis is a different model; documented, not silently mangled |
| slide transition (directional) | `p:push dir` | native |
| fade transition | `p:fade` | native |
| morph transition | `p:fade` | nearest universal — PowerPoint's own Morph needs object-matching extensions |
| page SFX | transition sound (`p:sndAc`) | the offline SFX pack's wav bytes, fetched once per id |

## The package

Written by `src/lib/pptx/zip-writer.ts` (hand-rolled OPC/ZIP: CRC-32,
stored + raw-deflated entries through the platform
`CompressionStream` — zero new dependencies, the house rule) and
assembled by `src/lib/pptx-export.ts`:

```
[Content_Types].xml  _rels/.rels  docProps/{core,app}.xml
ppt/presentation.xml (+ rels)     ppt/theme/theme1.xml
ppt/slideMasters/slideMaster1.xml (+ rels)
ppt/slideLayouts/slideLayout1.xml (+ rels)
ppt/slides/slideN.xml (+ rels)    ppt/media/imageN.png
ppt/media/sfxN.wav                [per distinct SFX id]
ppt/fonts/fontN.fntdata           [per embedded face, v0.22]
ppt/notesMasters/notesMaster1.xml (+ rels)      [when notes exist]
ppt/notesSlides/notesSlideN.xml (+ rels)        [per noted page]
```

Media parts live under `ppt/media/` (the slide rels' `../media/…`
targets resolve there — v0.22 fixed a placement bug that left parts
at the package root as broken refs). Slide rels share one id
namespace across images and sounds (rId1 is always the layout).

Slides are 96-dpi px → EMU (`px × 9525`); font sizes px → pt
(`× 0.75`), `sz` in 1/100 pt.

## Verification

- Unit (`src/lib/pptx/zip-writer.test.ts`, `pptx-export.test.ts`):
  CRC-32 known vectors; an **independent zip reader** re-parses
  every archive (EOCD → central directory → local entries →
  `DecompressionStream`); the package test asserts the full part
  list, content-type coverage, rels resolution, EMU sizes, XML
  escaping (hostile text), the rotation-origin re-base numerically,
  per-page letterboxing, node-mode raster skipping and the
  no-pages refusal. v0.22 adds: normAutofit presence, transition
  XML (fade/slide/none + schema position), the timing tree (click
  group, delays, wipe filters, rotate dropped honestly), SFX
  embedding (audio rel, wav content-type, bytes in the package),
  and media-part placement under `ppt/media/`.
- Conversion proof: the suite writes `/tmp/pptx-smoke.pptx`;
  `scripts/verify-pptx.sh` converts it with headless LibreOffice
  (`soffice --convert-to pdf`) and checks the rendered pixels —
  background, shapes and text must all appear. The same file opens
  in PowerPoint/Keynote/Google Slides (the LibreOffice Impress
  filter is the strictest widely-available parser). A malformed
  timing tree would repair-prompt instead of converting.
- e2e (`tests/e2e/pptx-export.spec.ts`): export through the dialog,
  assert the download, crack the zip with Python's `zipfile`, assert
  the skeleton + the heading text as a native run. The v0.22 case
  asserts transition + timing + `embeddedFontLst` + `fntdata` parts
  + media placement, then does the LibreOffice round-trip.

## API surface

None — this is a client-side export (like PNG/PDF/SVG/GIF/video).
Nothing leaves the browser; no admin switches apply.
