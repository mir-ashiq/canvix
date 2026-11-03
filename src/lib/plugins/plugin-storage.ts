// ─────────────────────────────────────────────────────────────
// Plugin storage — tier 2 of the storage model (research
// PLUGIN-SYSTEM.md §4.8): per-plugin settings in localStorage,
// namespaced `canvix:plugin:<pluginId>:*`, 256 KB per plugin.
//
// The BROKER owns this module — plugins never touch localStorage
// directly (they cannot: sandbox="allow-scripts" gives them an
// opaque origin and a null localStorage). Every key the broker
// reads or writes is forced inside the plugin's own prefix, so
// one plugin can neither read another plugin's keys nor any host
// key (brand kit precedent: same browser-local approach).
//
// Cross-device sync is deliberately NOT here — that is phase 3's
// optional PluginStorage table. MVP settings follow the browser.
// ─────────────────────────────────────────────────────────────

import { checkCloneSafe } from './data-caps'

/** Full key prefix — `canvix:plugin:<pluginId>:`. */
export const PLUGIN_STORAGE_PREFIX = 'canvix:plugin:'

/** Total bytes (key + value, UTF-8) one plugin may occupy (§4.7). */
export const PLUGIN_STORAGE_QUOTA_BYTES = 256 * 1024

/** A single value may not eat the whole quota — keep headroom. */
export const MAX_VALUE_BYTES = 64 * 1024

/** Storage key charset — no traversal, no spaces, no colons. */
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

/** pluginId shape — reverse-DNS, already enforced by the manifest validator. */
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9.-]{1,99}$/

/** The localStorage surface the broker needs (injectable for tests). */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  key(index: number): string | null
  readonly length: number
}

export type StorageErrorCode = 'E_KEY' | 'E_VALUE' | 'E_QUOTA' | 'E_STORAGE'

export type StorageResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; code: StorageErrorCode; message: string }

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length
}

/** In-memory fallback for non-browser contexts (never happens in the panel flow). */
function memoryStorage(): StorageLike {
  const map = new Map<string, string>()
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size
    },
  }
}

function defaultStorage(): StorageLike {
  try {
    return globalThis.localStorage ?? memoryStorage()
  } catch {
    return memoryStorage()
  }
}

export class PluginStorage {
  readonly prefix: string

  constructor(
    readonly pluginId: string,
    private readonly storage: StorageLike = defaultStorage(),
  ) {
    if (!PLUGIN_ID_RE.test(pluginId)) {
      // pluginId comes from an install row the server validated —
      // this guard is belt-and-braces against a corrupted row.
      throw new Error('PluginStorage: invalid pluginId')
    }
    this.prefix = `${PLUGIN_STORAGE_PREFIX}${pluginId}:`
  }

  /** Read one key. Missing keys resolve to `null` (KV semantics, not an error). */
  get(key: string): StorageResult<unknown> {
    const keyErr = this.checkKey(key)
    if (keyErr) return keyErr
    const raw = this.storage.getItem(this.prefix + key)
    if (raw === null) return { ok: true, value: null }
    try {
      return { ok: true, value: JSON.parse(raw) as unknown }
    } catch {
      // corrupted entry — surface it rather than crash the panel
      return { ok: false, code: 'E_STORAGE', message: 'stored value is not valid JSON (was localStorage edited?)' }
    }
  }

  /** Write one JSON value inside the quota. */
  set(key: string, value: unknown): StorageResult {
    const keyErr = this.checkKey(key)
    if (keyErr) return keyErr
    // structured-clone-safe first: functions/DOM nodes/BigInt never
    // survive postMessage round-trips either, so reject them here.
    const cloneErr = checkCloneSafe(value, { maxBytes: MAX_VALUE_BYTES })
    if (cloneErr) return { ok: false, code: 'E_VALUE', message: cloneErr }
    const encoded = JSON.stringify(value) ?? 'null'
    const entryBytes = utf8Bytes(this.prefix + key) + utf8Bytes(encoded)
    if (entryBytes > PLUGIN_STORAGE_QUOTA_BYTES) {
      return { ok: false, code: 'E_QUOTA', message: `value is larger than the ${Math.round(PLUGIN_STORAGE_QUOTA_BYTES / 1024)} KB storage quota` }
    }
    // account current usage WITHOUT this key (a set may overwrite)
    let usage = this.usageBytes()
    const existing = this.storage.getItem(this.prefix + key)
    if (existing !== null) {
      usage -= utf8Bytes(this.prefix + key) + utf8Bytes(existing)
    }
    if (usage + entryBytes > PLUGIN_STORAGE_QUOTA_BYTES) {
      return {
        ok: false,
        code: 'E_QUOTA',
        message: `storage quota exceeded (${Math.round(PLUGIN_STORAGE_QUOTA_BYTES / 1024)} KB) — remove unused keys first`,
      }
    }
    try {
      this.storage.setItem(this.prefix + key, encoded)
    } catch {
      return { ok: false, code: 'E_STORAGE', message: 'localStorage is unavailable (private mode?)' }
    }
    return { ok: true, value: undefined }
  }

  /** Remove one key. Removing a missing key is a no-op. */
  remove(key: string): StorageResult {
    const keyErr = this.checkKey(key)
    if (keyErr) return keyErr
    this.storage.removeItem(this.prefix + key)
    return { ok: true, value: undefined }
  }

  /** This plugin's keys, relative (no prefix). */
  keys(): string[] {
    const out: string[] = []
    for (let i = 0; i < this.storage.length; i++) {
      const full = this.storage.key(i)
      if (full !== null && full.startsWith(this.prefix)) out.push(full.slice(this.prefix.length))
    }
    return out.sort()
  }

  /** Current UTF-8 usage of this plugin's namespace (keys + values). */
  usageBytes(): number {
    let total = 0
    for (const key of this.keys()) {
      const raw = this.storage.getItem(this.prefix + key)
      total += utf8Bytes(this.prefix + key) + (raw === null ? 0 : utf8Bytes(raw))
    }
    return total
  }

  private checkKey(key: string): { ok: false; code: StorageErrorCode; message: string } | null {
    if (typeof key !== 'string' || !KEY_RE.test(key)) {
      return { ok: false, code: 'E_KEY', message: 'storage keys are 1–64 chars of [A-Za-z0-9_.-]' }
    }
    return null
  }
}
