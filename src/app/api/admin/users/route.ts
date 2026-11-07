import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, isAdminUser, adminSource } from '@/lib/admin/guard'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/admin/users — the console's user directory.
// ?q=<username substring> · ?page=<0-based> (25 per page).
// Aggregate columns (designs owned, active sessions, last active) are
// fetched with two GROUP BY queries over the page's ids — never per-row.

const PAGE_SIZE = 25

async function __canvix_get(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.res

  try {
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 64)
    const page = Math.max(0, Math.min(Number(req.nextUrl.searchParams.get('page')) || 0, 500))
    const where = q ? { username: { contains: q } } : {}

    const [total, users] = await Promise.all([
      db.user.count({ where }),
      db.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: page * PAGE_SIZE,
        take: PAGE_SIZE,
        select: { id: true, username: true, role: true, createdAt: true },
      }),
    ])

    const ids = users.map((u) => u.id)
    const designCounts = new Map<string, number>()
    const sessionInfo = new Map<string, { active: number; last: Date | null }>()
    if (ids.length) {
      const [dRows, sRows] = await Promise.all([
        db.$queryRaw<{ id: string; n: number }[]>`
          SELECT "ownerId" AS id, COUNT(*)::int AS n FROM "Design"
          WHERE "ownerId" = ANY(${ids}::text[]) AND "deletedAt" IS NULL GROUP BY "ownerId"`,
        db.$queryRaw<{ id: string; active: number; last: Date | null }[]>`
          SELECT "userId" AS id,
            COUNT(*) FILTER (WHERE "expiresAt" > now())::int AS active,
            MAX("createdAt") AS last
          FROM "Session" WHERE "userId" = ANY(${ids}::text[]) GROUP BY "userId"`,
      ])
      for (const r of dRows) designCounts.set(r.id, r.n)
      for (const r of sRows) sessionInfo.set(r.id, { active: r.active, last: r.last })
    }

    return NextResponse.json({
      total,
      page,
      pageSize: PAGE_SIZE,
      users: users.map((u) => ({
        ...u,
        admin: isAdminUser(u),
        adminSource: adminSource(u),
        designs: designCounts.get(u.id) ?? 0,
        activeSessions: sessionInfo.get(u.id)?.active ?? 0,
        lastActiveAt: sessionInfo.get(u.id)?.last ?? null,
      })),
    })
  } catch (error) {
    console.error('GET /api/admin/users failed', error)
    return NextResponse.json({ error: 'User directory unavailable — database unreachable.' }, { status: 503 })
  }
}

export const GET = withLogging('GET /api/admin/users', __canvix_get)
