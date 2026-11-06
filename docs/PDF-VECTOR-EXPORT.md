# Vector-text PDF export (v0.15 R4)

How the PDF exporter works, and — because this slice's brief
explicitly asked for it — the **dependency decisions on record**:
what was added, what was reused, what was rejected, and why.

## What ships

PDF export emits **real text**: `BT … Tf … TJ … ET` operators with
embedded subset TrueType fonts (`Type0` / `CIDFontType2` +
`FontFile2` + `/W` widths + a `ToUnicode` CMap), so exported text is
selectable, searchable and copy-pastable in every standards-compliant
viewer. Shapes, lines, freehand strokes, tables, charts, embeds and
frames map to vector path/shading operators; photos ride through as
their original JPEG bytes (`DCTDecode`); anything the vector path
cannot express is rasterized **per element** — never per page — by
the same Konva compositor the video export uses.

The text geometry is the shared one: `layoutRichLines`
(`src/lib/rich-text.ts`) positions every run, baselines use Konva's
exact formula (`(ascent − descent)/2 + lineHeight/2` from measured
'M' metrics), and underline/strike use Konva's exact geometry
(`baseline ± fontSize/4`, thickness `fontSize/15`). Per-glyph
positions come from the same canvas measurements the editor wraps
with (chunked prefix measurement — exact at chunk boundaries,
kerning drift distributed inside), emitted as `TJ` adjustment
numbers, so glyph placement matches the canvas to the pixel.

## The font ladder (fail-closed)

For every `(family, bold, italic)` a document's text needs:

1. **Embed the real font.** The app already renders with Google
   Fonts, but the browser holds those as woff2 and PDF `FontFile2`
   requires TrueType. `/api/fonts/ttf` performs the css2 lookup
   **server-side with a legacy Android 2.2 User-Agent** — the one
   negotiation that returns `.ttf format('truetype')` faces — and
   hands back the `fonts.gstatic.com` URL, which serves
   `access-control-allow-origin: *`, so the client downloads the
   bytes directly (no font bandwidth crosses the Worker). Weights
   snap to each family's available list (Montserrat has no 400,
   Abril Fatface has no 700). Variable families arrive as
   per-weight static instances (verified for Inter).
2. **Subset before embedding** (`src/lib/pdf/ttf.ts`): used glyphs
   only (composite components pulled in transitively, their
   references rewritten), re-indexed format-4 cmap, rebuilt
   hmtx/loca/maxp, long loca, correct table checksums. A typical
   page's fonts embed in a few KB.
3. **Fall back to standard-14** (PDF's built-in
   Helvetica/Times/Courier + WinAnsi) whenever any step fails —
   offline, Google unreachable, css2 rejects the combination. The
   text stays real and extractable; per-family fallbacks are
   documented below. Runs are then laid out by the viewer's own
   metrics (spacing may drift slightly from the canvas — the
   documented degradation).
4. **Coverage gate:** if a run's codepoints are under 75% mapped in
   the subset (e.g. CJK text in Poppins), the whole element
   rasterizes instead of shipping tofu boxes.

| App category | Standard-14 fallback |
|---|---|
| sans (Inter, Poppins, … 18 families) | Helvetica |
| serif (Playfair Display, Lora, … 14) | Times |
| mono (DM Mono, JetBrains Mono, Space Mono) | Courier |
| display (Anton, Bungee, … 14) | Helvetica *(no std-14 equivalent — documented degradation)* |
| handwriting (Pacifico, Caveat, … 14) | Helvetica *(same)* |

## Raster-strip fallbacks (documented, per element)

Stickers/emoji (color-emoji fonts), plugin renders, filtered
images, drop shadows, curved text, text effects (shadow/lift/echo/
splice), gradient-filled text, and authored-path shapes with
gradient fills render as pixel-perfect strips via the video-export
compositor (`buildKonvaNode`) — the page keeps every other element
vector. Audio/video elements are omitted, exactly as the SVG export
omits them. Text without a collected face (should not happen — the
collect pass walks every element) degrades silently behind the same
strip rule.

## Dependency decisions (the record)

| Decision | Choice | Why |
|---|---|---|
| PDF container | **hand-rolled** `src/lib/pdf/pdf-writer.ts` (~250 lines) | We need per-glyph `TJ` positioning, `Type0`/`CIDToGIDMap` dictionaries and raw stream control no PDF library exposes cleanly; the writer is xref-exact and re-parsed by an independent test parser (the R2 mini-muxer pattern). Content streams stay **uncompressed** — text/path ops are a few KB and images carry their own entropy coding, so Flate would add machinery for marginal gain. |
| jsPDF | **removed** (was `^4.2.1`) | It only ever rasterized pages (`addImage` JPEG). The new engine does that job in ~40 lines plus real text; one PDF codepath instead of two, ~350 KB less dynamic-import payload. Net dependencies: **−1**. |
| Font subsetting | **hand-rolled** `src/lib/pdf/ttf.ts` (~700 lines) | `fontkit`/`opentype.js` each pull 10× the code we need and don't emit subset fonts in a browser-friendly shape; the subsetter is pure TS, byte-verified against real Google-served fonts, and cross-checked by fontTools on dev machines. |
| TTF acquisition | **own API route + Google css2 legacy-UA negotiation** | Zero client-side format conversion (no woff2→ttf, no brotli dependency — `DecompressionStream` has no brotli); the app already depends on fonts.googleapis.com for rendering, so this adds no new external dependency, just a different negotiation of the same CDN. |
| PNG/alpha images | **`CompressionStream('deflate')`** | Platform zlib for `FlateDecode` planes + `/SMask`; zero dependencies, works in every browser we support and in Node tests. |
| SVG→PDF conversion (svg2pdf.js etc.) | **rejected** | We map the element model directly (the SVG serializer's geometry decisions, one-for-one); an SVG-string parser would be a second, weaker source of truth. |

**Runtime dependencies added: 0. Removed: 1 (jspdf).**

## Files

- `src/lib/pdf/pdf-writer.ts` — object model, xref, JPEG probe, colour helpers
- `src/lib/pdf/ttf.ts` — TrueType parser + glyph subsetter
- `src/lib/pdf/fonts.ts` — acquisition ladder + standard-14 fallback table
- `src/app/api/fonts/ttf/route.ts` — legacy-UA css2 → gstatic TTF URL resolver
- `src/lib/pdf/text-ops.ts` — face collection, font registry, run drawing
- `src/lib/pdf/image-embed.ts` — JPEG passthrough, Flate/SMask embedding
- `src/lib/pdf/vector-page.ts` — element → operator mappers + raster strips
- `src/lib/pdf-export.ts` — orchestrator + download
- `tests/fixtures/fonts/` — real Google-served TTFs (SIL OFL, see
  `OFL-LICENSE.txt`) built by `scripts/` tooling from the same css2
  path production uses

## Known limits (honest list)

- Gradient fills on text elements and authored paths render with the
  flat fallback colour (v1; shapes and page backgrounds do get real
  axial/radial shadings).
- Rich-text links are styled (as in SVG export) but not clickable
  annotations yet.
- Embed host labels render full-opacity white in the std14 path
  (alpha is approximated).
- Audio/video elements are omitted (SVG-export parity).
