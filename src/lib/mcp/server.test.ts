// JSON-RPC 2.0 protocol conformance tests for the MCP server core.
// Regression suite for the v0.6.1 fix: tools/list used to answer with
// id: null instead of echoing the request id (spec violation that
// breaks client request/response correlation).

import { describe, it, expect } from 'vitest'
import { handleMcpText, MAX_BODY_BYTES, type McpRequestContext } from './server'

// Minimal stand-in for NextRequest — handleMcpText only reads headers.
const ctx: McpRequestContext = {
  headers: new Headers({ host: 'localhost:3000' }),
} as unknown as McpRequestContext

async function rpc(text: string) {
  const outcome = await handleMcpText(text, ctx)
  return { status: outcome.status, body: outcome.body as unknown as Record<string, unknown> }
}

async function rpcJson(msg: unknown) {
  return rpc(JSON.stringify(msg))
}

// ── id echo (the v0.6.1 fix) ──────────────────────────────────

describe('JSON-RPC id echo', () => {
  it('tools/list echoes a numeric id (regression: used to return null)', async () => {
    const { body } = await rpcJson({ jsonrpc: '2.0', id: 42, method: 'tools/list' })
    expect(body.id).toBe(42)
    expect(body.error).toBeUndefined()
  })

  it('tools/list echoes a string id', async () => {
    const { body } = await rpcJson({ jsonrpc: '2.0', id: 'req-abc', method: 'tools/list' })
    expect(body.id).toBe('req-abc')
  })

  it('tools/list returns the full tool catalogue', async () => {
    const { body } = await rpcJson({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const tools = (body.result as { tools: Array<{ name: string; description: string }> }).tools
    expect(Array.isArray(tools)).toBe(true)
    expect(tools.length).toBeGreaterThanOrEqual(20)
    const names = tools.map((t) => t.name)
    for (const expected of ['create_design', 'add_text', 'add_shape', 'add_image', 'export_design']) {
      expect(names).toContain(expected)
    }
    for (const t of tools) {
      expect(typeof t.description).toBe('string')
      expect(t.description.length).toBeGreaterThan(0)
    }
  })

  it('ping echoes the id and returns an empty result', async () => {
    const { body } = await rpcJson({ jsonrpc: '2.0', id: 7, method: 'ping' })
    expect(body.id).toBe(7)
    expect(body.result).toEqual({})
  })

  it('every response declares jsonrpc: "2.0"', async () => {
    const { body } = await rpcJson({ jsonrpc: '2.0', id: 3, method: 'ping' })
    expect(body.jsonrpc).toBe('2.0')
  })
})

// ── initialize negotiation ────────────────────────────────────

describe('initialize', () => {
  it('echoes the id and negotiates a supported protocol version', async () => {
    const { body } = await rpcJson({
      jsonrpc: '2.0',
      id: 'init-1',
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    })
    expect(body.id).toBe('init-1')
    const result = body.result as { protocolVersion: string; serverInfo: { name: string; version: string } }
    expect(result.protocolVersion).toBe('2024-11-05')
    expect(result.serverInfo.name).toBe('canvix')
    expect(result.serverInfo.version).toBe('0.6.1')
  })

  it('falls back to the default version for unknown protocol versions', async () => {
    const { body } = await rpcJson({
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: { protocolVersion: '1999-01-01' },
    })
    const result = body.result as { protocolVersion: string }
    expect(result.protocolVersion).toBe('2025-03-26')
  })
})

// ── error handling ────────────────────────────────────────────

describe('error handling', () => {
  it('answers invalid JSON with -32700 and HTTP 400', async () => {
    const { status, body } = await rpc('{ this is not json')
    expect(status).toBe(400)
    expect((body.error as { code: number }).code).toBe(-32700)
  })

  it('answers unknown methods with -32601 and echoes the id', async () => {
    const { body } = await rpcJson({ jsonrpc: '2.0', id: 99, method: 'no/such/method' })
    expect((body.error as { code: number }).code).toBe(-32601)
    expect(body.id).toBe(99)
  })

  it('answers unknown tools with -32602 (INVALID_PARAMS)', async () => {
    const { body } = await rpcJson({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'definitely_not_a_tool', arguments: {} },
    })
    expect((body.error as { code: number }).code).toBe(-32602)
    expect(body.id).toBe(5)
  })

  it('answers an empty batch with -32600', async () => {
    const { status, body } = await rpc('[]')
    expect(status).toBe(400)
    expect((body.error as { code: number }).code).toBe(-32600)
  })

  it('answers oversized batches with -32600', async () => {
    const batch = Array.from({ length: 33 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'ping' }))
    const { body } = await rpcJson(batch)
    expect((body.error as { code: number }).code).toBe(-32600)
    expect((body.error as { message: string }).message).toMatch(/batch too large/i)
  })

  it('answers malformed entries that carry an id with -32600', async () => {
    const { body } = await rpcJson({ jsonrpc: '2.0', id: 11 }) // no method
    expect((body.error as { code: number }).code).toBe(-32600)
    expect(body.id).toBe(11)
  })
})

// ── notifications & batches ───────────────────────────────────

describe('notifications and batches', () => {
  it('notifications get 202 Accepted with no body', async () => {
    const { status, body } = await rpcJson({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(status).toBe(202)
    expect(body).toBeNull()
  })

  it('client responses get 202 Accepted with no body', async () => {
    const { status } = await rpcJson({ jsonrpc: '2.0', result: { ok: true } })
    expect(status).toBe(202)
  })

  it('a mixed batch answers only the requests, in order, with ids intact', async () => {
    const { status, body } = await rpcJson([
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 'first', method: 'ping' },
      { jsonrpc: '2.0', id: 'second', method: 'ping' },
    ])
    expect(status).toBe(200)
    const arr = body as unknown as Array<{ id: string }>
    expect(Array.isArray(arr)).toBe(true)
    expect(arr.map((r) => r.id)).toEqual(['first', 'second'])
  })
})

// ── body cap constants ────────────────────────────────────────

describe('request size limits', () => {
  it('exports a 1 MB cap', () => {
    expect(MAX_BODY_BYTES).toBe(1024 * 1024)
  })
})
