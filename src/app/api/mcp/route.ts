import { NextRequest, NextResponse } from 'next/server'
import { checkAuth, handleMcpRequest, mcpRateLimit, mcpTokenConfigured } from '@/lib/mcp/server'

export const runtime = 'nodejs'
export const maxDuration = 60

// ─────────────────────────────────────────────────────────────
// POST /api/mcp — Model Context Protocol endpoint
// (Streamable HTTP, stateless profile; see src/lib/mcp/server.ts)
//
// Auth:     Authorization: Bearer <CANVIX_MCP_TOKEN>
// Disabled: until CANVIX_MCP_TOKEN is set (responds with a
//           JSON-RPC error explaining how to enable it).
// GET:      405 (no server-initiated SSE stream — spec-compliant)
// ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
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
  const outcome = await handleMcpRequest(req)
  if (outcome.status === 202) {
    return new NextResponse(null, { status: 202 })
  }
  return NextResponse.json(outcome.body, { status: outcome.status })
}

// stateless server: no SSE stream for server-initiated messages
export async function GET() {
  return NextResponse.json(
    { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'This MCP server is stateless — use POST. GET streams are not offered.' } },
    { status: 405, headers: { Allow: 'POST' } }
  )
}

export async function DELETE() {
  // no sessions to terminate (stateless)
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } })
}

export async function PUT() {
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } })
}

// let capability probes know whether the server is configured
export async function OPTIONS() {
  return NextResponse.json(
    { mcp: mcpTokenConfigured() ? 'enabled' : 'disabled', transport: 'streamable-http', endpoint: '/api/mcp' },
    { status: 200, headers: { Allow: 'POST, OPTIONS' } }
  )
}
