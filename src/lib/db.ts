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
