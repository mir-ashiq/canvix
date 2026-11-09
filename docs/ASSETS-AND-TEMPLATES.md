# Assets & Templates — the Wave 2 ecosystem

> Since v0.17.0. Covers the icon library, illustration packs, the font
> catalog, custom font upload, save-as-template, smart templates
> (fields + CSV + REST fill), server-side brand kits, and the preset
> catalog.

## Icon library

Two sources in the editor's **Apps → Icons**:

| Source | Count | Insert as | Notes |
|---|---|---|---|
| Offline pack | 562 | editable vector path (stroke) | bundled; recolour from the properties bar; works offline |
| Online (Iconify) | 200,000+ | image element | full colour fidelity for multi-colour sets |

The offline pack is extracted from the ISC-licensed
[lucide](https://lucide.dev) set at build time
(`scripts/gen-icon-pack.mjs`), flattened to single-path data in the
Canvix 100×100 path box. Regenerate with:

```bash
node scripts/gen-icon-pack.mjs
```

The online half proxies the free public
[api.iconify.design](https://api.iconify.design):

```
GET /api/icons?q=rocket          → { icons: ["mdi:rocket", …] }
GET /api/icons?svg=mdi:home&color=%23FF0000 → image/svg+xml
```

Strictly validated inputs (the reference feeds an upstream URL),
30 requests/min/IP, hard edge caching on svg fetches. Like the
`/api/fonts/ttf` Google-Fonts resolver it is an unauthenticated,
keyless passthrough to a public CDN — there is no admin kill-switch
because there is no credential or spend to guard. If you need it
fully offline, the offline pack is the answer; the online toggle
degrades gracefully (a notice, not an error).

## Illustration packs

48 original flat-art SVGs in six packs (business, people, nature,
tech, abstract, festive) — authored in-house from primitives
(`scripts/gen-illustrations.mjs`, clean-room). **Apps →
Illustrations**; search by name or tag, filter by pack, insert as an
image element. Works offline.

## Font catalog (369 families)

The catalog lives in `src/lib/fonts/catalog.ts`. The original 63
families preload with first paint (`app/layout.tsx` link); every
other family loads on demand (`lib/fonts/loader.ts`):

- `ensureFontLoaded(family)` — injects the Google Fonts css2 link once
- `ensureDocumentFonts(pages)` — scans a document's text elements
- `registerCustomFont({ family, url })` — FontFace from a media URL

Konva stages repaint when a font settles (the loader broadcasts
`canvix:fonts-loaded`; `CanvasStage` listens and batch-draws).

### Custom font upload

`POST /api/fonts/custom?family=My+Font&ext=ttf` with the raw font
bytes as the body (`.ttf` `.otf` `.woff` `.woff2`, ≤ 8 MB). Fonts are
stored in the `Media` table, attributed to the session account or the
anonymous browser cookie (same rules as uploads), and served through
the standard `/api/media/<id>` stream. `GET` lists the caller's
fonts, `DELETE ?id=` removes one. The font dropdown has an
**Upload a font** button; uploaded fonts appear under the `custom`
category pill.

> Vector-PDF export resolves Google Fonts through `/api/fonts/ttf`.
> Custom uploaded fonts fall back to the PDF standard-14 path in
> exported PDFs (screen, PNG, SVG and video exports render them
> faithfully) — a documented v1 approximation.

## Save as template

**File → Save as template…** in the editor persists the open document
to the `UserTemplate` table (50 per attribution). Templates panel →
**Your templates** lists them with apply/delete. Attribution mirrors
designs: account-owned, or claimed by the anonymous cookie that
created them.

## Smart templates — fields, CSV bulk fill, REST fill

Templates may declare fields (see
`src/lib/templates/collection-v17-fields.ts` for examples); text
elements carry `{{key}}` markers. One substitution engine
(`src/lib/templates/fields.ts`) drives three surfaces:

1. **Editor fill dialog** — applying a fielded template from the
   Templates panel opens a guided form (examples prefilled).
2. **Dashboard CSV bulk fill** — smart template cards show a **CSV**
   chip: upload or paste a CSV whose header row names the fields, see
   a parsed row/column preview, then generate up to 100 designs per
   batch.
3. **REST fill API** — for agents, MCP and scripts:

```bash
# render only (no auth needed for server-to-server callers)
curl -X POST https://your-canvix/api/templates/certificate-excellence/fill \
  -H 'content-type: application/json' \
  -d '{"values":{"recipient_name":"Ada Lovelace","date":"2026-11-09"}}'

# batch from CSV, persisting a design per row for the caller
curl -X POST 'https://your-canvix/api/templates/certificate-excellence/fill?persist=1' \
  -H 'content-type: text/csv' \
  --data-binary @recipients.csv
```

Body forms: JSON `{ values }` or `{ rows: [...] }` (≤ 100), raw
`text/csv`, or multipart with a `csv` file. `?persist=1` creates
designs attributed to the caller (session cookie or anon cookie —
`Set-Cookie` on the response). Browser cross-site calls are rejected
by CSRF; server-to-server calls (no Origin header) pass by design.
Unmatched markers stay visible in the render so mistakes are obvious.

## Server-side brand kits

`BrandKitRecord` rows (10 per attribution) with full CRUD at
`/api/brand-kits`. The editor Brand panel:

- loads kits on open (server wins over the localStorage cache),
- syncs the active kit debounced (800 ms) on every change,
- shows a kit selector with create/delete and a sync indicator,
- falls back to localStorage offline and re-syncs when reachable.

Validated server-side: 1–8 hex colours, ≤ 8 palettes × 8 colours,
≤ 8 logo image data-URLs (≤ 512 KB each), font family names ≤ 60 chars.

## Preset catalog (60 sizes)

`PRESET_GROUPS` in `lib/editor-utils.ts` — social media, video &
thumbnails, presentations & docs, print, and web & marketing sizes.
The dashboard's eight quick cards are unchanged; the ninth card
("More sizes") opens a searchable grouped browser. Custom sizes work
as before.

## Template library (366 designs)

122 hand-authored originals + 244 deterministic computed variants:
every design gets an **Aurora** colourway (hue-rotation with
saturation/lightness tuning; near-neutral colours barely move so
whites stay white) and an **Ink** typography swap (curated
same-category font table; colours untouched). Variants are generated
at module load (`lib/templates/variants.ts`) — the bundle ships only
the originals — and the DB seed materialises the same list with
stable slugs (`-aurora` / `-ink`), so re-seeding is idempotent.

After deploying v0.17.0, run the setup once to apply migration 0011
and refresh the library:

```bash
npm run db:setup   # migrate deploy + seed (366 templates)
```
