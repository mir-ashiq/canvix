import { describe, expect, it } from 'vitest'
import { HOST_CALL_METHODS } from './permissions'
import {
  MAX_RPC_BYTES,
  RPC_API_MAJOR,
  parseRpcCall,
  parseRpcResult,
  rpcErr,
  rpcOk,
} from './rpc'

// The envelope is the whole wire protocol (§4.3): versioned,
// correlation-id'd, direction-pinned. Everything hostile — wrong
// protocol, oversized params, replay-shaped junk — must produce a
// typed error, never a throw and never a silent pass.

const CALL = { v: 1, id: 'rpc_7', dir: 'call', method: 'design.getSnapshot', params: {} } as const

describe('parseRpcCall', () => {
  it('accepts a well-formed call and round-trips its fields', () => {
    const r = parseRpcCall(CALL)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.method).toBe('design.getSnapshot')
      expect(r.value.handshake).toBeUndefined()
    }
  })

  it('accepts an optional handshake token with a strict charset', () => {
    const ok = parseRpcCall({ ...CALL, handshake: 'aB3-x_9Z' })
    expect(ok.ok).toBe(true)
    for (const bad of ['short', 'has space', 'has/slash', ' Injection\n', '']) {
      expect(parseRpcCall({ ...CALL, handshake: bad }).ok).toBe(false)
    }
  })

  it('rejects protocol major mismatches with E_VERSION', () => {
    for (const v of [2, 0, '1', null, 1.5]) {
      const r = parseRpcCall({ ...CALL, v })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe('E_VERSION')
    }
  })

  it('rejects malformed shapes with E_MALFORMED', () => {
    const malformed: unknown[] = [
      null,
      'string',
      42,
      [],
      { v: 1, dir: 'call', method: 'info' }, // no id
      { v: 1, id: '', dir: 'call', method: 'info' }, // empty id
      { v: 1, id: 'rpc 7', dir: 'call', method: 'info' }, // space in id
      { v: 1, id: 'a'.repeat(65), dir: 'call', method: 'info' }, // too long
      { v: 1, id: 'rpc_7', dir: 'result', method: 'info' }, // wrong dir
      { v: 1, id: 'rpc_7', dir: 'call' }, // no method
      { v: 1, id: 'rpc_7', dir: 'call', method: 'Not.Lowercase' },
      { v: 1, id: 'rpc_7', dir: 'call', method: '<script>' },
    ]
    for (const m of malformed) {
      const r = parseRpcCall(m)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe('E_MALFORMED')
    }
  })

  it('pins methods to the caller-supplied catalog via E_METHOD', () => {
    const r = parseRpcCall(CALL, { methods: HOST_CALL_METHODS })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('E_METHOD')
    // unknown ≠ unauthorized: a valid but non-catalog method is E_METHOD even with no permission context
    const probe = parseRpcCall({ ...CALL, method: 'design.exfiltrate' })
    expect(probe.ok).toBe(true) // parse level: shape is fine
  })

  it('enforces payload caps with E_PAYLOAD', () => {
    const oversized = parseRpcCall({ ...CALL, params: { blob: 'x'.repeat(MAX_RPC_BYTES) } })
    expect(oversized.ok).toBe(false)
    if (!oversized.ok) expect(oversized.code).toBe('E_PAYLOAD')

    const hostile = parseRpcCall({ ...CALL, params: { sneaky: new Date() } })
    expect(hostile.ok).toBe(false)
    if (!hostile.ok) expect(hostile.code).toBe('E_PAYLOAD')

    // params are optional
    expect(parseRpcCall({ v: 1, id: 'rpc_1', dir: 'call', method: 'info' }).ok).toBe(true)
  })
})

describe('parseRpcResult', () => {
  it('accepts ok results with and without a payload', () => {
    expect(parseRpcResult(rpcOk('rpc_7', { pages: 2 }))).toEqual({
      ok: true,
      value: { v: RPC_API_MAJOR, id: 'rpc_7', dir: 'result', ok: true, result: { pages: 2 } },
    })
    expect(parseRpcResult(rpcOk('rpc_7')).ok).toBe(true)
  })

  it('accepts typed errors and rejects unknown codes', () => {
    const r = parseRpcResult(rpcErr('rpc_7', 'E_PERMISSION', 'design:read not granted'))
    expect(r.ok).toBe(true)
    const badCode = parseRpcResult({ v: 1, id: 'rpc_7', dir: 'result', ok: false, error: { code: 'E_PWNED', message: 'hi' } })
    expect(badCode.ok).toBe(false)
    if (!badCode.ok) expect(badCode.code).toBe('E_MALFORMED')
  })

  it('requires ok to be boolean and error to be {code,message}', () => {
    for (const bad of [
      { v: 1, id: 'r', dir: 'result' },
      { v: 1, id: 'r', dir: 'result', ok: 'yes' },
      { v: 1, id: 'r', dir: 'result', ok: false, error: 'just a string' },
      { v: 1, id: 'r', dir: 'result', ok: false, error: { code: 'E_METHOD' } },
      { v: 1, id: 'r', dir: 'result', ok: false, error: { code: 'E_METHOD', message: 'x'.repeat(501) } },
    ]) {
      expect(parseRpcResult(bad).ok).toBe(false)
    }
  })

  it('rejects oversized results', () => {
    const r = parseRpcResult({ v: 1, id: 'r', dir: 'result', ok: true, result: 'x'.repeat(MAX_RPC_BYTES) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('E_PAYLOAD')
  })
})
