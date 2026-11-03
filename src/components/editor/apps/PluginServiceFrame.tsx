'use client'

// ─────────────────────────────────────────────────────────────
// PluginServiceFrame — ONE hidden service iframe + its broker
// (P4, research PLUGIN-SYSTEM.md §4.3/§4.5).
//
// Same boundary as the panel host (P3), one difference in kind:
// this frame's broker runs in `context: 'service'`, so it is the
// only context where `elements.registerRenderer` is answered — and
// the frame is registered with the renderer cache as the plugin's
// render transport, so `elements.render` calls flow host → plugin
// with results sanitized before any host use.
//
// The frame is hidden (0×0, aria-hidden): the render contract needs
// it ALIVE, never visible. Unmount = transport deregistered = the
// canvas degrades to placeholders; settled renders stay cached.
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { PluginBroker, type BrokerInstall } from '@/lib/plugins/broker'
import { PluginStorage } from '@/lib/plugins/plugin-storage'
import {
  notifyRendererKindsChanged,
  setRenderTransport,
  type PluginInstallInfo,
} from '@/lib/plugins/renderer-cache'
import { applyDesignAction } from '@/lib/design-actions'
import { useEditorStore } from '@/store/editor-store'
import { toast } from '@/hooks/use-toast'

/** Cryptographically random handshake token (URL-fragment safe). */
function newHandshakeToken(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24)
}

export interface ServiceFrameProps {
  install: PluginInstallInfo
}

export function PluginServiceFrame({ install }: ServiceFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const brokerRef = useRef<PluginBroker | null>(null)

  // one handshake token per mount — never reused across remounts
  const handshake = useMemo(() => newHandshakeToken(), [])

  // the service entry the manifest declared (validator guarantees a
  // safe relative .html path whenever elements exist; the defensive
  // fallback keeps the iframe pointed inside the bundle either way)
  const serviceSrc = useMemo(() => {
    const file = install.entry?.service && /^[\w][\w./-]*\.html$/.test(install.entry.service) ? install.entry.service : 'service.html'
    return `/api/plugins/${encodeURIComponent(install.installId)}/serve/${file}#${encodeURIComponent(handshake)}`
  }, [install.installId, install.entry, handshake])

  const hostVersion = useMemo(() => {
    const el = document.querySelector('meta[name="canvix-version"]')
    return el?.getAttribute('content') ?? 'dev'
  }, [])

  const attachBroker = useCallback(() => {
    const frame = iframeRef.current?.contentWindow
    if (!frame || brokerRef.current) return

    const record: BrokerInstall = {
      installId: install.installId,
      pluginId: install.pluginId,
      version: install.version,
      // the consent record — renderer registration itself needs
      // `element:plugin`; a plugin that never asked simply never
      // registers, and its elements stay placeholders
      permissions: install.grantedPermissions,
      elementKinds: install.elements.map((e) => e.kind),
    }
    const broker = new PluginBroker({
      install: record,
      host: {
        getDesignState: () => {
          const s = useEditorStore.getState()
          return { pages: s.pages, currentPage: s.currentPage, readOnly: s.readOnly }
        },
        applyAction: (action, caller) => applyDesignAction({ ...action, type: String(action.type) }, caller),
        notify: (text) => toast({ title: install.name, description: text }),
        closePanel: () => undefined, // a service frame has no panel to close
        logError: (scope, error) => console.error(`[plugin:${install.pluginId}] ${scope}`, error),
      },
      storage: new PluginStorage(install.pluginId),
      hostVersion,
      context: 'service',
      // P5: the moment this frame's renderer registers, renders that
      // degraded while it was booting get re-attempted (dev cold
      // compiles of the serve route can outrun the 12 s boot grace)
      onKindsChanged: () => notifyRendererKindsChanged(install.pluginId),
    })
    const onMessage = (ev: MessageEvent) => broker.handleMessage(ev)
    broker.attach(frame, handshake, onMessage)
    brokerRef.current = broker
    // THIS is what makes it a render transport — plugin elements on
    // the canvas can now be drawn by this frame
    setRenderTransport(install.pluginId, broker)

    return () => {
      setRenderTransport(install.pluginId, null)
      broker.dispose(onMessage)
      brokerRef.current = null
    }
  }, [install, handshake, hostVersion])

  useEffect(() => {
    const cleanup = attachBroker()
    return cleanup
  }, [attachBroker])

  return (
    <iframe
      ref={iframeRef}
      title={`${install.name} renderer (sandboxed service)`}
      // THE SECURITY BOUNDARY — allow-scripts ONLY (same as panels):
      // opaque origin, no cookies/DOM/storage of the host
      sandbox="allow-scripts"
      src={serviceSrc}
      className="w-0 h-0 border-0"
      tabIndex={-1}
      aria-hidden
    />
  )
}
