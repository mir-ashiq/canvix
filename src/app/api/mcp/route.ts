import { NextRequest, NextResponse } from 'next/server'
import { checkAuth, handleMcpRequest, mcpRateLimit, mcpTokenConfigured } from '@/lib/mcp/server'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const maxDuration = 60

// ─────────────────────────────────────────────────────────────
// POST /api/mcp — Model Context Protocol endpoint
// (Streamable HTTP, stateless profile; see src/lib/mcp/server.ts)
//
// Auth (either rail, v0.25):
//   operator  Authorization: Bearer <CANVIX_MCP_TOKEN> (unscoped)
//   user      Authorization: Bearer cvx_…  (API key with 'mcp' scope
//             — every tool is scoped to the key owner's designs and
//             AI resolves their BYOK providers first)
// Disabled: only when NEITHER exists — the error explains both paths.
// GET:      405 (no server-initiated SSE stream — spec-compliant)
// ─────────────────────────────────────────────────────────────

async function __canvix_post(req: NextRequest) {
  const authError = checkAuth(req)
  if (authError) {
    const status = authError.error?.code === -32001 ? 401 : 503
    return NextResponse.json(authError, { status })
  }
  if (!mcpRateLimit(req)) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Rate limit reached — max 120 requests/minute.' } },
      { status: 429 }
    )
  }
  // BYO-MCP (v0.25): cvx_ keys resolve asynchronously (DB-backed);
  // failures surface as a 401 JSON-RPC error from handleMcpRequest.
  const outcome = await handleMcpRequest(req)
  if (outcome.status === 202) {
    return new NextResponse(null, { status: 202 })
  }
  return NextResponse.json(outcome.body, { status: outcome.status })
}

// stateless server: no SSE stream for server-initiated messages
async function __canvix_get() {
  return NextResponse.json(
    { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'This MCP server is stateless — use POST. GET streams are not offered.' } },
    { status: 405, headers: { Allow: 'POST' } }
  )
}

async function __canvix_delete() {
  // no sessions to terminate (stateless)
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } })
}

async function __canvix_put() {
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } })
}

// let capability probes know whether the server is configured.
// v0.25: the user rail (personal cvx_ tokens) works even without the
// operator token, so the endpoint reports 'enabled' whenever EITHER
// rail is available; 'user-tokens' tells the dashboard card to offer
// the personal-token flow.
async function __canvix_options() {
  return NextResponse.json(
    {
      mcp: mcpTokenConfigured() ? 'enabled' : 'user-tokens',
      transport: 'streamable-http',
      endpoint: '/api/mcp',
    },
    { status: 200, headers: { Allow: 'POST, OPTIONS' } }
  )
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const POST = withLogging('POST /api/mcp', __canvix_post)
export const GET = withLogging('GET /api/mcp', __canvix_get)
export const DELETE = withLogging('DELETE /api/mcp', __canvix_delete)
export const PUT = withLogging('PUT /api/mcp', __canvix_put)
export const OPTIONS = withLogging('OPTIONS /api/mcp', __canvix_options)
