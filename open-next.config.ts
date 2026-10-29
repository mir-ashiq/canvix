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
//
// v0.11.2: `buildCommand` breaks a recursion. `opennextjs-cloudflare
// build` builds the Next.js app by spawning the project's own
// `npm run build` (its default buildCommand). Since scripts/build.mjs
// routes `npm run build` to `opennextjs-cloudflare build` inside
// Cloudflare Workers Builds (WORKERS_CI=1), the default would recurse
// forever: build → opennext build → npm run build → opennext build → …
// Spawning `next build` directly is equivalent (the env-var standalone
// mode OpenNext sets still applies) and terminates. This also makes the
// manual `npm run preview` / `deploy` / `upload` scripts leaner — they
// no longer re-run the standalone copy steps inside the spawned build.
const config = {
  ...defineCloudflareConfig(),
  buildCommand: "next build",
};

export default config;
