// Unit tests for the AI request log query layer (v0.16.3 A3) — the
// parsers are pure; queryAiLogs runs against a mocked db, verifying
// the where-clauses the Logs view depends on and the row shaping.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const dbMock = vi.hoisted(() => ({
  aIUsage: {
    findMany: vi.fn().mockResolvedValue([]),
    groupBy: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))

import { parseLogWindow, parseOutcome, parseLimit, LOG_WINDOWS, queryAiLogs } from './logs'

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.aIUsage.findMany.mockResolvedValue([])
  dbMock.aIUsage.groupBy.mockResolvedValue([])
  dbMock.aIUsage.deleteMany.mockResolvedValue({ count: 0 })
})

describe('log query parsers (A3)', () => {
  it('defaults the window to 24h and accepts known values only', () => {
    expect(parseLogWindow(null)).toBe('24h')
    expect(parseLogWindow('15m')).toBe('15m')
    expect(parseLogWindow('7d')).toBe('7d')
    expect(parseLogWindow('bogus')).toBe('24h')
    expect(LOG_WINDOWS['15m']).toBe(15 * 60 * 1000)
  })

  it('parses outcome conservatively', () => {
    expect(parseOutcome(null)).toBe('all')
    expect(parseOutcome('errors')).toBe('errors')
    expect(parseOutcome('ok')).toBe('ok')
    expect(parseOutcome('everything')).toBe('all')
  })

  it('clamps the limit', () => {
    expect(parseLimit(null)).toBe(150)
    expect(parseLimit('10')).toBe(20)
    expect(parseLimit('9999')).toBe(400)
    expect(parseLimit('abc')).toBe(150)
  })
})

describe('queryAiLogs (A3)', () => {
  it('passes window, feature and outcome filters into the where clause', async () => {
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0.5) // never sweeps
    await queryAiLogs({ window: '1h', feature: 'image', outcome: 'errors', limit: 50 })
    const where = dbMock.aIUsage.findMany.mock.calls[0][0].where
    expect(where.feature).toBe('image')
    expect(where.ok).toBe(false)
    expect(where.createdAt.gte).toBeInstanceOf(Date)
    expect(Date.now() - where.createdAt.gte.getTime()).toBeLessThanOrEqual(LOG_WINDOWS['1h'] + 100)
    expect(dbMock.aIUsage.findMany.mock.calls[0][0].take).toBe(50)
    expect(dbMock.aIUsage.groupBy).toHaveBeenCalled()
    expect(dbMock.aIUsage.deleteMany).not.toHaveBeenCalled()
    rand.mockRestore()
  })

  it('drops unknown features instead of erroring', async () => {
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    await queryAiLogs({ window: '24h', feature: "'; DROP TABLE", outcome: 'all', limit: 150 })
    expect(dbMock.aIUsage.findMany.mock.calls[0][0].where.feature).toBeUndefined()
    rand.mockRestore()
  })

  it('shapes rows and aggregates per-feature counts', async () => {
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    dbMock.aIUsage.findMany.mockResolvedValue([
      {
        id: 'c1',
        createdAt: new Date('2026-11-07T10:00:00Z'),
        feature: 'image',
        provider: 'NVIDIA NIM',
        model: 'qwen/qwen-image',
        ok: false,
        status: 404,
        durationMs: null,
        error: '404 page not found (HTTP 404)',
      },
    ])
    dbMock.aIUsage.groupBy.mockResolvedValue([
      { feature: 'image', ok: false, _count: { _all: 3 } },
      { feature: 'write', ok: true, _count: { _all: 4 } },
      { feature: 'write', ok: false, _count: { _all: 1 } },
    ])
    const out = await queryAiLogs({ window: '24h', outcome: 'all', limit: 150 })
    expect(out.rows).toHaveLength(1)
    expect(out.rows[0]).toEqual({
      id: 'c1',
      createdAt: '2026-11-07T10:00:00.000Z',
      feature: 'image',
      provider: 'NVIDIA NIM',
      model: 'qwen/qwen-image',
      ok: false,
      status: 404,
      durationMs: null,
      error: '404 page not found (HTTP 404)',
    })
    expect(out.counts.total).toBe(8)
    expect(out.counts.errors).toBe(4)
    expect(out.counts.byFeature.image).toEqual({ calls: 3, errors: 3 })
    expect(out.counts.byFeature.write).toEqual({ calls: 5, errors: 1 })
    // every known feature has an entry even with zero rows
    expect(out.counts.byFeature.assistant).toEqual({ calls: 0, errors: 0 })
    rand.mockRestore()
  })

  it('sweeps rows past retention when the 1% dice come up', async () => {
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0)
    dbMock.aIUsage.deleteMany.mockResolvedValue({ count: 12 })
    const out = await queryAiLogs({ window: '15m', outcome: 'all', limit: 150 })
    expect(dbMock.aIUsage.deleteMany).toHaveBeenCalled()
    expect(out.swept).toBe(true)
    const where = dbMock.aIUsage.deleteMany.mock.calls[0][0].where
    // 90-day retention
    const days = (Date.now() - where.createdAt.lt.getTime()) / (24 * 60 * 60 * 1000)
    expect(days).toBeGreaterThan(89.9)
    expect(days).toBeLessThan(90.1)
    rand.mockRestore()
  })
})
