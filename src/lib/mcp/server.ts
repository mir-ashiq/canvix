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
import { authenticateApiKey } from '@/lib/auth/api-key'
import { db } from '@/lib/db'

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
const REQUEST_TOO_LARGE = -32002

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

// ── v0.25: BYO-MCP — per-user tokens (profile → API key with 'mcp' scope)
//
// Two auth rails, same endpoint:
//   • operator token (CANVIX_MCP_TOKEN) — unscoped, the historical
//     behaviour: every design on the instance, instance AI providers
//   • user API key (cvx_… with the 'mcp' scope) — every tool is
//     scoped to the key owner's own designs (same footprint as the
//     v1 REST rail), and generate_design resolves the owner's BYOK
//     providers first (resolveSlotForUser) so their own keys pay
//     for their agent's work — the operator's AI is never consumed.
//
// The user rail is what makes canvix.app usable by anyone: no
// operator token exists there, but every signed-in user can mint a
// personal token from their profile and connect Claude/Cursor to
// THEIR designs.

/** Who is calling — null when auth fails (checkAuth returns the error). */
export interface McpAuth {
  /** 'operator' | 'user' — tools use this to scope DB access */
  kind: 'operator' | 'user'
  /** null for operator; the key owner for user tokens */
  userId: string | null
  username?: string
}

export function checkAuth(req: NextRequest): JsonRpcResponse | null {
  const expected = process.env.CANVIX_MCP_TOKEN ?? ''
  const header = req.headers.get('authorization') ?? ''
  const bearer = header.replace(/^Bearer\s+/i, '').trim()
  if (expected) {
    if (tokenMatches(expected, bearer)) return originGuard(req)
  } else if (!bearer) {
    return {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: SERVER_NOT_CONFIGURED,
        message:
          'The Canvix MCP server is disabled: set CANVIX_MCP_TOKEN on the server, or (signed-in users) create a personal MCP token in Settings → API keys with the "mcp" scope. See README → "AI agents (MCP)".',
      },
    }
  }
  // no operator token (or it didn't match) — fall through to the
  // user rail; a bad operator token that is also not a cvx_ key is
  // simply an auth failure below.
  if (bearer.startsWith('cvx_')) return null // resolved asynchronously in resolveMcpAuth
  if (expected) {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: UNAUTHORIZED, message: 'Unauthorized — send "Authorization: Bearer <CANVIX_MCP_TOKEN>" (or a cvx_… API key with the mcp scope).' },
    }
  }
  return {
    jsonrpc: '2.0',
    id: null,
    error: { code: SERVER_NOT_CONFIGURED, message: mcpDisabledMessage() },
  }
}

function mcpDisabledMessage(): string {
  return (
    'The Canvix MCP server is disabled: set CANVIX_MCP_TOKEN on the server, or (signed-in users) create a personal MCP token in Settings → API keys with the "mcp" scope.'
  )
}

/** DNS-rebinding guard shared by both rails. */
function originGuard(req: NextRequest): JsonRpcResponse | null {
  const origin = req.headers.get('origin')
  if (!origin) return null
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
    return null
  } catch {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: INVALID_REQUEST, message: 'Invalid Origin header.' },
    }
  }
}

/**
 * Resolve the caller for the user rail (async — it hits the DB).
 * Returns null when the bearer is not a cvx_ key (operator rail
 * already handled synchronously). Errors surface as a JsonRpcResponse.
 */
export async function resolveMcpAuth(req: NextRequest): Promise<McpAuth | JsonRpcResponse | null> {
  const header = req.headers.get('authorization') ?? ''
  const bearer = header.replace(/^Bearer\s+/i, '').trim()
  if (!bearer.startsWith('cvx_')) return null // operator rail — nothing to resolve
  const auth = await authenticateApiKey(req, db)
  if (!auth) return null
  if (!auth.ok) {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: UNAUTHORIZED, message: auth.message },
    }
  }
  if (!auth.user.scopes.includes('mcp')) {
    return {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: UNAUTHORIZED,
        message: 'This API key lacks the "mcp" scope. Re-create it in Settings → API keys with mcp checked.',
      },
    }
  }
  const guard = originGuard(req)
  if (guard) return guard
  return { kind: 'user', userId: auth.user.id, username: auth.user.username }
}

/** The auth the operator rail produces (unscoped, historical). */
export const OPERATOR_AUTH: McpAuth = { kind: 'operator', userId: null }

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

export function handleInitialize(msg: JsonRpcRequest, auth: McpAuth = OPERATOR_AUTH): JsonRpcResponse {
  const requested = typeof msg.params?.protocolVersion === 'string' ? (msg.params.protocolVersion as string) : ''
  const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION
  const userRail = auth.kind === 'user'
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
        'create/generate designs, add text/shapes/images/tables/charts/embeds, restyle, animate, comment and export (svg/png/json). ' +
        'Start with get_capabilities, then list_templates / search_designs. Edits made here appear live to humans in the editor.' +
        (userRail
          ? ` You are connected with a personal token${auth.username ? ` (${auth.username})` : ''} — every tool is scoped to YOUR designs only, and AI generation uses your saved providers first.`
          : ''),
    },
  }
}

function toolsList(msg: JsonRpcRequest, tools: ToolDef[]): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: msg.id ?? null,
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

/** Hard cap on request body size (protects memory; batch is capped at 32 anyway). */
export const MAX_BODY_BYTES = 1024 * 1024

export class BodyTooLargeError extends Error {
  constructor() {
    super(`Request body exceeds the ${Math.round(MAX_BODY_BYTES / 1024)} KB limit.`)
    this.name = 'BodyTooLargeError'
  }
}

/** Read a request body while enforcing a byte cap (works for chunked bodies too). */
export async function readBodyCapped(req: NextRequest, capBytes: number = MAX_BODY_BYTES): Promise<string> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > capBytes) throw new BodyTooLargeError()
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      total += value.byteLength
      if (total > capBytes) {
        await reader.cancel().catch(() => undefined)
        throw new BodyTooLargeError()
      }
      chunks.push(value)
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8')
}

/** Anything handleMcpText needs from the transport layer. */
export type McpRequestContext = Pick<NextRequest, 'headers'>

/**
 * Core JSON-RPC processing over an already-read body string.
 * Exported for unit tests (no HTTP involved).
 *
 * `auth` scopes every tool call: OPERATOR_AUTH keeps the historical
 * unscoped view; a user token (BYO-MCP) restricts tools to the key
 * owner's own designs (see tools.ts ToolDeps).
 */
export async function handleMcpText(text: string, req: McpRequestContext, auth: McpAuth = OPERATOR_AUTH): Promise<McpOutcome> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { status: 400, body: errorResponse(null, PARSE_ERROR, 'Invalid JSON body.') }
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
        responses.push(handleInitialize(msg, auth))
        break
      case 'ping':
        responses.push({ jsonrpc: '2.0', id: msg.id ?? null, result: {} })
        break
      case 'tools/list':
        responses.push(toolsList(msg, buildTools({ req, auth })))
        break
      case 'tools/call':
        responses.push(await toolsCall(msg, buildTools({ req, auth })))
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

/**
 * Process an HTTP POST (single message or batch).
 * - notifications / client responses only → 202 Accepted, no body
 * - requests → 200 with one JSON object, or an array for multi-request batches
 * - body over MAX_BODY_BYTES → 413 with a JSON-RPC error
 *
 * Auth resolution order (BYO-MCP, v0.25): the operator token matches
 * synchronously; otherwise a cvx_ key resolves against the API-key
 * table (user rail, scoped tools). checkAuth handles the failure
 * shapes before we get here.
 */
export async function handleMcpRequest(req: NextRequest): Promise<McpOutcome> {
  let text: string
  try {
    text = await readBodyCapped(req)
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      return { status: 413, body: errorResponse(null, REQUEST_TOO_LARGE, err.message) }
    }
    throw err
  }
  const userAuth = await resolveMcpAuth(req)
  if (userAuth && 'error' in userAuth && typeof (userAuth as JsonRpcResponse).error?.code === 'number') {
    return { status: 401, body: userAuth as JsonRpcResponse }
  }
  return handleMcpText(text, req, (userAuth as McpAuth | null) ?? OPERATOR_AUTH)
}

/** Rate limit for the MCP endpoint (per IP, generous — agents batch). */
export function mcpRateLimit(req: NextRequest): boolean {
  return rateLimit('mcp', req, 120, 60).ok
}
