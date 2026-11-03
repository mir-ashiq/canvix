'use client'

// ─────────────────────────────────────────────────────────────
// InstalledApps — the "Installed" section of the Apps grid (P3,
// research §4.4 extension points / §4.3 lifecycle).
//
// Flow:  Install by URL → POST /api/plugins (server fetches,
// validates, sha256-pins the bundle) → CONSENT MODAL lists every
// requested permission verbatim → grant keeps it listed / remove
// deletes the install row.
//
// Degrades silently: flag off (503), signed out (401) or offline
// → the section never renders. The plugin runtime itself is a
// lazy dynamic import — self-hosters with the flag off never
// download a byte of it (§4.10 bundle accounting).
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { Puzzle, ShieldCheck, Trash2, Power, Loader2, X, ExternalLink, Plus } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { BUNDLED_PLUGINS, bundledManifestUrl } from '@/lib/plugins/firstparty'
import type { PluginInstallView } from './PluginRuntime'

const PluginRuntime = dynamic(() => import('./PluginRuntime').then((m) => m.PluginRuntime), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-64">
      <Loader2 size={18} className="text-[#02C0CC] animate-spin" />
    </div>
  ),
})

interface InstallSummaryRow {
  id: string
  pluginId: string
  name: string
  description: string | null
  author: string | null
  version: string
  enabled: boolean
  entry: { panel?: string }
  /** P5: element kinds + schema — flows into the panel's broker
   *  record so its addPluginElement calls pass the declared-kind check */
  elements?: { kind: string; label: string; schema?: unknown[] }[]
  permissions: { permission: string; description: string }[]
  createdAt: string
}

/** Tell the rest of the editor (the service layer) that the install
 *  list changed mid-session — P5. */
function broadcastPluginsChanged() {
  window.dispatchEvent(new CustomEvent('canvix:plugins-changed'))
}

export function InstalledApps() {
  const [installs, setInstalls] = useState<InstallSummaryRow[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [installing, setInstalling] = useState(false)
  const [consent, setConsent] = useState<InstallSummaryRow | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins', { cache: 'no-store' })
      if (!res.ok) return // 503 flag off / 401 signed out — silent
      const data = (await res.json()) as { installs: InstallSummaryRow[] }
      setInstalls(data.installs)
    } catch {
      // offline — leave the section hidden
    }
  }, [])

  useEffect(() => {
    // async state updates live in the .then — never synchronously
    // inside the effect body (react-hooks/set-state-in-effect)
    let cancelled = false
    void fetch('/api/plugins', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok || cancelled) return // 503 flag off / 401 signed out — silent
        const data = (await res.json()) as { installs: InstallSummaryRow[] }
        if (!cancelled) setInstalls(data.installs)
      })
      .catch(() => {
        // offline — leave the section hidden
      })
    return () => {
      cancelled = true
    }
  }, [])

  const install = useCallback(async (manifestUrl: string) => {
    const target = manifestUrl.trim()
    if (!target) return
    setInstalling(true)
    try {
      const res = await fetch('/api/plugins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifestUrl: target }),
      })
      const data = (await res.json().catch(() => ({}))) as { install?: InstallSummaryRow; error?: string }
      if (!res.ok || !data.install) {
        toast({ title: 'Could not install this plugin', description: data.error ?? `HTTP ${res.status}` })
        return
      }
      setConsent(data.install) // consent screen — permissions verbatim
      setUrl('')
      await load()
      broadcastPluginsChanged()
    } catch {
      toast({ title: 'Could not install this plugin', description: 'Network error — try again.' })
    } finally {
      setInstalling(false)
    }
  }, [load])

  const setEnabled = useCallback(async (row: InstallSummaryRow, enabled: boolean) => {
    setInstalls((prev) => (prev ? prev.map((r) => (r.id === row.id ? { ...r, enabled } : r)) : prev))
    try {
      const res = await fetch(`/api/plugins/${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) throw new Error(String(res.status))
      toast({ title: enabled ? `${row.name} enabled` : `${row.name} disabled`, description: enabled ? undefined : 'Its elements stay on the canvas as placeholders.' })
      broadcastPluginsChanged()
    } catch {
      toast({ title: 'Could not update the plugin' })
      await load()
    }
  }, [load])

  const uninstall = useCallback(async (row: InstallSummaryRow) => {
    setInstalls((prev) => (prev ? prev.filter((r) => r.id !== row.id) : prev))
    if (openId === row.id) setOpenId(null)
    try {
      const res = await fetch(`/api/plugins/${encodeURIComponent(row.id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(String(res.status))
      toast({ title: `${row.name} removed`, description: 'Your design and its elements are untouched.' })
      broadcastPluginsChanged()
    } catch {
      toast({ title: 'Could not remove the plugin' })
      await load()
    }
  }, [openId, load])

  // flag off / signed out / offline → render nothing at all
  if (!installs) return null

  const open = installs.find((r) => r.id === openId && r.enabled) ?? null
  if (open) {
    const view: PluginInstallView = {
      id: open.id,
      pluginId: open.pluginId,
      name: open.name,
      version: open.version,
      author: open.author,
      grantedPermissions: open.permissions.map((p) => p.permission),
      entryPanel: open.entry.panel,
      elements: open.elements ?? [],
    }
    return <PluginRuntime install={view} onClose={() => setOpenId(null)} />
  }

  // bundled plugins this instance ships but the user has not installed
  const bundledAvailable = BUNDLED_PLUGINS.filter(
    (b) => !installs.some((r) => r.pluginId === b.pluginId),
  )

  return (
    <section className="mt-4" aria-label="Installed plugin apps">
      <div className="flex items-center gap-1.5 mb-2">
        <Puzzle size={12} className="text-[#02C0CC]" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-white/50">Installed</span>
        <span className="text-[10px] text-white/30">({installs.length})</span>
      </div>

      <div className="flex gap-1.5 mb-2.5">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void install(url)
          }}
          placeholder="https://example.com/plugin/manifest.json"
          aria-label="Plugin manifest URL"
          className="flex-1 min-w-0 h-8 rounded-lg bg-white/[0.05] border border-white/10 px-2.5 text-[11px] text-white placeholder:text-white/25 focus:outline-none focus:border-[#7630D7]"
        />
        <button
          onClick={() => void install(url)}
          disabled={installing || !url.trim()}
          className="h-8 px-3 rounded-lg bg-[#7630D7] hover:bg-[#8B5CF6] disabled:opacity-40 text-white text-[11px] font-semibold flex items-center gap-1 shrink-0 transition-colors"
        >
          {installing ? <Loader2 size={11} className="animate-spin" /> : null}
          Install
        </button>
      </div>

      {bundledAvailable.length > 0 && (
        <div className="mb-2.5 space-y-1.5" aria-label="Bundled plugin apps">
          {bundledAvailable.map((b) => (
            <button
              key={b.slug}
              onClick={() => void install(bundledManifestUrl(b.slug))}
              disabled={installing}
              className="w-full text-left rounded-xl border border-[#7630D7]/30 bg-[#7630D7]/[0.08] hover:bg-[#7630D7]/[0.16] disabled:opacity-40 p-2.5 transition-colors group"
              aria-label={`Install ${b.name} (bundled)`}
            >
              <div className="flex items-center gap-1.5">
                <Plus size={11} className="text-[#02C0CC] shrink-0" />
                <span className="text-[12px] font-semibold text-white group-hover:text-[#02C0CC] transition-colors">
                  {b.name}
                </span>
                <span className="text-[9px] font-mono text-white/30 shrink-0">bundled</span>
              </div>
              <div className="text-[10px] text-white/40 leading-relaxed">{b.description}</div>
            </button>
          ))}
        </div>
      )}

      {installs.length === 0 ? (
        <p className="text-[11px] text-white/35 leading-relaxed rounded-xl border border-dashed border-white/10 p-3">
          No apps installed yet. Paste a plugin manifest URL above — you&apos;ll see exactly what it may access
          before anything runs.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {installs.map((row) => (
            <li
              key={row.id}
              className={cn(
                'rounded-xl border p-2.5 transition-colors',
                row.enabled ? 'border-white/10 bg-white/[0.03]' : 'border-white/5 bg-transparent opacity-60',
              )}
            >
              <div className="flex items-center gap-2">
                <button
                  onClick={() => (row.enabled ? setOpenId(row.id) : toast({ title: `${row.name} is disabled` }))}
                  disabled={!row.enabled}
                  className="flex-1 min-w-0 text-left cursor-pointer disabled:cursor-not-allowed group"
                  aria-label={`Open ${row.name}`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-semibold text-white truncate group-hover:text-[#02C0CC] transition-colors">
                      {row.name}
                    </span>
                    <span className="text-[9px] font-mono text-white/30 shrink-0">v{row.version}</span>
                  </div>
                  <div className="text-[10px] text-white/40 truncate">{row.description ?? row.pluginId}</div>
                </button>
                <button
                  onClick={() => void setEnabled(row, !row.enabled)}
                  title={row.enabled ? 'Disable' : 'Enable'}
                  aria-label={row.enabled ? `Disable ${row.name}` : `Enable ${row.name}`}
                  className={cn(
                    'w-6 h-6 rounded-md flex items-center justify-center transition-colors',
                    row.enabled ? 'text-emerald-400 hover:bg-emerald-400/10' : 'text-white/30 hover:bg-white/10',
                  )}
                >
                  <Power size={12} />
                </button>
                <button
                  onClick={() => void uninstall(row)}
                  title="Remove (your design is never touched)"
                  aria-label={`Remove ${row.name}`}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-white/30 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {consent && <ConsentModal row={consent} onClose={() => setConsent(null)} />}
    </section>
  )
}

// ── consent screen — the trust gate (§4.6) ───────────────────

function ConsentModal({ row, onClose }: { row: InstallSummaryRow; onClose: () => void }) {
  const [removing, setRemoving] = useState(false)
  const remove = async () => {
    setRemoving(true)
    try {
      await fetch(`/api/plugins/${encodeURIComponent(row.id)}`, { method: 'DELETE' })
      toast({ title: `${row.name} removed`, description: 'Nothing from this plugin was kept.' })
    } catch {
      toast({ title: 'Could not remove — delete it from the Installed list' })
    } finally {
      onClose()
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={`Permissions for ${row.name}`}>
      <div className="w-full max-w-md rounded-2xl border border-white/12 bg-[#14141A] shadow-2xl">
        <div className="flex items-start gap-3 p-4 border-b border-white/8">
          <div className="w-9 h-9 rounded-xl bg-[#7630D7]/20 flex items-center justify-center shrink-0">
            <ShieldCheck size={17} className="text-[#7630D7]" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[14px] font-bold text-white">
              {row.name} <span className="font-mono text-[10px] text-white/40">v{row.version}</span>
            </h2>
            <p className="text-[11px] text-white/50">
              by {row.author ?? 'unknown author'} · wants to join this Canvix
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-white/40 hover:text-white">
            <X size={15} />
          </button>
        </div>

        <div className="p-4">
          <p className="text-[12px] text-white/70 leading-relaxed mb-3">
            This app is third-party code. It runs in a sandbox and can only do the things listed below —
            <span className="text-white/90 font-semibold"> nothing else, ever</span>. Review carefully.
          </p>
          <ul className="space-y-2">
            {row.permissions.map((p) => (
              <li key={p.permission} className="flex gap-2.5 rounded-xl bg-white/[0.04] border border-white/8 p-2.5">
                <span className="text-[10px] font-mono text-[#02C0CC] bg-[#02C0CC]/10 rounded px-1.5 py-0.5 h-fit shrink-0">
                  {p.permission}
                </span>
                <span className="text-[11px] text-white/70 leading-relaxed">{p.description}</span>
              </li>
            ))}
            {row.permissions.length === 0 && (
              <li className="text-[11px] text-white/45 italic">No permissions requested — this plugin is read-only.</li>
            )}
          </ul>
        </div>

        <div className="flex items-center gap-2 p-4 pt-0">
          <a
            href="https://github.com/mir-ashiq/canvix/blob/main/docs/PLUGINS.md"
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-white/35 hover:text-white/60 flex items-center gap-1"
          >
            <ExternalLink size={10} /> How plugins work
          </a>
          <div className="flex-1" />
          <button
            onClick={() => void remove()}
            disabled={removing}
            className="h-9 px-3.5 rounded-lg border border-white/12 text-[12px] text-white/70 hover:text-white hover:border-white/25 transition-colors flex items-center gap-1.5 disabled:opacity-40"
          >
            {removing ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            Remove it
          </button>
          <button
            onClick={onClose}
            className="h-9 px-4 rounded-lg bg-[#7630D7] hover:bg-[#8B5CF6] text-white text-[12px] font-semibold transition-colors"
          >
            Keep installed
          </button>
        </div>
      </div>
    </div>
  )
}
