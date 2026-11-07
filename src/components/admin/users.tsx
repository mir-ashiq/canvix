'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, ChevronLeft, ChevronRight, ShieldCheck, ShieldOff, LogOut } from 'lucide-react'
import { getJson, sendJson } from './fetch'
import { Card, RoleBadge } from './bits'
import { fmt } from './charts'

interface AdminUserRow {
  id: string
  username: string
  role: string
  createdAt: string
  admin: boolean
  adminSource: string | null
  designs: number
  activeSessions: number
  lastActiveAt: string | null
}
interface UsersPage {
  total: number
  page: number
  pageSize: number
  users: AdminUserRow[]
}

/** Two-step inline confirm — no native dialogs, works headless in e2e. */
type Action = { kind: 'role'; row: AdminUserRow; next: 'admin' | 'user' } | { kind: 'sessions'; row: AdminUserRow } | null

export function AdminUsers() {
  const [data, setData] = useState<UsersPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [pending, setPending] = useState<Action>(null)
  const [busy, setBusy] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (query: string, pageNo: number) => {
    const res = await getJson<UsersPage>(`/api/admin/users?q=${encodeURIComponent(query)}&page=${pageNo}`)
    if (res.ok) {
      setData(res.data)
      setError(null)
    } else {
      setError(res.data?.error ?? `Request failed (${res.status})`)
    }
  }, [])

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => void load(q, page), q ? 300 : 0)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [q, page, load])

  async function runRole(row: AdminUserRow, next: 'admin' | 'user') {
    setBusy(true)
    const res = await sendJson<{ error?: string }>(`/api/admin/users/${row.id}/role`, 'POST', { role: next })
    setBusy(false)
    setPending(null)
    if (!res.ok) {
      setError(res.data?.error ?? `Could not update the role (${res.status}).`)
      return
    }
    setError(null)
    void load(q, page)
  }

  async function runSessions(row: AdminUserRow) {
    setBusy(true)
    const res = await sendJson<{ revoked?: number; error?: string }>(`/api/admin/users/${row.id}/sessions`, 'POST', {})
    setBusy(false)
    setPending(null)
    if (!res.ok) {
      setError(res.data?.error ?? `Could not revoke sessions (${res.status}).`)
      return
    }
    setError(null)
    void load(q, page)
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <>
      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}
      <Card
        title={data ? `${fmt(data.total)} account${data.total === 1 ? '' : 's'}` : 'Accounts'}
        right={
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(0)
              }}
              placeholder="Search username…"
              aria-label="Search users by username"
              className="h-8 w-44 rounded-lg border bg-background pl-8 pr-2 text-sm outline-none focus:ring-2 focus:ring-ring sm:w-56"
            />
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Username</th>
                <th className="py-2 pr-3 font-medium">Role</th>
                <th className="py-2 pr-3 text-right font-medium">Designs</th>
                <th className="py-2 pr-3 text-right font-medium">Sessions</th>
                <th className="py-2 pr-3 font-medium">Last active</th>
                <th className="py-2 pr-3 font-medium">Joined</th>
                <th className="py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!data && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    loading…
                  </td>
                </tr>
              )}
              {data?.users.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    no accounts match “{q}”
                  </td>
                </tr>
              )}
              {data?.users.map((row) => {
                const isPending =
                  pending && ((pending.kind === 'role' && pending.row.id === row.id) || (pending.kind === 'sessions' && pending.row.id === row.id))
                return (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="py-2.5 pr-3 font-medium">{row.username}</td>
                    <td className="py-2.5 pr-3">
                      <RoleBadge admin={row.admin} source={row.adminSource} />
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{fmt(row.designs)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{row.activeSessions}</td>
                    <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                      {row.lastActiveAt ? new Date(row.lastActiveAt).toLocaleString() : '—'}
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleDateString()}</td>
                    <td className="py-2.5 text-right">
                      <div className="flex justify-end gap-1.5">
                        {isPending && pending?.kind === 'role' ? (
                          <>
                            <button
                              onClick={() => void runRole(row, pending.next)}
                              disabled={busy}
                              className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
                            >
                              confirm
                            </button>
                            <button
                              onClick={() => setPending(null)}
                              disabled={busy}
                              className="rounded-lg border px-2.5 py-1 text-xs font-medium disabled:opacity-50"
                            >
                              cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => setPending({ kind: 'role', row, next: row.admin ? 'user' : 'admin' })}
                              disabled={busy}
                              title={row.admin ? 'Remove admin rights' : 'Grant admin rights'}
                              className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
                            >
                              {row.admin ? <ShieldOff size={13} /> : <ShieldCheck size={13} />}
                              {row.admin ? 'revoke' : 'make admin'}
                            </button>
                            <button
                              onClick={() => setPending({ kind: 'sessions', row })}
                              disabled={busy}
                              title="Sign this user out everywhere"
                              className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
                            >
                              <LogOut size={13} /> sign out
                            </button>
                          </>
                        )}
                        {isPending && pending?.kind === 'sessions' && (
                          <>
                            <button
                              onClick={() => void runSessions(row)}
                              disabled={busy}
                              className="rounded-lg bg-destructive px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
                            >
                              confirm sign-out
                            </button>
                            <button
                              onClick={() => setPending(null)}
                              disabled={busy}
                              className="rounded-lg border px-2.5 py-1 text-xs font-medium disabled:opacity-50"
                            >
                              cancel
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {data && data.total > data.pageSize && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              page {data.page + 1} / {pages}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={data.page === 0}
                className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium disabled:opacity-40"
              >
                <ChevronLeft size={13} /> prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
                disabled={data.page >= pages - 1}
                className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium disabled:opacity-40"
              >
                next <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </Card>
      <p className="text-xs text-muted-foreground">
        Admin rights come from the <code className="rounded bg-muted px-1">CANVIX_ADMIN_USERS</code> environment variable
        (always wins, shown as <span className="font-medium">· env</span>) or from this table. Role changes refuse
        self-modification — a second administrator or the env variable is the recovery path.
      </p>
    </>
  )
}
