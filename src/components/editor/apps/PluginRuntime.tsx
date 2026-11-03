'use client'

// ─────────────────────────────────────────────────────────────
// PluginRuntime — the host side of a plugin panel (P3, research
// PLUGIN-SYSTEM.md §4.3 "lifecycle").
//
// This component is the ONLY thing that turns an installed row
// into running code. Everything the research pinned as the
// boundary lives here, in one auditable place:
//
//   · <iframe sandbox="allow-scripts"> — and NOTHING else in
//     the attribute: no same-origin, no top-navigation, no
//     forms, no popups. The frame is an opaque origin: it
//     cannot read host cookies, host DOM or host localStorage.
//   · The handshake token rides the URL fragment (#…) — the
//     fragment is never sent over the wire, and the broker
//     refuses the first RPC call that does not echo it.
//   · The PluginBroker owns every message in/out (origin
//     discipline, permissions, rate budget, payload caps).
//   · Unmount = deactivate: broker disposed, listener removed.
//     Plugins are ephemeral; only their namespaced storage
//     survives.
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Loader2, ShieldCheck } from 'lucide-react'
import { AppHeader } from './registry'
import { PluginBroker, type BrokerInstall } from '@/lib/plugins/broker'
import { PluginStorage } from '@/lib/plugins/plugin-storage'
import { applyDesignAction } from '@/lib/design-actions'
import { useEditorStore } from '@/store/editor-store'
import { toast } from '@/hooks/use-toast'

export interface PluginInstallView {
  id: string
  pluginId: string
  name: string
  version: string
  author?: string | null
  /** granted permission strings (the consent record) */
  grantedPermissions: string[]
  /** manifest entry.panel — relative path inside the bundle */
  entryPanel?: string
}

/** Cryptographically random handshake token (URL-fragment safe). */
function newHandshakeToken(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24)
}

export function PluginRuntime({ install, onClose }: { install: PluginInstallView; onClose: () => void }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const brokerRef = useRef<PluginBroker | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  // one handshake token per mount — never reused across remounts
  const handshake = useMemo(() => newHandshakeToken(), [])
  const panelSrc = useMemo(() => {
    const entry = install.entryPanel && /^[\w][\w./-]*\.html$/.test(install.entryPanel) ? install.entryPanel : 'panel.html'
    return `/api/plugins/${encodeURIComponent(install.id)}/serve/${entry}#${encodeURIComponent(handshake)}`
  }, [install.id, install.entryPanel, handshake])

  const hostVersion = useMemo(() => {
    const el = document.querySelector('meta[name="canvix-version"]')
    return el?.getAttribute('content') ?? 'dev'
  }, [])

  const attachBroker = useCallback(() => {
    const frame = iframeRef.current?.contentWindow
    if (!frame || brokerRef.current || failed) return

    const record: BrokerInstall = {
      installId: install.id,
      pluginId: install.pluginId,
      version: install.version,
      permissions: install.grantedPermissions,
    }
    const broker = new PluginBroker({
      install: record,
      host: {
        getDesignState: () => {
          const s = useEditorStore.getState()
          return { pages: s.pages, currentPage: s.currentPage, readOnly: s.readOnly }
        },
        applyAction: (action) => applyDesignAction({ ...action, type: String(action.type) }),
        notify: (text) => toast({ title: install.name, description: text }),
        closePanel: () => onClose(),
        logError: (scope, error) => console.error(`[plugin:${install.pluginId}] ${scope}`, error),
      },
      storage: new PluginStorage(install.pluginId),
      hostVersion,
      context: 'panel',
    })
    const onMessage = (ev: MessageEvent) => broker.handleMessage(ev)
    broker.attach(frame, handshake, onMessage)
    brokerRef.current = broker
    setReady(true)

    // host→plugin subscription pushes: zustand's subscribe fires on
    // every set — diff against the last snapshot we pushed so a
    // plugin only hears about real selection/document changes
    let lastSelection = JSON.stringify(useEditorStore.getState().selectedIds)
    let lastDoc = JSON.stringify(docSignature())
    const unsub = useEditorStore.subscribe(() => {
      const broker = brokerRef.current
      if (!broker) return
      const s = useEditorStore.getState()
      const selection = JSON.stringify(s.selectedIds)
      if (selection !== lastSelection) {
        lastSelection = selection
        broker.pushEvent('selection', { ids: s.selectedIds })
      }
      const doc = JSON.stringify(docSignature())
      if (doc !== lastDoc) {
        lastDoc = doc
        broker.pushEvent('document', {
          pages: s.pages.map((p) => ({ id: p.id, elements: p.elements.length })),
          currentPage: s.currentPage,
        })
      }
    })

    // dispose on unmount: no listener leaks, no dangling iframes
    return () => {
      unsub()
      broker.dispose(onMessage)
      brokerRef.current = null
    }
  }, [install.id, install.pluginId, install.version, handshake, hostVersion, failed])

  useEffect(() => {
    const cleanup = attachBroker()
    return cleanup
  }, [attachBroker])

  return (
    <div className="flex flex-col h-full min-h-0">
      <AppHeader icon={ShieldCheck} title={install.name} onClose={onClose}>
        <span className="text-[10px] text-white/35 font-mono">
          v{install.version}
          {install.author ? ` · ${install.author}` : ''}
        </span>
      </AppHeader>

      <div className="relative flex-1 min-h-0 rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
        {!ready && !failed && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[#0F0F13]">
            <Loader2 size={18} className="text-[#02C0CC] animate-spin" />
            <p className="text-[11px] text-white/45">Starting {install.name} in its sandbox…</p>
          </div>
        )}
        {failed && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[#0F0F13] px-6 text-center">
            <AlertTriangle size={18} className="text-amber-400" />
            <p className="text-[12px] text-white/70 font-semibold">This app could not start</p>
            <p className="text-[11px] text-white/45 leading-relaxed">
              The plugin&apos;s panel is unavailable — it may have been uninstalled or disabled. Removing the app
              never affects your design.
            </p>
          </div>
        )}
        <iframe
          ref={iframeRef}
          title={`${install.name} (sandboxed plugin)`}
          // THE SECURITY BOUNDARY — allow-scripts ONLY:
          // no allow-same-origin (opaque origin: no cookies/DOM/storage)
          // no allow-top-navigation, allow-forms, allow-popups, allow-modals
          sandbox="allow-scripts"
          src={panelSrc}
          className="w-full h-full border-0 bg-white"
          onError={() => setFailed(true)}
        />
      </div>

      <p className="mt-2 text-[10px] text-white/30 leading-relaxed flex items-center gap-1.5">
        <ShieldCheck size={11} className="shrink-0" />
        Sandboxed — this app runs isolated and can only act inside the permissions you granted.
      </p>
    </div>
  )
}

/** Cheap structural signature of the document for document-event diffing. */
function docSignature(): { pages: { id: string; n: number }[]; currentPage: number } {
  const s = useEditorStore.getState()
  return {
    pages: s.pages.map((p) => ({ id: p.id, n: p.elements.length })),
    currentPage: s.currentPage,
  }
}
