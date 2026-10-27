// ─────────────────────────────────────────────────────────────
// db-errors — turn Prisma errors into actionable API payloads.
//
// v0.8: after moving the database (e.g. Neon → Supabase) the classic
// failure is a 500 with no explanation and a bare "Could not open
// template" toast. These helpers classify the Prisma error code and
// return a `code` the UI can translate into a real instruction.
// ─────────────────────────────────────────────────────────────
import { NextResponse } from 'next/server'

export interface DbErrorPayload {
  error: string
  code:
    | 'DB_NOT_MIGRATED' // tables missing → npm run db:setup
    | 'DB_UNREACHABLE' // bad URL / network / password
    | 'DB_TIMEOUT' // serverless cold start or pooler stall
    | 'DB_UNKNOWN'
  fix?: string
}

const FRIENDLY: Record<DbErrorPayload['code'], { error: string; fix: string }> = {
  DB_NOT_MIGRATED: {
    error: 'Database is not set up on this host',
    fix: 'Run  npm run db:setup  (migrations + template seed).',
  },
  DB_UNREACHABLE: {
    error: 'Cannot reach the database',
    fix: 'Check DATABASE_URL, password and network. See /api/health for details.',
  },
  DB_TIMEOUT: {
    error: 'Database timed out',
    fix: 'The host may be waking up (serverless pause) — retry, or see /api/health.',
  },
  DB_UNKNOWN: {
    error: 'Database error',
    fix: 'See /api/health for a full diagnosis.',
  },
}

/** Map a thrown Prisma (or raw pg) error to a stable code. */
export function classifyDbError(error: unknown): DbErrorPayload['code'] {
  const e = error as { code?: string; message?: string }
  const code = e?.code ?? ''
  const message = e?.message ?? ''

  // P2021 table does not exist / P2022 column does not exist / P2025 record not found on bootstrap
  if (code === 'P2021' || code === 'P2022' || /does not exist/i.test(message)) return 'DB_NOT_MIGRATED'
  // P1001 can't reach / P1002 timed out connecting / P1000 auth failed
  if (code === 'P1001') return 'DB_UNREACHABLE'
  if (code === 'P1002') return 'DB_TIMEOUT'
  if (code === 'P1000' || /password authentication failed/i.test(message)) return 'DB_UNREACHABLE'
  if (/prepared statement .* does not exist/i.test(message) || code === 'P2023') return 'DB_UNREACHABLE'
  if (/timed out|timeout|ETIMEDOUT/i.test(message)) return 'DB_TIMEOUT'
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET/i.test(message)) return 'DB_UNREACHABLE'
  return 'DB_UNKNOWN'
}

/** Build a 500 response that actually tells the user what to do next. */
export function dbErrorResponse(error: unknown, route: string): NextResponse {
  const code = classifyDbError(error)
  const friendly = FRIENDLY[code]
  console.error(`${route} failed [${code}]`, error)
  return NextResponse.json(
    { error: friendly.error, code, fix: friendly.fix } satisfies DbErrorPayload,
    { status: 500 }
  )
}
