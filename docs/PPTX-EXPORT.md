# PPTX export — operator guide & decision record (Wave 5, first slice)

The Export dialog's **PPTX** format turns a Canvix design into a real
PowerPoint file: an OOXML package (a zip) written entirely in the
browser, dependency-free, with native editable objects wherever the
format can express them.

This is the first slice of the audit's Wave 5 ("Export & Sharing
Professionalisation") and closes the presentation-story gap that was
left after speaker notes and presenter view shipped in v0.18/v0.19:
the deck you present in Canvix can now be handed to PowerPoint,
Keynote or Google Slides — speaker notes included.

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

**Text wrapping**: PowerPoint re-wraps text with its own engine, so
line breaks can differ slightly from the canvas (the box, size,
alignment and spacing carry over exactly). Fonts are referenced by
family — not embedded — so opening on a machine without the font
falls back to that viewer's substitution, the same posture as the
SVG export.

Animations, transitions and SFX do not carry into PPTX (v1) —
PowerPoint's animation model is declarative and different enough
that a faithful mapping is its own project; recorded here so nobody
has to rediscover it.

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
ppt/notesMasters/notesMaster1.xml (+ rels)      [when notes exist]
ppt/notesSlides/notesSlideN.xml (+ rels)        [per noted page]
```

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
  no-pages refusal.
- Conversion proof: the suite writes `/tmp/pptx-smoke.pptx`;
  `scripts/verify-pptx.sh` converts it with headless LibreOffice
  (`soffice --convert-to pdf`) and checks the rendered pixels —
  background, shapes and text must all appear. The same file opens
  in PowerPoint/Keynote/Google Slides (the LibreOffice Impress
  filter is the strictest widely-available parser).
- e2e (`tests/e2e/pptx-export.spec.ts`): export through the dialog,
  assert the download, crack the zip with Python's `zipfile`, assert
  the skeleton + the heading text as a native run.

## API surface

None — this is a client-side export (like PNG/PDF/SVG/GIF/video).
Nothing leaves the browser; no admin switches apply.
