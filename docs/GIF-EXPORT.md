# GIF export — architecture & decision record (v0.15 R5)

Social-loop animated GIFs from any page range, rendered entirely in
the browser. This document is the dependency-decision record the
roadmap requires, in the same spirit as `docs/PDF-VECTOR-EXPORT.md`.

## The pipeline

```
page range (dialog) ──► buildTimeline ──► createRenderSession  ← the SAME
        │                                        │                session the
        │                                        │                video engines
        │              palette pass: 8 deterministic   │                use (R2/R3)
        │              timeline samples → median cut    │
        │              → 256 colours → 15-bit LUT       │
        ▼                                        ▼
  planGifFrames ──► per frame: prepareFrameAt(t) → renderFrameAt(t)
  (fail-closed:            → getImageData → nearest-LUT index
  refuses up front)        → optional Floyd–Steinberg dither
                           → GifWriter.addFrame (LZW, sub-blocks)
                           → byte-cap check EVERY frame
```

- **Deterministic pacing is inherited, not reimplemented**: every
  frame is rendered at `t = frame / fps` with no wall clock in the
  loop — the R2 contract. Autoplay videos sit at their exact source
  frame via the R3 `prepareFrameAt` seek scheduler.
- The palette is built from **8 deterministic timeline samples**
  (first, last, evenly between), stride-sampled to ≤ 400 000 pixels
  — the same design always produces the same palette.

## Dependency decisions (the record)

| Option | Verdict | Why |
| --- | --- | --- |
| **Hand-rolled GIF89a + LZW** (~500 lines across `src/lib/gif/`) | **CHOSEN** | The house rule: zero new dependencies when the format is small, stable, and well-specified (the R2 WebM-muxer and R4 TTF-subsetter precedent). GIF89a is frozen since 1989; the LZW variant is ~80 lines. Fully unit-testable against PIL-generated goldens. |
| `gif.js` (MIT, ~30 KB) | rejected | Adds a dependency for code we can own and verify; its worker-first API fights the shared render session; unmaintained upstream. |
| `gifenc` (MIT, ~10 KB) | rejected | Fast and nice, but still a dependency for ~500 ownable lines; pulls its own quantizer we would bypass anyway (our palette must match the OTHER exporters' colour story). |
| Server-side ffmpeg render | rejected | Violates the local-only export promise (`ShareDialog`: "no uploads, no server rendering"). |

## Colour

- **Global palette, not per-frame local tables.** Median cut over
  the timeline samples; each palette entry is the **most-popular
  colour of its box** (flat design fills pass through exactly, and
  no colour is invented the design never showed). Per-frame local
  tables were rejected: +768 bytes/frame and visible palette
  flicker on gradients.
- **15-bit nearest-colour LUT** (32 768 entries): built once per
  export, then every pixel costs one shift-mask-and-load. Distances
  are measured in the same 5-bit space pixels are reduced into, so
  palette colours map to their own bin.
- **Dithering is a user option** (default on): standard
  raster-order Floyd–Steinberg, error clamped into gamut before
  indexing. Off = nearest colour (smaller files, banding on
  gradients).

## Timing honesty

GIF delays are **centiseconds**. The offered rates map as
10 fps → 10 cs, 15 fps → 7 cs (14.29 effective), 20 fps → 5 cs.
Durations and progress are computed from the **actual** encoded
delays, never from the requested fps. Delays are floored at 2 cs
(browsers freeze GIFs with 0 cs delays).

## Caps (all enforced fail-closed)

| Cap | Value | Rationale |
| --- | --- | --- |
| Dimension | 480 / 720 / 1080 px longest edge | social-platform friendly sizes |
| Output bytes | 25 MB | the strictest common social limit (Discord free tier) — checked **during** the encode so an oversized export aborts early with advice |
| Frames | 1 800 | bounds memory/time on hostile decks (e.g. 180 s at 10 fps); refused **before** rendering in the dialog |

## Honest limits

- **GIFs are silent** — the format has no audio track. The dialog
  says so before you click.
- **No transparency** — the render canvas is opaque by design
  (every other exporter composites the page background too).
- **No frame-diff rect optimization yet** — every frame is a full
  image; LZW still compresses static regions hard. Disposal/restore
  rect diffing is a documented post-R5 evaluation (it is the classic
  source of GIF flicker bugs; the deterministic renderer makes it
  safe to add later).

## Testing

- **Unit** (`src/lib/gif/*.test.ts`, 47 tests): the LZW codec is
  validated against **PIL-generated golden streams** (a real-world
  encoder) and through an **independent in-test decoder**; the
  container writer is asserted byte-for-byte (header, LSD, GCT,
  NETSCAPE block, GCE delays, sub-block chunking, trailer) and
  walked back with a structural parser. The 4096-entry table
  exhaustion + clear-code reset is covered by a 40 000-pixel noise
  case.
- **The interlace lesson, on the record**: the first golden
  generation silently produced wrong vectors because PIL interlaces
  larger images by default and its own decoder de-interlaces
  invisibly — the comparison "passed" against transposed rows for
  row-uniform images and failed everywhere else. Golden generation
  now pins `interlace=False` explicitly. (The R4 lesson repeating:
  *run a real parser, and make sure the fixture tells the truth*.)
- **e2e** (`tests/e2e/gif-export.spec.ts`, anonymous zero-registration):
  structural parse + **ffprobe as the independent second opinion**
  (codec, dimensions, frame count, duration) — the same discipline
  as the WebM spec; no new CI dependencies (ffmpeg is already in
  the e2e job). Plus the page-range acceptance and the pre-flight
  cap refusal.
