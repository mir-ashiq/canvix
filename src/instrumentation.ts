// src/instrumentation.ts (v0.12.5, roadmap H7) — Next's server
// lifecycle hooks, used for exactly one thing: the opt-in error
// webhook. `onRequestError` fires for every UNHANDLED error across
// pages, route handlers, server actions and middleware — Next's
// own route-catch — so one file instruments the whole app.
//
// When CANVIX_ERROR_WEBHOOK_URL is unset (the default) this file
// does nothing beyond a structured local log line. See
// src/lib/observability.ts for the payload contract.
import { buildErrorReport, logLine, postErrorWebhook } from './lib/observability'

export async function onRequestError(
  error: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routePath: string; routeType: string },
): Promise<void> {
  const report = buildErrorReport(error, request, context)
  logLine('error', 'unhandled_request_error', {
    message: report.message,
    path: report.path,
    method: report.method,
    route_type: report.routeType,
    route_path: context.routePath,
    app_version: report.appVersion,
  })
  await postErrorWebhook(report)
}
