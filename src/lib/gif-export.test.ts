import { describe, expect, it } from 'vitest'
import type { PageData } from '@/lib/types'
import { GIF_MAX_FRAMES, gifDelayCs, planGifFrames, selectGifPages } from './gif-plan'

function page(id: string): PageData {
  return {
    id,
    background: { type: 'solid', color: '#ffffff' },
    elements: [],
  } as unknown as PageData
}

describe('gifDelayCs', () => {
  it('maps the dialog rates to exact centiseconds', () => {
    expect(gifDelayCs(10)).toBe(10)
    expect(gifDelayCs(20)).toBe(5)
    expect(gifDelayCs(50)).toBe(2)
  })
  it('rounds honestly (15 fps encodes as 7 cs = 14.29 effective)', () => {
    expect(gifDelayCs(15)).toBe(7)
    expect(gifDelayCs(30)).toBe(3) // 3.33 → 3
  })
  it('never emits a zero delay (browsers freeze on 0)', () => {
    expect(gifDelayCs(200)).toBe(2) // clamped, not 0.5 → 1 → 0
    expect(gifDelayCs(1000)).toBe(2)
  })
  it('fails closed on garbage fps', () => {
    expect(() => gifDelayCs(0)).toThrow(/positive/)
    expect(() => gifDelayCs(-5)).toThrow(/positive/)
    expect(() => gifDelayCs(Number.NaN)).toThrow(/positive/)
  })
})

describe('planGifFrames', () => {
  it('plans frames and reports duration from the ACTUAL delays', () => {
    // 6 s at 15 fps → 90 frames × 7 cs = 6.3 s (not 6.0 — the
    // centisecond rounding is reported, not hidden)
    const plan = planGifFrames(6, 15)
    expect(plan.frames).toBe(90)
    expect(plan.delayCs).toBe(7)
    expect(plan.durationSec).toBeCloseTo(6.3, 10)
  })
  it('clamps a sub-frame timeline to one frame', () => {
    const plan = planGifFrames(0.01, 10)
    expect(plan.frames).toBe(1)
  })
  it('respects a custom maxFrames with an actionable error', () => {
    expect(() => planGifFrames(60, 30, 100)).toThrow(/page range|frame rate|video/)
    expect(planGifFrames(60, 10, 1800).frames).toBe(600) // at the cap: fine
    expect(() => planGifFrames(181, 10, 1800)).toThrow(/cap/)
  })
  it('fails closed on a non-positive timeline', () => {
    expect(() => planGifFrames(0, 15)).toThrow(/duration/)
    expect(() => planGifFrames(-1, 15)).toThrow(/duration/)
  })
})

describe('selectGifPages', () => {
  const pages = [page('p1'), page('p2'), page('p3'), page('p4')]

  it('returns every page for mode=all and one for mode=current', () => {
    expect(selectGifPages(pages, { mode: 'all' })).toHaveLength(4)
    expect(selectGifPages(pages, { mode: 'current', currentPage: 2 })).toEqual([pages[2]])
  })
  it('slices an inclusive 1-based range', () => {
    expect(selectGifPages(pages, { mode: 'range', from: 2, to: 3 })).toEqual([pages[1], pages[2]])
    expect(selectGifPages(pages, { mode: 'range', from: 3, to: 3 })).toEqual([pages[2]])
    expect(selectGifPages(pages, { mode: 'range', from: 1, to: 4 })).toHaveLength(4)
  })
  it('clamps out-of-bounds ranges into the design (typed 99 in a 4-pager = 4)', () => {
    expect(selectGifPages(pages, { mode: 'range', from: 1, to: 99 })).toHaveLength(4)
    expect(selectGifPages(pages, { mode: 'range', from: 0, to: 2 })).toEqual([pages[0], pages[1]])
  })
  it('fails closed on reversed, non-numeric, and out-of-range input', () => {
    expect(() => selectGifPages(pages, { mode: 'range', from: 3, to: 1 })).toThrow(/reversed/)
    expect(() => selectGifPages(pages, { mode: 'range', from: Number.NaN, to: 2 })).toThrow(/numeric/)
    expect(() => selectGifPages(pages, { mode: 'current', currentPage: 4 })).toThrow(/out of range/)
    expect(() => selectGifPages(pages, { mode: 'current', currentPage: -1 })).toThrow(/out of range/)
    expect(() => selectGifPages([], { mode: 'all' })).toThrow(/no pages/)
  })
})

describe('GIF caps are stable constants (documented in docs/GIF-EXPORT.md)', () => {
  it('keeps the frame cap at 1800', () => {
    expect(GIF_MAX_FRAMES).toBe(1800)
  })
})
