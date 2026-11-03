// ─────────────────────────────────────────────────────────────
// Plugin data caps — one clone-safety checker for everything a
// plugin may put on the wire (research §4.7):
//
//   RPC params/results · element `data` · manifest initialData ·
//   renderer input/output payloads · storage values
//
// The limits are deliberately IDENTICAL to the collab op payload
// caps (`validateOpPayload`, src/lib/collab/protocol.ts) so a
// plugin value that passes here can ride autosave, collab ops and
// Postgres jsonb unchanged — no second translation layer, no
// "works in the editor, rejected by the server" surprises.
//
// The plugin wire protocol is JSON-typed: null/boolean/number/
// string/array/plain-object only. Richer structured-clone types
// (Date, Map, Set, RegExp, class instances) are rejected on
// purpose — they cannot be persisted by the rest of the system.
// ─────────────────────────────────────────────────────────────

/** Serialized-size cap per payload — the collab MAX_EVENT_BYTES. */
export const PLUGIN_DATA_MAX_BYTES = 256 * 1024
/** Maximum nesting depth. */
export const PLUGIN_DATA_MAX_DEPTH = 12
/** Maximum array length. */
export const PLUGIN_DATA_MAX_ARRAY = 500
/** Maximum string length. */
export const PLUGIN_DATA_MAX_STRING = 100_000
/** Maximum object keys per level. */
export const PLUGIN_DATA_MAX_KEYS = 60

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/**
 * Validate a plugin-supplied value against the data caps.
 * Returns `null` when safe, or a plain-language error string
 * naming the violation (never a silent no-op, §4.1).
 */
export function checkCloneSafe(
  value: unknown,
  opts: { maxBytes?: number; depth?: number; maxString?: number } = {},
): string | null {
  const maxBytes = opts.maxBytes ?? PLUGIN_DATA_MAX_BYTES
  const maxDepth = opts.depth ?? PLUGIN_DATA_MAX_DEPTH
  const maxString = opts.maxString ?? PLUGIN_DATA_MAX_STRING

  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    return 'payload is not serializable (circular reference or unsupported type)'
  }
  // top-level functions/symbols/undefined stringify to undefined
  if (serialized === undefined) {
    return 'payload is not serializable (top-level function, symbol or undefined)'
  }
  if (serialized.length > maxBytes) {
    return `payload is ${serialized.length} bytes — the cap is ${maxBytes}`
  }

  const walk = (v: unknown, depth: number, path: string): string | null => {
    if (v === null || v === undefined) return null
    if (typeof v === 'boolean') return null
    if (typeof v === 'number') {
      return Number.isFinite(v) ? null : `${path}: non-finite number`
    }
    if (typeof v === 'string') {
      return v.length <= maxString
        ? null
        : `${path}: string longer than ${maxString} characters`
    }
    if (Array.isArray(v)) {
      if (v.length > PLUGIN_DATA_MAX_ARRAY) {
        return `${path}: array longer than ${PLUGIN_DATA_MAX_ARRAY} items`
      }
      if (depth >= maxDepth) return `${path}: nested deeper than ${maxDepth} levels`
      for (let i = 0; i < v.length; i++) {
        const err = walk(v[i], depth + 1, `${path}[${i}]`)
        if (err) return err
      }
      return null
    }
    if (isPlainObject(v)) {
      const keys = Object.keys(v)
      if (keys.length > PLUGIN_DATA_MAX_KEYS) {
        return `${path}: object with more than ${PLUGIN_DATA_MAX_KEYS} keys`
      }
      if (depth >= maxDepth) return `${path}: nested deeper than ${maxDepth} levels`
      for (const k of keys) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
          return `${path}: reserved key name "${k}"`
        }
        const err = walk(v[k], depth + 1, `${path}.${k}`)
        if (err) return err
      }
      return null
    }
    // functions, symbols, bigints, Dates, Maps, class instances…
    return `${path}: unsupported value type (${typeof v})`
  }

  return walk(value, 0, 'payload')
}
