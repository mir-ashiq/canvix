import { PrismaD1 } from '@prisma/adapter-d1'
import { PrismaClient } from '@/generated/prisma/client'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { cache } from 'react'

/**
 * Cloudflare D1 Prisma client.
 *
 * D1 is a Worker binding, so it must be resolved from the request's
 * Cloudflare context rather than process.env. A request-scoped client
 * avoids sharing a connection/client between Worker requests.
 */
export const getDb = cache(() => {
  const { env } = getCloudflareContext()
  const adapter = new PrismaD1(env.DB)
  return new PrismaClient({ adapter })
})

export const getDbAsync = async () => {
  const { env } = await getCloudflareContext({ async: true })
  const adapter = new PrismaD1(env.DB)
  return new PrismaClient({ adapter })
}

/**
 * Compatibility facade so the existing application can keep using
 * db.user..., db.design..., etc. during the D1 migration.
 */
export const db = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getDb()
    const value = Reflect.get(client as object, property, client as object)
    return typeof value === 'function' ? value.bind(client) : value
  },
})
