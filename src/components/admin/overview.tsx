'use client'

import { useEffect, useState } from 'react'
import { getJson } from './fetch'
import { StatCard, Card, Chip } from './bits'
import { BarChart, LineChart, HBars, fmt, fmtBytes } from './charts'

interface DayPoint {
  day: string
  value: number
}
interface AiDayPoint extends DayPoint {
  ok: number
}
interface Overview {
  version: string
  dbLatencyMs: number
  totals: {
    users: number
    designs: number
    templates: number
    mediaCount: number
    mediaBytes: number
    comments: number
    aiCalls: number
    activeSessions: number
  }
  windows: { requests24h: number; requests7d: number; ai7d: number; dauToday: number }
  series: { traffic: DayPoint[]; dau: DayPoint[]; signups: DayPoint[]; aiCalls: AiDayPoint[] }
  topRoutes: { route: string; method: string; hits: number }[]
  aiByFeature: { feature: string; calls: number; ok: number }[]
  recentUsers: { id: string; username: string; role: string; createdAt: string; admin: boolean }[]
  provider: { configured: boolean; source: string | null }
}

const SOURCE_LABEL: Record<string, string> = {
  db: 'console',
  env: 'environment',
  file: 'config file',
}

export function AdminOverview() {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getJson<Overview>('/api/admin/overview').then((res) => {
      if (!alive) return
      if (res.ok) setData(res.data)
      else setError(res.data?.error ?? `Request failed (${res.status})`)
    })
    return () => {
      alive = false
    }
  }, [])

  if (error) {
    return (
      <Card title="Overview">
        <p className="text-sm text-destructive">{error}</p>
      </Card>
    )
  }
  if (!data) {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    )
  }

  const aiFail7d = Math.max(
    0,
    data.series.aiCalls.slice(-7).reduce((a, p) => a + Math.max(0, p.value - p.ok), 0)
  )

  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Users" value={fmt(data.totals.users)} sub={`${data.windows.dauToday} active today`} />
        <StatCard label="Designs" value={fmt(data.totals.designs)} sub={`${fmt(data.totals.templates)} templates`} />
        <StatCard label="API requests" value={fmt(data.windows.requests24h)} sub={`${fmt(data.windows.requests7d)} in 7 days`} />
        <StatCard
          label="AI calls"
          value={fmt(data.windows.ai7d)}
          sub={`7d · ${aiFail7d > 0 ? `${fmt(aiFail7d)} failed` : 'no failures'}`}
        />
        <StatCard label="Active sessions" value={fmt(data.totals.activeSessions)} sub="unexpired" />
        <StatCard label="Media stored" value={fmtBytes(data.totals.mediaBytes)} sub={`${fmt(data.totals.mediaCount)} files`} />
        <StatCard label="Comments" value={fmt(data.totals.comments)} sub="all designs" />
        <StatCard
          label="AI provider"
          value={data.provider.configured ? 'configured' : 'none'}
          sub={data.provider.configured ? `via ${SOURCE_LABEL[data.provider.source ?? ''] ?? data.provider.source}` : 'local features only'}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="API traffic — last 14 days"
          right={<Chip>{fmt(data.series.traffic.reduce((a, p) => a + p.value, 0))} total</Chip>}
        >
          <BarChart bars={data.series.traffic.map((p) => ({ label: p.day, value: p.value }))} />
        </Card>
        <Card title="Daily active users — last 14 days" right={<Chip tone={data.windows.dauToday > 0 ? 'good' : 'neutral'}>{data.windows.dauToday} today</Chip>}>
          <LineChart points={data.series.dau.map((p) => ({ label: p.day, value: p.value }))} />
        </Card>
        <Card title="New sign-ups — last 14 days">
          <BarChart bars={data.series.signups.map((p) => ({ label: p.day, value: p.value }))} color="var(--cv-violet)" />
        </Card>
        <Card title="AI calls — last 14 days" right={<Chip tone={aiFail7d > 0 ? 'bad' : 'good'}>teal = ok · red = failed</Chip>}>
          <BarChart
            bars={data.series.aiCalls.map((p) => ({
              label: p.day,
              value: Math.max(0, p.value - Math.max(0, p.value - p.ok)),
              alt: Math.max(0, p.value - p.ok),
            }))}
          />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Top routes — last 7 days">
          <HBars
            rows={data.topRoutes.map((r) => ({
              label: `${r.method} ${r.route.replace('/api/', '')}`,
              value: r.hits,
              hint: `${r.method} ${r.route}`,
            }))}
          />
        </Card>
        <Card title="AI usage by feature — last 7 days">
          <HBars
            rows={data.aiByFeature.map((f) => ({
              label: f.feature,
              value: f.calls,
              hint: `${f.calls} calls · ${f.ok} succeeded`,
            }))}
            color="var(--cv-violet)"
          />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Newest accounts">
          <ul className="divide-y">
            {data.recentUsers.length === 0 && <li className="py-2 text-sm text-muted-foreground">no accounts yet</li>}
            {data.recentUsers.map((u) => (
              <li key={u.id} className="flex items-center justify-between py-2 text-sm">
                <span className="font-medium">{u.username}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {u.admin && <Chip tone="good">admin</Chip>}
                  {new Date(u.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Instance">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Canvix version</dt>
            <dd className="text-right font-medium tabular-nums">{data.version}</dd>
            <dt className="text-muted-foreground">Database latency</dt>
            <dd className="text-right font-medium tabular-nums">{data.dbLatencyMs} ms</dd>
            <dt className="text-muted-foreground">AI provider</dt>
            <dd className="text-right font-medium">
              {data.provider.configured ? `configured · ${SOURCE_LABEL[data.provider.source ?? ''] ?? data.provider.source}` : 'not configured'}
            </dd>
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            Traffic counters are aggregate counts only — no ids, no IPs, no query strings. 90-day retention. Disable with{' '}
            <code className="rounded bg-muted px-1">CANVIX_TRAFFIC=0</code>.
          </p>
        </Card>
      </div>
    </>
  )
}
