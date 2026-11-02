// ─────────────────────────────────────────────────────────────
// Plugin RPC broker — the host-side runtime half of the plugin
// system (research PLUGIN-SYSTEM.md §4.3, P3).
//
// One broker instance per mounted plugin iframe. It is the ONLY
// path between a plugin and the host:
//
//   origin discipline   ev.source === the iframe window we mounted
//                       (an opaque-origin frame cannot be named,
//                       so source identity IS the origin check)
//   handshake           a one-time token rides the iframe URL
//                       fragment; the first call must echo it
//   rate limit          200 calls / minute, then E_THROTTLE
//   permissions         every method is checked against the
//                       install's granted list (default-deny)
//   payload caps        every envelope passes the RPC byte cap
//
// The broker is framework-free and fully dependency-injected:
// node unit tests drive it with fake windows and storages, the
// PluginRuntime component drives it with the real ones.
//
// postMessage targetOrigin: a sandboxed iframe has an OPAQUE
// origin, so '*' is the only addressable target. This is safe
// because every INBOUND message is gated on ev.source identity —
// we only ever speak to the frame we mounted, and it cannot be
// navigated away without dropping our reference.
// ─────────────────────────────────────────────────────────────

import { checkCloneSafe } from './data-caps'
import { PluginStorage } from './plugin-storage'
import { pluginSnapshot, type PluginDesignSnapshot } from './snapshot'
import { methodAllowed, requiredPermission } from './permissions'
import {
  MAX_RPC_BYTES,
  RPC_API_MAJOR,
  RPC_API_MINOR,
  newRpcId,
  parseRpcCall,
  parseRpcResult,
  rpcErr,
  rpcOk,
  type RpcCall,
  type RpcErrorCode,
} from './rpc'

/** The validated action set a PANEL may drive (§4.3). */
export const PANEL_ACTION_TYPES: ReadonlySet<string> = new Set([
  'addText',
  'addImage',
  'updateElements',
  'deleteElements',
  'setBackground',
  'addPage',
  'duplicatePage',
  'alignElements',
  'distributeElements',
])

/** push-event topics a plugin may subscribe to (§4.3). */
export const SUBSCRIBE_TOPICS: ReadonlySet<string> = new Set(['selection', 'document'])

/** RPC rate budget (§4.7): 200 calls / minute, soft. */
export const RPC_RATE_CALLS = 200
export const RPC_RATE_WINDOW_MS = 60_000

/** How long a pushed event waits for the plugin's ack before dropping. */
export const EVENT_ACK_TIMEOUT_MS = 5_000

/** ui.notify text cap. */
export const NOTIFY_TEXT_MAX = 200

/** What the broker needs to know about an install. */
export interface BrokerInstall {
  installId: string
  pluginId: string
  version: string
  /** granted (normalized) permission strings — the consent record */
  permissions: string[]
}

/** Host capabilities the broker calls into (all injected, all mockable). */
export interface BrokerHost {
  /** current editor state for snapshots + read-only checks */
  getDesignState(): { pages: Parameters<typeof pluginSnapshot>[0]['pages']; currentPage: number; readOnly: boolean }
  /** execute a whitelisted design action (design-actions.ts) */
  applyAction(action: Record<string, unknown>): Promise<string>
  /** toast */
  notify(text: string): void
  /** close the plugin's panel */
  closePanel(): void
  /** structured error log — details never cross the RPC boundary */
  logError(scope: string, error: unknown): void
}

/** Minimal window surface (real iframes and test doubles both fit). */
export interface PostableWindow {
  postMessage(message: unknown, targetOrigin: string): void
}

export interface BrokerOptions {
  install: BrokerInstall
  host: BrokerHost
  storage: PluginStorage
  /** host app version for `info` (injected — no server imports here) */
  hostVersion: string
  /** 'panel' now; 'service' arrives with P4 renderers */
  context?: 'panel' | 'service'
  /** injectable clock for tests */
  now?: () => number
}

interface PendingAck {
  timer: ReturnType<typeof setTimeout>
  settled: boolean
}

export class PluginBroker {
  private readonly install: BrokerInstall
  private readonly host: BrokerHost
  private readonly storage: PluginStorage
  private readonly hostVersion: string
  private readonly context: 'panel' | 'service'
  private readonly now: () => number

  private iframeWindow: PostableWindow | null = null
  private handshakeToken: string | null = null
  private verified = false
  private disposed = false

  private readonly callTimestamps: number[] = []
  private readonly subscriptions = new Set<'selection' | 'document'>()
  private readonly pendingAcks = new Map<string, PendingAck>()

  constructor(opts: BrokerOptions) {
    this.install = opts.install
    this.host = opts.host
    this.storage = opts.storage
    this.hostVersion = opts.hostVersion
    this.context = opts.context ?? 'panel'
    this.now = opts.now ?? (() => Date.now())
  }

  /** Bind to the mounted iframe. `onMessage` must be wired to `window`. */
  attach(iframeWindow: PostableWindow, handshakeToken: string, onMessage: (ev: MessageEvent) => void): void {
    this.iframeWindow = iframeWindow
    this.handshakeToken = handshakeToken
    if (typeof window !== 'undefined') window.addEventListener('message', onMessage)
  }

  /** True after the plugin echoed the handshake token. */
  get isVerified(): boolean {
    return this.verified
  }

  get subscribedTopics(): ReadonlySet<'selection' | 'document'> {
    return this.subscriptions
  }

  /** Tear down: no listener leaks, no dangling ack timers. */
  dispose(onMessage?: (ev: MessageEvent) => void): void {
    this.disposed = true
    if (onMessage && typeof window !== 'undefined') window.removeEventListener('message', onMessage)
    for (const pending of this.pendingAcks.values()) clearTimeout(pending.timer)
    this.pendingAcks.clear()
    this.subscriptions.clear()
    this.iframeWindow = null
  }

  // ── inbound ─────────────────────────────────────────────────

  /** Handle one window MessageEvent. Safe to call for any event. */
  handleMessage(ev: MessageEvent): void {
    if (this.disposed || !this.iframeWindow) return
    // ORIGIN DISCIPLINE: the source must be exactly the frame we
    // mounted. An opaque-origin iframe cannot be named by origin,
    // so identity of the window object is the whole check.
    if ((ev as { source?: unknown }).source !== this.iframeWindow) return

    const data = (ev as { data?: unknown }).data
    if (typeof data !== 'object' || data === null) return
    const dir = (data as { dir?: unknown }).dir

    if (dir === 'call') {
      this.handleCall(data)
    } else if (dir === 'result') {
      this.handleResult(data)
    }
    // unknown dir — silently ignored (noise from a broken plugin)
  }

  private handleCall(data: unknown): void {
    const parsed = parseRpcCall(data, { methods: METHOD_CATALOG })
    if (!parsed.ok) {
      this.send(parsed.code === 'E_METHOD' ? rpcErr(this.safeId(data), parsed.code, parsed.message) : rpcErr(this.safeId(data), parsed.code, parsed.message))
      return
    }
    const call = parsed.value

    // HANDSHAKE: the first call must echo the token from its URL fragment.
    if (!this.verified) {
      if (call.handshake !== this.handshakeToken) {
        this.send(
          rpcErr(call.id, 'E_PERMISSION', 'handshake failed — remount the panel (the URL fragment token was not echoed)'),
        )
        return
      }
      this.verified = true
    }

    // RATE LIMIT (soft, per-iframe sliding window)
    if (!this.takeBudget()) {
      this.send(rpcErr(call.id, 'E_THROTTLE', `rate limit exceeded (${RPC_RATE_CALLS} calls/min) — back off and retry`))
      return
    }

    // PERMISSION (default-deny; unknown methods already answered E_METHOD)
    if (!methodAllowed(call.method, this.install.permissions)) {
      const need = requiredPermission(call.method)
      this.send(rpcErr(call.id, 'E_PERMISSION', `${need ?? call.method} was not granted to this plugin (consent screen)`))
      return
    }

    void this.dispatch(call).then(
      (result) => this.send(rpcOk(call.id, result)),
      (error: unknown) => {
        if (error instanceof BrokerError) {
          // typed broker rejection — its code is RPC-wire-legal
          this.send(rpcErr(call.id, error.code, error.message))
          return
        }
        this.host.logError(`plugin ${this.install.pluginId} ${call.method}`, error)
        this.send(rpcErr(call.id, 'E_INTERNAL', 'host-side failure (details are in the server logs)'))
      },
    )
  }

  private handleResult(data: unknown): void {
    if (!this.verified) return // acks only count post-handshake
    const parsed = parseRpcResult(data)
    if (!parsed.ok) return // malformed acks are dropped, not fatal
    const pending = this.pendingAcks.get(parsed.value.id)
    if (pending && !pending.settled) {
      pending.settled = true
      clearTimeout(pending.timer)
      this.pendingAcks.delete(parsed.value.id)
    }
  }

  private async dispatch(call: RpcCall): Promise<unknown> {
    switch (call.method) {
      case 'info':
        return {
          api: { major: RPC_API_MAJOR, minor: RPC_API_MINOR },
          host: this.hostVersion,
          plugin: { id: this.install.pluginId, version: this.install.version },
          capabilities: { panel: true, renderer: this.context === 'service' },
        }
      case 'ping':
        return { pong: true, t: this.now() }

      case 'design.getSnapshot': {
        const state = this.host.getDesignState()
        const snapshot: PluginDesignSnapshot = pluginSnapshot({ pages: state.pages, currentPage: state.currentPage })
        const err = checkCloneSafe(snapshot, { maxBytes: MAX_RPC_BYTES })
        if (err) {
          throw new BrokerError('E_PAYLOAD', `design snapshot exceeds the ${Math.round(MAX_RPC_BYTES / 1024)} KB plugin cap — split or simplify the design`)
        }
        return snapshot
      }

      case 'subscribe': {
        const topic = (call.params as { topic?: unknown } | undefined)?.topic
        if (typeof topic !== 'string' || !SUBSCRIBE_TOPICS.has(topic)) {
          throw new BrokerError('E_PAYLOAD', `topic must be one of ${Array.from(SUBSCRIBE_TOPICS).join(', ')}`)
        }
        this.subscriptions.add(topic as 'selection' | 'document')
        return { subscribed: Array.from(this.subscriptions) }
      }

      case 'actions.apply': {
        const state = this.host.getDesignState()
        if (state.readOnly) {
          throw new BrokerError('E_PERMISSION', 'this design is read-only — design:write is suspended')
        }
        const action = (call.params as { action?: unknown } | undefined)?.action
        if (typeof action !== 'object' || action === null || Array.isArray(action)) {
          throw new BrokerError('E_PAYLOAD', 'params.action must be an object')
        }
        const type = (action as { type?: unknown }).type
        if (typeof type !== 'string' || !PANEL_ACTION_TYPES.has(type)) {
          throw new BrokerError(
            'E_PAYLOAD',
            `unknown action type — allowed: ${Array.from(PANEL_ACTION_TYPES).join(', ')} (addPluginElement arrives with element support)`,
          )
        }
        const message = await this.host.applyAction(action as Record<string, unknown>)
        return { message }
      }

      case 'elements.registerRenderer':
        // P4 wires this for service iframes; a panel cannot render.
        if (this.context !== 'service') {
          throw new BrokerError('E_METHOD', 'renderer registration is only available to element service iframes (P4)')
        }
        throw new BrokerError('E_METHOD', 'service renderer wiring is not enabled in this build')

      case 'storage.get': {
        const key = (call.params as { key?: unknown } | undefined)?.key
        const res = this.storage.get(asKey(key))
        if (!res.ok) throw storageError(res)
        return { value: res.value }
      }
      case 'storage.set': {
        const p = (call.params ?? {}) as { key?: unknown; value?: unknown }
        const res = this.storage.set(asKey(p.key), p.value)
        if (!res.ok) throw storageError(res)
        return { ok: true }
      }
      case 'storage.remove': {
        const key = (call.params as { key?: unknown } | undefined)?.key
        const res = this.storage.remove(asKey(key))
        if (!res.ok) throw storageError(res)
        return { ok: true }
      }
      case 'storage.keys':
        return { keys: this.storage.keys() }

      case 'ui.notify': {
        const text = (call.params as { text?: unknown } | undefined)?.text
        if (typeof text !== 'string' || !text.trim()) {
          throw new BrokerError('E_PAYLOAD', 'params.text must be a non-empty string')
        }
        this.host.notify(text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, NOTIFY_TEXT_MAX))
        return { ok: true }
      }
      case 'ui.closePanel':
        this.host.closePanel()
        return { ok: true }

      default:
        // unreachable: parseRpcCall already filtered the catalog
        throw new BrokerError('E_METHOD', `unknown method "${call.method}"`)
    }
  }

  // ── outbound (host → plugin pushes) ─────────────────────────

  /**
   * Push a subscription event into the iframe (fire-and-forget
   * with a bounded ack wait). Call this from store listeners.
   */
  pushEvent(topic: 'selection' | 'document', payload: unknown): void {
    if (this.disposed || !this.iframeWindow || !this.subscriptions.has(topic)) return
    const err = checkCloneSafe(payload, { maxBytes: MAX_RPC_BYTES })
    if (err) return // never let a push blow the cap — drop silently
    const id = newRpcId()
    const pending: PendingAck = { settled: false, timer: setTimeout(() => this.pendingAcks.delete(id), EVENT_ACK_TIMEOUT_MS) }
    this.pendingAcks.set(id, pending)
    this.send({ v: RPC_API_MAJOR, id, dir: 'call', method: 'event', params: { topic, payload } })
  }

  // ── helpers ─────────────────────────────────────────────────

  private send(envelope: unknown): void {
    if (!this.iframeWindow || this.disposed) return
    try {
      this.iframeWindow.postMessage(envelope, '*')
    } catch {
      // frame went away mid-call — nothing to deliver to
    }
  }

  /** Sliding-window budget: true when the call is allowed. */
  private takeBudget(): boolean {
    const t = this.now()
    const cutoff = t - RPC_RATE_WINDOW_MS
    while (this.callTimestamps.length && this.callTimestamps[0] <= cutoff) this.callTimestamps.shift()
    if (this.callTimestamps.length >= RPC_RATE_CALLS) return false
    this.callTimestamps.push(t)
    return true
  }

  /** Best-effort id for parse failures (so even garbage gets an answer). */
  private safeId(data: unknown): string {
    const id = (data as { id?: unknown } | null)?.id
    return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(id) ? id : 'rpc_unparsed'
  }
}

/** Typed broker-side rejection — its code rides the RPC error wire. */
export class BrokerError extends Error {
  constructor(readonly code: RpcErrorCode, message: string) {
    super(message)
    this.name = 'BrokerError'
  }
}

/**
 * Map a storage-layer error onto the RPC error code space. The
 * storage codes (E_KEY/E_VALUE/E_QUOTA/E_STORAGE) are NOT wire
 * codes — a plugin-side parseRpcResult would reject them — so
 * they fold into E_PAYLOAD with the explanatory message intact.
 */
function storageError(res: { ok: false; code: string; message: string }): BrokerError {
  return new BrokerError('E_PAYLOAD', `storage: ${res.message}`)
}

function asKey(key: unknown): string {
  return typeof key === 'string' ? key : ''
}

/** The plugin→host method catalog as a plain record for parseRpcCall. */
const METHOD_CATALOG: Record<string, unknown> = {
  info: null,
  ping: null,
  'design.getSnapshot': null,
  subscribe: null,
  'actions.apply': null,
  'elements.registerRenderer': null,
  'storage.get': null,
  'storage.set': null,
  'storage.remove': null,
  'storage.keys': null,
  'ui.notify': null,
  'ui.closePanel': null,
}
