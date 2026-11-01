import type { NextConfig } from "next";

// ─────────────────────────────────────────────────────────────────
// Security headers + CSP baseline (v0.12.1, roadmap H3 — see
// research/V0118-ROADMAP-RESEARCH.md §5.1). One static source of
// truth in next.config: every deploy target (Vercel, Cloudflare
// Workers via OpenNext, Netlify, Node standalone) serves these on
// every route — pages and API handlers alike.
//
// CSP ships as Report-Only on purpose: it documents the policy the
// app needs today (Google Fonts, data:/blob: images, blob: workers)
// without risking a regression on a renderer we have not audited.
// Review the browser-console violation reports for ~a week, then
// flip to enforcement (README → “Security notes” has the path).
// The plugin serve route (v0.13, P1) will NOT use this baseline —
// it gets the strict per-manifest CSP drafted in
// src/lib/security/plugin-csp.ts.
// ─────────────────────────────────────────────────────────────────
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  // dev needs eval for HMR; wasm+blob workers are the background
  // remover; inline is Next's hydration scripts (nonce-based CSP is
  // the enforcement-time upgrade, tracked with P1)
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: blob: https://fonts.gstatic.com",
  // stock-photo providers may return remote URLs; data: covers AI
  // thumbnails, blob: covers canvas exports
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  // embed cards (YouTube, Maps, …) frame out over TLS; enforcement
  // will tighten this to the embed allowlist
  "frame-src https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Browsers ignore HSTS over plain HTTP, so self-hosters behind
  // http:// are unaffected by definition — the header only starts
  // counting once the host is served over TLS (reverse proxy,
  // platform, or tunnel).
  { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
  // Canvix uses none of these; explicitly off.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
];

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        // every route class — landing/editor pages, API routes, SSE
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
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
