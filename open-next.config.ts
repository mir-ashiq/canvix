import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Canvix needs no optional Cloudflare bindings to run:
//   - no R2/KV incremental cache — every Canvix route is dynamic
//     (the v0.9.2 CDN headers on /api/templates are plain HTTP caching,
//     which Workers serves from the edge without a binding)
//   - no D1/Hyperdrive — Postgres goes straight to Supabase's
//     transaction pooler over node:net/node:tls (nodejs_compat)
//   - no Cloudflare Images binding — Canvix does not use next/image
//
// If you ever want ISR caching, add an R2 bucket and switch to
// r2IncrementalCache:
//   import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
//   export default defineCloudflareConfig({ incrementalCache: r2IncrementalCache });
export default defineCloudflareConfig();
