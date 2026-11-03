// ─────────────────────────────────────────────────────────────
// Disk fetcher for bundled plugins (P5) — the server half of
// firstparty.ts. Imported ONLY by the install route (and its
// tests): it touches node:fs, so it must never enter a client
// bundle. It is loaded lazily (dynamic import at the call site),
// keeping runtimes without a filesystem (Cloudflare Workers)
// able to serve every other plugin route unaffected — a bundled
// install there fails with the honest error instead.
//
// Security posture: the fetcher answers exactly the FetchLike
// surface collectBundle needs, and it reads only from
// `public/plugins/**` — the same bytes the static file server
// already publishes to the world. Path containment is enforced
// segment-by-segment (no '..', '.', empty, backslash or NUL
// segments), and the URL constructor has already percent-decoded,
// so encoded traversal cannot smuggle through.
// ─────────────────────────────────────────────────────────────

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { FetchLike } from './install'

function notFound(url: string): { ok: false; status: number; arrayBuffer(): Promise<ArrayBuffer> } {
  return {
    ok: false,
    status: 404,
    arrayBuffer: async () => {
      throw new Error(`bundled file not found: ${url}`)
    },
  }
}

/**
 * Build the filesystem-backed fetcher for the bundled-plugin
 * install branch. `cwd` is injectable for tests; production reads
 * against process.cwd() (Next serves public/ from the repo root —
 * standalone output copies it alongside the server).
 */
export function createBundledFetcher(cwd: string = process.cwd()): FetchLike {
  return async (url) => {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      return notFound(url)
    }
    const pathname = u.pathname
    if (!pathname.startsWith('/plugins/')) return notFound(url)

    // segment-wise containment: the URL constructor decoded %XX,
    // so checking the decoded segments closes encoded traversal
    const segments = pathname.slice(1).split('/')
    if (
      segments.length < 3 ||
      segments.some(
        (s) =>
          s === '' ||
          s === '.' ||
          s === '..' ||
          s.includes('\\') ||
          s.includes('\0') ||
          !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s),
      )
    ) {
      return notFound(url)
    }

    const fsPath = path.join(cwd, 'public', ...segments)
    try {
      const bytes = await readFile(fsPath)
      const ab = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer
      return { ok: true, status: 200, arrayBuffer: async () => ab }
    } catch {
      return notFound(url)
    }
  }
}
