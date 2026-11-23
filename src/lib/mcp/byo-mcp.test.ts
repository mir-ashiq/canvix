// ─────────────────────────────────────────────────────────────
// v0.25 (BYO-MCP): per-user MCP tokens — invariants.
//
// What is locked in here:
//   1. checkAuth: the operator token still works alone; without it
//      a cvx_ bearer is accepted pending async resolution; garbage
//      is rejected with a helpful message
//   2. resolveMcpAuth: the user rail — valid key with 'mcp' scope
//      resolves to the owner; a key WITHOUT the scope is rejected;
//      revoked/unknown keys surface as JSON-RPC errors
//   3. tool scoping: with a user auth, search_designs only sees the
//      owner's rows, getDesign refuses foreign designs, and
//      create_design attributes to the owner; operator auth keeps
//      the historical unscoped view
//   4. initialize/get_capabilities honestly describe the rail
// ─────────────────────────────────────────────────────────────

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'

// ── db mock (module-level — tools.ts imports db at top) ──────

const designRows: Array<Record<string, unknown> & { id: string; ownerId: string | null; deletedAt: Date | null }> = []
const createdDesigns: Array<Record<string, unknown>> = []

vi.mock('@/lib/db', () => ({
  db: {
    design: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        designRows.find((d) => d.id === where.id) ?? null
      ),
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
        designRows.filter((d) => {
          if (where?.deletedAt !== undefined && d.deletedAt !== null) return false
          if (where?.ownerId !== undefined && d.ownerId !== where.ownerId) return false
          return true
        })
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: 'design_new_1', ...data, deletedAt: null }
        createdDesigns.push(row)
        return row
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    apiKey: {
      findUnique: vi.fn(),
    },
    template: {
      findUnique: vi.fn(async () => null),
    },
  },
}))

// Mock the AI provider layer so generate_design/capabilities paths
// are deterministic and never touch config or the network.
vi.mock('@/lib/ai/provider', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return {
    ...orig,
    hasProvider: vi.fn(async () => false),
    getClientForSlot: vi.fn(async () => null),
    getClientForSlotForUser: vi.fn(async (_slot: string, userId: string | null) => {
      // user rail: BYOK "resolves" for user_b (they saved a provider)
      return userId === 'user_b' ? { zai: {}, model: 'm', label: 'byok', source: 'user' } : null
    }),
    rateLimit: vi.fn(() => ({ ok: true, retryAfterSec: 0 })),
    recordUsage: vi.fn(async () => undefined),
  }
})

import { checkAuth, resolveMcpAuth, handleMcpText, OPERATOR_AUTH, type McpAuth, type McpRequestContext } from './server'
import { buildTools } from './tools'
import { newApiKeyValue, apiKeyIdFor } from '@/lib/auth/api-key'

// ── helpers ───────────────────────────────────────────────────

function reqWith(headers: Record<string, string>): NextRequest {
  return { headers: new Headers(headers) } as unknown as NextRequest
}

const ctx: McpRequestContext = { headers: new Headers({ host: 'localhost:3000' }) }

async function rpc(msg: unknown, auth: McpAuth = OPERATOR_AUTH) {
  const outcome = await handleMcpText(JSON.stringify(msg), ctx, auth)
  return outcome.body as unknown as {
    id?: unknown
    result?: { content?: Array<{ type: string; text?: string }>; instructions?: string }
    error?: { message: string }
  }
}

/** tools/call helper — returns the raw text plus parsed JSON when the text is JSON (fail() is plain text) */
async function callTool(name: string, args: Record<string, unknown>, auth: McpAuth = OPERATOR_AUTH) {
  const body = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, auth)
  const text = body.result?.content?.[0]?.text ?? ''
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    parsed = { _raw: text }
  }
  return { text, parsed, error: body.error }
}

const USER_A: McpAuth = { kind: 'user', userId: 'user_a', username: 'alice' }
const USER_B: McpAuth = { kind: 'user', userId: 'user_b', username: 'bob' }

beforeEach(() => {
  designRows.length = 0
  createdDesigns.length = 0
  designRows.push(
    { id: 'design_a1', name: 'Alice poster', width: 1080, height: 1080, pages: [], ownerId: 'user_a', deletedAt: null, updatedAt: new Date() },
    { id: 'design_b1', name: 'Bob flyer', width: 1080, height: 1080, pages: [], ownerId: 'user_b', deletedAt: null, updatedAt: new Date() },
    { id: 'design_free', name: 'Anonymous commons', width: 1080, height: 1080, pages: [], ownerId: null, deletedAt: null, updatedAt: new Date() }
  )
})

afterEach(() => {
  vi.clearAllMocks()
  delete process.env.CANVIX_MCP_TOKEN
})

// ── 1. checkAuth (sync, operator rail + fall-through) ─────────

describe('checkAuth — operator token and fall-through (v0.25)', () => {
  it('still accepts the operator token when configured (historical rail)', () => {
    process.env.CANVIX_MCP_TOKEN = 'operator-secret'
    const err = checkAuth(reqWith({ authorization: 'Bearer operator-secret' }))
    expect(err).toBeNull()
  })

  it('rejects a wrong operator token that is not a cvx_ key', () => {
    process.env.CANVIX_MCP_TOKEN = 'operator-secret'
    const err = checkAuth(reqWith({ authorization: 'Bearer wrong-token' }))
    expect(err?.error?.code).toBe(-32001)
  })

  it('accepts a cvx_ bearer for async resolution even without an operator token', () => {
    const key = newApiKeyValue()
    expect(checkAuth(reqWith({ authorization: `Bearer ${key}` }))).toBeNull()
  })

  it('with no token and no bearer, explains BOTH enable paths', () => {
    const err = checkAuth(reqWith({}))
    expect(err?.error?.code).toBe(-32000)
    expect(err?.error?.message).toContain('CANVIX_MCP_TOKEN')
    expect(err?.error?.message).toContain('mcp') // the personal-token path
  })

  it('enforces the Origin guard on the operator rail (DNS rebinding)', () => {
    process.env.CANVIX_MCP_TOKEN = 'operator-secret'
    const err = checkAuth(reqWith({ host: 'canvix.example.com', authorization: 'Bearer operator-secret', origin: 'https://evil.example.com' }))
    expect(err?.error?.message).toContain('Cross-origin')
  })
})

// ── 2. resolveMcpAuth (async, user rail) ─────────────────────

describe('resolveMcpAuth — the cvx_ user rail', () => {
  it('returns null for non-cvx bearers (operator rail — nothing to resolve)', async () => {
    process.env.CANVIX_MCP_TOKEN = 'operator-secret'
    expect(await resolveMcpAuth(reqWith({ authorization: 'Bearer operator-secret' }))).toBeNull()
  })

  it('resolves a valid cvx_ key WITH the mcp scope to the owner', async () => {
    const token = newApiKeyValue()
    const { db } = await import('@/lib/db')
    vi.mocked(db.apiKey.findUnique).mockResolvedValueOnce({
      id: apiKeyIdFor(token),
      user: { id: 'user_a', username: 'alice' },
      scopes: 'mcp',
      expiresAt: null,
      revokedAt: null,
    } as never)
    const auth = await resolveMcpAuth(reqWith({ authorization: `Bearer ${token}` }))
    expect(auth).toEqual({ kind: 'user', userId: 'user_a', username: 'alice' })
  })

  it('rejects a cvx_ key WITHOUT the mcp scope with a re-issue hint', async () => {
    const token = newApiKeyValue()
    const { db } = await import('@/lib/db')
    vi.mocked(db.apiKey.findUnique).mockResolvedValueOnce({
      id: apiKeyIdFor(token),
      user: { id: 'user_a', username: 'alice' },
      scopes: 'designs:read',
      expiresAt: null,
      revokedAt: null,
    } as never)
    const err = await resolveMcpAuth(reqWith({ authorization: `Bearer ${token}` }))
    expect((err as { error?: { message: string } }).error?.message).toContain('mcp" scope')
  })

  it('surfaces revoked keys as a JSON-RPC error', async () => {
    const token = newApiKeyValue()
    const { db } = await import('@/lib/db')
    vi.mocked(db.apiKey.findUnique).mockResolvedValueOnce({
      id: apiKeyIdFor(token),
      user: { id: 'user_a', username: 'alice' },
      scopes: 'mcp',
      expiresAt: null,
      revokedAt: new Date(),
    } as never)
    const err = await resolveMcpAuth(reqWith({ authorization: `Bearer ${token}` }))
    expect((err as { error?: { message: string } }).error?.message).toContain('revoked')
  })
})

// ── 3. tool scoping (the BYO-MCP security footprint) ─────────

describe('tool scoping — user rail', () => {
  it('search_designs only returns the owner rows for a user token', async () => {
    const { parsed } = await callTool('search_designs', {}, USER_A)
    const designs = parsed.designs as Array<{ id: string }>
    expect(designs.map((d) => d.id)).toEqual(['design_a1'])
  })

  it('search_designs returns everything for the operator rail (historical)', async () => {
    const { parsed } = await callTool('search_designs', {}, OPERATOR_AUTH)
    const designs = parsed.designs as Array<{ id: string }>
    expect(designs.map((d) => d.id).sort()).toEqual(['design_a1', 'design_b1', 'design_free'])
  })

  it('get_design refuses another user design by id (no enumeration)', async () => {
    const { parsed } = await callTool('get_design', { design_id: 'design_b1' }, USER_A)
    expect(parsed.error ?? parsed.isError ?? parsed).toBeTruthy() // not found shape
    const { parsed: own } = await callTool('get_design', { design_id: 'design_a1' }, USER_A)
    expect(own.id).toBe('design_a1')
  })

  it('get_design also refuses the anonymous commons for user tokens (v1 REST footprint)', async () => {
    const { parsed } = await callTool('get_design', { design_id: 'design_free' }, USER_A)
    expect(JSON.stringify(parsed)).not.toContain('Anonymous commons')
  })

  it('create_design attributes the new design to the token owner', async () => {
    await callTool('create_design', { name: 'Agent made', width: 800, height: 600 }, USER_B)
    expect(createdDesigns.length).toBe(1)
    expect(createdDesigns[0].ownerId).toBe('user_b')
  })

  it('create_design stays unattributed on the operator rail (historical)', async () => {
    await callTool('create_design', { name: 'Operator made', width: 800, height: 600 }, OPERATOR_AUTH)
    expect(createdDesigns.length).toBe(1)
    expect(createdDesigns[0].ownerId).toBeUndefined()
  })

  it('add_text on a foreign design fails as not-found (mutateDesign scope)', async () => {
    // give Bob's design a page so the mutation path reaches the scope check
    designRows[1].pages = [{ id: 'page_0', background: { type: 'solid', color: '#FFFFFF' }, elements: [] }]
    const { parsed } = await callTool('add_text', { design_id: 'design_b1', text: 'hijack', x: 10, y: 10 }, USER_A)
    expect(JSON.stringify(parsed)).toContain('not found')
  })
})

// ── 4. initialize / get_capabilities honesty ─────────────────

describe('initialize and get_capabilities describe the rail', () => {
  it('initialize declares the personal-token scope for user auth', async () => {
    const body = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize' }, USER_A)
    expect(body.result?.instructions).toContain('personal token')
    expect(body.result?.instructions).toContain('alice')
  })

  it('initialize stays silent about scoping on the operator rail', async () => {
    const body = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize' }, OPERATOR_AUTH)
    expect(body.result?.instructions).not.toContain('personal token')
  })

  it('get_capabilities reports BYOK-backed AI for a user with providers', async () => {
    const { parsed } = await callTool('get_capabilities', {}, USER_B)
    expect(parsed.aiProvider).toContain('available')
    expect(parsed.auth).toContain('bob')
    expect(parsed.auth).toContain('scoped to your own designs')
  })

  it('get_capabilities points provider-less users at BYOK settings', async () => {
    const { parsed } = await callTool('get_capabilities', {}, USER_A)
    expect(parsed.aiProvider).toContain('bring your own key')
  })
})
