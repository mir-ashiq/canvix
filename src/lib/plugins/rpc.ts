// ─────────────────────────────────────────────────────────────
// Plugin RPC envelope — the versioned postMessage wire format
// (research/PLUGIN-SYSTEM.md §4.3).
//
// One bidirectional envelope for both directions:
//
//   plugin → host   { v, id, dir: 'call',  method, params }
//   host → plugin   { v, id, dir: 'result', ok, result | error }
//   host → plugin   { v, id, dir: 'call',  method: 'elements.render' | 'event', params }
//   plugin → host   { v, id, dir: 'result', ok, result | error }
//
// `v` is the protocol MAJOR as an integer. Additive changes bump
// RPC_API_MINOR (and the manifest's `canvixPluginApi` minor);
// breaking changes bump the major, and a mismatched major is
// rejected with E_VERSION — never a silent no-op.
//
// Origin discipline (§4.3) is enforced by the broker component
// (P3), not here: this module only parses and validates envelopes
// so it is unit-testable in node with zero DOM.
// ─────────────────────────────────────────────────────────────

import { checkCloneSafe } from './data-caps'

/** Protocol major of THIS host build. */
export const RPC_API_MAJOR = 1
/** Additive minor — grows when new methods/fields are added. */
export const RPC_API_MINOR = 0

/** Byte cap per message — the collab op cap (§4.7). */
export const MAX_RPC_BYTES = 256 * 1024

export type RpcErrorCode =
  | 'E_VERSION' // protocol major mismatch
  | 'E_MALFORMED' // envelope is not a valid shape
  | 'E_PAYLOAD' // params/result violate the data caps
  | 'E_PERMISSION' // method exists but permission not granted
  | 'E_METHOD' // no such method for this direction
  | 'E_THROTTLE' // rate budget exhausted
  | 'E_NOT_FOUND' // target (element, key, install) missing
  | 'E_TIMEOUT' // deadline exceeded (renderer contract)
  | 'E_INTERNAL' // host-side failure — details in server logs only

const RPC_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/
// camelCase method names are the §4.3 catalog's shape
// (design.getSnapshot) — lowercase start, no underscores
const RPC_METHOD_RE = /^[a-z][a-zA-Z0-9.]{0,63}$/
const HANDSHAKE_RE = /^[A-Za-z0-9_-]{8,128}$/
const ERROR_MESSAGE_MAX = 500

export interface RpcErrorShape {
  code: RpcErrorCode
  message: string
}

export interface RpcCall {
  v: number
  id: string
  dir: 'call'
  method: string
  params?: unknown
  /** echoed one-time handshake token (first call from an iframe) */
  handshake?: string
}

export interface RpcResultOk {
  v: number
  id: string
  dir: 'result'
  ok: true
  result?: unknown
}

export interface RpcResultErr {
  v: number
  id: string
  dir: 'result'
  ok: false
  error: RpcErrorShape
}

export type RpcResult = RpcResultOk | RpcResultErr

export type ParseOk<T> = { ok: true; value: T }
export type ParseErr = { ok: false; code: RpcErrorCode; message: string }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
}

function checkCommon(data: unknown): ParseErr | { v: number; id: string } {
  if (!isPlainObject(data)) {
    return { ok: false, code: 'E_MALFORMED', message: 'message must be a plain object' }
  }
  if (data.v !== RPC_API_MAJOR) {
    return {
      ok: false,
      code: 'E_VERSION',
      message: `protocol v${String(data.v)} is not supported (host speaks v${RPC_API_MAJOR})`,
    }
  }
  if (typeof data.id !== 'string' || !RPC_ID_RE.test(data.id)) {
    return { ok: false, code: 'E_MALFORMED', message: 'id must be 1–64 chars of [A-Za-z0-9_.:-]' }
  }
  return { v: data.v, id: data.id }
}

/**
 * Parse a plugin→host (or host→plugin) CALL envelope.
 * Pass `methods` to pin the direction's method catalog — a method
 * outside it answers E_METHOD (unknown ≠ unauthorized).
 */
export function parseRpcCall(
  data: unknown,
  opts: { methods?: ReadonlySet<string> | Readonly<Record<string, unknown>> } = {},
): ParseOk<RpcCall> | ParseErr {
  const common = checkCommon(data)
  if (!('v' in common)) return common
  const raw = data as Record<string, unknown>
  if (raw.dir !== 'call') {
    return { ok: false, code: 'E_MALFORMED', message: 'dir must be "call"' }
  }
  if (typeof raw.method !== 'string' || !RPC_METHOD_RE.test(raw.method)) {
    return { ok: false, code: 'E_MALFORMED', message: 'method must be lowercase dotted identifiers' }
  }
  if (opts.methods) {
    // Object.hasOwn: 'constructor' must not "exist" via the prototype chain
    const known =
      opts.methods instanceof Set
        ? opts.methods.has(raw.method)
        : Object.hasOwn(opts.methods, raw.method)
    if (!known) {
      return { ok: false, code: 'E_METHOD', message: `unknown method "${raw.method}"` }
    }
  }
  if (raw.handshake !== undefined) {
    if (typeof raw.handshake !== 'string' || !HANDSHAKE_RE.test(raw.handshake)) {
      return { ok: false, code: 'E_MALFORMED', message: 'handshake must be 8–128 chars of [A-Za-z0-9_-]' }
    }
  }
  if (raw.params !== undefined) {
    const err = checkCloneSafe(raw.params, { maxBytes: MAX_RPC_BYTES })
    if (err) return { ok: false, code: 'E_PAYLOAD', message: err }
  }
  return {
    ok: true,
    value: {
      v: RPC_API_MAJOR,
      id: common.id,
      dir: 'call',
      method: raw.method,
      params: raw.params,
      ...(raw.handshake !== undefined ? { handshake: raw.handshake as string } : {}),
    },
  }
}

/** Parse a RESULT envelope (either direction). */
export function parseRpcResult(data: unknown): ParseOk<RpcResult> | ParseErr {
  const common = checkCommon(data)
  if (!('v' in common)) return common
  const raw = data as Record<string, unknown>
  if (raw.dir !== 'result') {
    return { ok: false, code: 'E_MALFORMED', message: 'dir must be "result"' }
  }
  if (raw.ok === true) {
    if (raw.result !== undefined) {
      const err = checkCloneSafe(raw.result, { maxBytes: MAX_RPC_BYTES })
      if (err) return { ok: false, code: 'E_PAYLOAD', message: err }
    }
    return { ok: true, value: { v: RPC_API_MAJOR, id: common.id, dir: 'result', ok: true, result: raw.result } }
  }
  if (raw.ok === false) {
    const e = raw.error
    if (!isPlainObject(e) || typeof e.code !== 'string' || typeof e.message !== 'string') {
      return { ok: false, code: 'E_MALFORMED', message: 'error must be { code, message }' }
    }
    if (!RPC_ERROR_CODES.has(e.code)) {
      return { ok: false, code: 'E_MALFORMED', message: `unknown error code "${e.code}"` }
    }
    if (e.message.length > ERROR_MESSAGE_MAX) {
      return { ok: false, code: 'E_MALFORMED', message: `error message longer than ${ERROR_MESSAGE_MAX} chars` }
    }
    return {
      ok: true,
      value: {
        v: RPC_API_MAJOR,
        id: common.id,
        dir: 'result',
        ok: false,
        error: { code: e.code as RpcErrorCode, message: e.message },
      },
    }
  }
  return { ok: false, code: 'E_MALFORMED', message: 'ok must be true or false' }
}

export const RPC_ERROR_CODES: ReadonlySet<string> = new Set<RpcErrorCode>([
  'E_VERSION',
  'E_MALFORMED',
  'E_PAYLOAD',
  'E_PERMISSION',
  'E_METHOD',
  'E_THROTTLE',
  'E_NOT_FOUND',
  'E_TIMEOUT',
  'E_INTERNAL',
])

/** Build a success result envelope. */
export function rpcOk(id: string, result?: unknown): RpcResultOk {
  return { v: RPC_API_MAJOR, id, dir: 'result', ok: true, result }
}

/** Build a failure result envelope. */
export function rpcErr(id: string, code: RpcErrorCode, message: string): RpcResultErr {
  return { v: RPC_API_MAJOR, id, dir: 'result', ok: false, error: { code, message } }
}

let rpcCounter = 0

/** Fresh correlation id (host side). */
export function newRpcId(): string {
  rpcCounter += 1
  const rand =
    typeof crypto !== 'undefined' && 'getRandomValues' in crypto
      ? Array.from(crypto.getRandomValues(new Uint8Array(6)))
          .map((b) => b.toString(36).padStart(2, '0'))
          .join('')
      : Math.random().toString(36).slice(2, 14)
  return `rpc_${rpcCounter.toString(36)}_${rand}`
}
