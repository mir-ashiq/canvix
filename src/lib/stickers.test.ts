import { describe, expect, it } from 'vitest'
import {
  EMOJI_STICKERS,
  STICKER_PACKS,
  VECTOR_STICKER_COUNT,
  findSticker,
  searchStickers,
} from './stickers'
import { stickerDataUrl } from './sticker-image'

// ── v0.22 sticker packs: the library contract ────────────────
// These tests pin the invariants every renderer relies on:
// valid self-contained SVG, unique ids, sane sizes, a working
// search, and the emoji back-compat set.

const all = STICKER_PACKS.flatMap((p) => p.stickers)

describe('sticker packs — library shape', () => {
  it('ships at least 10 packs with at least 8 stickers each', () => {
    expect(STICKER_PACKS.length).toBeGreaterThanOrEqual(10)
    for (const p of STICKER_PACKS) {
      expect(p.stickers.length).toBeGreaterThanOrEqual(8)
      expect(p.id).toMatch(/^[a-z]+$/)
      expect(p.name.length).toBeGreaterThan(2)
      expect(p.icon.length).toBeGreaterThan(0)
    }
  })

  it('ships at least 120 authored vector stickers', () => {
    expect(VECTOR_STICKER_COUNT).toBeGreaterThanOrEqual(120)
    expect(all.length).toBe(VECTOR_STICKER_COUNT)
  })

  it('has unique sticker ids across the whole library', () => {
    const ids = all.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps the 40-emoji starter set unchanged (back-compat)', () => {
    expect(EMOJI_STICKERS.length).toBe(40)
    expect(EMOJI_STICKERS).toContain('😀')
    expect(EMOJI_STICKERS).toContain('❌')
  })
})

describe('sticker packs — SVG validity', () => {
  it('every svg is a self-contained 120×120 viewBox document', () => {
    for (const s of all) {
      expect(s.svg.startsWith('<svg '), `${s.id}: opening tag`).toBe(true)
      expect(s.svg.endsWith('</svg>'), `${s.id}: closing tag`).toBe(true)
      expect(s.svg).toContain('viewBox="0 0 120 120"')
      expect(s.svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    }
  })

  it('every svg carries drawable content (paths/shapes/text)', () => {
    for (const s of all) {
      const drawable = /<(path|circle|rect|ellipse|polygon|text|line|g)\b/.test(s.svg)
      expect(drawable, `${s.id}: has drawable elements`).toBe(true)
    }
  })

  it('never references external resources or scripts', () => {
    for (const s of all) {
      expect(s.svg, `${s.id}: no href`).not.toMatch(/href\s*=/i)
      expect(s.svg, `${s.id}: no script`).not.toMatch(/<script/i)
      // url(#id) internal refs are fine; url(anything-else) is external
      const external = s.svg.match(/url\((?!#)[^)]*\)/g) ?? []
      expect(external, `${s.id}: external url() refs`).toHaveLength(0)
      expect(s.svg, `${s.id}: no external css`).not.toMatch(/@import/i)
    }
  })

  it('uses only the house palette hexes (consistency contract)', () => {
    const allowed = new Set([
      '#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF', '#B983FF', '#FF9F45',
      '#FF7BAC', '#FFFFFF', '#2D2A32', '#FFC24B', '#8A5A3B', '#2D3A5C',
      '#D9C7A7', '#B8860B', '#FFF6D9',
    ])
    for (const s of all) {
      const hexes = s.svg.match(/#[0-9A-Fa-f]{6}\b/g) ?? []
      for (const h of hexes) {
        expect(allowed.has(h.toUpperCase()), `${s.id}: off-palette ${h}`).toBe(true)
      }
    }
  })

  it('keeps markup under 4 KB per sticker (picker loads the whole library)', () => {
    for (const s of all) {
      expect(s.svg.length, `${s.id}: ${s.svg.length} bytes`).toBeLessThan(4096)
    }
  })
})

describe('sticker packs — search', () => {
  it('empty query returns every pack in full', () => {
    const r = searchStickers('')
    expect(r.length).toBe(STICKER_PACKS.length)
    expect(r.reduce((n, x) => n + x.stickers.length, 0)).toBe(VECTOR_STICKER_COUNT)
  })

  it('finds by sticker name, keyword and pack name', () => {
    expect(searchStickers('coffee').flatMap((r) => r.stickers).map((s) => s.id)).toContain('food-coffee')
    expect(searchStickers('valentine').flatMap((r) => r.stickers).map((s) => s.id)).toContain('hearts-arrow')
    expect(searchStickers('travel').length).toBeGreaterThan(0)
  })

  it('multi-term queries are ANDed', () => {
    const r = searchStickers('red heart').flatMap((x) => x.stickers)
    expect(r.map((s) => s.id)).toContain('hearts-red')
    expect(r.some((s) => s.id === 'hearts-blue')).toBe(false)
  })

  it('unknown queries return nothing', () => {
    expect(searchStickers('zzz-not-a-sticker')).toHaveLength(0)
  })
})

describe('sticker packs — lookups', () => {
  it('findSticker resolves ids and rejects unknowns', () => {
    expect(findSticker('faces-grin')?.name).toBeTruthy()
    expect(findSticker('nope-nope')).toBeUndefined()
  })
})

describe('sticker-image — data URL encoding', () => {
  it('encodes as a utf-8 SVG data URL (no base64 round-trip)', () => {
    const url = stickerDataUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="10"/></svg>')
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
    expect(decodeURIComponent(url.slice(url.indexOf(',') + 1))).toContain('<circle')
  })

  it('is deterministic — same markup, same URL (cache keys hold)', () => {
    const a = stickerDataUrl('<svg>a</svg>')
    const b = stickerDataUrl('<svg>a</svg>')
    expect(a).toBe(b)
  })
})
