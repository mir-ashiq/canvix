import { test, expect, type Browser } from '@playwright/test'
import { createHash } from 'node:crypto'
import { Client } from 'pg'

// v0.32.1 (Unified Canvix AI hardening) — design provenance, end to
// end through the REAL flow the review asked for: the design save.
//
//   1. APPLY→SAVE: PUT /api/designs/[id] with the pages AND the
//      pending aiProvenance payload persists the contract and
//      VERIFIES it server-side against the saved pages (verified:
//      true, verifiedAt bound to that save). Restrictions survive
//      ("no stock photos" stays in the contract).
//   2. BOUND TO THE DOCUMENT: a later save whose pages append words
//      to a required text (the review's P0 example — substring
//      matching used to let this through) flips verified to FALSE;
//      restoring the exact text flips it back. Proof, not a claim.
//   3. PRIVACY: a link VIEWER (no session) gets the shareable
//      contract (brief + verification state) but NEVER the original
//      generation prompt; writes are refused (NOT_YOUR_DESIGN 403,
//      and the client-supplied provenance PUT is gone — 405).
//   4. NO SILENT WEAKENING: a junk or over-limit brief is REFUSED at
//      save time with an explicit reason in the response — never
//      stored truncated or capped.
//
// Needs a database — see playwright.config.ts. The fixture user +
// session + designs are seeded straight into the database (same
// pattern as api-keys.spec.ts, inside the register budget).

const USER = { id: 'u_e2e_prov_user', username: 'e2e_prov_user', token: 'e2e-prov-user-token-v2' }

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'

const PROMPT = 'A poster for a night run — "Run Dal Lake 2026", night blues, 1080x1350'

const BRIEF = {
  requiredTexts: [
    { tier: 'preference', text: 'Run Dal Lake 2026' },
    { tier: 'preference', text: '12km · Dachigam Road · 26 Jan' },
  ],
  requiredColors: [{ tier: 'preference', hex: '#1B3A6B' }],
  restrictions: ['no stock photos'],
  notes: [],
}

/** pages that satisfy the brief exactly (strict equality) */
const pagesSatisfying = () => [
  {
    id: 'p1',
    background: { type: 'solid', color: '#FFFFFF' },
    elements: [
      { id: 't1', type: 'text', text: 'Run Dal Lake 2026', x: 80, y: 200, width: 900, height: 120, fontSize: 96, fontFamily: 'Inter', bold: true, fill: '#1B3A6B', align: 'center' },
      { id: 't2', type: 'text', text: '12km · Dachigam Road · 26 Jan', x: 80, y: 360, width: 900, height: 60, fontSize: 36, fontFamily: 'Inter', fill: '#1B3A6B', align: 'center' },
      { id: 'r1', type: 'rect', x: 0, y: 0, width: 1080, height: 120, fill: '#1B3A6B' },
    ],
  },
]

/** the review's P0 example: required text with words APPENDED — a
 *  substring match would pass, strict equality must not */
const pagesWithAppendedWords = () => [
  {
    id: 'p1',
    background: { type: 'solid', color: '#FFFFFF' },
    elements: [
      { id: 't1', type: 'text', text: 'Run Dal Lake 2026 — Special Offer', x: 80, y: 200, width: 900, height: 120, fontSize: 96, fontFamily: 'Inter', bold: true, fill: '#1B3A6B', align: 'center' },
      { id: 't2', type: 'text', text: '12km · Dachigam Road · 26 Jan', x: 80, y: 360, width: 900, height: 60, fontSize: 36, fontFamily: 'Inter', fill: '#1B3A6B', align: 'center' },
      { id: 'r1', type: 'rect', x: 0, y: 0, width: 1080, height: 120, fill: '#1B3A6B' },
    ],
  },
]

function sessionId(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

let client: InstanceType<typeof Client>

test.setTimeout(120_000)

test.beforeAll(async () => {
  client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  await client.query(`DELETE FROM "Session" WHERE "userId" = $1`, [USER.id])
  await client.query(`DELETE FROM "User" WHERE "id" = $1`, [USER.id])
  await client.query(
    `INSERT INTO "User" ("id", "username", "passwordHash", "createdAt") VALUES ($1, $2, 'seed-no-login', now())`,
    [USER.id, USER.username]
  )
  await client.query(
    `INSERT INTO "Session" ("id", "userId", "createdAt", "expiresAt") VALUES ($1, $2, now(), now() + interval '2 hours')`,
    [sessionId(USER.token), USER.id]
  )
  await client.query(`DELETE FROM "Design" WHERE "ownerId" = $1`, [USER.id])
  for (const id of ['d_e2e_prov_mine', 'd_e2e_prov_two']) {
    await client.query(
      `INSERT INTO "Design" ("id", "name", "width", "height", "pages", "ownerId", "createdAt", "updatedAt")
       VALUES ($1, 'Provenance design', 1080, 1350, '[]'::jsonb, $2, now(), now())`,
      [id, USER.id]
    )
  }
})

test.afterAll(async () => {
  if (client) {
    // provenance rows cascade with their designs; clean the designs
    await client.query(`DELETE FROM "Design" WHERE "ownerId" = $1`, [USER.id])
    await client.query(`DELETE FROM "Session" WHERE "userId" = $1`, [USER.id])
    await client.query(`DELETE FROM "User" WHERE "id" = $1`, [USER.id])
    await client.end().catch(() => {})
  }
})

async function signedInContext(browser: Browser) {
  const ctx = await browser.newContext()
  await ctx.addCookies([{ name: 'canvix_session', value: USER.token, url: BASE }])
  return ctx
}

type ApiResponse = { status(): number; json(): Promise<unknown> }
type ApiFetch = (url: string, opts?: Record<string, unknown>) => Promise<ApiResponse>

async function saveDesign(api: { fetch: ApiFetch }, designId: string, body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await api.fetch(`${BASE}/api/designs/${designId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', origin: BASE },
    data: body,
  })
  return { status: res.status(), body: (await res.json()) as Record<string, unknown> }
}

test.describe('design AI provenance — persisted and verified by the design save (v0.32.1)', () => {
  test('the apply→save flow stores the contract AND verifies it server-side', async ({ browser }) => {
    const ctx = await signedInContext(browser)
    const api = ctx.request

    // the apply flow's next save carries pages + the pending contract
    const { status, body } = await saveDesign(api, 'd_e2e_prov_mine', {
      pages: pagesSatisfying(),
      aiProvenance: { prompt: PROMPT, outcome: 'passed', brief: BRIEF },
    })
    expect(status).toBe(200)

    // stored, normalized (tiers forced mandatory) and VERIFIED against
    // the saved pages — with the restriction intact
    const stored = body.aiProvenance as {
      brief?: { requiredTexts?: { tier?: string; text?: string }[]; restrictions?: string[] }
      verified?: boolean
      verifiedAt?: string
    }
    expect(stored).toBeDefined()
    expect(stored.brief?.requiredTexts?.[0]).toEqual({ tier: 'mandatory', text: 'Run Dal Lake 2026' })
    expect(stored.brief?.restrictions).toEqual(['no stock photos'])
    expect(stored.verified).toBe(true)
    expect(typeof stored.verifiedAt).toBe('string')

    // the editor's load path: prompt + contract + verification state
    const got = await api.fetch(`${BASE}/api/designs/d_e2e_prov_mine`)
    expect(got.status()).toBe(200)
    const design = (await got.json()) as {
      aiProvenance?: { prompt?: string; brief?: { requiredTexts?: { text?: string }[] }; verified?: boolean }
    }
    expect(design.aiProvenance?.prompt).toBe(PROMPT)
    expect(design.aiProvenance?.brief?.requiredTexts?.map((t) => t.text)).toEqual(
      expect.arrayContaining(['Run Dal Lake 2026', '12km · Dachigam Road · 26 Jan'])
    )
    expect(design.aiProvenance?.verified).toBe(true)

    // the dedicated GET agrees (the editor sees the prompt)
    const direct = await api.fetch(`${BASE}/api/designs/d_e2e_prov_mine/ai-provenance`)
    expect(direct.status()).toBe(200)
    const directBody = (await direct.json()) as { provenance?: { prompt?: string; verified?: boolean } }
    expect(directBody.provenance?.prompt).toBe(PROMPT)
    expect(directBody.provenance?.verified).toBe(true)

    await ctx.close()
  })

  test('verification is bound to the saved document — appended words flip it false, the exact text flips it back', async ({ browser }) => {
    const ctx = await signedInContext(browser)
    const api = ctx.request

    // a later save APPENDS words to the required headline (the
    // review's P0 example). Substring matching would call this
    // satisfied; the strict server-side gate must not.
    const appended = await saveDesign(api, 'd_e2e_prov_mine', { pages: pagesWithAppendedWords() })
    expect(appended.status).toBe(200)
    expect(appended.body.aiProvenanceVerified).toBe(false)

    // the GET shows the contract intact but the verdict false
    const drifted = (await (await api.fetch(`${BASE}/api/designs/d_e2e_prov_mine`)).json()) as {
      aiProvenance?: { brief?: { requiredTexts?: { text?: string }[] }; verified?: boolean }
    }
    expect(drifted.aiProvenance?.brief?.requiredTexts?.[0]?.text).toBe('Run Dal Lake 2026')
    expect(drifted.aiProvenance?.verified).toBe(false)

    // restoring the exact text flips the verdict back — the proof
    // stays bound to the CURRENT document, not a one-time claim
    const restored = await saveDesign(api, 'd_e2e_prov_mine', { pages: pagesSatisfying() })
    expect(restored.body.aiProvenanceVerified).toBe(true)

    await ctx.close()
  })

  test('privacy: a link VIEWER gets the shareable contract, never the prompt; writes are refused', async ({ browser }) => {
    // the owner stores a contract first (fresh design)
    const ctx = await signedInContext(browser)
    const api = ctx.request
    const stored = await saveDesign(api, 'd_e2e_prov_two', {
      pages: pagesSatisfying(),
      aiProvenance: { prompt: 'private generation prompt', outcome: 'passed', brief: BRIEF },
    })
    expect(stored.body.aiProvenance).toBeDefined()
    await ctx.close()

    // the link viewer: no session at all — the designs family grants
    // link-view, so they can read the design AND its shareable
    // contract, but the original prompt is private to editors
    const viewer = await browser.newContext()
    const vapi = viewer.request
    const got = await vapi.fetch(`${BASE}/api/designs/d_e2e_prov_two`)
    expect(got.status()).toBe(200)
    const design = (await got.json()) as { readOnly?: boolean; aiProvenance?: { prompt?: string; brief?: unknown; verified?: boolean } }
    expect(design.readOnly).toBe(true)
    expect(design.aiProvenance).toBeDefined()
    expect(design.aiProvenance?.brief).toBeDefined()
    expect(design.aiProvenance?.verified).toBe(true)
    expect('prompt' in (design.aiProvenance ?? {})).toBe(false)
    expect(JSON.stringify(design.aiProvenance)).not.toContain('private generation prompt')

    // the dedicated GET follows the same rule
    const direct = await vapi.fetch(`${BASE}/api/designs/d_e2e_prov_two/ai-provenance`)
    expect(direct.status()).toBe(200)
    const directBody = (await direct.json()) as { provenance?: { prompt?: string; brief?: unknown } }
    expect(directBody.provenance?.brief).toBeDefined()
    expect('prompt' in (directBody.provenance ?? {})).toBe(false)

    // writes are refused: the viewer cannot save the design (and so
    // cannot write provenance through it)…
    const foreignSave = await vapi.fetch(`${BASE}/api/designs/d_e2e_prov_two`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', origin: BASE },
      data: { pages: pagesSatisfying() },
    })
    expect(foreignSave.status()).toBe(403)
    // …and the client-supplied provenance PUT no longer exists
    const gone = await vapi.fetch(`${BASE}/api/designs/d_e2e_prov_two/ai-provenance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', origin: BASE },
      data: { brief: BRIEF },
    })
    expect(gone.status()).toBe(405)

    await viewer.close()
  })

  test('junk and over-limit briefs are REFUSED at save — never silently weakened', async ({ browser }) => {
    const ctx = await signedInContext(browser)
    const api = ctx.request

    // nothing usable: the design still saves; the refusal is explicit
    const junk = await saveDesign(api, 'd_e2e_prov_two', {
      pages: pagesSatisfying(),
      aiProvenance: { prompt: 'x', outcome: 'passed', brief: { requiredTexts: [], requiredColors: [] } },
    })
    expect(junk.status).toBe(200)
    expect(typeof junk.body.aiProvenanceRejected).toBe('string')
    expect(junk.body.aiProvenance).toBeUndefined()

    // over-limit (more than the cap): refused rather than stored
    // with entries silently dropped
    const over = await saveDesign(api, 'd_e2e_prov_two', {
      pages: pagesSatisfying(),
      aiProvenance: {
        prompt: 'x',
        outcome: 'passed',
        brief: { requiredTexts: Array.from({ length: 80 }, (_, i) => ({ text: `t${i}` })) },
      },
    })
    expect(over.status).toBe(200)
    expect(typeof over.body.aiProvenanceRejected).toBe('string')

    await ctx.close()
  })

  test('a missing design id is a flat 404 on both verbs', async ({ browser }) => {
    const ctx = await signedInContext(browser)
    const api = ctx.request
    const got = await api.fetch(`${BASE}/api/designs/d_e2e_prov_missing/ai-provenance`)
    expect(got.status()).toBe(404)
    const put = await api.fetch(`${BASE}/api/designs/d_e2e_prov_missing`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', origin: BASE },
      data: { pages: pagesSatisfying() },
    })
    expect(put.status()).toBe(404)
    await ctx.close()
  })
})
