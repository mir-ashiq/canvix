import { PrismaD1 } from '@prisma/adapter-d1'
import { PrismaClient } from '@/generated/prisma/client'

/**
 * CLI/script Prisma client for D1.
 *
 * Runtime requests use env.DB directly. Operator scripts can target the
 * remote D1 database through Prisma's HTTP adapter using Cloudflare
 * credentials supplied in the shell environment.
 */
export function createScriptClient(_rawUrl?: string) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const databaseId = process.env.CLOUDFLARE_DATABASE_ID
  const token = process.env.CLOUDFLARE_D1_TOKEN

  if (!accountId || !databaseId || !token) {
    throw new Error(
      'CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DATABASE_ID and CLOUDFLARE_D1_TOKEN are required for D1 scripts.',
    )
  }

  const adapter = new PrismaD1({
    CLOUDFLARE_ACCOUNT_ID: accountId,
    CLOUDFLARE_DATABASE_ID: databaseId,
    CLOUDFLARE_D1_TOKEN: token,
  })

  return new PrismaClient({ adapter })
}
