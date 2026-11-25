// Security regression tests for the media store (v0.31, CWE-79 fix —
// the 2026-11-25 report, credit @hackchang).
//
// Replays the report's proof of concept against the hardened routes:
//   · init     rejects image/svg+xml (and html/xml) outright
//   · finalize rejects SVG bytes smuggled under an allowed mime,
//              and requires the upload's owner
//   · PATCH    requires the upload's owner
//   · GET      never serves attacker-controlled bytes as an
//              instantiable document: unverified rows become
//              application/octet-stream + attachment + sandbox CSP
import { describe, it, expect, vi, beforeEach } from 'vitest'

const queryRaw = vi.hoisted(() => vi.fn())
const executeRaw = vi.hoisted(() => vi.fn())
const mediaCreate = vi.hoisted(() => vi.fn())
const mediaUpdate = vi.hoisted(() => vi.fn())
const mediaDelete = vi.hoisted(() => vi.fn())
const mediaDeleteMany = vi.hoisted(() => vi.fn())
const dbMock = vi.hoisted(() => ({
  $queryRawUnsafe: queryRaw,
  $executeRawUnsafe: executeRaw,
  media: { create: mediaCreate, update: mediaUpdate, delete: mediaDelete, deleteMany: mediaDeleteMany },
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))
vi.mock('@/lib/observability', () => ({
  withLogging: (_name: string, fn: unknown) => fn,
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(() => new Response('rate limited', { status: 429 })),
}))
const getSessionUserMock = vi.hoisted(() => vi.fn(async (_req: unknown) => null as { id: string } | null))
vi.mock('@/lib/auth/session', () => ({ getSessionUser: getSessionUserMock }))

import { NextRequest } from 'next/server'
import { POST } from './route'
import { GET, PATCH, PUT } from './[id]/route'
import { anonKeyHash } from '@/lib/auth/anon'

// real signatures the finalize gate demands
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const SVG_POC = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>',
)

beforeEach(() => {
  vi.clearAllMocks()
  getSessionUserMock.mockResolvedValue(null)
  mediaCreate.mockResolvedValue({ id: 'm-new' })
  mediaUpdate.mockResolvedValue({ id: 'm-new' })
  mediaDelete.mockResolvedValue({ id: 'gone' })
  mediaDeleteMany.mockResolvedValue(0)
})

// ── helpers ───────────────────────────────────────────────────

function postInit(mime: string, size = 57) {
  return new NextRequest('http://localhost/api/media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mime, size, name: 'a.bin' }),
  })
}

function patchChunk(id: string, offset: number, body: Buffer, cookie?: string) {
  return new NextRequest(`http://localhost/api/media/${id}?offset=${offset}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/octet-stream', ...(cookie ? { Cookie: cookie } : {}) },
    body: new Uint8Array(body),
  })
}

function putFinalize(id: string, expectedSize: number, cookie?: string) {
  return new NextRequest(`http://localhost/api/media/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ expectedSize }),
  })
}

function getMedia(id: string, range?: string) {
  return new NextRequest(`http://localhost/api/media/${id}`, {
    method: 'GET',
    ...(range ? { headers: { Range: range } } : {}),
  })
}

const ANON = 'anon-token-a'

function row(over: Partial<{ bytes: Buffer; mime: string; ownerId: string | null; anonKey: string | null }> = {}) {
  return {
    bytes: PNG,
    mime: 'image/png',
    ownerId: null,
    anonKey: anonKeyHash(ANON),
    ...over,
  }
}

// ── init: the exact allowlist ─────────────────────────────────

describe('POST /api/media — init (CWE-79 fix)', () => {
  it('rejects the report payload: image/svg+xml never enters the store', async () => {
    const res = await POST(postInit('image/svg+xml'))
    expect(res.status).toBe(415)
    expect(mediaCreate).not.toHaveBeenCalled()
  })

  it('rejects html/xhtml/xml and unknown image/* shapes the old prefix check let through', async () => {
    for (const mime of ['text/html', 'application/xhtml+xml', 'text/xml', 'image/svg+xml; charset=utf-8', 'image/hack']) {
      const res = await POST(postInit(mime))
      expect(res.status, mime).toBe(415)
    }
    expect(mediaCreate).not.toHaveBeenCalled()
  })

  it('accepts raster/audio/video and stores the CANONICAL type, not the client string', async () => {
    queryRaw.mockResolvedValue([{ used: 0 }])
    const res = await POST(postInit('image/jpg'))
    expect(res.status).toBe(201)
    expect(mediaCreate).toHaveBeenCalledTimes(1)
    expect(mediaCreate.mock.calls[0]![0].data.mime).toBe('image/jpeg')
  })
})

// ── PATCH: ownership ──────────────────────────────────────────

describe('PATCH /api/media/[id] — ownership (CWE-79 fix)', () => {
  it('404s before any byte write when the caller has no attribution', async () => {
    queryRaw.mockResolvedValue([row()])
    const res = await PATCH(patchChunk('m-new', 0, Buffer.from('chunk')), { params: Promise.resolve({ id: 'm-new' }) })
    expect(res.status).toBe(404)
    expect(executeRaw).not.toHaveBeenCalled()
  })

  it('404s when the caller is not the row owner (flat — no existence oracle)', async () => {
    queryRaw.mockResolvedValue([row()])
    const res = await PATCH(patchChunk('m-new', 0, Buffer.from('chunk'), `canvix_anon=someone-else`),
      { params: Promise.resolve({ id: 'm-new' }) })
    expect(res.status).toBe(404)
    expect(executeRaw).not.toHaveBeenCalled()
  })

  it('appends for the row owner', async () => {
    queryRaw
      .mockResolvedValueOnce([row()]) // ownership
      .mockResolvedValueOnce([{ len: 5 }]) // post-append length
    executeRaw.mockResolvedValue(1)
    const res = await PATCH(patchChunk('m-new', 0, Buffer.from('chunk'), `canvix_anon=${ANON}`),
      { params: Promise.resolve({ id: 'm-new' }) })
    expect(res.status).toBe(200)
    expect(executeRaw).toHaveBeenCalledTimes(1)
  })
})

// ── finalize: ownership + byte verification ───────────────────

describe('PUT /api/media/[id] — finalize (CWE-79 fix)', () => {
  it('rejects SVG bytes smuggled under an allowed mime — the PoC upload', async () => {
    queryRaw
      .mockResolvedValueOnce([{ len: SVG_POC.length }])
      .mockResolvedValueOnce([row({ bytes: SVG_POC })])
    const res = await PUT(putFinalize('m-new', SVG_POC.length, `canvix_anon=${ANON}`),
      { params: Promise.resolve({ id: 'm-new' }) })
    expect(res.status).toBe(415)
    expect(mediaUpdate).not.toHaveBeenCalled()
    expect(mediaDelete).not.toHaveBeenCalled()
  })

  it('rejects a legacy-shaped row (mime image/svg+xml) even from its owner', async () => {
    queryRaw
      .mockResolvedValueOnce([{ len: SVG_POC.length }])
      .mockResolvedValueOnce([row({ bytes: SVG_POC, mime: 'image/svg+xml' })])
    const res = await PUT(putFinalize('m-new', SVG_POC.length, `canvix_anon=${ANON}`),
      { params: Promise.resolve({ id: 'm-new' }) })
    expect(res.status).toBe(415)
    expect(mediaUpdate).not.toHaveBeenCalled()
  })

  it('404s a non-owner before reading bytes or hashing', async () => {
    queryRaw
      .mockResolvedValueOnce([{ len: PNG.length }])
      .mockResolvedValueOnce([row({ ownerId: 'user-a', anonKey: null })])
    const res = await PUT(putFinalize('m-new', PNG.length, `canvix_anon=${ANON}`),
      { params: Promise.resolve({ id: 'm-new' }) })
    expect(res.status).toBe(404)
    expect(mediaUpdate).not.toHaveBeenCalled()
  })

  it('finalizes a verified PNG for its owner', async () => {
    queryRaw
      .mockResolvedValueOnce([{ len: PNG.length }])
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce([]) // no dupe
    const res = await PUT(putFinalize('m-new', PNG.length, `canvix_anon=${ANON}`),
      { params: Promise.resolve({ id: 'm-new' }) })
    expect(res.status).toBe(200)
    expect(mediaUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'm-new' }, data: expect.objectContaining({ keepInLibrary: true }) }),
    )
  })
})

// ── GET: the response hardening ───────────────────────────────

describe('GET /api/media/[id] — stream hardening (CWE-79 fix)', () => {
  it('serves the stored SVG row (the report end state) as an inert download', async () => {
    queryRaw.mockResolvedValue([{ bytes: SVG_POC, mime: 'image/svg+xml' }])
    const res = await GET(getMedia('m-evil'), { params: Promise.resolve({ id: 'm-evil' }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('content-disposition')).toBe('attachment')
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toContain('immutable')
  })

  it('downgrades a legacy row whose bytes no longer prove the claim', async () => {
    queryRaw.mockResolvedValue([{ bytes: SVG_POC, mime: 'image/png' }])
    const res = await GET(getMedia('m-legacy'), { params: Promise.resolve({ id: 'm-legacy' }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('content-disposition')).toBe('attachment')
  })

  it('serves a verified raster inline — the editor flow is unchanged', async () => {
    queryRaw.mockResolvedValue([{ bytes: PNG, mime: 'image/png' }])
    const res = await GET(getMedia('m-good'), { params: Promise.resolve({ id: 'm-good' }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('content-disposition')).toBeNull()
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('serves real audio/video containers inline (audio/wav)', async () => {
    const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0x08, 0, 0]), Buffer.from('WAVEfmt ')])
    queryRaw.mockResolvedValue([{ bytes: WAV, mime: 'audio/wav' }])
    const res = await GET(getMedia('m-wav'), { params: Promise.resolve({ id: 'm-wav' }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('audio/wav')
    expect(res.headers.get('content-disposition')).toBeNull()
  })

  it('Range requests carry the same hardening (206 path)', async () => {
    queryRaw.mockResolvedValue([{ bytes: SVG_POC, mime: 'image/svg+xml' }])
    const res = await GET(getMedia('m-evil', 'bytes=0-9'), { params: Promise.resolve({ id: 'm-evil' }) })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('content-disposition')).toBe('attachment')
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
  })
})
