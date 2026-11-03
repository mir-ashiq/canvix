// ─────────────────────────────────────────────────────────────
// First-party bundled plugins (P5, research/PLUGIN-SYSTEM.md §5).
//
// Canvix ships a small set of reference plugins in
// `public/plugins/<slug>/` — plain static files, versioned with the
// repo, installable through the SAME rail as any third-party
// plugin (validate → sha256-pin → consent → per-user rows). No
// separate code path, no extra trust: the only specialness is the
// reserved `com.canvix.*` id namespace, which the manifest
// validator grants exactly when the bundle comes from this
// instance's own `public/` directory.
//
// The install URL form is deliberately strict and RELATIVE:
//
//     /plugins/<slug>/manifest.json
//
// A relative URL is same-origin by construction (the browser can
// only resolve it against the app's own origin), so no Host-header
// comparison is needed to decide "first-party" — and the files are
// read from disk by the server, never fetched over the network,
// so the SSRF guard's (correct) loopback denial never bites. This
// module is CLIENT-SAFE (no node imports); the disk fetcher lives
// in firstparty-fetch.ts, imported only by the install route.
// ─────────────────────────────────────────────────────────────

/** One plugin bundled with this Canvix build. */
export interface BundledPlugin {
  /** directory under public/plugins/ — lowercase slug */
  slug: string
  /** the manifest's plugin id (reserved com.canvix.* namespace) */
  pluginId: string
  name: string
  description: string
}

/** The plugins shipped in this repository's public/plugins/. */
export const BUNDLED_PLUGINS: readonly BundledPlugin[] = [
  {
    slug: 'wordcloud',
    pluginId: 'com.canvix.wordcloud',
    name: 'Word Cloud',
    description: 'Turn any text into a seeded word-cloud graphic — bundled, zero network.',
  },
]

/** Install URL for a bundled plugin (the strict relative form). */
export function bundledManifestUrl(slug: string): string {
  return `/plugins/${slug}/manifest.json`
}

/** The strict shape a bundled install URL must have. */
const BUNDLED_URL_RE = /^\/plugins\/([a-z0-9][a-z0-9-]{0,40})\/manifest\.json$/

/**
 * True when `url` is the relative, same-origin-by-construction
 * install form of a plugin this build actually bundles.
 * Anything else — absolute URLs, other paths, traversal — is false.
 */
export function isBundledManifestUrl(url: string): boolean {
  if (typeof url !== 'string') return false
  const m = BUNDLED_URL_RE.exec(url)
  if (!m) return false
  return BUNDLED_PLUGINS.some((b) => b.slug === m[1])
}

/**
 * The synthetic absolute origin the disk fetcher serves bundled
 * files under. `collectBundle` requires an absolute http(s) URL and
 * resolves every declared file against it; the bundled branch
 * replaces the network hop entirely, so the host name is inert —
 * it just needs to be a syntactically valid, obviously-internal
 * origin that can never collide with a real one.
 */
export const BUNDLED_SYNTHETIC_ORIGIN = 'http://canvix.bundled.internal'

/** Absolute (synthetic) manifest URL for the bundled branch. */
export function bundledSyntheticUrl(slug: string): string {
  return `${BUNDLED_SYNTHETIC_ORIGIN}${bundledManifestUrl(slug)}`
}
