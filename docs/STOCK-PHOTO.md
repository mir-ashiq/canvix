# Stock photo search — operator guide & decision record (v0.16.4 A4)

The Photos rail ships a bundled library (42 AI-generated photos)
that works with zero configuration. Its **search** section is
**provider-gated**: it answers only when the self-hoster
configures a key for at least one stock-photo provider, and says
so with an operator hint otherwise (the F2b fail-closed pattern).
No key = the bundled library keeps working, `POST
/api/stock-photo/search` answers `503 NO_PROVIDER`, and everything
else in the editor is untouched.

## Why photo search is NOT an AI feature (the A4 decision)

Until v0.16.4 photo search rode the AI provider table as its
fifth capability slot (`imageSearch`), calling an
`images/search` endpoint through the OpenAI-compatible SDK. That
was a mis-design, and the A3 incident proved it: **almost no
OpenAI-compatible vendor serves an `images/search` route**, so a
chat-only provider (or any standard provider) pinned to the slot
404s forever — "why is photo search broken" needed the A3 Logs
view to even diagnose. "Find me a photo of a coffee shop" is a
**library query against licensed stock catalogs**, not a
generative one:

- real photos with real licensing (free commercial use, creator
  attribution) — an AI "search" returns arbitrary web images with
  unknown rights (the old panel had to tell users "check photo
  licenses before commercial use");
- free quota, no AI billing — Pexels and Pixabay keys are free;
- the exact architecture already shipped for the Videos rail
  (v0.15 R6) — and **the same two keys activate both rails**.

The `imageSearch` slot is **retired**: the admin table has four
model slots (text / vision / image / imageEdit), the per-slot
probe and the Logs slot strip show four, and a stored table that
still carries an `imageSearch` slot entry is read fine — unknown
slot keys are dropped by validation on read and disappear on the
next save. No migration.

## Providers

| Provider | Console card | Env fallback | Where to get it | License |
|---|---|---|---|---|
| Pexels | Stock media → Pexels | `PEXELS_API_KEY` | https://www.pexels.com/api/ (free) | Pexels License |
| Pixabay | Stock media → Pixabay | `PIXABAY_API_KEY` | https://pixabay.com/api/docs/ (free) | Pixabay Content License |

**v0.16.5 (A5): the keys are managed in the admin console** — the
AI & models page's **Stock media** card (Pexels & Pixabay), with
write-only key fields, a per-provider Test button and a Clear
button, exactly like the AI providers above it. A stored console
key **wins over** the env var; clearing it falls back to the env
key when one is set. Zero console work still works:

```bash
# .env — either key activates photo search (and the Videos rail)
PEXELS_API_KEY=your-free-key
# PIXABAY_API_KEY=your-free-key
```

Optional base overrides exist for proxies and test rigs:
`PEXELS_API_BASE` (default `https://api.pexels.com`) and
`PIXABAY_API_BASE` (default `https://pixabay.com/api`) — the same
overrides the Videos rail uses.

Both connectors are plain REST/JSON over `fetch`. **Zero new
runtime dependencies** (the house rule).

## How an insert works (and what it costs you)

1. The panel searches **server-side** (your key never reaches the
   browser; responses are cached in memory for 24 h per instance —
   Pixabay's request, Pexels gets it for free).
2. Clicking a tile downloads the chosen rendition **in the
   browser** (both provider CDNs answer `Access-Control-Allow-Origin:
   *` on GET — verified empirically).
3. The file rides the **existing chunked media store**: your
   quota (`CANVIX_UPLOAD_QUOTA_MB`), the per-file cap, sha256
   dedupe and the library listing all apply as for any upload.
   Dimensions are probed from the actual bytes
   (`createImageBitmap`), so the element behaves exactly like an
   uploaded image.
4. The preferred rendition is the largest at most 1920 px wide
   (Pexels `large2x` / Pixabay `fullHDURL` — the design-tool sweet
   spot; multi-megabyte originals are never the primary). If the
   store's cap rejects it or a download fails, the panel retries
   the **next smaller rendition** — the ladder the search route
   returns.

## Attribution model (the R6 acceptance, applied to photos)

Every result carries a sanitized credit block
`{ provider, author, license, url }`:

- **visible at insert** — the success toast names the provider,
  creator and license;
- **durable** — stored on the element (`ImageElement.credit`),
  so it rides autosave, version history, collab replication and
  the offline merge like any element field;
- **visible on selection** — the properties bar shows a credit
  chip (license + source page in the tooltip);
- **never on the canvas or burned into exports** — a forced
  overlay would corrupt the design, and neither license demands
  on-content credit. The provider chip on every search tile keeps
  "show users where the content comes from" satisfied.

Credit fields are capped and cleaned at ingest
(`src/lib/stock-photo.ts`): control characters stripped, lengths
hard-capped, source URLs must be http(s) — a `javascript:` URL
can never become a credit link.

## Admin surface

- **The Stock media card (v0.16.5 A5)** on the AI & models page
  manages the two keys: write-only fields (stored keys echo as
  masks only), a per-provider **Test** button — one minimal
  one-result search through the provider's real endpoint, so a
  pass there is a pass in the Photos panel — and a per-provider
  Clear that restores the env fallback. Saving takes effect
  immediately, no redeploy (the key store rides `AppConfig` with
  the config module's 10 s in-process cache).
- The **AI & models** page shows four slots and a banner stating
  where photo search lives (the stock media card) and which keys
  are active — the operator is never sent hunting for a slot that
  no longer exists.
- The **photoSearch feature switch** still works: switched off,
  `/api/stock-photo/search` answers `503 FEATURE_DISABLED` — same
  semantics as every AI feature.
- `/api/ai/capabilities` reports `photoSearch` from the stock
  keys (not from an AI slot).
- Stock-photo searches are **not** AIUsage rows (they spend no AI
  provider quota); historical `search` rows from the retired slot
  keep rendering in the Logs view.

## Honest limits

- **CI never talks to a real provider.** The unit suite parses
  recorded response fixtures; the acceptance e2e
  (`playwright.stockvideo.config.ts` — the same provider-on suite
  as videos) runs against the local **mock provider**
  (`tests/stock-video/mock-provider.mjs`, which also serves the
  documented photo search shape) so the full search → download →
  upload → probe → credit path is exercised without spending
  quota. Live-provider drift is mitigated by defensive parsing
  (unknown keys ignored, every field validated), not by tests we
  can't run keyless.
- **The no-key states are covered by the default e2e suite**
  (`tests/e2e/stock-photo-gated.spec.ts`): availability false,
  503 NO_PROVIDER with the hint, the Photos rail intact.
- **MCP cannot rewrite credits** — attribution integrity: an
  agent may move or restyle a stock photo but not strip its
  credit.
- Provider search failures surface as a sanitized status-only
  message (`Pexels search failed (429).`) — provider bodies and
  URLs never reach the client because Pixabay's key rides the
  query string.
- **Rate limit:** 20 searches/min/IP (`stockphoto:search` bucket)
  — beyond any typing session (the panel debounces at 600 ms),
  far below scripted drain velocity.
