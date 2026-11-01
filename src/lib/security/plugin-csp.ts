// ─────────────────────────────────────────────────────────────
// Per-manifest CSP for the plugin serve route — the DRAFT the
// v0.13 runtime core (roadmap P1, research/PLUGIN-SYSTEM.md §4
// threat “data exfiltration”) will attach to every response of
// /api/plugins/<id>/serve.
//
// This is deliberately NOT the app-wide report-only baseline in
// next.config.ts. Plugin documents are served by the HOST (same
// origin as the app) but run inside <iframe sandbox>, so their CSP
// must assume the document itself is untrusted:
//
//   default-src 'none'        — nothing is allowed unless granted
//   script-src 'self'         — the manifest's entry script, served
//                               by the host route (packaging rule:
//                               no inline <script>, enforced by the
//                               validator)
//   style-src 'unsafe-inline' — plugins style via DOM APIs; no
//                               external stylesheets, ever
//   img-src data: blob:       — generated art stays in the frame
//   connect-src <grants|none> — ONLY origins the user consented to,
//                               verbatim from the install screen
//   frame-ancestors 'self'    — only the Canvix app may embed it
//
// CSP governs fetch()/XHR/beacons/images in every mode, including
// no-cors — so an empty connect-src is a real exfiltration wall.
// The documented residual (self-navigation of the iframe) is why
// the consent screen, not the sandbox alone, is the trust gate.
// ─────────────────────────────────────────────────────────────

/** Origin a plugin was explicitly granted network access to. */
export type GrantedOrigin = string

/**
 * Validate a consent-granted connect-src origin.
 * Rules: absolute https: URLs only (plugins on localhost may use
 * http://127.0.0.1 for development builds), no wildcards, no
 * credentials, no fragments. Returns null when invalid.
 */
export function parseGrantedOrigin(raw: string): GrantedOrigin | null {
  const value = raw.trim()
  if (!value) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  const isDevLocal =
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  if (url.protocol !== 'https:' && !isDevLocal) return null
  if (url.username || url.password) return null
  if (url.hash) return null
  // canonical form so the header cannot be smuggled with padding
  return url.origin
}

/**
 * Build the strict serve-route CSP for one installed plugin.
 * `grantedConnectOrigins` comes verbatim from the consent screen —
 * an empty list means the plugin has zero network permissions and
 * connect-src collapses to 'none'.
 */
export function pluginServeCsp(
  grantedConnectOrigins: readonly string[],
): string {
  const origins: string[] = []
  for (const raw of grantedConnectOrigins) {
    const origin = parseGrantedOrigin(raw)
    if (origin && !origins.includes(origin)) origins.push(origin)
  }
  const connectSrc = origins.length ? origins.join(' ') : "'none'"
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    `connect-src ${connectSrc}`,
    'font-src data:',
    "frame-ancestors 'self'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ')
}
