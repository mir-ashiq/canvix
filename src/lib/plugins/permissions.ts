// ─────────────────────────────────────────────────────────────
// Plugin permissions — the middle leg of the trust chain
// (research/PLUGIN-SYSTEM.md §4.6):
//
//   manifest DECLARES → consent screen GRANTS → broker ENFORCES
//
// Everything here is default-deny: a method with no matching
// granted permission answers E_PERMISSION at the RPC broker, and
// an undeclared-but-requested network origin never reaches the
// serve-route CSP (plugin-csp.ts) at all.
// ─────────────────────────────────────────────────────────────

import { parseGrantedOrigin } from '@/lib/security/plugin-csp'

/** Permissions a manifest may declare (§4.6). `network:<origin>` is repeatable. */
export const PLUGIN_PERMISSIONS = [
  'design:read',
  'design:write',
  'element:plugin',
  'storage',
  'ui:notify',
] as const

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number]

/** Hard caps so a manifest cannot spam the consent screen. */
export const MAX_NON_NETWORK_PERMISSIONS = 8
export const MAX_NETWORK_ORIGINS = 5

export interface ParsedPermission {
  /** canonical form, e.g. `design:read` or `network:https://api.example.com` */
  permission: string
  name: PluginPermission | 'network'
  /** only for `network` — the validated https (or loopback) origin */
  origin?: string
}

/**
 * Parse and canonicalise one permission string.
 * Returns null for anything not in the catalog — unknown
 * permissions block install (never a silent no-op).
 */
export function parsePermission(raw: string): ParsedPermission | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if ((PLUGIN_PERMISSIONS as readonly string[]).includes(value)) {
    return { permission: value, name: value as PluginPermission }
  }
  if (value.startsWith('network:')) {
    const origin = parseGrantedOrigin(value.slice('network:'.length))
    if (!origin) return null
    return { permission: `network:${origin}`, name: 'network', origin }
  }
  return null
}

/** Plain-language line for the consent screen (§4.2: verbatim, user-readable). */
export function describePermission(p: ParsedPermission): string {
  switch (p.name) {
    case 'design:read':
      return 'Read the design you have open — pages, elements and their properties'
    case 'design:write':
      return 'Add, edit and delete elements in this design (via Canvix\u2019s undoable actions)'
    case 'element:plugin':
      return 'Add its own element types to the canvas and draw them'
    case 'storage':
      return 'Remember its settings in this browser (namespaced, 256 KB cap)'
    case 'ui:notify':
      return 'Show toast notifications and close its own panel'
    case 'network':
      return `Send and receive data with ${p.origin} — the only server it may contact`
  }
}

/**
 * Validate a manifest's whole permission list.
 * Output is what install records and the consent screen show.
 */
export function normalizePermissions(
  raw: unknown,
): { ok: true; permissions: string[]; networkOrigins: string[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'permissions must be an array' }
  const permissions: string[] = []
  const networkOrigins: string[] = []
  for (const item of raw) {
    const parsed = parsePermission(item)
    if (!parsed) {
      return { ok: false, error: `unknown permission ${JSON.stringify(item)}` }
    }
    if (parsed.name === 'network') {
      if (!networkOrigins.includes(parsed.origin!)) networkOrigins.push(parsed.origin!)
      if (networkOrigins.length > MAX_NETWORK_ORIGINS) {
        return { ok: false, error: `at most ${MAX_NETWORK_ORIGINS} network origins are allowed` }
      }
    } else if (!permissions.includes(parsed.permission)) {
      permissions.push(parsed.permission)
    }
  }
  if (permissions.length > MAX_NON_NETWORK_PERMISSIONS) {
    return { ok: false, error: `at most ${MAX_NON_NETWORK_PERMISSIONS} non-network permissions are allowed` }
  }
  return { ok: true, permissions, networkOrigins }
}

// ── broker side: method → required permission (§4.3 table) ────

/**
 * Every plugin→host RPC method the broker understands (v1, §4.3).
 * `null` = no permission required (safe introspection only).
 */
export const RPC_METHODS: Record<string, PluginPermission | null> = {
  info: null,
  ping: null,
  'design.getSnapshot': 'design:read',
  subscribe: 'design:read',
  'actions.apply': 'design:write',
  'elements.registerRenderer': 'element:plugin',
  'storage.get': 'storage',
  'storage.set': 'storage',
  'storage.remove': 'storage',
  'storage.keys': 'storage',
  'ui.notify': 'ui:notify',
  'ui.closePanel': 'ui:notify',
}

/**
 * Host→plugin invocations (same envelope, opposite direction):
 * the plugin side should accept exactly these.
 */
export const HOST_CALL_METHODS: ReadonlySet<string> = new Set([
  'elements.render', // renderer contract §4.5: { data, width, height, mode }
  'event', // subscription push: { topic: 'selection' | 'document', payload }
])

/**
 * Permission a method needs. Returns:
 *   string  → the required permission
 *   null    → method exists, no permission needed (info/ping)
 *   undefined → no such method (broker answers E_METHOD)
 *
 * Object.hasOwn — a plain property lookup would happily "find"
 * `constructor` and friends on the prototype chain.
 */
export function requiredPermission(method: string): PluginPermission | null | undefined {
  return Object.hasOwn(RPC_METHODS, method) ? RPC_METHODS[method] : undefined
}

/** True when `granted` (an install's normalized permission list) covers a method. */
export function methodAllowed(method: string, granted: readonly string[]): boolean {
  const need = requiredPermission(method)
  if (need === undefined) return false
  if (need === null) return true
  return granted.includes(need)
}
