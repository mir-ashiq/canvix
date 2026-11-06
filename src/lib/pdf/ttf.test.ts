// ttf.test.ts — parser + subsetter against REAL Google-Fonts-
// served TTFs (tests/fixtures/fonts, built by
// scripts/r4_make_fixtures.py from the same legacy-UA css2 path
// the production font ladder uses; SIL OFL, see OFL-LICENSE.txt).
//
// Independent cross-checks: (a) subsets are re-parsed by the
// module's own parser with byte-level glyph comparisons, (b) the
// whole-font checksum identity from the TrueType spec, and (c)
// WHEN python3 + fontTools are installed (dev boxes), fontTools
// itself must load our subset — skipped silently in CI.
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseTtf, subsetTtf, TtfError } from './ttf'

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL('../../../tests/fixtures/fonts/' + name, import.meta.url)))

function sum32(bytes: Uint8Array): number {
  let sum = 0
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    sum = (sum + ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3])) >>> 0
  }
  const rest = bytes.length - (bytes.length % 4)
  let tail = 0
  for (let i = rest; i < bytes.length; i++) tail = (tail << 8) | bytes[i]
  if (bytes.length % 4) {
    for (let i = bytes.length % 4; i < 4; i++) tail <<= 8
    sum = (sum + tail) >>> 0
  }
  return sum >>> 0
}

const codepointsOf = (s: string): number[] => Array.from(s).map((c) => c.codePointAt(0)!)

describe('parseTtf', () => {
  it('reads the metrics of a real Poppins 400', () => {
    const font = parseTtf(fixture('poppins-400.ttf'))
    expect(font.psName).toBe('Poppins-Regular')
    expect(font.unitsPerEm).toBe(1000)
    expect(font.numGlyphs).toBeGreaterThan(80)
    expect(font.ascent).toBeGreaterThan(600)
    expect(font.descent).toBeLessThan(0)
    expect(font.weightClass).toBe(400)
    expect(font.isItalic).toBe(false)
    expect(font.italicAngle).toBe(0)
    const A = font.glyphId(0x41)
    expect(A).toBeGreaterThan(0)
    expect(font.advance(A)).toBeGreaterThan(200)
    // absent codepoint (CJK, not in the latin fixture) → .notdef
    expect(font.glyphId(0x4e2d)).toBe(0)
  })

  it('reads weight + PS name from a Poppins 700', () => {
    const font = parseTtf(fixture('poppins-700.ttf'))
    expect(font.weightClass).toBe(700)
    expect(font.psName).toBe('Poppins-Bold')
  })

  it('reads the Google-served static instance of variable-family Inter at wght 700', () => {
    // validates that the legacy-UA css2 path yields real 700-weight
    // bytes for variable families (not the 400 default instance)
    const font = parseTtf(fixture('inter-700.ttf'))
    expect(font.weightClass).toBe(700)
    expect(font.unitsPerEm).toBeGreaterThan(0)
    const boldA = font.advance(font.glyphId(0x41))
    const regA = parseTtf(fixture('poppins-400.ttf')).advance(parseTtf(fixture('poppins-400.ttf')).glyphId(0x41))
    expect(boldA).toBeGreaterThan(0)
    expect(regA).toBeGreaterThan(0)
  })

  it('exposes composite components (é = e + acute in Poppins)', () => {
    const font = parseTtf(fixture('poppins-400.ttf'))
    const eacute = font.glyphId(0xe9)
    expect(eacute).toBeGreaterThan(0)
    const comps = font.components(eacute)
    expect(comps).toContain(font.glyphId(0x65)) // 'e'
    expect(comps.length).toBe(2)
    // simple glyph has no components
    expect(font.components(font.glyphId(0x41))).toEqual([])
  })

  it('rejects garbage and CFF fonts', () => {
    expect(() => parseTtf(new Uint8Array(8))).toThrow(TtfError)
    const otto = new Uint8Array([0x4f, 0x54, 0x54, 0x4f, 0, 1, 0, 0, 0, 0])
    expect(() => parseTtf(otto)).toThrow(/not a glyf TrueType/)
  })
})

describe('subsetTtf', () => {
  it('subsets to used glyphs and keeps them byte-identical', () => {
    const full = fixture('poppins-400.ttf')
    const font = parseTtf(full)
    const seed = codepointsOf('Hello é')
    const sub = subsetTtf(full, seed)

    // re-parse the subset with the same parser
    const re = parseTtf(sub.bytes)

    // every used codepoint maps through, Z (unused) does not
    for (const cp of seed) {
      if (font.glyphId(cp) === 0) continue
      const oldGid = font.glyphId(cp)
      const newGid = sub.codepointToGid.get(cp)
      expect(newGid).toBe(sub.gidMap.get(oldGid))
      expect(re.glyphId(cp)).toBe(newGid)
      // advance preserved
      expect(sub.advances[newGid!]).toBe(font.advance(oldGid))
    }
    expect(re.glyphId(0x5a)).toBe(0) // 'Z' not in the seed
    expect(re.numGlyphs).toBe(sub.gidMap.size)

    // simple glyph outlines byte-identical ('H')
    const oldH = font.glyphData(font.glyphId(0x48))
    const newH = re.glyphData(sub.codepointToGid.get(0x48)!)
    expect(newH.length).toBe(oldH.length)
    expect(Buffer.from(newH).equals(Buffer.from(oldH))).toBe(true)

    // composite rewritten: é's components remap correctly
    const comps = re.components(sub.codepointToGid.get(0xe9)!)
    expect(comps).toEqual([sub.gidMap.get(font.glyphId(0x65)), sub.gidMap.get(font.components(font.glyphId(0xe9))[1])])

    // whole-font checksum identity (TrueType spec):
    // sum(font) + checkSumAdjustment == 0xB1B0AFBA
    expect(sum32(sub.bytes)).toBe(0xb1b0afba)

    // PDF-side scaling
    expect(sub.scale).toBe(1) // Poppins is 1000 upem
    expect(sub.psName).toBe('Poppins-Regular')
  })

  it('handles non-consecutive codepoints (multi-segment format 4)', () => {
    const full = fixture('poppins-400.ttf')
    const sub = subsetTtf(full, [0x41, 0x5a, 0x61]) // A, Z, a
    const re = parseTtf(sub.bytes)
    for (const cp of [0x41, 0x5a, 0x61]) {
      expect(re.glyphId(cp)).toBe(sub.codepointToGid.get(cp))
    }
    expect(re.glyphId(0x42)).toBe(0) // B sits in the gap between segments
    expect(sum32(sub.bytes)).toBe(0xb1b0afba)
  })

  it('produces a .notdef-only font for an empty seed', () => {
    const sub = subsetTtf(fixture('poppins-400.ttf'), [])
    const re = parseTtf(sub.bytes)
    expect(re.numGlyphs).toBe(1)
    expect(re.glyphId(0x41)).toBe(0)
    expect(sum32(sub.bytes)).toBe(0xb1b0afba)
  })

  it('ignores astral codepoints and unmapped seeds (fail-closed)', () => {
    const sub = subsetTtf(fixture('poppins-400.ttf'), [0x1f600, 0x4e2d, 0x41])
    expect(sub.codepointToGid.has(0x1f600)).toBe(false)
    expect(sub.codepointToGid.has(0x4e2d)).toBe(false)
    expect(sub.codepointToGid.has(0x41)).toBe(true)
  })

  it('emits subsets fontTools can load (dev-machine cross-check)', () => {
    const sub = subsetTtf(fixture('poppins-400.ttf'), codepointsOf('Grüße aus München — déjà vu'))
    const path = `/tmp/r4-subset-crosscheck-${Date.now()}.ttf`
    try {
      execFileSync('python3', ['-c', 'import fontTools.ttLib'], { stdio: 'ignore' })
    } catch {
      return // fontTools not installed (CI) — the in-suite checks above cover structure
    }
    writeFileSync(path, sub.bytes)
    try {
      execFileSync(
        'python3',
        ['-c', 'import sys; from fontTools.ttLib import TTFont; f = TTFont(sys.argv[1]); assert len(f.getGlyphOrder()) == f["maxp"].numGlyphs; f.getBestCmap()', path],
        { stdio: 'ignore' },
      )
    } finally {
      rmSync(path, { force: true })
    }
  })
})
