// ─────────────────────────────────────────────────────────────
// db-script — Prisma factory for Node-side scripts (v0.9.3)
//
// Used by prisma/seed.ts, scripts/db-check.ts, scripts/usage-
// forensics.ts and the embedded tsx probes in scripts/auth-e2e.sh.
// Deliberately imports everything RELATIVE (no '@/' alias) so plain
// `tsx` can run it without a bundler resolving tsconfig paths.
//
// Mirrors src/lib/db.ts: rust-free client + @prisma/adapter-pg, one
// pooled connection per process.
// ─────────────────────────────────────────────────────────────

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'
import { driverConnectionString, normalizeDatabaseUrl } from './db-url'

export function createScriptClient(rawUrl?: string): PrismaClient {
  // keep the env var normalized too — anything constructed later in the
  // same process (e.g. prisma CLI helpers) sees the Supabase-safe URL
  process.env.DATABASE_URL = normalizeDatabaseUrl(process.env.DATABASE_URL)
  const url = rawUrl ?? process.env.DATABASE_URL
  const adapter = new PrismaPg({
    connectionString: driverConnectionString(url),
    max: 1,
  })
  return new PrismaClient({ adapter, log: ['error'] })
}
