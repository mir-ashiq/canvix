// ─────────────────────────────────────────────────────────────
// Plugin install pipeline — fetch, validate, pin (research §4.2).
//
//   submit → fetch → validate → consent → store
//            ^^^^^^^^^^^^^^^^^^ this module (pure, fetcher-injected,
//                               unit-testable with zero network)
//
// Every network hop goes through the existing safeFetch SSRF guard
// (denylist + DNS pinning + per-hop redirect revalidation). Caps per
// §4.7: 2 MB total bundle, ≤ 50 files (validator), 10 s per file.
// Each file is sha256-pinned at install; the runtime NEVER fetches
// again — a self-hoster's instance is fully offline post-install.
// ─────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto'
import { safeFetch } from '@/lib/mcp/ssrf-guard'
import {
  checkEntryHtml,
  validateManifest,
  type PluginManifest,
  type ValidateManifestOptions,
} from './manifest'

/** Total bundle size cap (§4.7). */
export const MAX_BUNDLE_BYTES = 2 * 1024 * 1024
/** Per-file fetch timeout. */
export const FILE_FETCH_TIMEOUT_MS = 10_000
/** Manifest fetch timeout. */
export const MANIFEST_FETCH_TIMEOUT_MS = 10_000
/** Max bytes for a single file (implied by total, but fail early). */
export const MAX_FILE_BYTES = MAX_BUNDLE_BYTES

export interface BundleAsset {
  path: string
  mime: string
  bytes: Uint8Array
  sha256: string
}

export interface InstalledBundle {
  manifest: PluginManifest
  networkOrigins: string[]
  assets: BundleAsset[]
  totalBytes: number
}

export type InstallError = { code: string; message: string }

/** Content types the serve route may emit (also the validator's extension list). */
export const ASSET_MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  woff2: 'font/woff2',
  map: 'application/json; charset=utf-8',
  ico: 'image/x-icon',
}

export function mimeForPath(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return Object.hasOwn(ASSET_MIME, ext) ? ASSET_MIME[ext] : null
}

/** Minimal Response-ish surface collectBundle needs from a fetcher. */
export interface FetchLike {
  (url: string, init?: { signal?: AbortSignal; redirect?: RequestRedirect }): Promise<{
    ok: boolean
    status: number
    arrayBuffer(): Promise<ArrayBuffer>
  }>
}

export interface CollectOptions extends ValidateManifestOptions {
  /** injectable transport — tests use this; default is safeFetch */
  fetcher?: FetchLike
  /** abort the whole install (user navigated away, request cancelled) */
  signal?: AbortSignal
}

function err(code: string, message: string): { ok: false; error: InstallError } {
  return { ok: false, error: { code, message } }
}

/** Resolve a bundle file path against the manifest URL (no traversal — path is pre-validated). */
export function assetUrl(manifestUrl: string, path: string): string {
  return new URL(path, manifestUrl).toString()
}

/**
 * Fetch and validate a whole plugin bundle from its manifest URL.
 * Returns the pinned assets ready for DB storage, or a typed error.
 */
export async function collectBundle(
  manifestUrl: string,
  opts: CollectOptions,
): Promise<{ ok: true; bundle: InstalledBundle } | { ok: false; error: InstallError }> {
  const doFetch: FetchLike = opts.fetcher ?? ((url, init) => safeFetch(url, init))

  let manifestHref: string
  try {
    manifestHref = new URL(manifestUrl).toString()
  } catch {
    return err('E_URL', 'manifestUrl must be an absolute http(s) URL')
  }
  if (!manifestHref.startsWith('https://') && !manifestHref.startsWith('http://')) {
    return err('E_URL', 'manifestUrl must be http(s)')
  }

  // 1. fetch the manifest
  let manifestRes: Awaited<ReturnType<FetchLike>>
  try {
    manifestRes = await doFetch(manifestHref, {
      signal: AbortSignal.any([AbortSignal.timeout(MANIFEST_FETCH_TIMEOUT_MS), ...(opts.signal ? [opts.signal] : [])]),
      redirect: 'follow',
    })
  } catch {
    return err('E_FETCH', 'could not fetch the manifest (timeout or network error)')
  }
  if (!manifestRes.ok) {
    return err('E_FETCH', `manifest fetch failed with HTTP ${manifestRes.status}`)
  }
  const manifestBuf = await manifestRes.arrayBuffer()
  if (manifestBuf.byteLength > 64 * 1024) {
    return err('E_PAYLOAD', 'manifest is larger than 64 KB')
  }
  let manifestJson: unknown
  try {
    manifestJson = JSON.parse(new TextDecoder().decode(manifestBuf))
  } catch {
    return err('E_MANIFEST', 'manifest is not valid JSON')
  }

  // 2. validate it (all §4.1 rules incl. the files list)
  const result = validateManifest(manifestJson, opts)
  if (!result.ok) {
    return err('E_MANIFEST', `manifest rejected: ${result.errors.join('; ')}`)
  }
  const { manifest, networkOrigins } = result

  // 3. fetch every declared file, cap + sha256 + package-check each
  const assets: BundleAsset[] = []
  let totalBytes = manifestBuf.byteLength
  for (const path of manifest.files) {
    if (opts.signal?.aborted) return err('E_ABORTED', 'install cancelled')
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await doFetch(assetUrl(manifestHref, path), {
        signal: AbortSignal.any([AbortSignal.timeout(FILE_FETCH_TIMEOUT_MS), ...(opts.signal ? [opts.signal] : [])]),
        redirect: 'follow',
      })
    } catch {
      return err('E_FETCH', `could not fetch "${path}" (timeout or network error)`)
    }
    if (!res.ok) {
      return err('E_FETCH', `file "${path}" fetch failed with HTTP ${res.status}`)
    }
    const buf = await res.arrayBuffer()
    if (buf.byteLength > MAX_FILE_BYTES) {
      return err('E_PAYLOAD', `file "${path}" is larger than ${Math.round(MAX_FILE_BYTES / 1024)} KB`)
    }
    totalBytes += buf.byteLength
    if (totalBytes > MAX_BUNDLE_BYTES) {
      return err('E_PAYLOAD', `bundle exceeds ${Math.round(MAX_BUNDLE_BYTES / 1024)} KB in total`)
    }
    const mime = mimeForPath(path)
    if (!mime) {
      return err('E_MANIFEST', `file "${path}" has an unsupported extension`)
    }
    const bytes = new Uint8Array(buf)
    // packaging rule on every html file (belt-and-braces for the CSP)
    if (path.endsWith('.html')) {
      const htmlErr = checkEntryHtml(new TextDecoder().decode(bytes))
      if (htmlErr) return err('E_MANIFEST', `"${path}": ${htmlErr}`)
    }
    assets.push({ path, mime, bytes, sha256: sha256Hex(bytes) })
  }

  return { ok: true, bundle: { manifest, networkOrigins, assets, totalBytes } }
}

/** sha256 hex digest of a byte array (the install-time integrity pin). */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
