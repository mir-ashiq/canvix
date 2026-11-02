import { describe, expect, it } from 'vitest'
import { compareSemver, matchesRange, parseSemver, sameVersion } from './semver'

// P1 security boundary: plugin engines ranges must be matched by a
// hand-rolled parser (zero-dep rule, research §4.10). These tests
// pin the grammar the manifest validator and install route rely on.

describe('parseSemver', () => {
  it('parses plain triples', () => {
    expect(parseSemver('0.13.0')).toEqual({ major: 0, minor: 13, patch: 0, prerelease: [] })
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] })
  })

  it('accepts v-prefix and build metadata (ignored)', () => {
    expect(parseSemver('v1.2.3')?.patch).toBe(3)
    expect(parseSemver('1.2.3+build.7')?.minor).toBe(2)
  })

  it('parses prerelease identifiers with numeric rules', () => {
    const v = parseSemver('1.0.0-rc.1')
    expect(v?.prerelease).toEqual(['rc', 1])
    // leading zeros on numeric identifiers are invalid per spec
    expect(parseSemver('1.0.0-01')).toBeNull()
    expect(parseSemver('1.0.0-rc.02')).toBeNull()
  })

  it('rejects junk', () => {
    for (const bad of ['', '1', '1.2', '1.2.3.4', 'a.b.c', '1.2.x', '>=1.2.3', '1.2.3-', '  ']) {
      expect(parseSemver(bad)).toBeNull()
    }
  })
})

describe('compareSemver', () => {
  it('orders triples numerically', () => {
    expect(compareSemver(parseSemver('0.12.9')!, parseSemver('0.13.0')!)).toBeLessThan(0)
    expect(compareSemver(parseSemver('1.0.0')!, parseSemver('0.99.99')!)).toBeGreaterThan(0)
  })

  it('orders prereleases: release > rc.10 > rc.2.a > rc.2 > alpha', () => {
    // spec: larger identifier sets rank higher when preceding fields tie
    const seq = ['1.0.0-alpha', '1.0.0-rc.2', '1.0.0-rc.2.a', '1.0.0-rc.10', '1.0.0']
    for (let i = 0; i + 1 < seq.length; i++) {
      expect(compareSemver(parseSemver(seq[i])!, parseSemver(seq[i + 1])!)).toBeLessThan(0)
    }
  })
})

describe('matchesRange', () => {
  it('exact match', () => {
    expect(matchesRange('0.12.5', '0.12.5')).toBe(true)
    expect(matchesRange('0.12.6', '0.12.5')).toBe(false)
    expect(matchesRange('0.12.5', '=0.12.5')).toBe(true)
  })

  it('comparator sets (the manifest example)', () => {
    expect(matchesRange('0.12.5', '>=0.12.0 <0.13.0')).toBe(true)
    expect(matchesRange('0.12.0', '>=0.12.0 <0.13.0')).toBe(true)
    expect(matchesRange('0.13.0', '>=0.12.0 <0.13.0')).toBe(false)
    expect(matchesRange('0.11.9', '>=0.12.0 <0.13.0')).toBe(false)
  })

  it('hyphen ranges are inclusive and partial upper ends open up', () => {
    expect(matchesRange('0.12.0', '0.12.0 - 0.13.0')).toBe(true)
    expect(matchesRange('0.13.0', '0.12.0 - 0.13.0')).toBe(true)
    expect(matchesRange('0.13.1', '0.12.0 - 0.13.0')).toBe(false)
    expect(matchesRange('0.13.9', '0.12.0 - 0.13')).toBe(true)
    expect(matchesRange('0.14.0', '0.12.0 - 0.13')).toBe(false)
  })

  it('OR alternatives', () => {
    expect(matchesRange('0.11.8', '>=0.14.0 || 0.11.x')).toBe(true)
    expect(matchesRange('0.12.0', '>=0.14.0 || 0.11.x')).toBe(false)
  })

  it('x-ranges and bare partials', () => {
    expect(matchesRange('0.12.9', '0.12.x')).toBe(true)
    expect(matchesRange('0.13.0', '0.12.x')).toBe(false)
    expect(matchesRange('0.12.3', '0.12')).toBe(true)
    expect(matchesRange('0.12.3', '0.x')).toBe(true)
    expect(matchesRange('1.0.0', '0.x')).toBe(false)
    expect(matchesRange('0.12.3', '0.*')).toBe(true)
  })

  it('comparators on partials shift like node-semver', () => {
    expect(matchesRange('1.3.0', '>1.2')).toBe(true)   // >1.2 ⇒ >=1.3.0
    expect(matchesRange('1.2.9', '>1.2')).toBe(false)
    expect(matchesRange('1.2.9', '<1.3')).toBe(true)   // <1.3 ⇒ <1.3.0
    expect(matchesRange('1.3.0', '<1.3')).toBe(false)
  })

  it('caret follows node-semver incl. the 0-major pinning', () => {
    expect(matchesRange('1.9.9', '^1.2.3')).toBe(true)
    expect(matchesRange('2.0.0', '^1.2.3')).toBe(false)
    expect(matchesRange('0.12.9', '^0.12.3')).toBe(true)
    expect(matchesRange('0.13.0', '^0.12.3')).toBe(false)
    expect(matchesRange('0.0.3', '^0.0.3')).toBe(true)
    expect(matchesRange('0.0.4', '^0.0.3')).toBe(false)
    expect(matchesRange('1.5.0', '^1.2')).toBe(true)
    expect(matchesRange('0.13.0', '^0')).toBe(true)
    expect(matchesRange('1.0.0', '^0')).toBe(false)
  })

  it('tilde pins the minor when one is given', () => {
    expect(matchesRange('1.2.9', '~1.2.3')).toBe(true)
    expect(matchesRange('1.3.0', '~1.2.3')).toBe(false)
    expect(matchesRange('1.9.0', '~1')).toBe(true)
    expect(matchesRange('2.0.0', '~1')).toBe(false)
  })

  it('prerelease versions need a same-triple prerelease comparator', () => {
    expect(matchesRange('0.13.0-rc.1', '>=0.13.0')).toBe(false)
    expect(matchesRange('0.13.0-rc.1', '>=0.13.0-rc.1')).toBe(true)
    expect(matchesRange('0.13.0-rc.2', '>=0.13.0-rc.1 <0.13.0')).toBe(true)
    expect(matchesRange('0.12.9-beta', '>=0.13.0-rc.1')).toBe(false)
  })

  it('unparseable input never matches (no silent no-op)', () => {
    expect(matchesRange('not-a-version', '>=1.0.0')).toBe(false)
    expect(matchesRange('1.0.0', 'not a range')).toBe(false)
    expect(matchesRange('1.0.0', '')).toBe(false)
    expect(matchesRange('1.0.0', '>=1.2')).toBe(false)
    expect(matchesRange('1.0.0', '1.2.3.4')).toBe(false)
  })

  it('tolerates whitespace and an OR with a bad alternative', () => {
    expect(matchesRange('0.12.5', '  >=0.12.0   <0.13.0  ')).toBe(true)
    expect(matchesRange('1.0.0', 'garbage || >=0.9.0')).toBe(true)
  })
})

describe('sameVersion', () => {
  it('distinguishes build metadata and prerelease', () => {
    expect(sameVersion('1.2.3', '1.2.3+build')).toBe(true)
    expect(sameVersion('1.2.3-rc.1', '1.2.3')).toBe(false)
    expect(sameVersion('nope', '1.2.3')).toBe(false)
  })
})
