// Unit tests for the admin guard (v0.16 A1): env bootstrap parsing,
// effective-admin resolution and the fail-closed default.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const user = (username: string, role = 'user') => ({ username, role })

beforeEach(() => {
  vi.unstubAllEnvs()
})

describe('envAdminUsernames (v0.16 A1)', () => {
  it('parses a comma list, trimming and lowercasing', async () => {
    const { envAdminUsernames } = await import('./guard')
    vi.stubEnv('CANVIX_ADMIN_USERS', ' Alice , BOB, carol_1 ')
    expect(envAdminUsernames()).toEqual(new Set(['alice', 'bob', 'carol_1']))
  })

  it('empty / unset → empty set (fail-closed)', async () => {
    const { envAdminUsernames } = await import('./guard')
    vi.stubEnv('CANVIX_ADMIN_USERS', '')
    expect(envAdminUsernames().size).toBe(0)
    delete process.env.CANVIX_ADMIN_USERS
    expect(envAdminUsernames().size).toBe(0)
  })

  it('drops blank segments', async () => {
    const { envAdminUsernames } = await import('./guard')
    vi.stubEnv('CANVIX_ADMIN_USERS', 'alice,,bob,')
    expect(envAdminUsernames()).toEqual(new Set(['alice', 'bob']))
  })
})

describe('isAdminUser (v0.16 A1)', () => {
  it('DB role admin wins', async () => {
    const { isAdminUser } = await import('./guard')
    expect(isAdminUser(user('alice', 'admin'))).toBe(true)
  })

  it('env bootstrap matches by username, case-insensitively', async () => {
    const { isAdminUser } = await import('./guard')
    vi.stubEnv('CANVIX_ADMIN_USERS', 'Alice')
    expect(isAdminUser(user('alice'))).toBe(true)
    expect(isAdminUser(user('bob'))).toBe(false)
  })

  it('plain users and missing users are never admin', async () => {
    const { isAdminUser } = await import('./guard')
    delete process.env.CANVIX_ADMIN_USERS
    expect(isAdminUser(user('alice'))).toBe(false)
    expect(isAdminUser(null)).toBe(false)
    expect(isAdminUser(undefined)).toBe(false)
  })
})

describe('adminSource (v0.16 A1)', () => {
  it('distinguishes db / env / both / none', async () => {
    const { adminSource } = await import('./guard')
    vi.stubEnv('CANVIX_ADMIN_USERS', 'alice')
    expect(adminSource(user('alice', 'admin'))).toBe('both')
    expect(adminSource(user('alice'))).toBe('env')
    expect(adminSource(user('bob', 'admin'))).toBe('db')
    expect(adminSource(user('bob'))).toBeNull()
    expect(adminSource(null)).toBeNull()
  })
})
