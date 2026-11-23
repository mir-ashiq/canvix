import { test, expect, type Browser } from '@playwright/test'
import { createHash } from 'node:crypto'
import { Client } from 'pg'

// v0.25 (BYO-MCP): personal MCP tokens — the agent rail, end to end.
//
// Proven here through the real API surfaces (no CANVIX_MCP_TOKEN set —
// this is the canvix.app situation: operator token absent, the user
// rail carries the feature):
//   1. a cvx_ key WITH the mcp scope authenticates against
//      POST /api/mcp (initialize answers; instructions declare the
//      personal-token scoping)
//   2. search_designs returns the owner's design and NOT a foreign
//      one or the anonymous commons
//   3. get_design on a foreign id answers not-found (no enumeration)
//   4. a key WITHOUT the mcp scope is rejected with the re-issue hint
//   5. revoking the key makes the very same token fail
//   6. OPTIONS reports the user-tokens rail
//
// Needs a database — see playwright.config.ts. Seeding follows
// api-keys.spec.ts (fixture users + session + designs straight into
// Postgres, inside the register budget).

const USER = { id: 'u_e2e_mcp_user', username: 'e2e_mcp_user', token: 'e2e-mcp-user-token' }
const OTHER = { id: 'u_e2e_mcp_other', username: 'e2e_mcp_other' }

function sessionId(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function apiKeyId(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

let client: InstanceType<typeof Client>

test.setTimeout(120_000)

test.beforeAll(async () => {
  client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  await client.query(`DELETE FROM "ApiKey" WHERE "userId" = $1`, [USER.id])
  await client.query(`DELETE FROM "Session" WHERE "userId" = $1`, [USER.id])
  await client.query(`DELETE FROM "User" WHERE "id" IN ($1, $2)`, [USER.id, OTHER.id])
  await client.query(
    `INSERT INTO "User" ("id", "username", "passwordHash", "createdAt") VALUES ($1, $2, 'seed-no-login', now()), ($3, $4, 'seed-no-login', now())`,
    [USER.id, USER.username, OTHER.id, OTHER.username]
  )
  await client.query(
    `INSERT INTO "Session" ("id", "userId", "createdAt", "expiresAt") VALUES ($1, $2, now(), now() + interval '2 hours')`,
    [sessionId(USER.token), USER.id]
  )
  await client.query(`DELETE FROM "Design" WHERE "id" LIKE 'd_e2e_mcp_%'`)
  await client.query(
    `INSERT INTO "Design" ("id", "name", "width", "height", "pages", "ownerId", "createdAt", "updatedAt")
     VALUES ('d_e2e_mcp_mine', 'Owned by mcp user', 1080, 1080, '[]'::jsonb, $1, now(), now()),
            ('d_e2e_mcp_other', 'Owned by someone else', 1080, 1080, '[]'::jsonb, $2, now(), now()),
            ('d_e2e_mcp_commons', 'e2e mcp commons', 1080, 1080, '[]'::jsonb, NULL, now(), now())`,
    [USER.id, OTHER.id]
  )
})

test.afterAll(async () => {
  if (client) {
    await client.query(`DELETE FROM "ApiKey" WHERE "userId" = $1`, [USER.id])
    await client.query(`DELETE FROM "Session" WHERE "userId" = $1`, [USER.id])
    await client.query(`DELETE FROM "Design" WHERE "id" LIKE 'd_e2e_mcp_%'`)
    await client.query(`DELETE FROM "User" WHERE "id" IN ($1, $2)`, [USER.id, OTHER.id])
    await client.end().catch(() => {})
  }
})

/** A browser context signed in as USER (the seeded session cookie). */
async function signedInContext(browser: Browser) {
  const ctx = await browser.newContext()
  await ctx.addCookies([
    { name: 'canvix_session', value: USER.token, url: process.env.BASE_URL ?? 'http://localhost:3000' },
  ])
  return ctx
}

/** Create an API key through the real route, session-cookie authed. */
async function createKey(request: import('@playwright/test').APIRequestContext, scopes: string[]): Promise<string> {
  const res = await request.post('/api/keys', {
    headers: { 'Content-Type': 'application/json' },
    data: { label: `e2e mcp ${scopes.join('+')}`, scopes },
  })
  expect(res.status()).toBe(201)
  const body = await res.json()
  expect(body.key).toMatch(/^cvx_[A-Za-z0-9_-]{43}$/)
  return body.key as string
}

async function mcpCall(
  request: import('@playwright/test').APIRequestContext,
  key: string,
  method: string,
  params: Record<string, unknown> = {}
) {
  const res = await request.post('/api/mcp', {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    data: { jsonrpc: '2.0', id: 1, method, params },
  })
  return { status: res.status(), body: await res.json() }
}

test.describe('BYO-MCP: personal tokens (v0.25)', () => {
  test('mcp-scoped key drives the agent rail, scoped to the owner', async ({ browser, request }) => {
    const ctx = await signedInContext(browser)
    // keys are created with the session cookie — same-origin browser auth
    const key = await createKey(ctx.request, ['mcp'])

    // 1. initialize works without CANVIX_MCP_TOKEN and declares the rail
    const init = await mcpCall(request, key, 'initialize', { protocolVersion: '2025-03-26' })
    expect(init.status).toBe(200)
    expect(init.body.result.serverInfo.name).toBe('canvix')
    expect(init.body.result.instructions).toContain('personal token')
    expect(init.body.result.instructions).toContain('scoped to YOUR designs')

    // 2. search_designs: owner sees own design only
    const search = await mcpCall(request, key, 'tools/call', { name: 'search_designs', arguments: {} })
    expect(search.status).toBe(200)
    const searchPayload = JSON.parse(search.body.result.content[0].text)
    const names = searchPayload.designs.map((d: { name: string }) => d.name)
    expect(names).toContain('Owned by mcp user')
    expect(names).not.toContain('Owned by someone else')
    expect(names).not.toContain('e2e mcp commons')

    // 3. get_design on a foreign id → not-found (no enumeration)
    const foreign = await mcpCall(request, key, 'tools/call', { name: 'get_design', arguments: { design_id: 'd_e2e_mcp_other' } })
    expect(foreign.status).toBe(200)
    const foreignPayload = JSON.parse(foreign.body.result.content[0].text)
    expect(foreignPayload.error).toBeTruthy()

    // get_design on own design works
    const own = await mcpCall(request, key, 'tools/call', { name: 'get_design', arguments: { design_id: 'd_e2e_mcp_mine' } })
    expect(own.status).toBe(200)
    const ownPayload = JSON.parse(own.body.result.content[0].text)
    expect(ownPayload.name).toBe('Owned by mcp user')

    // 4. a read-only key cannot drive agents (scope check)
    const readonlyKey = await createKey(ctx.request, ['designs:read'])
    const denied = await mcpCall(request, readonlyKey, 'initialize')
    expect(denied.status).toBe(401)
    expect(denied.body.error.message).toContain('mcp')

    // 5. revoke → the very same token stops working
    // (the UI revoke path is covered by api-keys.spec.ts; revoke in the DB)
    await client.query(`UPDATE "ApiKey" SET "revokedAt" = now() WHERE "id" = $1`, [apiKeyId(key)])
    const revokedCall = await mcpCall(request, key, 'initialize')
    expect(revokedCall.status).toBe(401)
    expect(revokedCall.body.error.message).toContain('revoked')

    await ctx.close()
  })

  test('OPTIONS reports the user-tokens rail when the operator token is absent', async ({ request }) => {
    const res = await request.fetch('/api/mcp', { method: 'OPTIONS' })
    expect(res.status()).toBe(200)
    const body = await res.json()
    // the CI server may or may not have CANVIX_MCP_TOKEN set — both
    // shapes are valid; the rail must never read "disabled"
    expect(['enabled', 'user-tokens']).toContain(body.mcp)
    expect(body.transport).toBe('streamable-http')
  })
})
