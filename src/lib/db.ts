import { PrismaClient } from '@prisma/client'
import { applyDatabaseUrlDefaults } from '@/lib/db-url'

// v0.8: Supabase-ready connection — see src/lib/db-url.ts. Patches the URL
// before the first PrismaClient is constructed (sslmode / pgbouncer flags).
applyDatabaseUrlDefaults()

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // v0.8: keep production logs quiet (query logging is a dev aid and a
    // performance tax on every request — Supabase poolers dislike noise).
    log:
      process.env.NODE_ENV === 'production'
        ? ['error']
        : ['query', 'error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
