'use client'

// ─────────────────────────────────────────────────────────────
// PluginServiceLayer — the host half of element rendering (P4,
// research PLUGIN-SYSTEM.md §4.3 "lifecycle" + §4.5).
//
// Watches the OPEN DESIGN for plugin elements and mounts one hidden
// service iframe per installed plugin that owns some of them. The
// iframe loads the manifest's entry.service through the same
// DB-served, CSP-pinned asset route as panels; inside it the plugin
// registers renderers (`elements.registerRenderer`) and answers
// `elements.render` calls driven by the renderer cache.
//
// Discipline inherited from the panel runtime (P3):
//   · <iframe sandbox="allow-scripts"> — nothing else
//   · one-time handshake token in the URL fragment
//   · the PluginBroker owns every message in/out
//   · unmount when the plugin's elements leave the design — plugins
//     are ephemeral, only storage (and the elements themselves,
//     which live in the document, not the plugin) survive
//
// Silent degradation everywhere: flag off (503), signed out (401)
// or offline → state 'off', zero iframes, placeholders on canvas.
// ─────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useEditorStore } from '@/store/editor-store'
import type { AnyElement, PluginElement } from '@/lib/types'
import { setPluginSystemState, type PluginInstallInfo } from '@/lib/plugins/renderer-cache'

// Unload policy (research §4.7, deviated deliberately): a frame
// unmounts as soon as its plugin has no elements in the open design —
// the 5-min idle grace the research sketched buys nothing the render
// cache doesn't already hold (settled renders survive unmounts), and
// immediate unmount keeps the iframe count trivially bounded. An
// undo/redo remount costs one re-render RPC.

const PluginServiceFrame = dynamic(
  () => import('./PluginServiceFrame').then((m) => m.PluginServiceFrame),
  { ssr: false },
)

/** Distinct pluginIds with elements present anywhere in the design. */
function pluginIdsIn(pages: { elements: AnyElement[] }[]): Set<string> {
  const ids = new Set<string>()
  const walk = (els: AnyElement[]) => {
    for (const el of els) {
      if (el.type === 'plugin') ids.add((el as PluginElement).pluginId)
      else if (el.type === 'group') walk(el.children)
    }
  }
  for (const p of pages) walk(p.elements ?? [])
  return ids
}

export function PluginServiceLayer() {
  const pages = useEditorStore((s) => s.pages)
  const [installs, setInstalls] = useState<PluginInstallInfo[] | null>(null)
  const [off, setOff] = useState(false)
  const [reloadEpoch, setReloadEpoch] = useState(0)

  // P5: InstalledApps broadcasts this after install/uninstall/enable/
  // disable — without it, a plugin installed mid-session never got a
  // service frame until the next editor remount (the list used to be
  // fetched exactly once), so freshly-generated elements sat as
  // "not responding" placeholders.
  useEffect(() => {
    const onPluginsChanged = () => setReloadEpoch((n) => n + 1)
    window.addEventListener('canvix:plugins-changed', onPluginsChanged)
    return () => window.removeEventListener('canvix:plugins-changed', onPluginsChanged)
  }, [])

  // fetch the install list on mount and after every install-list
  // change; 503 (flag off) and 401 (signed out) both mean "no plugin
  // system" — state 'off'
  useEffect(() => {
    let cancelled = false
    void fetch('/api/plugins', { cache: 'no-store' })
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) {
          setOff(true)
          return
        }
        const data = (await res.json()) as {
          installs: (PluginInstallInfo & {
            permissions: { permission: string }[]
          })[]
        }
        if (cancelled) return
        setInstalls(
          (data.installs ?? []).map((row) => ({
            ...row,
            grantedPermissions: (row.permissions ?? []).map((p) => p.permission),
          })),
        )
      })
      .catch(() => {
        if (!cancelled) setOff(true)
      })
    return () => {
      cancelled = true
    }
  }, [reloadEpoch])

  // push install state into the renderer cache (placeholder reasons)
  useEffect(() => {
    if (off) setPluginSystemState('off')
    else if (installs) setPluginSystemState('ready', installs)
  }, [off, installs])

  const present = useMemo(() => pluginIdsIn(pages), [pages])

  const byPlugin = useMemo(() => {
    const map = new Map<string, PluginInstallInfo>()
    for (const i of installs ?? []) map.set(i.pluginId, i)
    return map
  }, [installs])

  if (off || !installs) return null

  // frames derive PURELY from the elements in the design — a plugin
  // with no elements on any page mounts no iframe at all
  const frames: React.ReactNode[] = []
  for (const pluginId of Array.from(present).sort()) {
    const install = byPlugin.get(pluginId)
    // not installed / disabled → no iframe (canvas shows the reason)
    if (!install?.enabled) continue
    frames.push(<PluginServiceFrame key={install.installId} install={install} />)
  }
  // hidden — the render contract needs the frame ALIVE, not visible
  return frames.length ? <div aria-hidden className="absolute w-0 h-0 overflow-hidden pointer-events-none">{frames}</div> : null
}
