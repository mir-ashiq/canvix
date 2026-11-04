// Unit tests for the v0.14 (D1) finalize path: sha256 dedupe within
// the SAME attribution + keepInLibrary stamping.
//
//   1. identical bytes already in the caller's library → the new row
//      is deleted and the OLD id returned (deduplicated: true)
//   2. no dupe → row finalized, hashed, and kept in the library
//   3. dedupe NEVER matches across attributions (the SQL scopes by
//      ownerId/anonKey — asserted on the emitted statement)

import { describe, it, expect, vi, beforeEach } from 'vitest'

const queryRaw = vi.hoisted(() => vi.fn())
const mediaDelete = vi.hoisted(() => vi.fn())
const mediaUpdate = vi.hoisted(() => vi.fn())
const dbMock = vi.hoisted(() => ({
  $queryRawUnsafe: queryRaw,
  media: { delete: mediaDelete, update: mediaUpdate },
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))

vi.mock('@/lib/observability', () => ({
  withLogging: (_name: string, fn: unknown) => fn,
}))

import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { PUT } from './[id]/route'

beforeEach(() => {
  vi.clearAllMocks()
  mediaDelete.mockResolvedValue({ id: 'gone' })
  mediaUpdate.mockResolvedValue({ id: 'kept' })
})

function putReq(id: string, expectedSize: number) {
  return new NextRequest(`http://localhost/api/media/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedSize }),
  })
}

const OWNER = { ownerId: 'user-a', anonKey: null }
const BYTES = Buffer.from('pngbytes')

function mockFinalizeQueries(bytes: Buffer, owner: { ownerId: string | null; anonKey: Buffer | null }, dupe: { id: string }[]) {
  queryRaw
    .mockResolvedValueOnce([{ len: bytes.length }]) // length check
    .mockResolvedValueOnce([{ bytes, ...owner }]) // bytes + attribution
    .mockResolvedValueOnce(dupe) // dedupe lookup
}

describe('PUT /api/media/[id] finalize (v0.14 D1)', () => {
  it('dedupes: returns the OLD id and deletes the redundant row', async () => {
    mockFinalizeQueries(BYTES, OWNER, [{ id: 'm-old' }])
    const res = await PUT(putReq('m-new', BYTES.length), { params: Promise.resolve({ id: 'm-new' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'm-old', deduplicated: true })
    expect(mediaDelete).toHaveBeenCalledWith({ where: { id: 'm-new' } })
    expect(mediaUpdate).not.toHaveBeenCalled()
  })

  it('no dupe: finalizes with contentHash + keepInLibrary', async () => {
    mockFinalizeQueries(BYTES, OWNER, [])
    const res = await PUT(putReq('m-new', BYTES.length), { params: Promise.resolve({ id: 'm-new' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'm-new' })
    expect(mediaDelete).not.toHaveBeenCalled()
    const arg = mediaUpdate.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'm-new' })
    expect(arg.data.keepInLibrary).toBe(true)
    // sha256 of 'pngbytes' — proving the hash covers the actual bytes
    expect(arg.data.contentHash).toBe(createHash('sha256').update(BYTES).digest('hex'))
  })

  it('the dedupe lookup is attribution-scoped (never across accounts)', async () => {
    mockFinalizeQueries(BYTES, OWNER, [])
    await PUT(putReq('m-new', BYTES.length), { params: Promise.resolve({ id: 'm-new' }) })
    const dupeSql = queryRaw.mock.calls[2][0] as string
    expect(dupeSql).toContain('"ownerId" = $3')
    expect(dupeSql).toContain('"anonKey" = $4')
    // anonymous attribution rides the anonKey, never a foreign owner
    const args = queryRaw.mock.calls[2].slice(1)
    expect(args[2]).toBe('user-a')
    expect(args[3]).toBeNull()
  })

  it('length mismatch is a 409 before any dedupe work', async () => {
    queryRaw.mockResolvedValueOnce([{ len: 3 }])
    const res = await PUT(putReq('m-new', 999), { params: Promise.resolve({ id: 'm-new' }) })
    expect(res.status).toBe(409)
    expect(queryRaw).toHaveBeenCalledTimes(1)
  })
})
