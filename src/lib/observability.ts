// ─────────────────────────────────────────────────────────────
// Observability floor (v0.12.5, roadmap H7 — research/V0118-
// ROADMAP-RESEARCH.md §5.1). Three opt-in, zero-dependency
// primitives for the self-hoster:
//
//   1. Structured request logging — CANVIX_LOG=requests turns every
//      API request into one JSON line on stdout (method, path,
//      status, duration). OFF by default: a design tool's server
//      logs are the self-hoster's to read, and silent-by-default
//      is the privacy-correct choice. Query strings are
//      deliberately NOT logged (they carry design ids and cursor
//      data); IPs are not logged either.
//   2. /api/health?v=2 — aggregate counts + a DB latency probe
//      (see src/app/api/health/route.ts). Counts only, never ids.
//   3. Error webhook — CANVIX_ERROR_WEBHOOK_URL receives a POST
//      for every unhandled request error (src/instrumentation.ts,
//      Next's onRequestError hook). Also off unless configured.
//
// Everything here is stdlib-only (console, fetch, Date) so it runs
// on every runtime Canvix supports — Node, Bun, workerd.
// ─────────────────────────────────────────────────────────────

import type { NextRequest } from 'next/server'

/** The app version answering requests — from package.json at build time. */
export const APP_VERSION = process.env.npm_package_version ?? 'unknown'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** One structured JSON line — machine-greppable, human-readable. */
export function logLine(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

// ── 1. request logging ────────────────────────────────────────

export function requestLoggingEnabled(): boolean {
  const value = process.env.CANVIX_LOG
  return value === 'requests' || value === '1' || value === 'true'
}

/** Path without the query string — privacy: ids and cursors stay out. */
function loggedPath(url: string): string {
  const q = url.indexOf('?')
  return q === -1 ? url : url.slice(0, q)
}

export interface ApiRequestLog {
  method: string
  path: string
  status: number
  durationMs: number
  requestId?: string
}

export function logApiRequest(entry: ApiRequestLog): void {
  logLine('info', 'http_request', {
    method: entry.method,
    path: loggedPath(entry.path),
    status: entry.status,
    duration_ms: Math.round(entry.durationMs * 100) / 100,
    ...(entry.requestId ? { request_id: entry.requestId } : {}),
  })
}

/**
 * Wrap an API route handler with opt-in request logging. Zero-cost
 * passthrough when CANVIX_LOG is unset (the default): the wrapper
 * checks once per call and never touches the response otherwise.
 * Never mutates the response — the handler's headers, streams and
 * status codes pass through untouched (the SSE route included).
 */
export function withLogging<A extends unknown[]>(
  name: string,
  handler: (req: NextRequest, ...args: A) => Promise<Response>,
): (req: NextRequest, ...args: A) => Promise<Response> {
  return async (req, ...args) => {
    if (!requestLoggingEnabled()) return handler(req, ...args)
    const start = now()
    try {
      const res = await handler(req, ...args)
      logApiRequest({
        method: req.method,
        path: new URL(req.url).pathname,
        status: res.status,
        durationMs: now() - start,
      })
      return res
    } catch (error) {
      logApiRequest({
        method: req.method,
        path: new URL(req.url).pathname,
        status: 500,
        durationMs: now() - start,
      })
      throw error
    }
  }
}

const now = (): number =>
  typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()

// ── 3. error webhook ──────────────────────────────────────────

export interface ErrorReport {
  message: string
  stackHead?: string
  path: string
  method: string
  routeType?: string
  appVersion: string
  at: string
}

/** Build the webhook payload — pure, unit-testable. */
export function buildErrorReport(
  error: unknown,
  request: { path: string; method: string },
  context?: { routeType?: string },
): ErrorReport {
  const err = error instanceof Error ? error : new Error(String(error))
  return {
    message: `${err.name}: ${err.message}`.slice(0, 500),
    stackHead: (err.stack ?? '').split('\n').slice(0, 6).join('\n').slice(0, 1000) || undefined,
    path: request.path.slice(0, 300),
    method: request.method,
    routeType: context?.routeType,
    appVersion: APP_VERSION,
    at: new Date().toISOString(),
  }
}

/**
 * Fire-and-forget POST of an error report to CANVIX_ERROR_WEBHOOK_URL.
 * Returns the fetch promise (callers may void it) — never throws:
 * a broken webhook must not take the error path down with it.
 */
export function postErrorWebhook(report: ErrorReport): Promise<void> {
  const url = process.env.CANVIX_ERROR_WEBHOOK_URL
  if (!url) return Promise.resolve()
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report),
    signal: AbortSignal.timeout(5_000),
  })
    .then(() => undefined)
    .catch((err) => {
      // the watcher cannot become the watched — log locally, move on
      logLine('warn', 'error_webhook_failed', { reason: String(err).slice(0, 200) })
    })
}

export function errorWebhookConfigured(): boolean {
  return Boolean(process.env.CANVIX_ERROR_WEBHOOK_URL)
}
