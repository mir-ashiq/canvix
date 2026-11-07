'use client'

import { useEffect, useState } from 'react'
import { getJson, sendJson } from './fetch'
import { Card, Toggle, Chip } from './bits'
import { fmt, fmtBytes } from './charts'

interface ConfigView {
  provider: { configured: boolean; source: string | null }
  settings: { signupsOpen: boolean; anonymousEditing: boolean }
}
interface OverviewLite {
  version: string
  dbLatencyMs: number
  totals: { mediaCount: number; mediaBytes: number; designs: number; comments: number }
}

export function AdminSettings() {
  const [view, setView] = useState<ConfigView | null>(null)
  const [instance, setInstance] = useState<OverviewLite | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      const [cfg, ov] = await Promise.all([
        getJson<ConfigView>('/api/admin/config'),
        getJson<OverviewLite>('/api/admin/overview'),
      ])
      if (cfg.ok) setView(cfg.data)
      else setError(cfg.data?.error ?? `Request failed (${cfg.status})`)
      if (ov.ok) setInstance(ov.data)
    })()
  }, [])

  async function save(next: { signupsOpen: boolean; anonymousEditing: boolean }) {
    setBusy(true)
    const res = await sendJson<ConfigView & { error?: string }>('/api/admin/config', 'PUT', { settings: next })
    setBusy(false)
    if (!res.ok) {
      setNotice(null)
      setError(res.data?.error ?? `Could not save (${res.status}).`)
      return
    }
    setError(null)
    setView(res.data)
    setNotice('Settings saved.')
    setTimeout(() => setNotice(null), 4000)
  }

  if (!view) {
    return <div className="h-40 animate-pulse rounded-xl bg-muted" />
  }

  return (
    <>
      {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700">{notice}</div>}

      <Card title="Access">
        <ul className="divide-y">
          <li className="flex items-center justify-between gap-4 py-4">
            <div className="max-w-lg">
              <p className="text-sm font-medium">Allow new sign-ups</p>
              <p className="text-xs text-muted-foreground">
                When off, <code className="rounded bg-muted px-1">POST /api/auth/register</code> answers 503 with a
                friendly message — before the rate limiter, so a closed instance burns none of a visitor&apos;s attempt
                budget. Existing accounts sign in as usual.
              </p>
            </div>
            <Toggle
              label="Allow new sign-ups"
              checked={view.settings.signupsOpen}
              disabled={busy}
              onChange={(next) => void save({ ...view.settings, signupsOpen: next })}
            />
          </li>
          <li className="flex items-center justify-between gap-4 py-4">
            <div className="max-w-lg">
              <p className="text-sm font-medium">Anonymous editing</p>
              <p className="text-xs text-muted-foreground">
                When off, only signed-in accounts can create or save designs. Reading, sharing and exporting existing
                designs (including the anonymous commons) keeps working — this gates writes, not reads.
              </p>
            </div>
            <Toggle
              label="Anonymous editing"
              checked={view.settings.anonymousEditing}
              disabled={busy}
              onChange={(next) => void save({ ...view.settings, anonymousEditing: next })}
            />
          </li>
        </ul>
      </Card>

      <Card title="Instance">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Canvix version</dt>
          <dd className="text-right font-medium tabular-nums">{instance?.version ?? '—'}</dd>
          <dt className="text-muted-foreground">Database latency</dt>
          <dd className="text-right font-medium tabular-nums">{instance ? `${instance.dbLatencyMs} ms` : '—'}</dd>
          <dt className="text-muted-foreground">Designs</dt>
          <dd className="text-right font-medium tabular-nums">{instance ? fmt(instance.totals.designs) : '—'}</dd>
          <dt className="text-muted-foreground">Media</dt>
          <dd className="text-right font-medium tabular-nums">
            {instance ? `${fmt(instance.totals.mediaCount)} files · ${fmtBytes(instance.totals.mediaBytes)}` : '—'}
          </dd>
          <dt className="text-muted-foreground">AI provider</dt>
          <dd className="text-right">
            {view.provider.configured ? <Chip tone="good">{view.provider.source}</Chip> : <Chip tone="bad">none</Chip>}
          </dd>
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">
          First administrator: set{' '}
          <code className="rounded bg-muted px-1">CANVIX_ADMIN_USERS=&quot;your-username&quot;</code> and sign in — the
          Admin link appears on the dashboard. Everything else is operable from these pages.
        </p>
      </Card>

      <Card title="Privacy posture">
        <ul className="list-disc space-y-1.5 pl-4 text-xs text-muted-foreground">
          <li>Traffic counters are per-day aggregates: route, method, status, count. No ids, no IPs, no query strings.</li>
          <li>Daily-active records store a userId or the hashed anonymous cookie key — first-party, admin-visible only.</li>
          <li>Counters can be switched off entirely with <code className="rounded bg-muted px-1">CANVIX_TRAFFIC=0</code>; rows older than 90 days are swept automatically.</li>
          <li>Provider API keys are write-only: stored once, echoed back only as a mask.</li>
        </ul>
      </Card>
    </>
  )
}
