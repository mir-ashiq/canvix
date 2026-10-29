// ─────────────────────────────────────────────────────────────
// runtime — which server runtime is this code executing on?
//
// Canvix deploys to three kinds of runtimes today:
//   - Node / Bun  (Vercel Node functions, self-hosted `next start`
//                  / standalone server.js, `npm run dev`)
//   - workerd     (Cloudflare Workers, via @opennextjs/cloudflare)
//
// A handful of modules need to know (MCP SSRF pinning, the sharp
// rasterizer, connection tuning) because workerd supports the
// nodejs_compat shim — node:crypto, node:net, node:http… — but NOT
// everything (no real fs, no node:dns resolver, no native modules).
//
// Detection notes:
//   - workerd exposes `navigator.userAgent === 'Cloudflare-Workers'`
//     (documented detection method). It ALSO fakes process.versions.node
//     under nodejs_compat, so the workerd check MUST run first.
//   - Bun sets process.versions.bun.
// ─────────────────────────────────────────────────────────────

export type ServerRuntime = 'node' | 'workerd' | 'bun' | 'unknown'

/** True when running inside Cloudflare Workers (workerd). */
export function isWorkersRuntime(): boolean {
  // NB: `navigator` is also defined on Node >= 21 — hence the explicit
  // userAgent probe rather than a typeof check.
  const nav = (globalThis as { navigator?: { userAgent?: string } }).navigator
  return typeof nav?.userAgent === 'string' && nav.userAgent.includes('Cloudflare-Workers')
}

/** Full runtime descriptor — memoized (the probes are cheap but pointless to repeat). */
let cached: ServerRuntime | undefined

export function detectServerRuntime(): ServerRuntime {
  if (cached) return cached
  if (isWorkersRuntime()) {
    cached = 'workerd'
  } else if (typeof process !== 'undefined' && process.versions) {
    if (typeof process.versions.bun === 'string') cached = 'bun'
    else if (typeof process.versions.node === 'string') cached = 'node'
    else cached = 'unknown'
  } else {
    cached = 'unknown'
  }
  return cached
}
