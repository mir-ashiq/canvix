import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, isAdminUser, adminSource } from '@/lib/admin/guard'
import { resolveProvider } from '@/lib/ai/provider'
import { fillDays, sumSeries, dayKey, type DayPoint } from '@/lib/admin/series'
import { APP_VERSION, withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/admin/overview — everything the console's landing page shows:
// totals, 14-day traffic/DAU/signup/AI series, top routes, AI usage by
// feature, the ten newest accounts and which layer answers as the AI
// provider. Aggregate counts only — the same stance as /api/health?v=2.

const DAYS = 14

interface RawDayRow {
  day: Date
  n: number
}
interface RawTrafficRow {
  day: Date
  hits: number
}
interface RawAiDayRow {
  day: Date
  n: number
  ok: number
}

async function __canvix_get(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.res

  const probeStart = Date.now()
  try {
    const since = new Date(Date.now() - (DAYS - 1) * 24 * 60 * 60 * 1000)
    const since7 = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)

    const [
      users,
      designs,
      templates,
      mediaAgg,
      comments,
      aiTotal,
      activeSessions,
      trafficRows,
      dauRows,
      signupRows,
      aiDayRows,
      topRoutes,
      aiByFeature,
      recentUsers,
      provider,
    ] = await Promise.all([
      db.user.count(),
      db.design.count({ where: { deletedAt: null } }),
      db.template.count(),
      db.media.aggregate({ _count: true, _sum: { size: true } }),
      db.comment.count(),
      db.aIUsage.count(),
      db.session.count({ where: { expiresAt: { gt: new Date() } } }),
      db.$queryRaw<RawTrafficRow[]>`
        SELECT "day", SUM("hits")::int AS hits FROM "TrafficStat"
        WHERE "day" >= ${since} GROUP BY "day" ORDER BY "day"`,
      db.$queryRaw<RawDayRow[]>`
        SELECT "day", COUNT(*)::int AS n FROM "DailyActive"
        WHERE "day" >= ${since} GROUP BY "day" ORDER BY "day"`,
      db.$queryRaw<RawDayRow[]>`
        SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::int AS n FROM "User"
        WHERE "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
      db.$queryRaw<RawAiDayRow[]>`
        SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::int AS n,
          COUNT(*) FILTER (WHERE "ok")::int AS ok
        FROM "AIUsage" WHERE "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
      db.$queryRaw<{ route: string; method: string; hits: number }[]>`
        SELECT "route", "method", SUM("hits")::int AS hits FROM "TrafficStat"
        WHERE "day" >= ${since7} GROUP BY "route", "method" ORDER BY 3 DESC LIMIT 10`,
      db.$queryRaw<{ feature: string; n: number; ok: number }[]>`
        SELECT "feature", COUNT(*)::int AS n, COUNT(*) FILTER (WHERE "ok")::int AS ok
        FROM "AIUsage" WHERE "createdAt" >= ${since7} GROUP BY "feature" ORDER BY 2 DESC`,
      db.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, username: true, role: true, createdAt: true },
      }),
      resolveProvider(),
    ])
    const dbLatencyMs = Date.now() - probeStart

    // sparse SQL rows → gap-free UTC day series
    const traffic: DayPoint[] = fillDays(trafficRows.map((r) => [dayKey(new Date(r.day)), r.hits]), DAYS)
    const dau: DayPoint[] = fillDays(dauRows.map((r) => [dayKey(new Date(r.day)), r.n]), DAYS)
    const signups: DayPoint[] = fillDays(signupRows.map((r) => [dayKey(new Date(r.day)), r.n]), DAYS)
    // fillDays reorders/drops rows — rebuild ok counts from a keyed map
    const okByKey = new Map(aiDayRows.map((r) => [dayKey(new Date(r.day)), Number(r.ok)]))
    const aiCalls: { day: string; value: number; ok: number }[] = fillDays(
      aiDayRows.map((r) => [dayKey(new Date(r.day)), r.n]),
      DAYS
    ).map((p) => ({ ...p, ok: okByKey.get(p.day) ?? 0 }))

    return NextResponse.json({
      version: APP_VERSION,
      dbLatencyMs,
      totals: {
        users,
        designs,
        templates,
        mediaCount: mediaAgg._count,
        mediaBytes: mediaAgg._sum.size ?? 0,
        comments,
        aiCalls: aiTotal,
        activeSessions,
      },
      windows: {
        requests24h: sumSeries(traffic, 1),
        requests7d: sumSeries(traffic, 7),
        ai7d: sumSeries(aiCalls, 7),
        dauToday: dau[dau.length - 1]?.value ?? 0,
      },
      series: { traffic, dau, signups, aiCalls },
      topRoutes: topRoutes.map((r) => ({ route: r.route, method: r.method, hits: r.hits })),
      aiByFeature: aiByFeature.map((r) => ({ feature: r.feature, calls: r.n, ok: r.ok })),
      recentUsers: recentUsers.map((u) => ({
        id: u.id,
        username: u.username,
        role: u.role,
        createdAt: u.createdAt,
        admin: isAdminUser(u),
        adminSource: adminSource(u),
      })),
      provider: { configured: provider !== null, source: provider?.source ?? null },
    })
  } catch (error) {
    console.error('GET /api/admin/overview failed', error)
    return NextResponse.json({ error: 'Overview unavailable — database unreachable.' }, { status: 503 })
  }
}

export const GET = withLogging('GET /api/admin/overview', __canvix_get)
