// ─────────────────────────────────────────────────────────────
// Plugin renderer cache — the host half of the renderer contract
// (research/PLUGIN-SYSTEM.md §4.5, P4).
//
// One module-level store that answers a single question for every
// consumer (canvas node, svg-export, video-export, thumbnails):
//
//   "What does plugin element E look like at box (w, h) in mode M?"
//
// Answers are produced by the owning plugin's SERVICE iframe via
// broker.callPlugin('elements.render', …), sanitized here (the ONE
// place untrusted SVG enters host code), and cached by
//
//   (pluginId, elementId, hash(data), w, h, mode)
//
// so a restyle (data change) or a resize re-renders, and everything
// else is a cache hit. Renders are DETERMINISTIC by contract — the
// seed lives in `data` — so a cached answer is the answer.
//
// Failure philosophy (§4.5 "Failure"): render error, timeout, or a
// missing/disabled plugin → a neutral placeholder. Data is never
// touched; the editor never blocks; a plugin iframe death degrades
// to placeholders, never crashes the host.
//
// Environment: pure TS + injectable transports — node unit tests
// drive it with fake brokers, the browser with real ones.
// ─────────────────────────────────────────────────────────────

import type { PluginElement } from '@/lib/types'
import { sanitizePluginSvg, MAX_PLUGIN_SVG_BYTES } from './sanitize-svg'

/** Render modes (§4.5): 'canvas' = editor/thumbnails, 'export' =
 *  SVG/PNG/PDF/video serialization. Plugins may sharpen or simplify
 *  for export; the input shape is identical. */
export type RenderMode = 'canvas' | 'export'

/** What the layer knows about one install (from GET /api/plugins). */
export interface PluginInstallInfo {
  installId: string
  pluginId: string
  name: string
  version: string
  enabled: boolean
  /** granted (normalized) permission strings — the consent record */
  grantedPermissions: string[]
  /** manifest entry paths (safe relatives, DB-served) */
  entry: { panel?: string; service?: string }
  /** manifest elements[] — kinds + labels + schema (for the properties slot) */
  elements: { kind: string; label: string; schema: unknown[] }[]
}

export type PluginSystemStatus = 'unknown' | 'off' | 'ready'

export interface PluginSystemState {
  /** 'unknown' = not fetched yet · 'off' = flag disabled / signed out · 'ready' = list loaded */
  status: PluginSystemStatus
  installs: Map<string, PluginInstallInfo>
}

/** The minimal broker surface this cache needs (real PluginBroker fits). */
export interface RenderTransport {
  kinds: ReadonlySet<string>
  isHandshaked: boolean
  callPlugin(method: 'elements.render', params: unknown, opts?: { timeoutMs?: number }): Promise<unknown>
}

// ── state ────────────────────────────────────────────────────

let systemState: PluginSystemState = { status: 'unknown', installs: new Map() }
const systemListeners = new Set<() => void>()

const brokers = new Map<string, RenderTransport>()
/** Bumped on every broker mount/unmount — nodes re-attempt renders. */
let brokerEpoch = 0

export type RenderEntry =
  | { status: 'pending' }
  | { status: 'ok'; dataUrl: string; svg: string | null }
  | { status: 'error'; message: string }

interface CacheCell {
  entry: RenderEntry
  listeners: Set<() => void>
  /** watchdog timer id — settles a pending render whose transport never arrived */
  watchdog: ReturnType<typeof setTimeout> | null
  settled: boolean
  /** a transport call is in flight — later kicks are no-ops */
  started: boolean
}

const renderCache = new Map<string, CacheCell>()
/** Bounded cache: settled entries beyond this are evicted oldest-first. */
const MAX_CACHED_RENDERS = 120
/** Grace for a pending render whose service iframe is still booting. */
const BOOT_GRACE_MS = 12_000

// ── install-state store ──────────────────────────────────────

export function getPluginSystemState(): PluginSystemState {
  return systemState
}

export function getBrokerEpoch(): number {
  return brokerEpoch
}

/** Snapshot for useSyncExternalStore (must be referentially stable between changes). */
export function subscribePluginSystem(cb: () => void): () => void {
  systemListeners.add(cb)
  return () => systemListeners.delete(cb)
}

/** Called by the service layer: the installs list arrived (ready) or
 *  the flag/auth gate says the system is off. */
export function setPluginSystemState(status: PluginSystemStatus, installs?: PluginInstallInfo[]): void {
  const map = new Map<string, PluginInstallInfo>()
  for (const i of installs ?? []) map.set(i.pluginId, i)
  systemState = { status, installs: map }
  for (const cb of systemListeners) cb()
}

/** Mount/unmount the transport for a plugin (its service broker). */
export function setRenderTransport(pluginId: string, transport: RenderTransport | null): void {
  if (transport) brokers.set(pluginId, transport)
  else brokers.delete(pluginId)
  brokerEpoch += 1
  // drop this plugin's settled renders — a fresh frame may render
  // differently after a plugin update/reinstall; pending cells keep
  // waiting for their own settle (the disposed broker rejects them)
  for (const [key, cell] of renderCache) {
    if (!key.startsWith(pluginId + '|')) continue
    if (cell.settled) renderCache.delete(key)
  }
  for (const cb of systemListeners) cb()
}

/**
 * P5: a service broker just registered a renderer kind. Renders that
 * degraded to "not responding" while its iframe was still booting (a
 * dev-mode cold compile of the serve route can outrun the 12 s boot
 * grace) get one more attempt — their settled ERROR cells are dropped
 * and the broker-epoch bump re-kicks every canvas node watching this
 * plugin. OK renders are never re-requested (deterministic contract).
 */
export function notifyRendererKindsChanged(pluginId: string): void {
  brokerEpoch += 1
  for (const [key, cell] of renderCache) {
    if (!key.startsWith(pluginId + '|')) continue
    if (cell.settled && cell.entry.status === 'error') renderCache.delete(key)
  }
  for (const cb of systemListeners) cb()
}

/** Placeholder reason for an element whose plugin cannot render it
 *  right now (§4.9 matrix). null = render normally. */
export function placeholderReason(el: PluginElement): { reason: 'loading' | 'off' | 'missing' | 'disabled'; label: string } | { reason: 'render'; label: null } | null {
  if (systemState.status === 'unknown') {
    return { reason: 'loading', label: 'Checking installed apps…' }
  }
  if (systemState.status === 'off') {
    return { reason: 'off', label: 'Plugins are disabled on this Canvix instance' }
  }
  const install = systemState.installs.get(el.pluginId)
  if (!install) {
    return { reason: 'missing', label: `Install “${el.pluginId}” to view this element` }
  }
  if (!install.enabled) {
    return { reason: 'disabled', label: `“${install.name}” is disabled` }
  }
  return null
}

// ── cache keys ───────────────────────────────────────────────

/** FNV-1a — fast, deterministic, good enough for a cache key. */
function hashData(data: Record<string, unknown>): string {
  const s = JSON.stringify(data) ?? ''
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export function renderKey(el: PluginElement, mode: RenderMode): string {
  const w = clampDim(el.width)
  const h = clampDim(el.height)
  return `${el.pluginId}|${el.id}|${hashData(el.data)}|${w}x${h}|${mode}`
}

function clampDim(n: number): number {
  return Math.min(8000, Math.max(8, Math.round(Number(n) || 8)))
}

// ── render pipeline ──────────────────────────────────────────

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** Validate + normalize a renderer result (§4.5). */
function normalizeRenderResult(result: unknown): { dataUrl: string; svg: string | null } | { error: string } {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    return { error: 'renderer result must be an object { svg } or { raster }' }
  }
  const r = result as { svg?: unknown; raster?: unknown }
  if (typeof r.svg === 'string') {
    const clean = sanitizePluginSvg(r.svg)
    if (!clean.ok) return { error: `renderer output rejected: ${clean.error}` }
    return { dataUrl: svgToDataUrl(clean.svg), svg: clean.svg }
  }
  if (typeof r.raster === 'string') {
    if (!/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(r.raster)) {
      return { error: 'raster must be a base64 png/jpeg/gif/webp data URL' }
    }
    if (r.raster.length > MAX_PLUGIN_SVG_BYTES) {
      return { error: `renderer output is ${r.raster.length} bytes — the cap is ${MAX_PLUGIN_SVG_BYTES}` }
    }
    return { dataUrl: r.raster, svg: null }
  }
  return { error: 'renderer result must carry svg or raster' }
}

function ensureCell(key: string): CacheCell {
  let cell = renderCache.get(key)
  if (!cell) {
    cell = { entry: { status: 'pending' }, listeners: new Set(), watchdog: null, settled: false, started: false }
    renderCache.set(key, cell)
  }
  return cell
}

function settleCell(key: string, cell: CacheCell, entry: RenderEntry): void {
  if (cell.settled) return
  cell.settled = true
  if (cell.watchdog) clearTimeout(cell.watchdog)
  cell.watchdog = null
  cell.entry = entry
  for (const cb of cell.listeners) cb()
  cell.listeners.clear()
  evict()
}

function evict(): void {
  if (renderCache.size <= MAX_CACHED_RENDERS) return
  for (const [key, cell] of renderCache) {
    if (renderCache.size <= MAX_CACHED_RENDERS) break
    if (cell.settled) renderCache.delete(key)
  }
}

/** Kick off (or join) the render for one element. Safe to call
 *  repeatedly — idempotent per key until settled. */
export function requestRender(el: PluginElement, mode: RenderMode): void {
  const key = renderKey(el, mode)
  const cell = ensureCell(key)
  if (cell.settled) return

  // placeholder states need no transport (§4.9) — but they can flip
  // (install arrives, plugin enabled), so callers re-request on
  // broker-epoch changes; a pending cell without a reason resolves
  // through its watchdog
  const reason = placeholderReason(el)
  if (reason && reason.reason !== 'render') {
    if (!cell.watchdog) {
      cell.watchdog = setTimeout(() => {
        const c = renderCache.get(key)
        if (c && !c.settled) settleCell(key, c, { status: 'error', message: reason.label })
      }, BOOT_GRACE_MS)
    }
    return
  }

  const transport = brokers.get(el.pluginId)
  if (!transport || !transport.isHandshaked || !transport.kinds.has(el.kind)) {
    // service iframe still booting (or this plugin ships no renderer
    // for the kind) — wait, then degrade honestly
    if (!cell.watchdog) {
      cell.watchdog = setTimeout(() => {
        const c = renderCache.get(key)
        if (c && !c.settled) {
          settleCell(key, c, {
            status: 'error',
            message: transport
              ? `“${el.pluginId}” has not registered a renderer for “${el.kind}”`
              : `“${el.pluginId}” is not responding`,
          })
        }
      }, BOOT_GRACE_MS)
    }
    return
  }

  // one in-flight call per key — re-kicks while the promise is
  // outstanding are no-ops (they carry the same deterministic input)
  if (cell.started) return
  cell.started = true

  void transport
    .callPlugin('elements.render', {
      kind: el.kind,
      data: el.data,
      width: clampDim(el.width),
      height: clampDim(el.height),
      mode,
    })
    .then(
      (result) => {
        const norm = normalizeRenderResult(result)
        const c = renderCache.get(key) ?? cell
        settleCell(
          key,
          c,
          'dataUrl' in norm
            ? { status: 'ok', dataUrl: norm.dataUrl, svg: norm.svg }
            : { status: 'error', message: norm.error },
        )
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : 'renderer failed'
        const c = renderCache.get(key) ?? cell
        settleCell(key, c, { status: 'error', message })
      },
    )
}

/** Current entry for a key (undefined = never requested). */
export function getRenderEntry(key: string): RenderEntry | undefined {
  return renderCache.get(key)?.entry
}

/** Subscribe to one render key (useSyncExternalStore pattern). */
export function subscribeRender(key: string, cb: () => void): () => void {
  const cell = ensureCell(key)
  if (cell.settled) return () => undefined
  cell.listeners.add(cb)
  return () => cell.listeners.delete(cb)
}

/** Export path: await the render (placeholder-generating on failure).
 *  Never rejects — an error is returned as an error entry so exports
 *  can draw the placeholder instead of failing the whole file. */
export async function awaitRender(el: PluginElement, mode: RenderMode): Promise<RenderEntry> {
  requestRender(el, mode)
  const key = renderKey(el, mode)
  const cell = renderCache.get(key)
  if (!cell) return { status: 'error', message: 'render was not started' }
  if (cell.settled) return cell.entry
  return new Promise<RenderEntry>((resolve) => {
    const done = () => {
      const c = renderCache.get(key)
      if (c?.settled) resolve(c.entry)
    }
    cell.listeners.add(done)
  })
}

/** Prime every plugin element on the pages (export pre-pass). */
export async function primePluginRenders(els: PluginElement[], mode: RenderMode): Promise<void> {
  await Promise.all(els.map((el) => awaitRender(el, mode)))
}

/** Collect every plugin element in the pages (groups included). */
export function collectPluginElements(pages: { elements: unknown[] }[]): PluginElement[] {
  const out: PluginElement[] = []
  const walk = (els: unknown[]) => {
    for (const el of els) {
      if (!el || typeof el !== 'object') continue
      const e = el as { type?: string; children?: unknown[] }
      if (e.type === 'plugin') out.push(el as PluginElement)
      else if (Array.isArray(e.children)) walk(e.children)
    }
  }
  for (const p of pages) walk(p.elements ?? [])
  return out
}

/** Test seam: wipe all state between unit tests. */
export function __resetRendererCache(): void {
  for (const cell of renderCache.values()) {
    if (cell.watchdog) clearTimeout(cell.watchdog)
  }
  renderCache.clear()
  brokers.clear()
  systemState = { status: 'unknown', installs: new Map() }
  brokerEpoch = 0
  for (const cb of systemListeners) cb()
}
