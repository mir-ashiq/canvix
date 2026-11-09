// Unit tests for POST /api/templates/[slug]/fill (v0.17 Wave 2) —
// validation, rendering and persist mode with a stubbed db + auth.

import { NextRequest } from 'next/server'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const dbMock = vi.hoisted(() => ({
  template: { findUnique: vi.fn() },
  design: { createManyAndReturn: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))
vi.mock('@/lib/rate-limit', async (orig) => {
  const actual = await orig<typeof import('@/lib/rate-limit')>()
  return { ...actual, checkRateLimit: () => ({ ok: true }) }
})
const sessionMock = vi.hoisted(() => ({ getSessionUser: vi.fn() }))
vi.mock('@/lib/auth/session', () => sessionMock)
const anonMock = vi.hoisted(() => ({
  readAnonToken: vi.fn(),
  newAnonToken: vi.fn(),
  anonKeyHash: vi.fn(() => 'hashed'),
  setAnonCookie: vi.fn(),
}))
vi.mock('@/lib/auth/anon', () => anonMock)

import { POST } from './route'

const TEMPLATE = {
  id: 't1',
  slug: 'certificate-excellence',
  name: 'Certificate of Excellence',
  category: 'print',
  width: 1754,
  height: 1240,
  accent: '#B45309',
  fields: [{ key: 'recipient_name', label: 'Recipient name', example: 'Ada' }],
  pages: [
    {
      id: 'p1',
      background: { type: 'solid', color: '#FFFFFF' },
      elements: [
        { id: 't1', type: 'text', text: 'Awarded to {{recipient_name}}', x: 0, y: 0, width: 100, height: 40 },
      ],
    },
  ],
  createdAt: new Date(),
}

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) })
const jsonReq = (body: unknown, url = '/api/templates/certificate-excellence/fill') =>
  new NextRequest(`http://canvix.test${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

beforeEach(() => {
  dbMock.template.findUnique.mockReset().mockResolvedValue(TEMPLATE)
  dbMock.design.createManyAndReturn.mockReset().mockResolvedValue([{ id: 'd1', name: 'Certificate of Excellence' }])
  sessionMock.getSessionUser.mockReset().mockResolvedValue(null)
  anonMock.readAnonToken.mockReset().mockReturnValue('anon-token')
  anonMock.newAnonToken.mockReset().mockReturnValue('fresh-token')
})

describe('POST /api/templates/[slug]/fill (v0.17 Wave 2)', () => {
  it('renders a single values object', async () => {
    const res = await POST(jsonReq({ values: { recipient_name: 'Grace Hopper' } }), ctx('certificate-excellence'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.template).toBe('certificate-excellence')
    expect(body.fields).toEqual(['recipient_name'])
    expect(body.generated).toHaveLength(1)
    expect(body.generated[0].pages[0].elements[0].text).toBe('Awarded to Grace Hopper')
    expect(body.created).toBeUndefined()
  })

  it('renders batch rows and names them (1), (2), …', async () => {
    const res = await POST(
      jsonReq({ rows: [{ recipient_name: 'A' }, { recipient_name: 'B' }] }),
      ctx('certificate-excellence')
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.generated.map((g: { name: string }) => g.name)).toEqual([
      'Certificate of Excellence (1)',
      'Certificate of Excellence (2)',
    ])
  })

  it('accepts a raw text/csv body with a header row', async () => {
    const req = new NextRequest('http://canvix.test/api/templates/certificate-excellence/fill', {
      method: 'POST',
      headers: { 'content-type': 'text/csv' },
      body: 'recipient_name\nAda\nGrace\n',
    })
    const res = await POST(req, ctx('certificate-excellence'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.generated).toHaveLength(2)
    expect(body.generated[0].pages[0].elements[0].text).toBe('Awarded to Ada')
  })

  it('persists designs with ?persist=1 and stamps attribution', async () => {
    const res = await POST(
      jsonReq({ values: { recipient_name: 'Ada' } }, '/api/templates/certificate-excellence/fill?persist=1'),
      ctx('certificate-excellence')
    )
    expect(res.status).toBe(201)
    expect(dbMock.design.createManyAndReturn).toHaveBeenCalledOnce()
    const arg = dbMock.design.createManyAndReturn.mock.calls[0][0]
    expect(arg.data[0].source).toBe('template:certificate-excellence')
    expect(arg.data[0].anonKey).toBe('hashed')
    const body = await res.json()
    expect(body.created).toEqual([{ id: 'd1', name: 'Certificate of Excellence' }])
  })

  it('rejects malformed slugs, missing templates, fieldless templates', async () => {
    expect((await POST(jsonReq({ values: {} }), ctx('../etc'))).status).toBe(400)
    dbMock.template.findUnique.mockResolvedValueOnce(null)
    expect((await POST(jsonReq({ values: {} }), ctx('nope-template'))).status).toBe(404)
    dbMock.template.findUnique.mockResolvedValueOnce({ ...TEMPLATE, fields: null, pages: [{ id: 'p', background: { type: 'solid', color: '#fff' }, elements: [] }] })
    expect((await POST(jsonReq({ values: {} }), ctx('certificate-excellence'))).status).toBe(422)
  })

  it('rejects bad bodies: empty, wrong shapes, oversized batches', async () => {
    expect((await POST(jsonReq({}), ctx('certificate-excellence'))).status).toBe(400)
    expect((await POST(jsonReq({ rows: [] }), ctx('certificate-excellence'))).status).toBe(400)
    expect((await POST(jsonReq({ values: 'nope' }), ctx('certificate-excellence'))).status).toBe(400)
    expect(
      (await POST(jsonReq({ rows: Array.from({ length: 101 }, () => ({ recipient_name: 'x' })) }), ctx('certificate-excellence'))).status
    ).toBe(400)
  })

  it('falls back to scanning {{markers}} when a template has no declared fields', async () => {
    dbMock.template.findUnique.mockResolvedValueOnce({ ...TEMPLATE, fields: null })
    const res = await POST(jsonReq({ values: { recipient_name: 'Scan' } }), ctx('certificate-excellence'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.fields).toEqual(['recipient_name'])
    expect(body.generated[0].pages[0].elements[0].text).toBe('Awarded to Scan')
  })
})
