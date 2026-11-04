// Unit tests for claimAnonMedia (v0.14 D1): anonymous uploads follow
// the account on login/register. Scoping must be exact — ownerId IS
// NULL (never re-claim another account's rows) AND anonKey = this
// browser's hash. Failures are swallowed (best-effort).

import { describe, it, expect, vi, beforeEach } from 'vitest'

const updateMany = vi.hoisted(() => vi.fn())
const dbMock = vi.hoisted(() => ({ media: { updateMany } }))
vi.mock('@/lib/db', () => ({ db: dbMock }))

const readAnonToken = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/anon', () => ({
  readAnonToken,
  anonKeyHash: (t: string) => `hash(${t})`,
}))

import { NextRequest } from 'next/server'
import { claimAnonMedia } from './claim-media'

beforeEach(() => {
  vi.clearAllMocks()
})

function req(anon: string | null) {
  readAnonToken.mockReturnValue(anon)
  return new NextRequest('http://localhost/api/auth/login')
}

describe('claimAnonMedia (v0.14 D1)', () => {
  it('claims this browser\'s anon uploads into the account', async () => {
    updateMany.mockResolvedValueOnce({ count: 3 })
    await claimAnonMedia(req('tok-1'), 'user-9')
    expect(updateMany).toHaveBeenCalledTimes(1)
    const arg = updateMany.mock.calls[0][0]
    expect(arg.where).toEqual({ ownerId: null, anonKey: 'hash(tok-1)' })
    expect(arg.data).toEqual({ ownerId: 'user-9', anonKey: null })
  })

  it('no anon cookie → no-op', async () => {
    await claimAnonMedia(req(null), 'user-9')
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('DB failure is swallowed (login must not fail)', async () => {
    updateMany.mockRejectedValueOnce(new Error('db down'))
    await expect(claimAnonMedia(req('tok-2'), 'user-9')).resolves.toBeUndefined()
  })
})
