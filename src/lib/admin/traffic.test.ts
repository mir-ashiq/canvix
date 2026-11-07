// Unit tests for traffic + activity recording (v0.16 A1): day
// bucketing, route-name parsing, the opt-out flag and the
// fire-and-forget contract, against a mocked db.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const upsert = vi.hoisted(() => vi.fn())
const deleteMany = vi.hoisted(() => vi.fn())
const dbMock = vi.hoisted(() => ({ trafficStat: { upsert, deleteMany }, dailyActive: { upsert } }))
vi.mock('@/lib/db', () => ({ db: dbMock }))

import { utcDay, parseRouteName, recordTraffic, recordActive, trafficRecordingEnabled } from './traffic'

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  upsert.mockResolvedValue({})
  deleteMany.mockResolvedValue({ count: 0 })
})

describe('utcDay (v0.16 A1)', () => {
  it('truncates to UTC midnight', () => {
    expect(utcDay(new Date('2026-11-07T13:44:59.999Z')).toISOString()).toBe('2026-11-07T00:00:00.000Z')
  })

  it('late-UTC local times land on the next UTC day', () => {
    expect(utcDay(new Date('2026-11-07T23:30:00Z')).toISOString()).toBe('2026-11-07T00:00:00.000Z')
    expect(utcDay(new Date('2026-11-08T00:01:00Z')).toISOString()).toBe('2026-11-08T00:00:00.000Z')
  })
})

describe('parseRouteName (v0.16 A1)', () => {
  it('splits "METHOD /route" wrapper names', () => {
    expect(parseRouteName('GET /api/designs', 'POST')).toEqual({ route: '/api/designs', method: 'GET' })
  })

  it('odd shapes fall back to the request method and the whole name', () => {
    expect(parseRouteName('weird', 'POST')).toEqual({ route: 'weird', method: 'POST' })
    expect(parseRouteName(' ', 'GET')).toEqual({ route: ' ', method: 'GET' })
    expect(parseRouteName('GET ', 'GET')).toEqual({ route: 'GET ', method: 'GET' })
  })
})

describe('trafficRecordingEnabled (v0.16 A1)', () => {
  it('on by default, off only on the explicit opt-out', () => {
    delete process.env.CANVIX_TRAFFIC
    expect(trafficRecordingEnabled()).toBe(true)
    vi.stubEnv('CANVIX_TRAFFIC', '0')
    expect(trafficRecordingEnabled()).toBe(false)
  })
})

describe('recordTraffic (v0.16 A1)', () => {
  it('upserts the day aggregate with an increment', async () => {
    await recordTraffic('GET /api/health', 'GET', 200)
    expect(upsert).toHaveBeenCalledTimes(1)
    const arg = upsert.mock.calls[0][0]
    expect(arg.where.day_route_method_status).toMatchObject({ route: '/api/health', method: 'GET', status: 200 })
    expect(arg.update).toEqual({ hits: { increment: 1 } })
    expect(arg.create.hits).toBe(1)
  })

  it('honors the opt-out with zero db calls', async () => {
    vi.stubEnv('CANVIX_TRAFFIC', '0')
    await recordTraffic('GET /api/health', 'GET', 200)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('db failures are swallowed (accounting never breaks the request)', async () => {
    upsert.mockRejectedValue(new Error('down'))
    await expect(recordTraffic('GET /api/health', 'GET', 500)).resolves.toBeUndefined()
  })

  it('occasionally sweeps rows past the retention window', async () => {
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0)
    await recordTraffic('GET /api/health', 'GET', 200)
    expect(deleteMany).toHaveBeenCalledTimes(1)
    const where = deleteMany.mock.calls[0][0].where
    // cutoff ≈ today - 90d
    const cutoff = where.day.lt as Date
    const days = (Date.now() - cutoff.getTime()) / 86_400_000
    expect(days).toBeGreaterThan(89)
    expect(days).toBeLessThan(91)
    rand.mockRestore()
  })
})

describe('recordActive (v0.16 A1)', () => {
  it('upserts (day, actor) idempotently', async () => {
    await recordActive('user-1')
    expect(dbMock.dailyActive.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {} })
    )
  })

  it('null actors are a no-op', async () => {
    await recordActive(null)
    await recordActive(undefined)
    expect(dbMock.dailyActive.upsert).not.toHaveBeenCalled()
  })
})
