// Unit tests for the day-series helpers (v0.16 A1).

import { describe, it, expect } from 'vitest'
import { dayKey, recentDayKeys, fillDays, sumSeries } from './series'

const NOW = new Date('2026-11-07T18:30:00Z')

describe('dayKey / recentDayKeys (v0.16 A1)', () => {
  it('formats UTC YYYY-MM-DD', () => {
    expect(dayKey(NOW)).toBe('2026-11-07')
  })

  it('returns `days` keys ending today, oldest first', () => {
    expect(recentDayKeys(3, NOW)).toEqual(['2026-11-05', '2026-11-06', '2026-11-07'])
  })
})

describe('fillDays (v0.16 A1)', () => {
  it('fills gaps with zeros and drops out-of-window days', () => {
    const series = fillDays(
      [
        ['2026-11-07', 12],
        ['2026-11-05', 4],
        ['2026-10-01', 999], // outside the 3-day window
      ],
      3,
      NOW
    )
    expect(series).toEqual([
      { day: '2026-11-05', value: 4 },
      { day: '2026-11-06', value: 0 },
      { day: '2026-11-07', value: 12 },
    ])
  })

  it('newest duplicate wins', () => {
    const series = fillDays(
      [
        ['2026-11-07', 1],
        ['2026-11-07', 5],
      ],
      1,
      NOW
    )
    expect(series).toEqual([{ day: '2026-11-07', value: 5 }])
  })
})

describe('sumSeries (v0.16 A1)', () => {
  it('sums the last N points only', () => {
    const series = fillDays(
      [
        ['2026-11-05', 100],
        ['2026-11-06', 2],
        ['2026-11-07', 3],
      ],
      3,
      NOW
    )
    expect(sumSeries(series, 2)).toBe(5)
    expect(sumSeries(series, 7)).toBe(105)
  })
})
