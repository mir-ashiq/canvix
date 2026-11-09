// src/instrumentation.ts (v0.12.5, roadmap H7; v0.18 Wave 3 register)
// — Next's server lifecycle hooks, used for exactly two things:
//
//  1. onRequestError — the opt-in error webhook. When
//     CANVIX_ERROR_WEBHOOK_URL is unset (the default) this does
//     nothing beyond a structured local log line. See
//     src/lib/observability.ts for the payload contract.
//
//  2. register (v0.18) — the template-library top-up. "The template
//     library ships as code" (docs/UPGRADING.md), so on every boot
//     (nodejs runtime only) the built-in templates are reconciled
//     into the database: new ones appear, changed ones refresh,
//     nothing is ever deleted. A single COUNT is the normal-boot cost
//     — the upsert loop only runs when the library is short. Opt out
//     with CANVIX_TEMPLATE_SYNC=0 (operators who curate the library
//     by hand; npm run db:seed still works for them).
//
//     The v0.16.1 lesson applies in full: NOTHING Prisma-shaped may
//     be imported statically here — instrumentation is also compiled
//     for the edge runtime, and tracing Prisma into that bundle broke
//     `next build` (PR #39). The dynamic imports below happen inside
//     the nodejs branch only, after the NEXT_RUNTIME check.
import { buildErrorReport, logLine, postErrorWebhook } from './lib/observability'

export async function register(): Promise<void> {
  // edge/middleware compilations must not trace any of this
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // explicit operator opt-out (see the header note)
  if (process.env.CANVIX_TEMPLATE_SYNC === '0') return

  // fire-and-forget: a slow or failing database must never block or
  // crash the server boot — the next request health-checks it anyway
  void (async () => {
    try {
      const [{ db }, { syncTemplateLibrary }] = await Promise.all([
        import('./lib/db'),
        import('./lib/templates/sync'),
      ])
      const res = await syncTemplateLibrary(db)
      if (!res.skipped) {
        logLine('info', 'template_library_synced', {
          synced: res.synced,
          total: res.total,
          note: 'boot-time top-up: new built-in templates were added to the database',
        })
      }
    } catch (error) {
      logLine('error', 'template_library_sync_failed', {
        message: error instanceof Error ? error.message : String(error),
        note: 'non-fatal: the app serves with whatever the database already holds',
      })
    }
  })()
}

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
