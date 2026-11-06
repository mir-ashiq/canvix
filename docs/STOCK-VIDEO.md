# Stock video search — operator guide & decision record (v0.15 R6)

Canvix's Photos rail ships a bundled library that works with zero
configuration. The **Videos** rail is different by design: stock
*video* search is **provider-gated** — it appears only when the
self-hoster configures a key for at least one stock-video provider,
and hides itself entirely otherwise (the same fail-closed pattern
as the AI provider features; research §5.4 R6). No key = no rail
item, `POST /api/stock-video/search` answers `503 NO_PROVIDER`,
and everything else in the editor keeps working.

## Providers

| Provider | Env key | Where to get it | License |
|---|---|---|---|
| Pexels | `PEXELS_API_KEY` | https://www.pexels.com/api/ (free) | Pexels License |
| Pixabay | `PIXABAY_API_KEY` | https://pixabay.com/api/docs/ (free) | Pixabay Content License |

Optional base overrides exist for proxies and test rigs:
`PEXELS_API_BASE` (default `https://api.pexels.com`) and
`PIXABAY_API_BASE` (default `https://pixabay.com/api`).

```bash
# .env — either key activates the Videos rail
PEXELS_API_KEY=your-free-key
# PIXABAY_API_KEY=your-free-key
```

Both connectors are plain REST/JSON over `fetch`.

## How an insert works (and what it costs you)

1. The panel searches **server-side** (your key never reaches the
   browser; responses are cached in memory for 24 h per instance —
   Pixabay's request, Pexels gets it for free).
2. Clicking a tile downloads the chosen rendition **in the
   browser** (both provider CDNs answer `Access-Control-Allow-Origin:
   *` on GET — verified empirically, not assumed).
3. The file rides the **existing chunked media store**: your
   quota (`CANVIX_UPLOAD_QUOTA_MB`), the 32 MB per-file cap
   (`CANVIX_MAX_MEDIA_MB`), sha256 dedupe and the library listing
   all apply as for any upload.
4. The preferred rendition is the largest mp4 at most 1920 px
   wide. If the store's cap rejects it (413) or a download fails,
   the panel automatically retries the **next smaller rendition**
   — the ladder the search route returns.
5. The poster frame, duration and dimensions are probed from the
   actual bytes (the v0.11 upload path), so the element behaves
   exactly like an uploaded video — including R3's frame-accurate
   autoplay rendering in video/GIF exports.

## Attribution model (the R6 acceptance)

Every result carries a sanitized credit block
`{ provider, author, license, url }`:

- **visible at insert** — the success toast names the provider,
  creator and license;
- **durable** — stored on the element (`VideoElement.credit`), so
  it rides autosave, version history, collab replication and the
  offline merge like any element field;
- **visible on selection** — the properties bar shows a credit
  chip (license + source page in the tooltip);
- **never on the canvas or burned into exports** — a forced
  overlay would corrupt the design, and neither provider license
  demands on-content credit. Pixabay's "show users where the
  videos come from" request is satisfied by the provider chip on
  every search tile plus the durable credit.

Credit fields are capped and cleaned at ingest (`src/lib/stock-video.ts`):
control characters stripped, lengths hard-capped, source URLs must
be http(s) — a `javascript:` URL can never become a credit link.

## Dependency decisions (on record)

- **Zero new runtime dependencies.** Both providers are
  JSON-over-GET with one auth value; the connector, the sanitizer
  and the ladder are plain `fetch` + TypeScript. This follows the
  R2 WebM-muxer / R4 TTF-subsetter / R5 LZW house rule: no
  dependency for what ~400 honest lines can do.
- **Client-side download, not a server proxy.** The browser
  fetches the rendition (CDNs are CORS-open), so self-hoster
  bandwidth is one upload instead of download+upload. A server
  proxy remains the documented fallback if a provider ever ships
  a non-CORS CDN.
- **In-memory 24 h response cache, per instance.** Multi-instance
  fleets cache per instance (the rate-limit honesty note applies
  verbatim). Provider quota otherwise spends per search.
- **Rate limit:** 20 searches/min/IP (`stockvideo:search` bucket)
  — beyond any typing session (the panel debounces at 600 ms),
  far below scripted drain velocity.

## Honest limits

- **CI never talks to a real provider.** The unit suite parses
  recorded response fixtures; the acceptance e2e
  (`playwright.stockvideo.config.ts`) runs against a local **mock
  provider** (`tests/stock-video/mock-provider.mjs`) that serves
  real ffmpeg-generated renditions, so the full search → download
  → upload → probe → credit path is exercised without spending
  quota. Live-provider drift is mitigated by defensive parsing
  (unknown keys ignored, every field validated, `link`/`url`
  tolerated), not by tests we can't run keyless.
- **MCP cannot rewrite credits** — attribution integrity: an
  agent may move or trim a stock video but not strip its credit.
- Provider search failures surface as a sanitized status-only
  message (`Pexels search failed (429).`) — provider bodies and
  URLs never reach the client because Pixabay's key rides the
  query string.
