// design-engine/palette.ts — role expansion with WCAG at assignment time.
import { describe, expect, it } from 'vitest'
import { expandPalette, mixHex, onColor } from './palette'
import { contrast } from '@/lib/theme'

const POSTER_SEEDS = ['#090b1a', '#8b5cf6', '#22d3ee']

describe('expandPalette', () => {
  it('assigns the v0.29.3 poster seeds: darkest ground, accents by luminance', () => {
    const { roles, warnings } = expandPalette({ seeds: POSTER_SEEDS, mood: 'neutral' })
    expect(warnings).toHaveLength(0)
    expect(roles.background.toLowerCase()).toBe('#090b1a')
    // both remaining seeds preserved verbatim in accent roles
    expect([roles.accent.toLowerCase(), roles.accentSoft.toLowerCase()].sort()).toEqual(
      ['#22d3ee', '#8b5cf6'].sort(),
    )
  })

  it('ink clears WCAG 4.5 on the ground — checked at assignment, not after', () => {
    const { roles } = expandPalette({ seeds: POSTER_SEEDS, mood: 'neutral' })
    expect(contrast(roles.ink, roles.background)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(roles.inkSoft, roles.background)).toBeGreaterThanOrEqual(4.5)
  })

  it('light ground with no seeds flips ink to near-black', () => {
    const { roles } = expandPalette({ seeds: [], mood: 'minimal' })
    expect(roles.background).toBe('#FFFFFF')
    expect(roles.ink).toBe('#10131A')
    expect(contrast(roles.ink, roles.background)).toBeGreaterThanOrEqual(4.5)
  })

  it('pinned roles are honored verbatim', () => {
    const { roles } = expandPalette({ seeds: POSTER_SEEDS, mood: 'neutral', pinned: { background: '#FFFFFF' } })
    expect(roles.background).toBe('#FFFFFF')
    expect(contrast(roles.ink, roles.background)).toBeGreaterThanOrEqual(4.5)
  })

  it('is deterministic — same seeds, same roles, same warnings', () => {
    const a = expandPalette({ seeds: POSTER_SEEDS, mood: 'warm' })
    const b = expandPalette({ seeds: POSTER_SEEDS, mood: 'warm' })
    expect(a).toEqual(b)
  })

  it('surface steps one shade off the ground toward ink', () => {
    const dark = expandPalette({ seeds: POSTER_SEEDS, mood: 'neutral' })
    expect(dark.roles.surface).not.toBe(dark.roles.background)
    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16)
    // dark ground → surface is lighter; light ground → surface is darker
    expect(lum(dark.roles.surface)).toBeGreaterThan(lum(dark.roles.background))
  })
})

describe('color primitives', () => {
  it('mixHex is linear and clamped', () => {
    expect(mixHex('#000000', '#FFFFFF', 0.5)).toBe('#808080')
    expect(mixHex('#000000', '#FFFFFF', 0)).toBe('#000000')
    expect(mixHex('#000000', '#FFFFFF', 1)).toBe('#ffffff')
    expect(mixHex('#000000', '#FFFFFF', 9)).toBe('#ffffff')
  })
  it('onColor picks the higher-contrast ink for any fill', () => {
    expect(onColor('#090b1a')).toBe('#FFFFFF')
    expect(onColor('#FFFFFF')).toBe('#10131A')
    expect(onColor('#22d3ee')).toBe('#10131A')
    // mid-luminance fills: the contract is best-of-two, and the
    // compile contrast check reports honestly when even that misses 4.5
    for (const fill of ['#8b5cf6', '#7630d7', '#02c0cc', '#F4F5F7']) {
      const picked = contrast(onColor(fill), fill)
      const other = contrast(onColor(fill) === '#FFFFFF' ? '#10131A' : '#FFFFFF', fill)
      expect(picked).toBeGreaterThanOrEqual(other)
    }
  })
})
