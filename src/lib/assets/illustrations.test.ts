// Unit tests for the illustration packs (v0.17 Wave 2) — the library is
// hand-authored offline, so these tests guard the invariants the editor
// and exporters rely on: valid standalone SVG, no external refs, pack
// structure, and well-formed (balanced) markup.

import { describe, it, expect } from 'vitest'
import { ILLUSTRATIONS, ILLUSTRATION_PACKS } from './illustrations'

/** stack-based tag-balance check (attrs may contain quoted '>') */
function tagsBalanced(svg: string): boolean {
  const stack: string[] = []
  const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
  let m: RegExpExecArray | null
  let sawRoot = false
  while ((m = re.exec(svg))) {
    const [full, tag, attrs = ''] = m
    if (full.startsWith('</')) {
      const top = stack.pop()
      if (top !== tag) return false
    } else if (full.endsWith('/>')) {
      // self-closing — no stack entry
    } else {
      stack.push(tag)
    }
    sawRoot = true
  }
  return sawRoot && stack.length === 0
}

describe('illustration packs (v0.17 Wave 2)', () => {
  it('ships 6 packs × 8 illustrations = 48', () => {
    expect(ILLUSTRATION_PACKS).toHaveLength(6)
    expect(ILLUSTRATIONS).toHaveLength(48)
    for (const pack of ILLUSTRATION_PACKS) {
      expect(ILLUSTRATIONS.filter((i) => i.pack === pack.id)).toHaveLength(8)
    }
  })

  it('has unique kebab-case ids with names and 2–4 tags', () => {
    const ids = new Set(ILLUSTRATIONS.map((i) => i.id))
    expect(ids.size).toBe(ILLUSTRATIONS.length)
    for (const i of ILLUSTRATIONS) {
      expect(i.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(i.name.length).toBeGreaterThan(0)
      expect(i.tags.length).toBeGreaterThanOrEqual(2)
      expect(i.tags.length).toBeLessThanOrEqual(4)
      for (const t of i.tags) expect(t).toBe(t.toLowerCase())
    }
  })

  it('every svg is a standalone <svg> with the 200×200 viewBox', () => {
    for (const i of ILLUSTRATIONS) {
      expect(i.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">')).toBe(true)
      expect(i.svg.endsWith('</svg>')).toBe(true)
      // sizing attributes are forbidden on the ROOT tag (viewBox drives layout)
      const root = i.svg.slice(0, i.svg.indexOf('>') + 1)
      expect(root).not.toMatch(/\s(width|height)=/)
      // stroke-width etc. are fine on children
    }
  })

  it('contains no scripts, external refs, embedded images or <use>', () => {
    for (const i of ILLUSTRATIONS) {
      const httpIdx = i.svg.indexOf('http')
      while (httpIdx !== -1) {
        // the only http allowed is the xmlns attribute
        expect(i.svg.slice(Math.max(0, httpIdx - 40), httpIdx)).toContain('xmlns=')
        const next = i.svg.indexOf('http', httpIdx + 4)
        if (next !== -1) expect.fail('more than one http occurrence')
        break
      }
      expect(i.svg).not.toContain('script')
      expect(i.svg.toLowerCase()).not.toContain('href')
      expect(i.svg).not.toContain('<image')
      expect(i.svg).not.toContain('<use')
      expect(i.svg).not.toContain('<style')
    }
  })

  it('markup is balanced (every open tag closes in order)', () => {
    for (const i of ILLUSTRATIONS) expect(tagsBalanced(i.svg)).toBe(true)
  })

  it('each illustration is substantial but bounded (3–40 elements, 200–4000 chars)', () => {
    for (const i of ILLUSTRATIONS) {
      const opens = (i.svg.match(/<[a-zA-Z]/g) ?? []).length
      expect(opens).toBeGreaterThanOrEqual(4) // svg root + ≥3 shapes
      expect(opens).toBeLessThanOrEqual(41)
      expect(i.svg.length).toBeGreaterThanOrEqual(200)
      expect(i.svg.length).toBeLessThanOrEqual(4000)
    }
  })
})
