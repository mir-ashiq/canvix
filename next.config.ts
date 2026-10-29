import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    // v0.6.1: strict again — the codebase typechecks clean; keep it that way.
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  // v0.9.3: two trace pins for cross-runtime packages that Next's module
  // graph cannot see on its own:
  //   - sharp: loaded via a non-literal specifier in the MCP tools (that
  //     is what keeps it out of edge bundles) — pin it so self-hosted
  //     Node standalone deploys keep PNG export working.
  //   - pg-cloudflare: pg switches to it at RUNTIME when it detects
  //     workerd (navigator.userAgent check inside node_modules — invisible
  //     to Turbopack's tracing). Without the pin, the OpenNext worker
  //     bundle fails to resolve it at build time.
  outputFileTracingIncludes: {
    "/api/**": [
      "./node_modules/pg-cloudflare/**/*",
      // the generated Prisma client reads the query-compiler wasm from
      // disk at runtime (see scripts/patch-prisma-wasm.mjs) — pin the raw
      // file so self-hosted standalone deploys keep it available
      "./node_modules/@prisma/client/runtime/query_compiler_bg.postgresql.raw.wasm",
    ],
    "/api/mcp": ["./node_modules/sharp/**/*"],
  },
  // v0.9.4: the traced @prisma/client ships ~90 MB of wasm the patched
  // client provably never loads — in BOTH copies Next traces (the nft one
  // at node_modules/… and Turbopack's hashed copy under .next/node_modules/):
  //   - *wasm-base64*: base64-embedded compilers for every dialect; the
  //     patched loader (scripts/patch-prisma-wasm.mjs) only ever ESM-imports
  //     the raw .wasm (workerd) or reads it from disk (Node/Bun).
  //   - query_engine_bg*: the OLD library-engine wasm — dead with
  //     engineType = "client".
  //   - query_compiler_bg.{mysql,sqlite,sqlserver,cockroachdb}.*: other
  //     dialects' JS wrappers; the datasource is postgresql, fixed at
  //     generate time.
  // Netlify's function limit (50 MB zipped) made this visible; every
  // platform gets the smaller artifact. Keep the postgresql wrappers,
  // raw.wasm and wasm-module.mjs — those are live.
  outputFileTracingExcludes: {
    "/api/**": [
      "**/@prisma/client*/runtime/*wasm-base64*",
      "**/@prisma/client*/runtime/query_engine_bg*",
      "**/@prisma/client*/runtime/query_compiler_bg.{mysql,sqlite,sqlserver,cockroachdb}.*",
    ],
    "/api/mcp": [
      // sharp's non-linux binaries never load on any serverless host
      // (all linux-x64); keeps the standalone lean for every deploy.
      "./node_modules/@img/sharp-darwin-*",
      "./node_modules/@img/sharp-win32-*",
    ],
  },
};

export default nextConfig;
