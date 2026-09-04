// ─────────────────────────────────────────────────────────────
// Canvix MCP server — MCP 2025-03-26 "Streamable HTTP" transport
// (stateless profile): every client message is an HTTP POST of a
// JSON-RPC 2.0 request/notification/response; the server answers
// requests with one application/json object, notifications with
// 202 Accepted, and does not offer the optional SSE stream.
// ─────────────────────────────────────────────────────────────

import type { NextRequest } from 'next/server'
import { buildTools, SERVER_VERSION, type ToolResult, type ToolDef } from './tools'
import { rateLimit } from '@/lib/ai/provider'

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-03-26', '2024-11-05', '2025-06-18']
export const DEFAULT_PROTOCOL_VERSION = '2025-03-26'

// ── JSON-RPC types ───────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc?: '2.0'
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
  /** present only on client→server responses (resuming streams etc.) */
  result?: unknown
  error?: JsonRpcError
}

export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: JsonRpcError
}

const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602
const INTERNAL_ERROR = -32603
const SERVER_NOT_CONFIGURED = -32000
const UNAUTHORIZED = -32001

// ── auth ─────────────────────────────────────────────────────

/** Timing-safe token comparison (both must be non-empty to match). */
function tokenMatches(expected: string, provided: string): boolean {
  if (!expected || !provided) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(provided)
  if (a.length !== b.length) {
    // still burn a comparison to keep timing uniform
    a.compare(Buffer.alloc(a.length))
    return false
  }
  return a.compare(b) === 0
}

export function mcpTokenConfigured(): boolean {
  return Boolean(process.env.CANVIX_MCP_TOKEN)
}

export function checkAuth(req: NextRequest): JsonRpcResponse | null {
  const expected = process.env.CANVIX_MCP_TOKEN ?? ''
  if (!expected) {
    return {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: SERVER_NOT_CONFIGURED,
        message:
          'The Canvix MCP server is disabled: set CANVIX_MCP_TOKEN in the server environment to enable it. See README → "AI agents (MCP)".',
      },
    }
  }
  const header = req.headers.get('authorization') ?? ''
  const bearer = header.replace(/^Bearer\s+/i, '').trim()
  if (!tokenMatches(expected, bearer)) {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: UNAUTHORIZED, message: 'Unauthorized — send "Authorization: Bearer <CANVIX_MCP_TOKEN>".' },
    }
  }
  // spec security note: validate Origin when present (DNS-rebinding guard)
  const origin = req.headers.get('origin')
  if (origin) {
    try {
      const originHost = new URL(origin).host
      const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
      if (originHost && host && originHost !== host) {
        return {
          jsonrpc: '2.0',
          id: null,
          error: { code: INVALID_REQUEST, message: 'Cross-origin requests are not accepted by the MCP endpoint.' },
        }
      }
    } catch {
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: INVALID_REQUEST, message: 'Invalid Origin header.' },
      }
    }
  }
  return null
}

// ── message classification ───────────────────────────────────

function isNotification(msg: JsonRpcRequest): boolean {
  return typeof msg.method === 'string' && msg.id === undefined
}
function isClientResponse(msg: JsonRpcRequest): boolean {
  return msg.method === undefined && (msg.result !== undefined || msg.error !== undefined)
}

// ── protocol handlers ─────────────────────────────────────────

function errorResponse(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } }
}

export function handleInitialize(msg: JsonRpcRequest): JsonRpcResponse {
  const requested = typeof msg.params?.protocolVersion === 'string' ? (msg.params.protocolVersion as string) : ''
  const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION
  return {
    jsonrpc: '2.0',
    id: msg.id ?? null,
    result: {
      protocolVersion,
      capabilities: {
        tools: { listChanged: false },
        resources: {},
        prompts: {},
        logging: {},
      },
      serverInfo: {
        name: 'canvix',
        version: SERVER_VERSION,
        title: 'Canvix — open-source design tool',
      },
      instructions:
        'Canvix is a self-hosted, open-source design tool. Every tool creates or edits REAL, editable designs: ' +
        'create/generate designs, add text/shapes/images/tables/embeds, restyle, animate, comment and export (svg/png/json). ' +
        'Start with get_capabilities, then list_templates / search_designs. Edits made here appear live to humans in the editor.',
    },
  }
}

function toolsList(tools: ToolDef[]): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: null,
    result: {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    },
  }
}

async function toolsCall(msg: JsonRpcRequest, tools: ToolDef[]): Promise<JsonRpcResponse> {
  const id = msg.id ?? null
  const name = typeof msg.params?.name === 'string' ? (msg.params.name as string) : ''
  const args = (msg.params?.arguments && typeof msg.params.arguments === 'object' ? msg.params.arguments : {}) as Record<string, unknown>
  const tool = tools.find((t) => t.name === name)
  if (!tool) {
    return errorResponse(id, INVALID_PARAMS, `Unknown tool "${name}". Call tools/list for the available tools.`)
  }
  try {
    const result: ToolResult = await tool.handler(args)
    return { jsonrpc: '2.0', id, result: { content: result.content, isError: result.isError ?? false } }
  } catch (err) {
    // never leak stack traces to the wire
    const message = err instanceof Error ? `Tool execution failed: ${err.message.slice(0, 200)}` : 'Tool execution failed.'
    return errorResponse(id, INTERNAL_ERROR, message)
  }
}

// ── entry point ───────────────────────────────────────────────

export interface McpOutcome {
  status: number
  body: JsonRpcResponse | JsonRpcResponse[] | null
}

/**
 * Process an HTTP POST body (single message or batch).
 * - notifications / client responses only → 202 Accepted, no body
 * - requests → 200 with one JSON object, or an array for multi-request batches
 */
export async function handleMcpRequest(req: NextRequest): Promise<McpOutcome> {
  const parsed: unknown = await req.json().catch(() => null)
  if (parsed === null) {
    return {
      status: 400,
      body: errorResponse(null, PARSE_ERROR, 'Invalid JSON body.'),
    }
  }

  const messages: JsonRpcRequest[] = Array.isArray(parsed) ? (parsed as JsonRpcRequest[]) : [parsed as JsonRpcRequest]
  if (!messages.length) {
    return { status: 400, body: errorResponse(null, INVALID_REQUEST, 'Empty batch.') }
  }
  if (messages.length > 32) {
    return { status: 400, body: errorResponse(null, INVALID_REQUEST, 'Batch too large (max 32 messages).') }
  }

  const responses: JsonRpcResponse[] = []
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object' || typeof msg.method !== 'string') {
      // malformed entry — respond as an error if it looks like a request, else drop
      if (msg && typeof msg === 'object' && 'id' in (msg as object)) {
        responses.push(errorResponse((msg as JsonRpcRequest).id ?? null, INVALID_REQUEST, 'Invalid JSON-RPC message.'))
      }
      continue
    }

    // notifications & client responses → accepted, nothing to answer
    if (isNotification(msg) || isClientResponse(msg)) continue

    switch (msg.method) {
      case 'initialize':
        responses.push(handleInitialize(msg))
        break
      case 'ping':
        responses.push({ jsonrpc: '2.0', id: msg.id ?? null, result: {} })
        break
      case 'tools/list':
        responses.push(toolsList(buildTools({ req })))
        break
      case 'tools/call':
        responses.push(await toolsCall(msg, buildTools({ req })))
        break
      case 'resources/list':
        responses.push({ jsonrpc: '2.0', id: msg.id ?? null, result: { resources: [] } })
        break
      case 'resources/templates/list':
        responses.push({ jsonrpc: '2.0', id: msg.id ?? null, result: { resourceTemplates: [] } })
        break
      case 'prompts/list':
        responses.push({ jsonrpc: '2.0', id: msg.id ?? null, result: { prompts: [] } })
        break
      case 'completion/complete':
        responses.push({ jsonrpc: '2.0', id: msg.id ?? null, result: { completion: { values: [], total: 0, hasMore: false } } })
        break
      default:
        responses.push(errorResponse(msg.id ?? null, METHOD_NOT_FOUND, `Method "${msg.method}" is not supported.`))
    }
  }

  if (!responses.length) {
    // only notifications / responses were sent
    return { status: 202, body: null }
  }
  return { status: 200, body: responses.length === 1 ? responses[0] : responses }
}

/** Rate limit for the MCP endpoint (per IP, generous — agents batch). */
export function mcpRateLimit(req: NextRequest): boolean {
  return rateLimit('mcp', req, 120, 60).ok
}
