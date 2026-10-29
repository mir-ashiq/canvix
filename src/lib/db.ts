import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import { applyDatabaseUrlDefaults, driverConnectionString } from '@/lib/db-url'

// v0.8: Supabase-ready connection — see src/lib/db-url.ts. Patches the URL
// before the first client is constructed (sslmode / pgbouncer flags).
// (Still applied: `prisma migrate` / `db push` read this env var.)
applyDatabaseUrlDefaults()

// v0.9.3: rust-free Prisma client. The queryCompiler client has no native
// engine binary — it runs on Node, Bun AND Cloudflare Workers (workerd),
// and talks to Postgres through the real `pg` driver (node:net/node:tls
// sockets under workerd's nodejs_compat). One client, every runtime.
//
// Pool sizing: one connection per process/isolate. Serverless platforms
// spawn many isolates; the Supabase transaction pooler multiplexes them
// onto few real Postgres backends, and staying at max=1 per isolate keeps
// us far inside pooler client limits.

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createDb(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: driverConnectionString(process.env.DATABASE_URL),
    max: 1,
    // ── v0.10.1 pool hardening (production incident 2026-10-29) ──
    // Symptom: functions running to exactly their duration limit (30 s)
    // with requests never resolving. Cause: one stale pooled connection
    // (pooler idle-drop without a FIN) wedged the instance's single
    // connection — waiters queued forever because the pool had NO
    // acquisition timeout. Bounds now make every failure fast instead of
    // hanging: a timed-out request 502s, the v0.10 client retains + retries
    // it, and retries are idempotent (DesignEvent (designId, eventId)
    // unique). keepAlive lets the OS detect dead peers instead of parking
    // queries on them forever.
    connectionTimeoutMillis: 10_000, // pool-wait cap → error, never hang
    idleTimeoutMillis: 30_000, // drop idle conns before the pooler does it dirty
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  })
  return new PrismaClient({
    adapter,
    // v0.8: keep production logs quiet (query logging is a dev aid and a
    // performance tax on every request — Supabase poolers dislike noise).
    log:
      process.env.NODE_ENV === 'production'
        ? ['error']
        : ['query', 'error', 'warn'],
  })
}

export const db = globalForPrisma.prisma ?? createDb()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
