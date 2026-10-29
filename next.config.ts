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
};

export default nextConfig;
